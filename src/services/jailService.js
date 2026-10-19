import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';

// ==========================================
// JAIL SYSTEM
// .jailsetup builds everything: a "Jailed" role, a "Jail" category with a chat channel
// and a staff log channel, and hides every other channel from the Jailed role.
// ==========================================

export const DEFAULT_REASON = 'No reason provided';

const JAIL_ROLE_NAME = 'Jailed';
const CATEGORY_NAME = 'Jail';
const CHAT_NAME = 'jail-chat';
const LOGS_NAME = 'jail-logs';

const configCache = new Map();   // guildId -> config or null

const configKey = (guildId) => `jail_config_${guildId}`;

export async function getJailConfig(guildId) {
    if (configCache.has(guildId)) return configCache.get(guildId);

    const config = await getFromDb(configKey(guildId), null);
    configCache.set(guildId, config);

    return config;
}

async function saveJailConfig(guildId, config) {
    configCache.set(guildId, config);
    await setInDb(configKey(guildId), config);
}

// The ids of the three things the setup made
export function jailChannelIds(config) {
    return [config?.categoryId, config?.chatChannelId, config?.logChannelId].filter(Boolean);
}

// Gets the Jailed role, or tells the moderator that the setup was not done yet
export async function requireJail(guild) {
    const config = await getJailConfig(guild.id);

    const role = config?.roleId
        ? guild.roles.cache.get(config.roleId) ?? await guild.roles.fetch(config.roleId).catch(() => null)
        : null;

    if (!config || !role) {
        throw new TitanBotError(
            'Jail is not set up',
            ErrorTypes.VALIDATION,
            'Jail is not set up yet. An administrator must run `.jailsetup` first.',
        );
    }

    return { config, role };
}

// Roles that can be saved and given back (not @everyone, not bot/booster roles, not the jail role)
export function backupableRoleIds(member, jailRoleId) {
    return [...member.roles.cache.values()]
        .filter((role) => role.id !== member.guild.id && !role.managed && role.id !== jailRoleId)
        .map((role) => role.id);
}

export function shownReason(reason) {
    return reason === DEFAULT_REASON ? 'no reason' : reason;
}

// ==========================================
// SETUP
// ==========================================

function onlyAllowedBy(me, permissions) {
    // The bot can only hand out permissions that it has itself
    return me.permissions.has(PermissionFlagsBits.Administrator)
        ? permissions
        : permissions.filter((permission) => me.permissions.has(permission));
}

// Stops the Jailed role from seeing a channel
export async function lockChannelForJail(channel, role, reason = 'Jail setup') {
    const existing = channel.permissionOverwrites?.cache?.get(role.id);

    if (existing?.deny?.has(PermissionFlagsBits.ViewChannel)) return 'already';

    await channel.permissionOverwrites.edit(role, { ViewChannel: false }, { reason });

    return 'locked';
}

