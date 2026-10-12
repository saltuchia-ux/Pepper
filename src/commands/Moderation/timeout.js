import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';

const DEFAULT_REASON = 'No reason provided';
const MAX_REASON_LENGTH = 500;

// Used when you do not type a time:  .timeout @user
const DEFAULT_TIMEOUT_MINUTES = 10;

// Discord does not allow a timeout longer than 28 days
const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;

// Words you can type after a number:  5m  5min  5 minutes  2h  1 hour  3d  1 day  1w  1 week
const UNIT_MINUTES = {
    m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
    h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
    d: 1440, day: 1440, days: 1440,
    w: 10080, wk: 10080, wks: 10080, week: 10080, weeks: 10080,
};

const durationChoices = [
    { name: "5 minutes", value: 5 },
    { name: "10 minutes", value: 10 },
    { name: "30 minutes", value: 30 },
    { name: "1 hour", value: 60 },
    { name: "6 hours", value: 360 },
    { name: "1 day", value: 1440 },
    { name: "1 week", value: 10080 },
];

export default {
    data: new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Timeout a user for a specific duration.")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("User to timeout")
                .setRequired(true),
        )
        .addIntegerOption(
            (option) =>
                option
                    .setName("duration")
                    .setDescription("Duration of the timeout")
                    .setRequired(true)
                    .addChoices(...durationChoices),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Reason for the timeout (optional)")
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    // Slash command: /timeout target:@user duration:1 hour reason:...
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Timeout interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'timeout',
            });
            return;
        }

        const user = interaction.options.getUser("target");

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to timeout.',
                { subtype: 'invalid_user' },
            );
        }

        const member =
            interaction.options.getMember("target") ||
            await interaction.guild.members.fetch(user.id).catch(() => null);

        const minutes = interaction.options.getInteger("duration");
        const reason =
            interaction.options.getString("reason")?.trim() || DEFAULT_REASON;

        return timeoutMember(interaction, client, user, member, minutes, reason, false);
    },

    // Prefix command:
    //   .timeout @user 10m reason       .timeout userID 2 hours reason
    //   .timeout userID 5 min           .timeout userID reason   (uses the default time)
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'timeout')
            .split(/\s+/)
            .filter(Boolean);

        const userId = extractUserId(parts[0]);

        if (!userId) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'User not found',
                        'Use `.timeout @user 10m reason` or `.timeout userID 1 hour reason`.\n' +
                        'Time: `5min`, `10 minutes`, `2h`, `1 hour`, `3d`, `1 day`, `1w`, `1 week`.\n' +
                        `The time and the reason are optional (default time: ${DEFAULT_TIMEOUT_MINUTES} minutes).`
                    ),
                ],
                ephemeral: true,
            });
        }

        const member = await guild.members.fetch(userId).catch(() => null);

        if (!member) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'Member not found',
                        'I could not find that member in this server. Check the ID and make sure they have not left.'
                    ),
                ],
                ephemeral: true,
            });
        }

        const rest = parts.slice(1);
        const parsed = parseDuration(rest);

        const minutes = parsed ? parsed.minutes : DEFAULT_TIMEOUT_MINUTES;
        const reasonWords = parsed ? rest.slice(parsed.used) : rest;
        const reason = reasonWords.join(' ') || DEFAULT_REASON;

        return timeoutMember(interaction, client, member.user, member, minutes, reason, !parsed);
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
async function timeoutMember(interaction, client, user, member, minutes, reason, usedDefaultTime) {
    // Only people with the Timeout Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        throw new TitanBotError(
            'Missing Timeout Members permission',
            ErrorTypes.PERMISSION,
            'You need the **Timeout Members** permission to use this command.',
        );
    }

    if (!member) {
        throw new TitanBotError(
            "Target not found",
            ErrorTypes.USER_INPUT,
            "The target user is not currently in this server.",
        );
    }

    if (user.id === interaction.user.id) {
        throw new TitanBotError(
            "Cannot timeout self",
            ErrorTypes.VALIDATION,
            "You cannot timeout yourself.",
        );
    }

    if (user.id === client.user.id) {
        throw new TitanBotError(
            "Cannot timeout bot",
            ErrorTypes.VALIDATION,
            "You cannot timeout the bot.",
        );
    }

    if (!Number.isFinite(minutes) || minutes < 1) {
        throw new TitanBotError(
            'Invalid timeout time',
            ErrorTypes.VALIDATION,
            'The timeout must be at least 1 minute.',
        );
    }

    if (minutes > MAX_TIMEOUT_MINUTES) {
        throw new TitanBotError(
            'Timeout too long',
            ErrorTypes.VALIDATION,
            'Discord only allows a timeout of up to **28 days** (4 weeks).',
        );
    }

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
        );
    }

    const result = await ModerationService.timeoutUser({
        guild: interaction.guild,
        member,
        moderator: interaction.member,
        durationMs: minutes * 60 * 1000,
        reason,
    });

    const timeText = formatDuration(minutes) + (usedDefaultTime ? ' (default)' : '');

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: '⏳ Member Timed Out',
                description: `${user} has been timed out.`,
                color: 'warning',
                thumbnail: user.displayAvatarURL?.({ size: 256 }) || null,
                fields: [
                    { name: '⏱️ Time', value: timeText, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                    { name: '📝 Reason', value: reason },
                ],
                footer: `Case #${result.caseId}`,
                timestamp: true,
            }),
        ],
    });
}
