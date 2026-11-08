import { PermissionFlagsBits } from 'discord.js';
import { COMMAND_SETTINGS_TEXT } from '../config/commandSettings.js';
import { resolveCommandAlias } from '../config/commands/commandAliases.js';
import { getFromDb, setInDb } from './database.js';
import { Mutex } from './mutex.js';
import { logger } from './logger.js';

// ==========================================
// Makes src/config/commandSettings.js work.
// You do NOT need to edit this file. Edit commandSettings.js instead.
//
//   findCommandByTrigger()  ->  which command does ".word" run?   (messageCreate.js)
//   checkCommandAccess()    ->  may this person use it?            (permissionGuard.js)
// ==========================================

const TRIGGER_FORMAT = /^[a-z0-9_-]{1,32}$/;

// ------------------------------------------
// READING THE SETTINGS TEXT
// One command per line:
//
//   ban      [ 'ban' 'bn' ]      [ 'ModerateMembers' '123456789012345678' ]
//   name     words               who can use it   (default / everyone / admin / owner / off / permission / list)
// ------------------------------------------

// "[ 'ban' 'bn' ]" or "ban, bn" or "default"  ->  ['ban', 'bn']
function readList(value) {
    return (String(value).match(/'[^']*'|"[^"]*"|[^\s,\[\]]+/g) ?? [])
        .map((item) => item.replace(/^['"]|['"]$/g, '').trim())
        .filter(Boolean);
}

export function parseCommandSettings(text) {
    const result = new Map();

    for (const rawLine of String(text ?? '').split('\n')) {
        // notes: everything after # or // on a line is ignored
        const line = rawLine.replace(/(#|\/\/).*$/, '').trim();

        if (!line) continue;

        // name   [ words ]   who  (the words must be inside [ ])
        const match = /^([A-Za-z0-9_-]+)\s*(\[[^\]]*\])\s*(.*)$/.exec(line);

        if (!match) {
            logger.warn(`[commandSettings] this line was not understood and was skipped: "${line}"`);
            continue;
        }

        const name = match[1].toLowerCase();
        const triggers = readList(match[2]);
        const whoText = match[3].trim();
        const who = readList(whoText);
        const entry = { triggers, enabled: true, access: 'default' };

        if (who.length === 1 && /^(off|disabled?)$/i.test(who[0])) {
            entry.enabled = false;
        } else if (who.length > 1 || /^\[/.test(whoText)) {
            entry.access = who;
        } else if (who.length === 1) {
            entry.access = who[0];
        }

        if (result.has(name)) logger.warn(`[commandSettings] "${name}" is written twice, the last one is used`);

        result.set(name, entry);
    }

    return result;
}

// ------------------------------------------
// SETTINGS PER SERVER
// The file (commandSettings.js) is the base for every server.
// The server owner can change things for THEIR server with  .cmdset  (saved in the database).
// Those changes are put on top of the file.
// ------------------------------------------

// Builds the "which word runs which command" table from a Map of settings
function buildSettings(entries) {
    const triggerMap = new Map();

    for (const [name, entry] of entries) {
        let triggers = (Array.isArray(entry.triggers) ? entry.triggers : [])
            .map((word) => String(word).trim().toLowerCase().replace(/^\./, ''))
            .filter((word) => TRIGGER_FORMAT.test(word));

        // nothing usable written: use the normal command name so it never becomes unreachable
        if (!triggers.length) {
            if (Array.isArray(entry.triggers) && entry.triggers.length) {
                logger.warn(`[commandSettings] "${name}" has no usable triggers, using ".${name}"`);
            }
            triggers = [name];
        }

        for (const word of triggers) {
            if (triggerMap.has(word) && triggerMap.get(word) !== name) {
                logger.warn(`[commandSettings] ".${word}" is used by "${triggerMap.get(word)}" and "${name}". "${triggerMap.get(word)}" keeps it.`);
                continue;
            }

            triggerMap.set(word, name);
        }
    }

    return { entries, triggerMap };
}

const baseSettings = buildSettings(parseCommandSettings(COMMAND_SETTINGS_TEXT));

const guildCache = new Map(); // serverId -> settings (file + that server's changes)

const overridesKey = (guildId) => `command_settings_${guildId}`;

// What the owner changed with .cmdset:  { ban: { triggers: [...], access: ..., enabled: false } }
export async function getOverrides(guildId) {
    const data = await getFromDb(overridesKey(guildId), {});

    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

export async function getGuildSettings(guildId) {
    if (!guildId) return baseSettings;

    const cached = guildCache.get(guildId);

    if (cached) return cached;

    const overrides = await getOverrides(guildId);
    const entries = new Map([...baseSettings.entries].map(([name, entry]) => [name, { ...entry }]));

    for (const [name, change] of Object.entries(overrides)) {
        const key = name.toLowerCase();

        entries.set(key, { ...(entries.get(key) ?? {}), ...change });
    }

    const settings = buildSettings(entries);

    guildCache.set(guildId, settings);

    return settings;
}

// patch = { triggers?, access?, enabled? }     patch = null  ->  go back to the file's settings
export async function saveOverride(guildId, name, patch) {
    const key = overridesKey(guildId);

    await Mutex.runExclusive(key, async () => {
        const data = { ...(await getOverrides(guildId)) };

        if (patch === null) {
            delete data[name];
        } else {
            data[name] = { ...(data[name] ?? {}), ...patch };
        }

        await setInDb(key, data);
    });

    guildCache.delete(guildId);
}

// ------------------------------------------
// TRIGGERS
// ------------------------------------------

// Returns the command that ".word" should run in this server, or null for nothing.
export async function findCommandByTrigger(client, word, guildId = null) {
    const { entries, triggerMap } = await getGuildSettings(guildId);
    const trigger = String(word ?? '').toLowerCase();

    const owner = triggerMap.get(trigger);

    if (owner) {
        const command = client.commands.get(owner);

        if (!command) return null;                              // the settings name a command that is not installed
        if (entries.get(owner)?.enabled === false) return null; // turned off

        return command;
    }

    // Not written in the settings: the old way (command name or old alias) ...
    const old = client.commands.get(trigger) ?? client.commands.get(resolveCommandAlias(trigger));

    if (!old) return null;

    // ... but if that command IS in the settings, its words were replaced, so the old word stops working
    if (entries.has(String(old.data?.name ?? '').toLowerCase())) return null;

    return old;
}

// The command name for a word the owner typed (a command name, or any word that runs it), or null
export async function resolveCommandName(client, guildId, word) {
    const { triggerMap } = await getGuildSettings(guildId);
    const clean = String(word ?? '').toLowerCase().replace(/^\./, '');

    const fromWords = triggerMap.get(clean);

    if (fromWords && client.commands.get(fromWords)) return fromWords;

    const command = client.commands.get(clean) ?? client.commands.get(resolveCommandAlias(clean));

    return command?.data?.name?.toLowerCase() ?? null;
}

export { TRIGGER_FORMAT };

// ------------------------------------------
// ACCESS
// ------------------------------------------

const warned = new Set();

function warnOnce(text) {
    if (warned.has(text)) return;

    warned.add(text);
    logger.warn(`[commandSettings] ${text}`);
}

// "BanMembers" / "ban_members" / "banmembers"  ->  "BanMembers", or undefined
export function findPermissionName(text) {
    const clean = String(text).toLowerCase().replace(/[\s_-]/g, '');

    return Object.keys(PermissionFlagsBits).find((name) => name.toLowerCase() === clean);
}

function matchesRule(member, rawRule) {
    const rule = String(rawRule).trim();
    const lower = rule.toLowerCase();

    if (lower === 'everyone') return true;
    if (lower === 'owner') return false; // the owner is allowed before we get here
    if (lower === 'admin') return member.permissions.has(PermissionFlagsBits.Administrator);

    if (/^\d{5,25}$/.test(rule)) return member.roles.cache.has(rule);          // role ID

    if (/^user:\d{5,25}$/i.test(rule)) return member.id === rule.slice(5);     // user ID

    const permissionName = findPermissionName(rule);

    if (!permissionName) {
        warnOnce(`"${rule}" is not a permission name, role ID or user:ID. It was ignored.`);
        return false;
    }

    return member.permissions.has(PermissionFlagsBits[permissionName]);
}

// 'default'  = nothing written for it: use the built-in rule
// 'allow'    = the settings let this person use it
// 'deny'     = the settings do not
// 'disabled' = the command is turned off
export async function checkCommandAccess(interaction, command) {
    const { entries } = await getGuildSettings(interaction.guildId ?? interaction.guild?.id ?? null);
    const entry = entries.get(String(command?.data?.name ?? '').toLowerCase());

    if (!entry) return 'default';
    if (entry.enabled === false) return 'disabled';

    const access = entry.access ?? 'default';

    if (access === 'default') return 'default';
    if (access === 'everyone') return 'allow';

    const member = interaction.member;

    if (!member) return 'deny';
    if (member.guild?.ownerId === member.id) return 'allow';

    const rules = [].concat(access);

    return rules.some((rule) => matchesRule(member, rule)) ? 'allow' : 'deny';
}

// When the settings file lets someone in, the command's own permission checks inside its code
// ("do you have Ban Members?") must not block them again. This makes those checks say yes.
export function grantAllPermissions(interaction) {
    const member = interaction.member;

    if (!member?.permissions) return;

    const wrap = (target) => (key) => {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
    };

    const permissions = new Proxy(member.permissions, {
        get(target, key) {
            if (key === 'has' || key === 'any') return () => true;
            if (key === 'missing') return () => [];
            return wrap(target)(key);
        },
    });

    try {
        interaction.member = new Proxy(member, {
            get(target, key) {
                if (key === 'permissions') return permissions;
                return wrap(target)(key);
            },
        });

        Object.defineProperty(interaction, 'memberPermissions', {
            value: permissions,
            configurable: true,
            writable: true,
        });
    } catch (error) {
        logger.warn('[commandSettings] could not widen permissions for this command', error);
    }
}
