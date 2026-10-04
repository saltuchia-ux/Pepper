import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('grole')
        .setDescription('Give a role to a user')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Role to give')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to give the role to')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        return giveRole(interaction);
    },

    async prefixExecute(interaction, config, client) {
        return giveRole(interaction);
    },
};

async function giveRole(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Ban Members** permission to use `.grole`.',
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
            content: '❌ You cannot give a role equal to or higher than your highest role.',
            ephemeral: true,
        });
    }

    if (target.roles.cache.has(role.id)) {
        return InteractionHelper.universalReply(interaction, {
            content: `❌ ${target} already has ${role}.`,
            ephemeral: true,
        });
    }

    try {
        await target.roles.add(role, `Given by ${interaction.user.tag}`);

        return InteractionHelper.universalReply(interaction, {
            content: `✅ Gave ${role} to ${target}.`,
        });
    } catch (error) {
        console.error('GROLE ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content: '❌ I could not give that role.',
            ephemeral: true,
        });
    }
}
