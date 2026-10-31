import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import {
    DEFAULT_REASON,
    MAX_REASON_LENGTH,
    getPrefixText,
    extractUserId,
    errorBox,
    parseDuration,
    formatDuration,
    sendPunishmentDm,
    buildTimeoutDm,
} from '../../utils/punishmentTools.js';
import { missingPermission, syntaxReply, userNotFoundReply } from '../../utils/punishmentTools.js';
import { boxPayload, COLORS } from '../../utils/replyStyle.js';

// Used when you do not type a time:  .mute @user .timeout @user
const DEFAULT_TIMEOUT_MINUTES = 10;

// Discord does not allow a timeout longer than 28 days
const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;

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
        .setName("mute")
        .setDescription("Mute (timeout) a user for a specific duration.")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("User to mute")
                .setRequired(true),
        )
        .addIntegerOption(
            (option) =>
                option
                    .setName("duration")
                    .setDescription("How long the mute lasts")
                    .setRequired(true)
                    .addChoices(...durationChoices),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Reason for the mute (optional)")
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    // Slash command: /mute target:@user duration:1 hour reason:...
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Mute interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'mute',
            });
            return;
        }

        const user = interaction.options.getUser("target");

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to mute.',
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
    //   .mute @user 10m reason       .mute userID 2 hours reason
    //   .mute userID 5 min           .mute userID reason   (uses the default time)
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'mute')
            .split(/\s+/)
            .filter(Boolean);

        const target = await takeUserFromWords(guild, parts);

        if (!target) {
            return parts.length ? userNotFoundReply(interaction) : syntaxReply(interaction, 'mute');
        }

        if (!target.member) {
            return userNotFoundReply(interaction);
        }

        const rest = parts.slice(target.used);
        const parsed = parseDuration(rest);

        const minutes = parsed ? parsed.minutes : DEFAULT_TIMEOUT_MINUTES;
        const reasonWords = parsed ? rest.slice(parsed.used) : rest;
        const reason = reasonWords.join(' ') || DEFAULT_REASON;

        return timeoutMember(interaction, client, target.member.user, target.member, minutes, reason, !parsed);
    },
};

// Shared by the slash and prefix versions
async function timeoutMember(interaction, client, user, member, minutes, reason, usedDefaultTime) {
    // Only people with the Timeout Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        throw missingPermission('timeout_members');
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
            "Cannot mute self",
            ErrorTypes.VALIDATION,
            "You cannot mute yourself.",
        );
    }

    if (user.id === client.user.id) {
        throw new TitanBotError(
            "Cannot mute bot",
            ErrorTypes.VALIDATION,
            "You cannot mute the bot.",
        );
    }

    if (!Number.isFinite(minutes) || minutes < 1) {
        throw new TitanBotError(
            'Invalid mute time',
            ErrorTypes.VALIDATION,
            'The mute must be at least 1 minute.',
        );
    }

    if (minutes > MAX_TIMEOUT_MINUTES) {
        throw new TitanBotError(
            'Mute too long',
            ErrorTypes.VALIDATION,
            'Discord only allows a mute (timeout) of up to **28 days** (4 weeks).',
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

    // Tell the user in a DM (silently skipped if their DMs are closed)
    await sendPunishmentDm(
        user,
        buildTimeoutDm({ guild: interaction.guild, reason, minutes }),
    );

    const timeText = formatDuration(minutes) + (usedDefaultTime ? ' (default)' : '');

    const reasonPart = reason && reason !== DEFAULT_REASON ? ` for ${reason}` : '';

    await InteractionHelper.universalReply(
        interaction,
        boxPayload(
            COLORS.warning,
            `${user} has been muted for ${formatDuration(minutes)} by ${interaction.user.username}${reasonPart}.`,
        ),
    );
}
