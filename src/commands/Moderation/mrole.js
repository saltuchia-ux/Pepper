import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('mrole')
        .setDescription('Create a new role')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('Role name')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('Role color, example #ff0000')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('emoji')
                .setDescription('Optional emoji')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '❌ Administrator only.',
                ephemeral: true,
            });
        }

        const name = interaction.options.getString('name');
        const color = interaction.options.getString('color');
        const emoji = interaction.options.getString('emoji');

        if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
            return interaction.reply({
                content: '❌ Use a color like `#ff0000`.',
                ephemeral: true,
            });
        }

        try {
            const role = await interaction.guild.roles.create({
                name: emoji ? `${emoji} ${name}` : name,
                color: color,
                reason: `Created by ${interaction.user.tag}`,
            });

            return interaction.reply(
                `✅ Created **${role.name}** with color **${color}**.`
            );
        } catch (error) {
            console.error('MROLE ERROR:', error);

            return interaction.reply({
                content: '❌ I could not create the role. Give the bot **Manage Roles** and make sure the bot role is above the role it is creating.',
                ephemeral: true,
            });
        }
    },

    async prefixExecute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply('❌ Administrator only.');
        }

        const args = interaction.options._hoistedOptions.map(option => option.value);

        if (args.length < 2) {
            return interaction.reply(
                '❌ Usage: `.mrole <name> <color> [emoji]`\nExample: `.mrole Member #ff0000 🎮`'
            );
        }

        const name = args[0];
        const color = args[1];
        const emoji = args[2] || '';

        if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
            return interaction.reply('❌ Invalid color. Example: `#ff0000`');
        }

        try {
            const role = await interaction.guild.roles.create({
                name: emoji ? `${emoji} ${name}` : name,
                color: color,
                reason: `Created by ${interaction.user.tag}`,
            });

            return interaction.reply(
                `✅ Created role **${role.name}** with color **${color}**.`
            );
        } catch (error) {
            console.error('MROLE ERROR:', error);

            return interaction.reply(
                '❌ I could not create the role. Make sure the bot has **Manage Roles** permission.'
            );
        }
    },
};
