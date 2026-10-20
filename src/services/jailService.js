import {
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { Mutex } from '../utils/mutex.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';

// ==========================================
// JAIL SYSTEM
// .jailsetup builds everything:
//   - a "Jailed" role
//   - a "Jail" category with  #jail-ticket (a button to open a ticket)  and  #jail-logs (staff only)
//   - every other channel and voice channel is hidden from the Jailed role
// A jailed person presses the button to open a private ticket and talks to the staff there.
// ==========================================

export const DEFAULT_REASON = 'No reason provided';

const JAIL_ROLE_NAME = 'Jailed';
const CATEGORY_NAME = 'Jail';
const PANEL_NAME = 'jail-ticket';
const OLD_CHAT_NAME = 'jail-chat';   // the old setup made this, it is turned into the ticket channel
const LOGS_NAME = 'jail-logs';

export const TICKET_OPEN_ID = 'jailticket_open';
export const TICKET_CLOSE_ID = 'jailticket_close';

const configCache = new Map();   // guildId -> config or null

const configKey = (guildId) => `jail_config_${guildId}`;
const ticketsKey = (guildId) => `jail_tickets_${guildId}`;   // { userId: channelId }
const recordsKey = (guildId) => `jail_records_${guildId}`;   // { userId: { reason, moderatorId, at } }

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

export function panelChannelIdOf(config) {
    return config?.panelChannelId ?? config?.chatChannelId ?? null;
}

// The ids of the things the setup made (the category, the ticket channel, the log channel)
export function jailChannelIds(config) {
    return [config?.categoryId, panelChannelIdOf(config), config?.logChannelId].filter(Boolean);
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

// Staff = roles that can jail people (Administrator or Timeout Members)
export function getStaffRoles(guild, jailRole) {
    return [...guild.roles.cache.values()].filter(
        (role) =>
            role.id !== guild.id &&
            role.id !== jailRole?.id &&
            !role.managed &&
            (role.permissions.has(PermissionFlagsBits.Administrator) ||
                role.permissions.has(PermissionFlagsBits.ModerateMembers)),
    );
}

// The bot can only hand out permissions that it has itself
function onlyAllowedBy(me, permissions) {
    return me.permissions.has(PermissionFlagsBits.Administrator)
        ? permissions
        : permissions.filter((permission) => me.permissions.has(permission));
}

function botOverwriteFor(me) {
    const P = PermissionFlagsBits;

    return me.permissions.has(P.Administrator)
        ? []
        : [{
            id: me.id,
            allow: onlyAllowedBy(me, [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages, P.ManageChannels]),
        }];
}

function staffOverwritesFor(me, staffRoles) {
    const P = PermissionFlagsBits;

    return staffRoles.map((role) => ({
        id: role.id,
        allow: onlyAllowedBy(me, [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages]),
    }));
}

// ==========================================
// HIDING CHANNELS FROM THE JAILED ROLE
// ==========================================

const VOICE_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

// Stops the Jailed role from seeing a channel (voice channels: also from joining it)
export async function lockChannelForJail(channel, role, reason = 'Jail setup') {
    const existing = channel.permissionOverwrites?.cache?.get(role.id);

    if (existing?.deny?.has(PermissionFlagsBits.ViewChannel)) return 'already';

    const denied = { ViewChannel: false };

    if (VOICE_TYPES.has(channel.type)) {
        denied.Connect = false;
        denied.Speak = false;
    }

    await channel.permissionOverwrites.edit(role, denied, { reason });

    return 'locked';
}

// ==========================================
// SETUP
// ==========================================

export async function setupJail(guild, { setupBy = null } = {}) {
    const P = PermissionFlagsBits;
    const me = guild.members.me ?? await guild.members.fetchMe();

    if (
        !me.permissions.has(P.Administrator) &&
        !(me.permissions.has(P.ManageRoles) && me.permissions.has(P.ManageChannels))
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
        createdPanel: false,
        createdLogs: false,
        convertedOldChat: false,
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

    const staffRoles = getStaffRoles(guild, role);
    const botOverwrite = botOverwriteFor(me);
    const staffOverwrites = staffOverwritesFor(me, staffRoles);

    // 2) the Jail category
    const categoryOverwrites = [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: role.id, allow: [P.ViewChannel] },
        ...botOverwrite,
        ...staffOverwrites,
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

    // 3) #jail-ticket: jailed people can see it but not write. They press a button to open a ticket.
    const panelOverwrites = [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: role.id, allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.AddReactions] },
        ...botOverwrite,
        ...staffOverwrites,
    ];

    const panelId = panelChannelIdOf(existing);

    let panel =
        (panelId && guild.channels.cache.get(panelId)) ||
        guild.channels.cache.find((c) => c.parentId === category.id && (c.name === PANEL_NAME || c.name === OLD_CHAT_NAME));

    if (!panel) {
        panel = await guild.channels.create({
            name: PANEL_NAME,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: 'If you are jailed, press the button to open a ticket and talk to a moderator.',
            permissionOverwrites: panelOverwrites,
            reason,
        });
        result.createdPanel = true;
    } else {
        // The old setup made a #jail-chat. It is turned into the ticket channel.
        if (panel.name !== PANEL_NAME) {
            await panel.setName(PANEL_NAME, reason).catch(() => {});
            result.convertedOldChat = true;
        }

        await panel.setTopic?.('If you are jailed, press the button to open a ticket and talk to a moderator.', reason).catch(() => {});
        await panel.permissionOverwrites.set(panelOverwrites, reason).catch(() => {});
    }

    // 4) #jail-logs: staff only
    const logOverwrites = [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: role.id, deny: [P.ViewChannel] },
        ...botOverwrite,
        ...staffOverwrites,
    ];

    let logs =
        (existing?.logChannelId && guild.channels.cache.get(existing.logChannelId)) ||
        guild.channels.cache.find((c) => c.parentId === category.id && c.name === LOGS_NAME);

    if (!logs) {
        logs = await guild.channels.create({
            name: LOGS_NAME,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: 'Staff only. Jail, unjail, ticket and restore history.',
            permissionOverwrites: logOverwrites,
            reason,
        });
        result.createdLogs = true;
    } else {
        await logs.permissionOverwrites.set(logOverwrites, reason).catch(() => {});
    }

    // 5) hide EVERY other channel and voice channel from the Jailed role
    for (const channel of guild.channels.cache.values()) {
        if (channel.id === category.id || channel.parentId === category.id) continue;
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

    // 6) the "Open Ticket" button message
    if (existing?.panelMessageId) {
        const old = await panel.messages?.fetch?.(existing.panelMessageId).catch(() => null);
        await old?.delete?.().catch(() => {});
    }

    const panelMessage = await panel
        .send({
            embeds: [
                createEmbed({
                    title: 'Jail ticket',
                    description:
                        'If you are in jail, press the button below to open a ticket.\n' +
                        'A private channel will be made where you can talk to a moderator.',
                    color: 'warning',
                }),
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(TICKET_OPEN_ID)
                        .setLabel('Open Ticket')
                        .setStyle(ButtonStyle.Primary),
                ),
            ],
        })
        .catch((error) => {
            logger.debug(`Could not post the ticket button: ${error.message}`);
            return null;
        });

    const config = {
        roleId: role.id,
        categoryId: category.id,
        panelChannelId: panel.id,
        panelMessageId: panelMessage?.id ?? null,
        logChannelId: logs.id,
        setupBy,
        setupAt: Date.now(),
    };

    await saveJailConfig(guild.id, config);

    return { config, role, category, panel, logs, staffRoles, result };
}

