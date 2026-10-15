import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { removeTempBan } from '../../services/tempBanService.js';
import { findBannedUser, takeBannedUserFromWords } from '../../utils/userResolver.js';
import {
    DEFAULT_REASON,
    MAX_REASON_LENGTH,
    getPrefixText,
    errorBox,
    getServerInvite,
    sendPunishmentDm,
    buildUnbanDm,
} from '../../utils/punishmentTools.js';

export default {
    data: new SlashCommandBuilder()
        .setName("unban")
        .setDescription("Unban a user from the server")
        .addStringOption((option) =>
            option
                .setName("target")
                .setDescription("The user ID, @mention or username of the banned user")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Reason for the unban (optional)")
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: "moderation",

    // Slash command: /unban target:123456789012345678 reason:...
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) return;

        const text = interaction.options.getString("target");
        const user = await findBannedUser(interaction.guild, text);

        if (!user) {
            throw new TitanBotError(
                'Banned user not found',
                ErrorTypes.USER_INPUT,
                'I could not find a banned user with that ID or name. Check the ban list in Server Settings > Bans.',
            );
        }

        const reason =
            interaction.options.getString("reason")?.trim() || DEFAULT_REASON;

        return unbanUser(interaction, user, reason);
    },

    // Prefix command: .unban userID reason   or   .unban username reason
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'unban')
            .split(/\s+/)
            .filter(Boolean);

        const usage =
            'Use `.unban userID reason` or `.unban username reason`.\n' +
            'Names with spaces go in quotes: `.unban "John Smith" reason`.\n' +
            'The reason is optional. The name is searched in the server ban list.';

        if (!parts.length) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Who should I unban?', usage)],
                ephemeral: true,
            });
        }

        const found = await takeBannedUserFromWords(guild, parts);

        if (!found) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'Banned user not found',
                        'I could not find a banned user with that name or ID.\n' +
                        'Check the ban list in Server Settings > Bans, or use their user ID.'
                    ),
                ],
                ephemeral: true,
            });
        }

        const reason = parts.slice(found.used).join(' ') || DEFAULT_REASON;

        return unbanUser(interaction, found.user, reason);
    },
};

// Shared by the slash and prefix versions
async function unbanUser(interaction, user, reason) {
    // Only people with the Ban Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw new TitanBotError(
            'Missing Ban Members permission',
            ErrorTypes.PERMISSION,
            'You need the **Ban Members** permission to use this command.',
        );
    }

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
        );
    }

    // Throws a clear message if the person is not banned
    const result = await ModerationService.unbanUser({
        guild: interaction.guild,
        user,
        moderator: interaction.member,
        reason,
    });

    // If it was a temporary ban, it does not need to be lifted again later
    await removeTempBan(interaction.guild.id, user.id);

    // Try to tell them in a DM. This only works if the bot can still reach them.
    const inviteUrl = await getServerInvite(interaction.guild);
    await sendPunishmentDm(
        user,
        buildUnbanDm({ guild: interaction.guild, reason, inviteUrl }),
    );

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: '✅ Member Unbanned',
                description: `${user} has been unbanned.`,
                color: 'success',
                thumbnail: user.displayAvatarURL?.({ size: 256 }) || null,
                fields: [
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                    { name: '📝 Reason', value: reason, inline: true },
                ],
                footer: result?.caseId ? `Case #${result.caseId}` : undefined,
                timestamp: true,
            }),
        ],
    });
}
