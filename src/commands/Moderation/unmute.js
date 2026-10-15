import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import {
    DEFAULT_REASON,
    MAX_REASON_LENGTH,
    getPrefixText,
    errorBox,
    sendPunishmentDm,
    buildUnmuteDm,
} from '../../utils/punishmentTools.js';

export default {
    data: new SlashCommandBuilder()
        .setName("unmute")
        .setDescription("Remove a mute (timeout) from a user")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("User to unmute")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Reason for the unmute (optional)")
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    // Slash command: /unmute target:@user reason:...
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) return;

        const user = interaction.options.getUser("target");

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to unmute.',
                { subtype: 'invalid_user' },
            );
        }

        const member =
            interaction.options.getMember("target") ||
            await interaction.guild.members.fetch(user.id).catch(() => null);

        const reason =
            interaction.options.getString("reason")?.trim() || DEFAULT_REASON;

        return unmuteMember(interaction, user, member, reason);
    },

    // Prefix command: .unmute @user reason   or   .unmute userID   or   .unmute username
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'unmute')
            .split(/\s+/)
            .filter(Boolean);

        const target = await takeUserFromWords(guild, parts);

        if (!target) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'User not found',
                        'Use `.unmute @user reason`, `.unmute userID reason` or `.unmute username reason`.\n' +
                        'Names with spaces go in quotes: `.unmute "John Smith" reason`.\n' +
                        'The reason is optional.'
                    ),
                ],
                ephemeral: true,
            });
        }

        if (!target.member) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'Member not found',
                        'I could not find that member in this server. Check the name or ID and make sure they have not left.'
                    ),
                ],
                ephemeral: true,
            });
        }

        const reason = parts.slice(target.used).join(' ') || DEFAULT_REASON;

        return unmuteMember(interaction, target.member.user, target.member, reason);
    },
};

// Shared by the slash and prefix versions
async function unmuteMember(interaction, user, member, reason) {
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

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
        );
    }

    // Throws a clear message if the person is not muted
    await ModerationService.removeTimeoutUser({
        guild: interaction.guild,
        member,
        moderator: interaction.member,
        reason,
    });

    // Tell the user in a DM (silently skipped if their DMs are closed)
    await sendPunishmentDm(user, buildUnmuteDm({ guild: interaction.guild, reason }));

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: '🔊 Member Unmuted',
                description: `${user} has been unmuted.`,
                color: 'success',
                thumbnail: user.displayAvatarURL?.({ size: 256 }) || null,
                fields: [
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                    { name: '📝 Reason', value: reason, inline: true },
                ],
                timestamp: true,
            }),
        ],
    });
}
