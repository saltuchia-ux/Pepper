import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('grole')
        .setDescription('Give a role to a user')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to give')
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to give the role to')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    category: 'moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ You need **Kick Members** permission.',
                ephemeral: true,
            });
        }

        const role = interaction.options.getRole('role');
        const user = interaction.options.getUser('user');

        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ User not found.',
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

    async prefixExecute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ You need **Kick Members** permission.',
                ephemeral: true,
            });
        }

        const content = interaction.message.content;

        const roleMatch = content.match(/<@&(\d+)>/);
        const userMatch = content.match(/<@!?(\d+)>/g);

        if (!roleMatch || !userMatch || userMatch.length < 1) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ Use: `.grole @role @user`',
                ephemeral: true,
            });
        }

        const role = interaction.guild.roles.cache.get(roleMatch[1]);

        const userId = userMatch
            .map(x => x.match(/\d+/)?.[0])
            .find(id => id !== roleMatch[1]);

        const member = await interaction.guild.members
            .fetch(userId)
            .catch(() => null);

        if (!role) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ Role not found.',
                ephemeral: true,
            });
        }

        if (!member) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ User not found.',
                ephemeral: true,
            });
        }

        try {
            await member.roles.add(role);

            return InteractionHelper.universalReply(interaction, {
                content: `✅ Gave **${role.name}** to ${member}.`,
            });
        } catch (error) {
            console.error('GROLE PREFIX ERROR:', error);

            return InteractionHelper.universalReply(interaction, {
                content: '❌ I could not give that role.',
                ephemeral: true,
            });
        }
    },
};
