import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import {
    DEFAULT_REASON,
    MAX_REASON_LENGTH,
    getPrefixText,
    extractUserId,
    errorBox,
    getServerInvite,
    sendPunishmentDm,
    buildKickDm,
} from '../../utils/punishmentTools.js';
import { missingPermission, syntaxReply, userNotFoundReply } from '../../utils/punishmentTools.js';
import { boxPayload, COLORS } from '../../utils/replyStyle.js';

export default {
    data: new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a user from the server")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("The user to kick")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Reason for the kick (optional)")
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    category: "moderation",

    // Slash command: /kick target:@user reason:...
    async execute(interaction, config, client) {
        const user = interaction.options.getUser("target");

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to kick.',
                { subtype: 'invalid_user' },
            );
        }

        const member =
            interaction.options.getMember("target") ||
            await interaction.guild.members.fetch(user.id).catch(() => null);

        const reason =
            interaction.options.getString("reason")?.trim() || DEFAULT_REASON;

        return kickMember(interaction, client, user, member, reason);
    },

    // Prefix command: .kick @user reason   or   .kick userID reason
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'kick')
            .split(/\s+/)
            .filter(Boolean);

        const target = await takeUserFromWords(guild, parts);

        if (!target) {
            return parts.length ? userNotFoundReply(interaction) : syntaxReply(interaction, 'kick');
        }

        if (!target.member) {
            return userNotFoundReply(interaction);
        }

        const reason = parts.slice(target.used).join(' ') || DEFAULT_REASON;

        return kickMember(interaction, client, target.member.user, target.member, reason);
    },
};

// Shared by the slash and prefix versions
async function kickMember(interaction, client, user, member, reason) {
    // Only people with the Kick Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        throw missingPermission('kick_members');
    }

    if (!member) {
        throw new TitanBotError(
            "Target not found",
            ErrorTypes.USER_INPUT,
            "The target user is not currently in this server.",
            { subtype: 'user_not_found' },
        );
    }

    if (user.id === interaction.user.id) {
        throw new TitanBotError(
            "Cannot kick self",
            ErrorTypes.VALIDATION,
            "You cannot kick yourself.",
        );
    }

    if (user.id === client.user.id) {
        throw new TitanBotError(
            "Cannot kick bot",
            ErrorTypes.VALIDATION,
            "You cannot kick the bot.",
        );
    }

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
        );
    }

    // The DM has to be sent BEFORE the kick (after it the bot can no longer reach them)
    const inviteUrl = await getServerInvite(interaction.guild);
    const dmMessage = await sendPunishmentDm(
        user,
        buildKickDm({ guild: interaction.guild, reason, inviteUrl }),
    );

    let result;

    try {
        result = await ModerationService.kickUser({
            guild: interaction.guild,
            member,
            moderator: interaction.member,
            reason,
        });
    } catch (error) {
        // The kick did not happen, so take the DM back
        await dmMessage?.delete().catch(() => {});
        throw error;
    }

    const reasonPart = reason && reason !== DEFAULT_REASON ? ` for ${reason}` : '';

    await InteractionHelper.universalReply(
        interaction,
        boxPayload(COLORS.warning, `${user} has been kicked by ${interaction.user.username}${reasonPart}.`),
    );
}
