import { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { TICKET_HUB } from '../config/ticketHub.js';
import { getUserLevelData } from './leveling/leveling.js';
import { logger } from '../utils/logger.js';

const PANEL_BUTTON_PREFIX = 'hub_ticket:';

function normalize(name) {
    return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Finds a text or announcement channel by name, ignoring emojis and symbols. */
export function findChannelByName(guild, wanted) {
    const target = normalize(wanted);
    return guild.channels.cache.find(
        (channel) =>
            (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
            && normalize(channel.name) === target,
    ) ?? null;
}

/** Finds the category where hub tickets go (exact name match, so "Jail Tickets" is never picked). */
export function findTicketCategory(guild) {
    const target = normalize(TICKET_HUB.ticketCategoryName);
    return guild.channels.cache.find(
        (channel) => channel.type === ChannelType.GuildCategory && normalize(channel.name) === target,
    ) ?? null;
}

export const findPanelChannel = (guild) => findChannelByName(guild, TICKET_HUB.panelChannelName);
export const findTicketLogChannel = (guild) => findChannelByName(guild, TICKET_HUB.logChannelName);

/** Every role ID that counts as ticket staff (the old setting plus the ones in ticketHub.js). */
export function getStaffRoleIds(config) {
    return [...new Set([config?.ticketStaffRoleId, ...TICKET_HUB.staffRoleIds].filter(Boolean))];
}

/**
 * Only the role(s) in config/ticketHub.js may close tickets.
 * Returns true/false, or null when no role is set there (then the old rules are used).
 */
export function memberCanCloseTickets(member) {
    const ids = TICKET_HUB.staffRoleIds;
    if (!ids.length) return null;
    return ids.some((roleId) => member?.roles?.cache?.has(roleId));
}

export async function getMemberLevel(client, guildId, userId) {
    const data = await getUserLevelData(client, guildId, userId);
    return data?.level ?? 0;
}

/** The panel. Plain embed object (not EmbedBuilder) so the emojis are kept. */
export function buildPanel(guild) {
    const embed = {
        color: 0x010101,
        title: `${guild.name} Tickets`,
        description: [
            'Pick a button below to open a private ticket. Only you and staff can see it.',
            '',
            `• **General:** questions about the server, reporting problems or people who shouldn't be here, claiming your custom role (level ${TICKET_HUB.customRoleLevel}+), anything else valid`,
            '',
            `• **Ideas${TICKET_HUB.ideasMinLevel > 0 ? ` • level ${TICKET_HUB.ideasMinLevel}+` : ''}:** bot recommendations, daily activity ideas, server ideas. It has to help the server, not just you`,
            '',
            "• **Verify:** send a video saying your username and today's date, with your face visible. Not comfortable? Don't open one",
        ].join('\n'),
    };

    const row = new ActionRowBuilder().addComponents(
        ...Object.entries(TICKET_HUB.types).map(([key, type]) =>
            new ButtonBuilder()
                .setCustomId(`${PANEL_BUTTON_PREFIX}${key}`)
                .setLabel(type.label)
                .setEmoji(type.emoji)
                .setStyle(ButtonStyle[type.style] ?? ButtonStyle.Primary),
        ),
    );

    return { embeds: [embed], components: [row] };
}

function isHubPanel(message, botId) {
    return message.author?.id === botId
        && message.components?.some((row) =>
            row.components?.some((c) => String(c.customId ?? '').startsWith(PANEL_BUTTON_PREFIX)));
}

/** Makes sure the panel is in the tickets channel: edits the existing one, or posts it if missing. */
export async function ensureTicketPanel(guild) {
    const channel = findPanelChannel(guild);
    if (!channel) return 'no_channel';

    const me = guild.members.me;
    const perms = channel.permissionsFor(me);
    if (!perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
        logger.warn(`Ticket hub: I need View Channel, Send Messages and Embed Links in #${channel.name} (${guild.name})`);
        return 'missing_permissions';
    }

    const payload = buildPanel(guild);
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const existing = recent?.find((message) => isHubPanel(message, me.id));

    if (existing) {
        await existing.edit(payload).catch((error) => logger.error('Ticket hub: could not update panel:', error));
        return 'updated';
    }

    await channel.send(payload);
    return 'posted';
}

export async function ensureAllTicketPanels(client) {
    if (!TICKET_HUB.enabled) return;

    for (const guild of client.guilds.cache.values()) {
        try {
            const result = await ensureTicketPanel(guild);
            if (result !== 'no_channel') logger.info(`Ticket hub: panel ${result} in ${guild.name}`);
        } catch (error) {
            logger.error(`Ticket hub: panel failed in ${guild.name}:`, error);
        }
    }
}
