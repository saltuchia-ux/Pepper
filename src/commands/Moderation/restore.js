import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { logModerationAction } from '../../utils/moderation.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { getPrefixText, errorBox } from '../../utils/punishmentTools.js';
import { getRoleBackup, deleteRoleBackup, backupMinutesLeft } from '../../services/roleBackupService.js';
import { getJailConfig, writeJailLog } from '../../services/jailService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('restore')
        .setDescription('Give a person their roles back (saved for 2 hours after a jail, kick or ban)')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('The user to give their roles back to')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',

    // Slash command: /restore target:@user
    async execute(interaction, config, client) {
        const user = interaction.options.getUser('target');

        const member =
            interaction.options.getMember('target') ||
            await interaction.guild.members.fetch(user.id).catch(() => null);

        return restoreRoles(interaction, user.id, member);
    },

    // Prefix command: .restore @user   or   .restore userID   or   .restore username
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'restore').split(/\s+/).filter(Boolean);
        const target = await takeUserFromWords(guild, parts);

        if (!target) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'User not found',
                        'Use `.restore @user`, `.restore userID` or `.restore username`.\n' +
                        'Names with spaces go in quotes: `.restore "John Smith"`.'
                    ),
                ],
                ephemeral: true,
            });
        }

        return restoreRoles(interaction, target.id, target.member);
    },
};

async function restoreRoles(interaction, userId, member) {
    // Only people with the Ban Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw new TitanBotError(
            'Missing Ban Members permission',
            ErrorTypes.PERMISSION,
            'You need the **Ban Members** permission to use this command.',
        );
    }

    const guild = interaction.guild;
    const backup = await getRoleBackup(guild.id, userId);

    if (!backup) {
        throw new TitanBotError(
            'No saved roles',
            ErrorTypes.VALIDATION,
            'There are no saved roles for that person.\n' +
            'Roles are saved for **2 hours** after a jail, kick or ban. After that they are gone.',
        );
    }

    if (!member) {
        const banned = await guild.bans.fetch(userId).catch(() => null);

        throw new TitanBotError(
            'Not in the server',
            ErrorTypes.USER_INPUT,
            banned
                ? 'That person is banned. Use `.unban` first and let them rejoin, then use `.restore`.\n'
                : 'That person is not in the server. Once they rejoin, use `.restore` again.\n',
        );
    }

    const me = guild.members.me ?? await guild.members.fetchMe();
    const botTop = me.roles.highest.position;
    const moderatorTop = interaction.member.roles.highest.position;
    const isOwner = guild.ownerId === interaction.user.id;

    const config = await getJailConfig(guild.id);

    const give = [];
    const skipped = { missing: 0, tooHighForBot: 0, tooHighForYou: 0 };

    for (const roleId of backup.roleIds) {
        const role = guild.roles.cache.get(roleId);

        if (!role) {
            skipped.missing++;
        } else if (role.managed || role.id === guild.id || role.id === config?.roleId) {
            // never given back
        } else if (role.position >= botTop) {
            skipped.tooHighForBot++;
        } else if (!isOwner && role.position >= moderatorTop) {
            // Stops someone from handing out a role that is above their own
            skipped.tooHighForYou++;
        } else {
            give.push(role);
        }
    }

    // The new role list = what they have now (without the Jailed role) + the saved roles
    const finalIds = new Set(
        [...member.roles.cache.keys()].filter((id) => id !== config?.roleId),
    );

    for (const role of give) finalIds.add(role.id);

    const wasJailed = Boolean(config?.roleId && member.roles.cache.has(config.roleId));

    try {
        await member.roles.set([...finalIds], `Roles restored by ${interaction.user.tag}`);
    } catch (error) {
        throw new TitanBotError(
            'Could not restore',
            ErrorTypes.PERMISSION,
            'I could not give the roles back. Check my **Manage Roles** permission and that my role is above theirs.',
        );
    }

    await deleteRoleBackup(guild.id, userId);

    await logModerationAction({
        client: guild.client,
        guild,
        event: {
            action: 'Roles Restored',
            target: `${member.user.tag} (${member.id})`,
            executor: `${interaction.user.tag} (${interaction.user.id})`,
            reason: `Gave back ${give.length} role(s)`,
            metadata: { userId: member.id, moderatorId: interaction.user.id },
        },
    }).catch(() => {});

    if (config) {
        await writeJailLog(guild, config, {
            title: 'Roles restored',
            description:
                `**User:** ${member} (${member.id})\n` +
                `**By:** ${interaction.user}\n` +
                `**Roles given back:** ${give.length}` +
                (wasJailed ? '\nThey were also let out of jail.' : ''),
            color: 'success',
        });
    }

    const skippedTotal = skipped.missing + skipped.tooHighForBot + skipped.tooHighForYou;
    const notes = [];

    if (wasJailed) notes.push('They were also let out of jail.');
    if (skipped.tooHighForYou) notes.push(`${skipped.tooHighForYou} role(s) are above your own role, so they were not given.`);
    if (skipped.tooHighForBot) notes.push(`${skipped.tooHighForBot} role(s) are above my role, so I cannot give them.`);
    if (skipped.missing) notes.push(`${skipped.missing} role(s) no longer exist.`);

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: 'Roles Restored',
                description:
                    `${member} got **${give.length}** role${give.length === 1 ? '' : 's'} back` +
                    (skippedTotal ? ` (${skippedTotal} skipped).` : '.') +
                    (notes.length ? `\n\n${notes.join('\n')}` : ''),
                color: 'success',
                thumbnail: member.user.displayAvatarURL?.({ size: 256 }) || null,
                fields: [
                    { name: 'Moderator', value: `${interaction.user}`, inline: true },
                    { name: 'Given back', value: give.length ? give.map((r) => r.toString()).join(' ').slice(0, 1000) : 'none', inline: false },
                ],
            }),
        ],
    });
}