// ==========================================
// TICKETS
// ==========================================

function ticketNameFor(user) {
    const slug = String(user.username || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 20);

    return `ticket-${slug || 'user'}`;
}

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

// What the staff should know about a jailed person (saved when they are jailed)
export async function saveJailRecord(guildId, userId, record) {
    await Mutex.runExclusive(recordsKey(guildId), async () => {
        const all = await getFromDb(recordsKey(guildId), {});
        all[userId] = record;
        await setInDb(recordsKey(guildId), all);
    });
}

export async function getJailRecord(guildId, userId) {
    const all = await getFromDb(recordsKey(guildId), {});
    return all[userId] ?? null;
}

export async function clearJailRecord(guildId, userId) {
    await Mutex.runExclusive(recordsKey(guildId), async () => {
        const all = await getFromDb(recordsKey(guildId), {});

        if (all[userId]) {
            delete all[userId];
            await setInDb(recordsKey(guildId), all);
        }
    });
}

// Returns the person's open ticket channel, or null
export async function getOpenTicket(guild, userId) {
    const all = await getFromDb(ticketsKey(guild.id), {});
    const channelId = all[userId];

    if (!channelId) return null;

    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);

    if (!channel) {
        // The channel was deleted by hand, forget about it
        await Mutex.runExclusive(ticketsKey(guild.id), async () => {
            const latest = await getFromDb(ticketsKey(guild.id), {});
            delete latest[userId];
            await setInDb(ticketsKey(guild.id), latest);
        });
    }

    return channel ?? null;
}

