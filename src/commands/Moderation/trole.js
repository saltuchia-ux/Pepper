import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('trole')
        .setDescription('Take a role from a user')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Role to remove')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to remove the role from')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        return takeRole(interaction);
    },

    async prefixExecute(interaction, config, client) {
        return takeRole(interaction);
    },
};

async function takeRole(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Ban Members** permission to use `.trole`.',
            ephemeral: true,
        });
    }

    const role = interaction.options.getRole('role');
    const target = interaction.options.getMember('user');

    if (!role || !target) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ User or role not found.',
            ephemeral: true,
        });
    }

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I need **Manage Roles** permission.',
            ephemeral: true,
        });
    }

    if (!role.editable) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I cannot manage that role. Make sure my bot role is above it.',
            ephemeral: true,
        });
    }

    if (role.position >= interaction.member.roles.highest.position) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You cannot remove a role equal to or higher than your highest role.',
            ephemeral: true,
        });
    }

    if (!target.roles.cache.has(role.id)) {
        return InteractionHelper.universalReply(interaction, {
            content: `❌ ${target} does not have ${role}.`,
            ephemeral: true,
        });
    }

    try {
        await target.roles.remove(role, `Removed by ${interaction.user.tag}`);

        return InteractionHelper.universalReply(interaction, {
            content: `✅ Removed ${role} from ${target}.`,
        });
    } catch (error) {
        console.error('TROLE ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content: '❌ I could not remove that role.',
            ephemeral: true,
        });
    }
}
