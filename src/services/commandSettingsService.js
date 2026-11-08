import {
    getGuildSettings,
    getOverrides,
    saveOverride,
    resolveCommandName,
    findPermissionName,
    TRIGGER_FORMAT,
} from '../utils/commandSettingsEngine.js';

// ==========================================
// .cmdset  -  the server owner changes command settings from Discord.
// What the owner changes is saved for THIS server only and is put on top of
// src/config/commandSettings.js.  (.cmdset reset ban  = back to the file.)
// ==========================================

const PREFIX = '.';

// the command that lets the owner in again must never be turned off or changed
const PROTECTED = new Set(['cmdset']);

export const CMDSET_HELP = [
    '**Command settings** (server owner only)',
    '`.cmdset show ban` see a command',
    '`.cmdset words ban ban bn` set the words that run it (replaces the old ones)',
    '`.cmdset add ban bn` / `.cmdset remove ban bn` add or remove one word',
    '`.cmdset who ban ModerateMembers @Role` who can use it',
    '`.cmdset who ban default` / `everyone` / `admin` / `owner`',
    '`.cmdset off ban` / `.cmdset on ban` turn it off or on',
    '`.cmdset reset ban` go back to the settings file',
    '`.cmdset list` everything changed in this server',
    '',
    'For `who` you can mix permission names (BanMembers, KickMembers, ModerateMembers, ManageMessages...), @roles and @users. Anyone who matches one of them can use the command.',
].join('\n');