// Makes a private channel for a jailed person. Returns { channel, created }.
export async function openJailTicket(guild, member, config, role) {
    const existing = await getOpenTicket(guild, member.id);

    if (existing) return { channel: existing, created: false };

    const P = PermissionFlagsBits;
    const me = guild.members.me ?? await guild.members.fetchMe();
    const staffRoles = getStaffRoles(guild, role);

    const channel = await guild.channels.create({
        name: ticketNameFor(member.user),
        type: ChannelType.GuildText,
        parent: config.categoryId,
        topic: `Jail ticket for ${member.user.tag} (${member.id})`,
        permissionOverwrites: [
            { id: guild.id, deny: [P.ViewChannel] },
            { id: member.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles] },
            ...botOverwriteFor(me),
            ...staffOverwritesFor(me, staffRoles),
        ],
        reason: `Jail ticket opened by ${member.user.tag}`,
    });

    await Mutex.runExclusive(ticketsKey(guild.id), async () => {
        const all = await getFromDb(ticketsKey(guild.id), {});
        all[member.id] = channel.id;
        await setInDb(ticketsKey(guild.id), all);
    });

    const record = await getJailRecord(guild.id, member.id);

    await channel
        .send({
            content: `${member}`,
            embeds: [
                createEmbed({
                    title: 'Jail ticket',
                    description:
                        `Hello ${member}! You are in jail.\n` +
                        (record
                            ? `**Jailed by:** <@${record.moderatorId}>\n**Reason:** ${record.reason}\n\n`
                            : '\n') +
                        'Write here and a moderator will talk to you.',
                    color: 'warning',
                }),
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(TICKET_CLOSE_ID)
                        .setLabel('Close Ticket')
                        .setStyle(ButtonStyle.Danger),
                ),
            ],
            allowedMentions: { users: [member.id] },
        })
        .catch(() => {});

    await writeJailLog(guild, config, {
        title: 'Jail ticket opened',
        description: `**User:** ${member} (${member.id})\n**Channel:** ${channel}`,
        color: 'warning',
    });

    return { channel, created: true };
}

// Deletes the person's ticket (if they have one). Returns true if a ticket was closed.
export async function closeJailTicket(guild, userId, { closedBy = null, reason = 'Ticket closed' } = {}) {
    let channelId = null;

    await Mutex.runExclusive(ticketsKey(guild.id), async () => {
        const all = await getFromDb(ticketsKey(guild.id), {});
        channelId = all[userId] ?? null;

        if (channelId) {
            delete all[userId];
            await setInDb(ticketsKey(guild.id), all);
        }
    });

    if (!channelId) return false;

    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);

    if (channel) {
        await channel.delete(reason).catch((error) => {
            logger.debug(`Could not delete the jail ticket channel: ${error.message}`);
        });
    }

    const config = await getJailConfig(guild.id);

    if (config) {
        await writeJailLog(guild, config, {
            title: 'Jail ticket closed',
            description:
                `**User:** <@${userId}>\n` +
                (closedBy ? `**Closed by:** ${closedBy}\n` : '') +
                `**Reason:** ${reason}`,
            color: 'success',
        });
    }

    return true;
}

// Finds out whose ticket a channel is (used by the Close button). Returns the user id or null.
export async function findTicketOwner(guildId, channelId) {
    const all = await getFromDb(ticketsKey(guildId), {});

    return Object.keys(all).find((userId) => all[userId] === channelId) ?? null;
}

// ==========================================
// MESSAGES
// ==========================================

export function buildJailDm({ guild, reason, panelChannelId }) {
    return createEmbed({
        title: 'You have been jailed',
        description:
            `You have been jailed in **${guild.name}** for: **${shownReason(reason)}**\n` +
            'You cannot see the other channels. ' +
            (panelChannelId
                ? `Open a ticket in <#${panelChannelId}> to talk to a moderator.`
                : 'Open a ticket in the jail ticket channel to talk to a moderator.'),
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
