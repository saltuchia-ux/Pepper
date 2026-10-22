import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { logModerationAction } from '../../utils/moderation.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { getPrefixText, errorBox, sendPunishmentDm } from '../../utils/punishmentTools.js';
import { saveRoleBackup } from '../../services/roleBackupService.js';
import {
    DEFAULT_REASON,
    requireJail,
    backupableRoleIds,
    buildJailDm,
    writeJailLog,
    panelChannelIdOf,
    saveJailRecord,
} from '../../services/jailService.js';
import { missingPermission, syntaxReply, userNotFoundReply } from '../../utils/punishmentTools.js';

const MAX_REASON_LENGTH = 500;

export default {
    data: new SlashCommandBuilder()
        .setName('jail')
        .setDescription('Put a user in jail (their roles are saved for 2 hours)')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('The user to jail')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason for the jail (optional)')
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',

    // Slash command: /jail target:@user reason:...
    async execute(interaction, config, client) {
        const user = interaction.options.getUser('target');

        const member =
            interaction.options.getMember('target') ||
            await interaction.guild.members.fetch(user.id).catch(() => null);

        const reason = interaction.options.getString('reason')?.trim() || DEFAULT_REASON;

        return jailMember(interaction, member, reason);
    },

    // Prefix command: .jail @user reason   or   .jail userID reason   or   .jail username reason
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'jail').split(/\s+/).filter(Boolean);
        const target = await takeUserFromWords(guild, parts);

        if (!target) {
            return parts.length ? userNotFoundReply(interaction) : syntaxReply(interaction, 'jail');
        }

        if (!target.member) {
            return userNotFoundReply(interaction);
        }

        const reason = parts.slice(target.used).join(' ') || DEFAULT_REASON;

        return jailMember(interaction, target.member, reason);
    },
};

async function jailMember(interaction, member, reason) {
    // Only people with the Timeout Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        throw missingPermission('timeout_members');
    }

    const guild = interaction.guild;
    const { config, role } = await requireJail(guild);

    if (!member) {
        throw new TitanBotError(
            'Target not found',
            ErrorTypes.USER_INPUT,
            'The target user is not currently in this server.',
        );
    }

    if (member.id === interaction.user.id) {
        throw new TitanBotError('Cannot jail self', ErrorTypes.VALIDATION, 'You cannot jail yourself.');
    }

    if (member.user?.bot) {
        throw new TitanBotError('Cannot jail a bot', ErrorTypes.VALIDATION, 'You cannot jail a bot.');
    }

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
        );
    }

    ModerationService.assertModerationHierarchy(interaction.member, member, 'jail');

    if (member.roles.cache.has(role.id)) {
        throw new TitanBotError(
            'Already jailed',
            ErrorTypes.VALIDATION,
            `${member} is already in jail.`,
            { plain: true },
        );
    }

    if (!member.manageable) {
        throw new TitanBotError(
            'Cannot manage member',
            ErrorTypes.PERMISSION,
            `You can't jail ${member}.`,
            { plain: true },
        );
    }

    // 1) save their roles BEFORE they are taken away (kept for 2 hours, used by .restore)
    await saveRoleBackup({
        guildId: guild.id,
        userId: member.id,
        roleIds: backupableRoleIds(member, role.id),
        reason: 'jail',
    });

    // 2) take every role away and give the Jailed role (bot / booster roles cannot be removed)
    const keep = [...member.roles.cache.values()].filter((r) => r.managed).map((r) => r.id);

    try {
        await member.roles.set([role.id, ...keep], `Jailed by ${interaction.user.tag}: ${reason}`);
    } catch (error) {
        throw new TitanBotError(
            'Could not jail',
            ErrorTypes.PERMISSION,
            'I could not jail that person. Check my **Manage Roles** permission and that my role is above theirs.',
        );
    }

    // 3) kick them out of voice (needs the Move Members permission, skipped if missing)
    if (member.voice?.channel) {
        await member.voice.disconnect('Jailed').catch(() => {});
    }

    // 4) save it in the history (.hs and .ms)
    await logModerationAction({
        client: guild.client,
        guild,
        event: {
            action: 'Member Jailed',
            target: `${member.user.tag} (${member.id})`,
            executor: `${interaction.user.tag} (${interaction.user.id})`,
            reason,
            metadata: { userId: member.id, moderatorId: interaction.user.id },
        },
    }).catch(() => {});

    // 5) tell them: DM and the staff log (they open a ticket themselves to talk)
    // what the staff should see inside the person's ticket later
    await saveJailRecord(guild.id, member.id, {
        reason,
        moderatorId: interaction.user.id,
        at: Date.now(),
    });

    await sendPunishmentDm(
        member.user,
        buildJailDm({ guild, reason, panelChannelId: panelChannelIdOf(config) }),
    );


    await writeJailLog(guild, config, {
        title: 'Member jailed',
        description:
            `**User:** ${member} (${member.id})\n` +
            `**By:** ${interaction.user}\n` +
            `**Reason:** ${reason}`,
        color: 'error',
    });

    // 6) answer the moderator
    await InteractionHelper.universalReply(interaction, { content: '✅' });
}
