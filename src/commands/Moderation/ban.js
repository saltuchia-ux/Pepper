import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import {
    addTempBan,
    removeTempBan,
    TEMP_BAN_MARKER,
} from '../../services/tempBanService.js';

const DEFAULT_REASON = 'No reason provided';
const MAX_REASON_LENGTH = 500;

// The longest temporary ban you can set
const MAX_BAN_MINUTES = 365 * 24 * 60;

// Words you can type after a number:  5m  5min  5 minutes  2h  1 hour  3d  1 day  1w  1 week
const UNIT_MINUTES = {
    m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
    h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
    d: 1440, day: 1440, days: 1440,
    w: 10080, wk: 10080, wks: 10080, week: 10080, weeks: 10080,
};

const durationChoices = [
    { name: "1 hour", value: 60 },
    { name: "6 hours", value: 360 },
    { name: "1 day", value: 1440 },
    { name: "3 days", value: 4320 },
    { name: "1 week", value: 10080 },
    { name: "2 weeks", value: 20160 },
    { name: "30 days", value: 43200 },
];

export default {
    data: new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a user from the server (permanent, or temporary if you pick a time)")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("The user to ban")
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName("duration")
                .setDescription("How long the ban lasts (leave empty for a permanent ban)")
                .setRequired(false)
                .addChoices(...durationChoices),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Reason for the ban (optional)")
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: "moderation",

    // Slash command: /ban target:@user duration:3 days reason:...
    async execute(interaction, config, client) {
        const user = interaction.options.getUser("target");

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to ban.',
                { subtype: 'invalid_user' },
            );
        }

        const minutes = interaction.options.getInteger("duration") || null;
        const reason =
            interaction.options.getString("reason")?.trim() || DEFAULT_REASON;

        return banUser(interaction, client, user, minutes, reason);
    },

    // Prefix command:
    //   .ban @user reason                .ban userID reason
    //   .ban userID 3 days reason        .ban @user 1w
    //   (no time = permanent ban, with a time = temporary ban)
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'ban')
            .split(/\s+/)
            .filter(Boolean);

        const userId = extractUserId(parts[0]);

        if (!userId) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'User not found',
                        'Use `.ban @user reason` or `.ban userID reason`.\n' +
                        'Add a time for a temporary ban: `.ban userID 3 days reason`.\n' +
                        'Time: `5min`, `10 minutes`, `2h`, `1 hour`, `3d`, `1 day`, `1w`, `1 week`.\n' +
                        'The time and the reason are optional (no time = permanent ban).'
                    ),
                ],
                ephemeral: true,
            });
        }

        // Works with a user ID even if the person is not in the server
        const discordClient = client ?? interaction.client;
        const user = await discordClient.users.fetch(userId).catch(() => null);

        if (!user) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('User not found', 'I could not find a Discord user with that ID.')],
                ephemeral: true,
            });
        }

        const rest = parts.slice(1);
        const parsed = parseDuration(rest);

        const minutes = parsed ? parsed.minutes : null;
        const reasonWords = parsed ? rest.slice(parsed.used) : rest;
        const reason = reasonWords.join(' ') || DEFAULT_REASON;

        return banUser(interaction, client, user, minutes, reason);
    },
};

// Reads a time like "10m", "5min", "5 minutes", "2h", "1 hour", "3d", "1w"
// from the start of the words. Returns { minutes, used } or null.
function parseDuration(words) {
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
function formatDuration(totalMinutes) {
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

// Gets the text after ".COMMAND" from a prefix command.
function getPrefixText(interaction, commandName) {
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
function extractUserId(value) {
    if (!value) return null;

    const text = String(value).trim();

    const mention = text.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];

    if (/^\d+$/.test(text)) return text;

    return null;
}

function errorBox(title, description) {
    return createEmbed({
        title: `❌ ${title}`,
        description,
        color: 'error',
    });
}

// Shared by the slash and prefix versions
async function banUser(interaction, client, user, minutes, reason) {
    // Only people with the Ban Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw new TitanBotError(
            'Missing Ban Members permission',
            ErrorTypes.PERMISSION,
            'You need the **Ban Members** permission to use this command.',
        );
    }

    if (user.id === interaction.user.id) {
        throw new TitanBotError(
            'Cannot ban self',
            ErrorTypes.VALIDATION,
            'You cannot ban yourself.',
        );
    }

    if (user.id === client.user.id) {
        throw new TitanBotError(
            'Cannot ban bot',
            ErrorTypes.VALIDATION,
            'You cannot ban the bot.',
        );
    }

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
        );
    }

    const isTemporary = minutes !== null;

    if (isTemporary && (!Number.isFinite(minutes) || minutes < 1)) {
        throw new TitanBotError(
            'Invalid ban time',
            ErrorTypes.VALIDATION,
            'A temporary ban must be at least 1 minute.',
        );
    }

    if (isTemporary && minutes > MAX_BAN_MINUTES) {
        throw new TitanBotError(
            'Ban too long',
            ErrorTypes.VALIDATION,
            'A temporary ban can be at most **365 days**. Leave the time out for a permanent ban.',
        );
    }

    // For temporary bans the time is added to the saved reason (shows in the audit log and .hs)
    const savedReason = isTemporary
        ? `${reason} ${TEMP_BAN_MARKER} ${formatDuration(minutes)}]`
        : reason;

    const result = await ModerationService.banUser({
        guild: interaction.guild,
        user,
        moderator: interaction.member,
        reason: savedReason,
    });

    let unbanAt = null;

    if (isTemporary) {
        unbanAt = Date.now() + minutes * 60 * 1000;

        await addTempBan({
            guildId: interaction.guild.id,
            userId: user.id,
            unbanAt,
            moderatorId: interaction.user.id,
        });
    } else {
        // A new permanent ban cancels any older temporary ban for this person
        await removeTempBan(interaction.guild.id, user.id);
    }

    const fields = [];

    if (isTemporary) {
        const unixTime = Math.floor(unbanAt / 1000);

        fields.push({
            name: '⏱️ Time',
            value: `${formatDuration(minutes)}\nEnds <t:${unixTime}:R>`,
            inline: true,
        });
    }

    fields.push(
        { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
        { name: '📝 Reason', value: reason, inline: !isTemporary },
    );

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: isTemporary ? '🔨 Member Temporarily Banned' : '🔨 Member Banned',
                description: `${user} has been banned${isTemporary ? ' for ' + formatDuration(minutes) : ''}.`,
                color: 'error',
                thumbnail: user.displayAvatarURL?.({ size: 256 }) || null,
                fields,
                footer: `Case #${result.caseId}`,
                timestamp: true,
            }),
        ],
    });
}