// "[ 'ban' 'bn' ]"  or  "ban, bn"  ->  ['ban', 'bn']
function readWords(text) {
    return String(text ?? '').replace(/[\[\],'"]/g, ' ').split(/\s+/).filter(Boolean);
}

// how an access setting is shown to the owner
function describeWho(access) {
    if (access == null || access === 'default') return 'the built-in rule';
    if (access === 'everyone') return 'everyone';
    if (access === 'owner') return 'only the server owner';

    return [].concat(access)
        .map((item) => {
            if (/^\d{5,25}$/.test(item)) return `<@&${item}>`;
            if (/^user:\d+$/i.test(item)) return `<@${item.slice(5)}>`;
            if (String(item).toLowerCase() === 'admin') return '`Administrator`';
            return `\`${item}\``;
        })
        .join(' or ');
}

function describeCommand(name, entry, changed) {
    const words = (entry?.triggers?.length ? entry.triggers : [name]).map((word) => `\`${PREFIX}${word}\``).join(' ');

    return [
        `**${name}** ${changed ? '(changed in this server)' : '(from the settings file)'}`,
        `words: ${words}`,
        `who can use it: ${describeWho(entry?.access)}`,
        `status: ${entry?.enabled === false ? 'OFF' : 'on'}`,
    ].join('\n');
}

// Turns what the owner typed after "who" into a setting.  Returns { access } or { enabled: false } or { error }
function readWho(tokens, guild) {
    if (!tokens.length) return { error: 'Tell me who can use it. Example: `.cmdset who ban ModerateMembers @Mods`' };

    const lower = tokens.map((token) => token.toLowerCase());

    for (const keyword of ['default', 'everyone', 'owner', 'off']) {
        if (lower.includes(keyword)) {
            if (tokens.length > 1) return { error: `\`${keyword}\` has to be written alone, without anything else` };

            return keyword === 'off' ? { enabled: false } : { access: keyword };
        }
    }

    const access = [];

    for (const token of tokens) {
        let match;

        if ((match = /^<@&(\d+)>$/.exec(token)) || /^\d{5,25}$/.test(token)) {
            const roleId = match ? match[1] : token;

            if (!guild.roles.cache.has(roleId)) return { error: `I can't find the role \`${roleId}\` in this server` };

            access.push(roleId);
        } else if ((match = /^<@!?(\d+)>$/.exec(token))) {
            access.push(`user:${match[1]}`);
        } else if (/^user:\d{5,25}$/i.test(token)) {
            access.push(`user:${token.slice(5)}`);
        } else if (token.toLowerCase() === 'admin') {
            access.push('admin');
        } else if (findPermissionName(token)) {
            access.push(findPermissionName(token));
        } else {
            return {
                error: `\`${token}\` is not a permission, role or user. Try \`BanMembers\`, \`KickMembers\`, \`ModerateMembers\`, \`ManageMessages\`, a @role or a @user`,
            };
        }
    }

    return { access: [...new Set(access)] };
}

// Cleans the words and checks them. Returns { words } or { error }
async function checkWords(client, guildId, name, rawWords) {
    const words = [...new Set(rawWords.map((word) => word.toLowerCase().replace(/^\./, '')))];

    if (!words.length) return { error: 'Give me at least one word. Example: `.cmdset words ban ban bn`' };

    const settings = await getGuildSettings(guildId);

    for (const word of words) {
        if (!TRIGGER_FORMAT.test(word)) {
            return { error: `\`${word}\` can only have letters, numbers, - and _ (like \`ban\` or \`bn\`)` };
        }

        const owner = settings.triggerMap.get(word);

        if (owner && owner !== name) {
            return { error: `\`${PREFIX}${word}\` already runs **${owner}**. Change **${owner}** first, then use that word here.` };
        }

        if (!owner && client.commands.get(word)?.data?.name?.toLowerCase() !== name && client.commands.get(word)) {
            return { error: `\`${PREFIX}${word}\` is the name of another command` };
        }
    }

    return { words };
}

// Runs one .cmdset line. Returns the text to reply with.
export async function runCmdSet({ client, guild, text }) {
    const tokens = readWords(text);
    const sub = tokens.shift()?.toLowerCase();

    if (!sub || sub === 'help') return CMDSET_HELP;

    if (sub === 'list') {
        const overrides = await getOverrides(guild.id);
        const names = Object.keys(overrides);

        if (!names.length) return 'Nothing was changed in this server. Everything uses the settings file.';

        const settings = await getGuildSettings(guild.id);
        const lines = names.slice(0, 20).map((name) => {
            const entry = settings.entries.get(name);
            const words = (entry?.triggers?.length ? entry.triggers : [name]).map((word) => `${PREFIX}${word}`).join(' ');

            return `**${name}**: ${words} | ${describeWho(entry?.access)}${entry?.enabled === false ? ' | OFF' : ''}`;
        });

        return `**Changed in this server**\n${lines.join('\n')}${names.length > 20 ? `\n...and ${names.length - 20} more` : ''}`;
    }

    const wanted = tokens.shift();

    if (!wanted) return `Tell me which command. Example: \`.cmdset ${sub} ban\`\n\n${CMDSET_HELP}`;

    const name = await resolveCommandName(client, guild.id, wanted);

    if (!name) return `⚠️ I don't know a command called **${wanted}**`;

    const settings = await getGuildSettings(guild.id);
    const overrides = await getOverrides(guild.id);
    const entry = settings.entries.get(name);
    const currentWords = entry?.triggers?.length ? entry.triggers : [name];

    if (sub === 'show') return describeCommand(name, entry, Boolean(overrides[name]));

    if (!['words', 'triggers', 'set', 'add', 'remove', 'who', 'access', 'on', 'off', 'reset'].includes(sub)) {
        return `⚠️ I don't know \`${sub}\`.\n\n${CMDSET_HELP}`;
    }

    if (PROTECTED.has(name)) return '⚠️ This command can not be changed, so you can never lock yourself out.';

    // ----- words -----
    if (['words', 'triggers', 'set', 'add', 'remove'].includes(sub)) {
        const typed = tokens;
        let list;

        if (sub === 'add') {
            list = [...currentWords, ...typed];
        } else if (sub === 'remove') {
            const gone = new Set(typed.map((word) => word.toLowerCase().replace(/^\./, '')));
            const missing = [...gone].filter((word) => !currentWords.includes(word));

            if (missing.length) return `⚠️ **${name}** is not using ${missing.map((word) => `\`${PREFIX}${word}\``).join(' ')}`;

            list = currentWords.filter((word) => !gone.has(word));

            if (!list.length) return '⚠️ A command needs at least one word. Use `.cmdset words` to give it a new one.';
        } else {
            list = typed;
        }

        const checked = await checkWords(client, guild.id, name, list);

        if (checked.error) return `⚠️ ${checked.error}`;

        await saveOverride(guild.id, name, { triggers: checked.words });

        return `✅ **${name}** now works with: ${checked.words.map((word) => `\`${PREFIX}${word}\``).join(' ')}`;
    }

    // ----- who can use it -----
    if (sub === 'who' || sub === 'access') {
        const result = readWho(tokens, guild);

        if (result.error) return `⚠️ ${result.error}`;

        if (result.enabled === false) {
            await saveOverride(guild.id, name, { enabled: false });
            return `✅ **${name}** is now OFF. Turn it on with \`.cmdset on ${name}\``;
        }

        await saveOverride(guild.id, name, { access: result.access });

        return `✅ **${name}** can now be used by: ${describeWho(result.access)}`;
    }

    // ----- on / off -----
    if (sub === 'on' || sub === 'off') {
        await saveOverride(guild.id, name, { enabled: sub === 'on' });

        return sub === 'on' ? `✅ **${name}** is on` : `✅ **${name}** is now OFF. Turn it on with \`.cmdset on ${name}\``;
    }

    // ----- reset -----
    await saveOverride(guild.id, name, null);

    return `✅ **${name}** is back to the settings file`;
}