export async function setupJail(guild, { setupBy = null } = {}) {
    const me = guild.members.me ?? await guild.members.fetchMe();

    if (
        !me.permissions.has(PermissionFlagsBits.Administrator) &&
        !(me.permissions.has(PermissionFlagsBits.ManageRoles) && me.permissions.has(PermissionFlagsBits.ManageChannels))
    ) {
        throw new TitanBotError(
            'Bot permissions missing',
            ErrorTypes.PERMISSION,
            'I need the **Manage Roles** and **Manage Channels** permissions to set up jail.',
        );
    }

    const existing = await getJailConfig(guild.id);
    const reason = 'Jail setup';
    const result = {
        createdRole: false,
        createdCategory: false,
        createdChat: false,
        createdLogs: false,
        locked: 0,
        alreadyLocked: 0,
        failed: 0,
    };

    // 1) the Jailed role
    let role =
        (existing?.roleId && guild.roles.cache.get(existing.roleId)) ||
        guild.roles.cache.find((r) => r.name === JAIL_ROLE_NAME && !r.managed);

    if (!role) {
        role = await guild.roles.create({
            name: JAIL_ROLE_NAME,
            color: 0x808080,
            permissions: [],
            mentionable: false,
            reason,
        });
        result.createdRole = true;
    }

    // Staff = roles that can jail people (Administrator or Timeout Members)
    const staffRoles = [...guild.roles.cache.values()].filter(
        (r) =>
            r.id !== guild.id &&
            r.id !== role.id &&
            !r.managed &&
            (r.permissions.has(PermissionFlagsBits.Administrator) ||
                r.permissions.has(PermissionFlagsBits.ModerateMembers)),
    );

    const P = PermissionFlagsBits;
    const botAllow = onlyAllowedBy(me, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages]);

    const botOverwrite = me.permissions.has(P.Administrator)
        ? []
        : [{ id: me.id, allow: botAllow }];

    const staffView = staffRoles.map((r) => ({
        id: r.id,
        allow: onlyAllowedBy(me, [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages]),
    }));

    // 2) the Jail category (nobody sees it except the jailed and the staff)
    const categoryOverwrites = [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: role.id, allow: [P.ViewChannel] },
        ...botOverwrite,
        ...staffView,
    ];

    let category =
        (existing?.categoryId && guild.channels.cache.get(existing.categoryId)) ||
        guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME);

    if (!category) {
        category = await guild.channels.create({
            name: CATEGORY_NAME,
            type: ChannelType.GuildCategory,
            permissionOverwrites: categoryOverwrites,
            reason,
        });
        result.createdCategory = true;
    } else {
        await category.permissionOverwrites.set(categoryOverwrites, reason).catch(() => {});
    }

    // 3) #jail-chat: the jailed person talks to the staff here
    const chatOverwrites = [
        { id: guild.id, deny: [P.ViewChannel] },
        {
            id: role.id,
            allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles],
            deny: [P.MentionEveryone],
        },
        ...botOverwrite,
        ...staffView,
    ];

    let chat =
        (existing?.chatChannelId && guild.channels.cache.get(existing.chatChannelId)) ||
        guild.channels.cache.find((c) => c.parentId === category.id && c.name === CHAT_NAME);

    if (!chat) {
        chat = await guild.channels.create({
            name: CHAT_NAME,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: 'You are in jail. Wait here for a moderator to talk to you.',
            permissionOverwrites: chatOverwrites,
            reason,
        });
        result.createdChat = true;
    } else {
        await chat.permissionOverwrites.set(chatOverwrites, reason).catch(() => {});
    }

    // 4) #jail-logs: staff only, every jail / unjail / restore is written here
    const logOverwrites = [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: role.id, deny: [P.ViewChannel] },
        ...botOverwrite,
        ...staffView,
    ];

    let logs =
        (existing?.logChannelId && guild.channels.cache.get(existing.logChannelId)) ||
        guild.channels.cache.find((c) => c.parentId === category.id && c.name === LOGS_NAME);

    if (!logs) {
        logs = await guild.channels.create({
            name: LOGS_NAME,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: 'Staff only. Jail, unjail and restore history.',
            permissionOverwrites: logOverwrites,
            reason,
        });
        result.createdLogs = true;
    } else {
        await logs.permissionOverwrites.set(logOverwrites, reason).catch(() => {});
    }

    // 5) hide every other channel from the Jailed role
    const jailIds = new Set([category.id, chat.id, logs.id]);

    for (const channel of guild.channels.cache.values()) {
        if (jailIds.has(channel.id)) continue;
        if (channel.isThread?.() || !channel.permissionOverwrites) continue;

        try {
            const status = await lockChannelForJail(channel, role, reason);

            if (status === 'locked') result.locked++;
            else result.alreadyLocked++;
        } catch (error) {
            result.failed++;
            logger.debug(`Jail setup could not lock ${channel.name}: ${error.message}`);
        }
    }

    const config = {
        roleId: role.id,
        categoryId: category.id,
        chatChannelId: chat.id,
        logChannelId: logs.id,
        setupBy,
        setupAt: Date.now(),
    };

    await saveJailConfig(guild.id, config);

    if (result.createdChat) {
        await chat
            .send({
                embeds: [
                    createEmbed({
                        title: 'Jail chat',
                        description:
                            'If you are here, a moderator put you in jail.\n' +
                            'Be patient and stay respectful. A moderator will talk to you here.',
                        color: 'warning',
                    }),
                ],
            })
            .catch(() => {});
    }

    return { config, role, category, chat, logs, staffRoles, result };
}

// ==========================================
// MESSAGES
// ==========================================

export function buildJailDm({ guild, reason }) {
    return createEmbed({
        title: 'You have been jailed',
        description:
            `You have been jailed in **${guild.name}** for: **${shownReason(reason)}**\n` +
            'You can only see the jail chat until a moderator lets you out.',
        color: 'error',
        thumbnail: guild.iconURL?.({ size: 256 }) || null,
    });
}

export function buildUnjailDm({ guild, reason }) {
    return createEmbed({
        title: 'You have been let out of jail',
        description: `You have been let out of jail in **${guild.name}**.\nReason: **${shownReason(reason)}**`,
        color: 'success',
        thumbnail: guild.iconURL?.({ size: 256 }) || null,
    });
}

// Writes a line into #jail-logs (if it exists)
export async function writeJailLog(guild, config, { title, description, color = 'primary' }) {
    try {
        const channel =
            guild.channels.cache.get(config.logChannelId) ??
            await guild.channels.fetch(config.logChannelId).catch(() => null);

        if (!channel) return;

        await channel.send({
            embeds: [createEmbed({ title, description, color })],
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        logger.debug(`Could not write to the jail log: ${error.message}`);
    }
}
