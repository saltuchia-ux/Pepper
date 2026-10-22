import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed } from './embeds.js';
import { logger } from './logger.js';
import { InteractionHelper } from './interactionHelper.js';
import { TitanBotError, ErrorTypes } from './errorHandler.js';
import { getCommandPrefix } from '../config/bot.js';
import { buildSyntaxText } from '../config/commands/commandSyntax.js';
import { plainPayload } from './replyStyle.js';

// ==========================================
// SHARED TOOLS for .kick  .timeout  .ban
// (reading the command text, times, and the DM messages)
// ==========================================

export const DEFAULT_REASON = 'No reason provided';
export const MAX_REASON_LENGTH = 500;

// Words you can type after a number:  5m  5min  5 minutes  2h  1 hour  3d  1 day  1w  1 week
export const UNIT_MINUTES = {
    m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
    h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
    d: 1440, day: 1440, days: 1440,
    w: 10080, wk: 10080, wks: 10080, week: 10080, weeks: 10080,
};

// Gets the text after ".COMMAND" from a prefix command.
export function getPrefixText(interaction, commandName) {
    const realMessage =
        interaction.message ??
        interaction._responseCoordinator?.message ??
        null;

    const content = realMessage?.content?.trim();

    if (content) {
        const match = content.match(
            new RegExp(`^\\S*?${commandName}(?:\\s+|$)`, 'i')
        );

        if (match) {
            return content.slice(match[0].length).trim();
        }
    }

    const args =
        interaction.options?._hoistedOptions?.map(option =>
            String(option.value)
        ) || [];

    return args.join(' ').trim();
}

// Accepts <@123>, <@!123> or a plain user ID.
export function extractUserId(value) {
    if (!value) return null;

    const text = String(value).trim();

    const mention = text.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];

    if (/^\d+$/.test(text)) return text;

    return null;
}

// ------------------------------------------
// SHORT PLAIN MESSAGES (no box around them)
// ------------------------------------------

// Plain text reply. Mentions are shown but nobody gets pinged.
export function plainReply(interaction, text) {
    return InteractionHelper.universalReply(interaction, plainPayload(text));
}

// "Syntax: .ban (user) (reason)  /  Example: .ban John annoying"
export function syntaxReply(interaction, commandName) {
    const text = buildSyntaxText(getCommandPrefix(), commandName)
        ?? `Wrong usage. Try ${getCommandPrefix()}help ${commandName}`;

    return plainReply(interaction, text);
}

// Short "User not found"
export function userNotFoundReply(interaction) {
    return plainReply(interaction, 'User not found');
}

// "⚠️ @user: You're missing permission: `ban_members`"
// Use:  throw missingPermission('ban_members');
export function missingPermission(permissionName) {
    return new TitanBotError(
        `Missing ${permissionName} permission`,
        ErrorTypes.PERMISSION,
        null,
        { missingPermission: permissionName },
    );
}

// Red error box
export function errorBox(title, description) {
    return createEmbed({
        title: `❌ ${title}`,
        description,
        color: 'error',
    });
}

// Reads a time like "10m", "5min", "5 minutes", "2h", "1 hour", "3d", "1w"
// from the start of the words. Returns { minutes, used } or null.
export function parseDuration(words) {
    const first = words[0];
    if (!first) return null;

    const joined = first.match(/^(\d+)([a-z]+)$/i);
    if (joined && UNIT_MINUTES[joined[2].toLowerCase()]) {
        return {
            minutes: parseInt(joined[1], 10) * UNIT_MINUTES[joined[2].toLowerCase()],
            used: 1,
        };
    }

    if (/^\d+$/.test(first) && words[1] && UNIT_MINUTES[words[1].toLowerCase()]) {
        return {
            minutes: parseInt(first, 10) * UNIT_MINUTES[words[1].toLowerCase()],
            used: 2,
        };
    }

    return null;
}

// 90 -> "1 hour 30 minutes"
export function formatDuration(totalMinutes) {
    const units = [
        ['week', 10080],
        ['day', 1440],
        ['hour', 60],
        ['minute', 1],
    ];

    let left = totalMinutes;
    const out = [];

    for (const [name, size] of units) {
        const count = Math.floor(left / size);
        if (count > 0) {
            out.push(`${count} ${name}${count === 1 ? '' : 's'}`);
            left -= count * size;
        }
    }

    return out.join(' ') || '0 minutes';
}

function shownReason(reason) {
    return reason === DEFAULT_REASON ? 'no reason' : reason;
}

