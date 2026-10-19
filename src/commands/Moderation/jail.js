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
} from '../../services/jailService.js';

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
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'User not found',
                        'Use `.jail @user reason`, `.jail userID reason` or `.jail username reason`.\n' +
                        'Names with spaces go in quotes: `.jail "John Smith" reason`.\n' +
                        'The reason is optional.'
                    ),
                ],
                ephemeral: true,
            });
        }

        if (!target.member) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Member not found', 'I could not find that member in this server.')],
                ephemeral: true,
            });
        }

        const reason = parts.slice(target.used).join(' ') || DEFAULT_REASON;

        return jailMember(interaction, target.member, reason);
    },
};

async function jailMember(interaction, member, reason) {
    // Only people with the Timeout Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        throw new TitanBotError(
            'Missing Timeout Members permission',
            ErrorTypes.PERMISSION,
            'You need the **Timeout Members** permission to use this command.',
        );
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
        );
    }

    if (!member.manageable) {
        throw new TitanBotError(
            'Cannot manage member',
            ErrorTypes.PERMISSION,
            'I cannot jail that person because their highest role is above my role.',
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

    // 5) tell them: DM, jail chat, staff log
    await sendPunishmentDm(member.user, buildJailDm({ guild, reason }));

    const chat = guild.channels.cache.get(config.chatChannelId);

    if (chat) {
        await chat
            .send({
                content: `${member}`,
                embeds: [
                    createEmbed({
                        title: 'You are in jail',
                        description:
                            `Reason: **${reason === DEFAULT_REASON ? 'no reason given' : reason}**\n` +
                            'A moderator will talk to you here.',
                        color: 'error',
                    }),
                ],
                allowedMentions: { users: [member.id] },
            })
            .catch(() => {});
    }

    await writeJailLog(guild, config, {
        title: 'Member jailed',
        description:
            `**User:** ${member} (${member.id})\n` +
            `**By:** ${interaction.user}\n` +
            `**Reason:** ${reason}`,
        color: 'error',
    });

    // 6) answer the moderator
    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: 'Member Jailed',
                description: `${member} has been jailed.`,
                color: 'error',
                thumbnail: member.user.displayAvatarURL?.({ size: 256 }) || null,
                fields: [
                    { name: 'Moderator', value: `${interaction.user}`, inline: true },
                    { name: 'Reason', value: reason, inline: true },
                    { name: 'Roles saved', value: 'For 2 hours. Use `.restore` to give them back.' },
                ],
            }),
        ],
    });
}
