import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { logModerationAction } from '../../utils/moderation.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { getPrefixText, errorBox, sendPunishmentDm } from '../../utils/punishmentTools.js';
import { getRoleBackup, backupMinutesLeft } from '../../services/roleBackupService.js';
import {
    DEFAULT_REASON,
    requireJail,
    buildUnjailDm,
    writeJailLog,
    closeJailTicket,
    clearJailRecord,
} from '../../services/jailService.js';
import { missingPermission, syntaxReply, userNotFoundReply } from '../../utils/punishmentTools.js';

const MAX_REASON_LENGTH = 500;

export default {
    data: new SlashCommandBuilder()
        .setName('unjail')
        .setDescription('Let a user out of jail')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('The user to let out')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Reason (optional)')
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',

    // Slash command: /unjail target:@user reason:...
    async execute(interaction, config, client) {
        const user = interaction.options.getUser('target');

        const member =
            interaction.options.getMember('target') ||
            await interaction.guild.members.fetch(user.id).catch(() => null);

        const reason = interaction.options.getString('reason')?.trim() || DEFAULT_REASON;

        return unjailMember(interaction, member, reason);
    },

    // Prefix command: .unjail @user reason   or   .unjail userID   or   .unjail username
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'unjail').split(/\s+/).filter(Boolean);
        const target = await takeUserFromWords(guild, parts);

        if (!target) {
            return parts.length ? userNotFoundReply(interaction) : syntaxReply(interaction, 'unjail');
        }

        if (!target.member) {
            return userNotFoundReply(interaction);
        }

        const reason = parts.slice(target.used).join(' ') || DEFAULT_REASON;

        return unjailMember(interaction, target.member, reason);
    },
};

async function unjailMember(interaction, member, reason) {
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

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
        );
    }

    if (!member.roles.cache.has(role.id)) {
        throw new TitanBotError(
            'Not jailed',
            ErrorTypes.VALIDATION,
            `${member} is not in jail.`,
            { plain: true },
        );
    }

    try {
        await member.roles.remove(role.id, `Let out of jail by ${interaction.user.tag}: ${reason}`);
    } catch (error) {
        throw new TitanBotError(
            'Could not unjail',
            ErrorTypes.PERMISSION,
            'I could not let that person out. Check my **Manage Roles** permission and that my role is above the Jailed role.',
        );
    }

    await logModerationAction({
        client: guild.client,
        guild,
        event: {
            action: 'Member Unjailed',
            target: `${member.user.tag} (${member.id})`,
            executor: `${interaction.user.tag} (${interaction.user.id})`,
            reason,
            metadata: { userId: member.id, moderatorId: interaction.user.id },
        },
    }).catch(() => {});

    await sendPunishmentDm(member.user, buildUnjailDm({ guild, reason }));

    // their jail ticket is not needed anymore
    const ticketClosed = await closeJailTicket(guild, member.id, {
        closedBy: `${interaction.user}`,
        reason: 'The person was let out of jail',
    });

    await clearJailRecord(guild.id, member.id);

    await writeJailLog(guild, config, {
        title: 'Member let out of jail',
        description:
            `**User:** ${member} (${member.id})\n` +
            `**By:** ${interaction.user}\n` +
            `**Reason:** ${reason}`,
        color: 'success',
    });

    const fields = [
        { name: 'Moderator', value: `${interaction.user}`, inline: true },
        { name: 'Reason', value: reason, inline: true },
    ];

    if (ticketClosed) {
        fields.push({ name: 'Ticket', value: 'Their jail ticket was closed.' });
    }

    // Their old roles are NOT given back here, but they may still be saved
    const backup = await getRoleBackup(guild.id, member.id);

    if (backup) {
        fields.push({
            name: 'Old roles',
            value:
                `Saved for ${backupMinutesLeft(backup)} more minutes. ` +
                'Someone with the **Ban Members** permission can give them back with `.role restore`.',
        });
    }

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: 'Member Let Out Of Jail',
                description: `${member} has been let out of jail.`,
                color: 'success',
                thumbnail: member.user.displayAvatarURL?.({ size: 256 }) || null,
                fields,
            }),
        ],
    });
}
