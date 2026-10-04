import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('mrole')
        .setDescription('Create a new role')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('The name of the role')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('Role color, e.g. #ff0000')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('emoji')
                .setDescription('Role emoji (optional)')
                .setRequired(false)
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

        const name = interaction.options.getString('name');
        const color = interaction.options.getString('color');
        const emoji = interaction.options.getString('emoji');

        if (!/^#?[0-9A-Fa-f]{6}$/.test(color)) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ Invalid color. Use a hex color like `#ff0000`.',
                ephemeral: true,
            });
        }

        const roleColor = color.startsWith('#') ? color : `#${color}`;

        try {
            const role = await interaction.guild.roles.create({
                name,
                color: roleColor,
                reason: `Role created by ${interaction.user.tag}`,
            });

            let message = `✅ Created role **${role.name}**`;

            if (emoji) {
                message += ` ${emoji}`;
            }

            return InteractionHelper.universalReply(interaction, {
                content: message,
            });

        } catch (error) {
            console.error('MROLE ERROR:', error);

            return InteractionHelper.universalReply(interaction, {
                content: '❌ I could not create the role. Make sure I have **Manage Roles** permission.',
                ephemeral: true,
            });
        }
    },
};