// ==========================================
// SERVER LINK
// Uses SERVER_INVITE_URL from .env if you set it, then the server's vanity link,
// and if neither exists the bot makes a one-person invite link by itself.
// ==========================================
export async function getServerInvite(guild, { neverExpires = false } = {}) {
    try {
        if (process.env.SERVER_INVITE_URL) return process.env.SERVER_INVITE_URL;

        if (guild.vanityURLCode) return `https://discord.gg/${guild.vanityURLCode}`;

        const me = guild.members.me ?? await guild.members.fetchMe();

        const channels = [
            guild.rulesChannel,
            guild.systemChannel,
            ...guild.channels.cache
                .filter((channel) => channel.type === ChannelType.GuildText)
                .values(),
        ].filter(Boolean);

        for (const channel of channels) {
            if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite)) {
                continue;
            }

            const invite = await channel
                .createInvite({
                    maxAge: neverExpires ? 0 : 7 * 24 * 60 * 60,
                    maxUses: 1,
                    unique: true,
                    reason: 'Invite for a member who was removed by a moderator',
                })
                .catch(() => null);

            if (invite) return invite.url;
        }
    } catch (error) {
        logger.debug(`Could not get a server invite: ${error.message}`);
    }

    return null;
}

// ==========================================
// DM MESSAGES
// ==========================================

// Sends the DM. Returns the sent message, or null if the DMs are closed.
export async function sendPunishmentDm(user, embed) {
    if (!user || user.bot) return null;

    try {
        // A plain string is sent as normal text, anything else as an embed
        return await user.send(typeof embed === 'string' ? { content: embed } : { embeds: [embed] });
    } catch (error) {
        logger.debug(`Could not DM ${user.id}: ${error.message}`);
        return null;
    }
}

export function buildKickDm({ guild, reason, inviteUrl }) {
    const fields = [{ name: '📝 Reason', value: shownReason(reason) }];

    if (inviteUrl) {
        fields.push({ name: '🔗 Join back', value: `You can come back with this link:\n${inviteUrl}` });
    }

    return createEmbed({
        title: '👢 You have been kicked',
        description: `You have been kicked from **${guild.name}**.`,
        color: 'warning',
        thumbnail: guild.iconURL?.({ size: 256 }) || null,
        fields,
        timestamp: true,
    });
}

export function buildTimeoutDm({ guild, reason, minutes }) {
    const endsAt = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);

    return createEmbed({
        title: '⏳ You have been timed out',
        description: `You have been timed out in **${guild.name}** for **${formatDuration(minutes)}**.`,
        color: 'warning',
        thumbnail: guild.iconURL?.({ size: 256 }) || null,
        fields: [
            { name: '📝 Reason', value: shownReason(reason) },
            { name: '⏱️ Time', value: formatDuration(minutes), inline: true },
            { name: '🕒 Ends', value: `<t:${endsAt}:R>`, inline: true },
        ],
        timestamp: true,
    });
}

// minutes = null means a permanent ban
export function buildBanDm({ guild, reason, minutes, inviteUrl }) {
    const isTemporary = minutes !== null;

    const fields = [
        { name: '📝 Reason', value: shownReason(reason) },
        {
            name: '⏱️ Banned for',
            value: isTemporary ? formatDuration(minutes) : '♾️ Permanent',
            inline: true,
        },
    ];

    if (isTemporary) {
        const endsAt = Math.floor((Date.now() + minutes * 60 * 1000) / 1000);

        fields.push({ name: '🕒 Ban ends', value: `<t:${endsAt}:F>\n(<t:${endsAt}:R>)`, inline: true });
    }

    if (inviteUrl) {
        fields.push({
            name: '🔗 Server link',
            value: isTemporary
                ? `Use this link once your ban is over:\n${inviteUrl}`
                : `If you are ever unbanned, you can join back here:\n${inviteUrl}`,
        });
    }

    return createEmbed({
        title: isTemporary ? '🔨 You have been temporarily banned' : '🔨 You have been banned',
        description: isTemporary
            ? `You have been banned from **${guild.name}** for **${formatDuration(minutes)}**.`
            : `You have been **permanently banned** from **${guild.name}**.`,
        color: 'error',
        thumbnail: guild.iconURL?.({ size: 256 }) || null,
        fields,
        timestamp: true,
    });
}

export function buildUnmuteDm({ guild, reason }) {
    return createEmbed({
        title: '🔊 You have been unmuted',
        description: `Your timeout in **${guild.name}** has been removed. You can talk again.`,
        color: 'success',
        thumbnail: guild.iconURL?.({ size: 256 }) || null,
        fields: [{ name: '📝 Reason', value: shownReason(reason) }],
        timestamp: true,
    });
}

export function buildUnbanDm({ guild, reason, inviteUrl }) {
    // Plain text (no box)
    let text = `You have been unbanned from **${guild.name}**.`;

    if (reason && reason !== DEFAULT_REASON) {
        text += `\nReason: ${reason}`;
    }

    if (inviteUrl) {
        text += `\nYou can come back with this link: ${inviteUrl}`;
    }

    return text;
}
