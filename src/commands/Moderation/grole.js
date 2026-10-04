import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('grole')
        .setDescription('Give a role to a user')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('The role to give')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to give the role to')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    category: 'moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ You need **Kick Members** permission.',
                ephemeral: true,
            });
        }

        const role = interaction.options.getRole('role');
        const user = interaction.options.getUser('user');

        const member = await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ User not found.',
                ephemeral: true,
            });
        }

        if (role.managed) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ I cannot give a managed role.',
                ephemeral: true,
            });
        }

        const botMember = interaction.guild.members.me;

        if (role.position >= botMember.roles.highest.position) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ That role is higher than or equal to my highest role.',
                ephemeral: true,
            });
        }

        if (member.roles.cache.has(role.id)) {
            return InteractionHelper.universalReply(interaction, {
                content: `❌ ${member} already has **${role.name}**.`,
                ephemeral: true,
            });
        }

        try {
            await member.roles.add(role);

            return InteractionHelper.universalReply(interaction, {
                content: `✅ Gave **${role.name}** to ${member}.`,
            });
        } catch (error) {
            console.error('GROLE ERROR:', error);

            return InteractionHelper.universalReply(interaction, {
                content: '❌ I could not give that role.',
                ephemeral: true,
            });
        }
    },
};
