import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { removeTempBan } from '../../services/tempBanService.js';
import {
    DEFAULT_REASON,
    MAX_REASON_LENGTH,
    getPrefixText,
    extractUserId,
    errorBox,
    getServerInvite,
    sendPunishmentDm,
    buildBanDm,
} from '../../utils/punishmentTools.js';
import { missingPermission, syntaxReply, userNotFoundReply } from '../../utils/punishmentTools.js';

export default {
    data: new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Permanently ban a user from the server (use /tempban for a temporary ban)")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("The user to ban")
                .setRequired(true),
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

    // Slash command: /ban target:@user reason:...
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

        const reason =
            interaction.options.getString("reason")?.trim() || DEFAULT_REASON;

        return banUser(interaction, client, user, reason);
    },

    // Prefix command: .ban @user reason   or   .ban userID reason
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

        const target = await takeUserFromWords(guild, parts);

        if (!target) {
            return parts.length ? userNotFoundReply(interaction) : syntaxReply(interaction, 'ban');
        }

        // A user ID works even if the person is not in the server
        const discordClient = client ?? interaction.client;
        const user =
            target.member?.user ??
            await discordClient.users.fetch(target.id).catch(() => null);

        if (!user) {
            return userNotFoundReply(interaction);
        }

        const reason = parts.slice(target.used).join(' ') || DEFAULT_REASON;

        return banUser(interaction, client, user, reason);
    },
};

// Shared by the slash and prefix versions
async function banUser(interaction, client, user, reason) {
    // Only people with the Ban Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw missingPermission('ban_members');
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

    // The DM has to be sent BEFORE the ban (after it the bot can no longer reach them)
    const inviteUrl = await getServerInvite(interaction.guild);
    const dmMessage = await sendPunishmentDm(
        user,
        buildBanDm({ guild: interaction.guild, reason, minutes: null, inviteUrl }),
    );

    let result;

    try {
        result = await ModerationService.banUser({
            guild: interaction.guild,
            user,
            moderator: interaction.member,
            reason,
        });
    } catch (error) {
        // The ban did not happen, so take the DM back
        await dmMessage?.delete().catch(() => {});
        throw error;
    }

    // A permanent ban cancels any older temporary ban for this person
    await removeTempBan(interaction.guild.id, user.id);

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: '🔨 Member Banned',
                description: `${user} has been banned.`,
                color: 'error',
                thumbnail: user.displayAvatarURL?.({ size: 256 }) || null,
                fields: [
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                    { name: '📝 Reason', value: reason, inline: true },
                ],
                footer: `Case #${result.caseId}`,
                timestamp: true,
            }),
        ],
    });
}
