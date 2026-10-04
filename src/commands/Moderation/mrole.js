import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('mrole')
        .setDescription('Create a new role')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('The role name')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('emoji')
                .setDescription('Optional emoji for the role')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('Role color, for example #ff0000')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    category: 'moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ You need **Administrator** permission.',
                ephemeral: true,
            });
        }

        const roleName = interaction.options.getString('name');
        const emoji = interaction.options.getString('emoji');
        const color = interaction.options.getString('color');

        if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
            return interaction.reply({
                content: '❌ Invalid color. Example: `#ff0000`',
                ephemeral: true,
            });
        }

        const finalName = emoji
            ? `${emoji} ${roleName}`
            : roleName;

        try {
            const role = await interaction.guild.roles.create({
                name: finalName,
                color: color,
                reason: `Role created by ${interaction.user.tag}`,
            });

            await interaction.reply(
                `✅ Created role **${role.name}** with color **${color}**.`
            );

        } catch (error) {
            console.error('MROLE ERROR:', error);

            await interaction.reply({
                content: '❌ I could not create the role. Make sure I have **Manage Roles** permission and my bot role is high enough.',
                ephemeral: true,
            });
        }
    },
};
