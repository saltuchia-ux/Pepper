import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('trole')
        .setDescription('Take a role from a user')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('The role to remove')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to remove the role from')
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

        if (!member.roles.cache.has(role.id)) {
            return InteractionHelper.universalReply(interaction, {
                content: `❌ ${member} does not have **${role.name}**.`,
                ephemeral: true,
            });
        }

        try {
            await member.roles.remove(role);

            return InteractionHelper.universalReply(interaction, {
                content: `✅ Removed **${role.name}** from ${member}.`,
            });
        } catch (error) {
            console.error('TROLE ERROR:', error);

            return InteractionHelper.universalReply(interaction, {
                content: '❌ I could not remove that role.',
                ephemeral: true,
            });
        }
    },
};
