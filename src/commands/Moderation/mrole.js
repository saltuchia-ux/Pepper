import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('mrole')
        .setDescription('Create a role')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('Role name')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('Color like #ff0000')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('emoji')
                .setDescription('Optional emoji')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    abuseProtection: {
        enabled: false
    },

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply('❌ Administrator only.');
        }

        const name = interaction.options.getString('name');
        const color = interaction.options.getString('color');
        const emoji = interaction.options.getString('emoji');

        return createRole(interaction, name, color, emoji);
    },

    async prefixExecute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply('❌ Administrator only.');
        }

        const args = interaction.options._hoistedOptions.map(x => x.value);

        if (args.length < 2) {
            return interaction.reply(
                '❌ Usage: `.mrole <name> <color> [emoji]`'
            );
        }

        const name = args[0];
        const colorIndex = args.findIndex(x =>
            /^#[0-9A-Fa-f]{6}$/.test(x)
        );

        if (colorIndex === -1) {
            return interaction.reply(
                '❌ Invalid color. Example: `#ff0000`'
            );
        }

        const color = args[colorIndex];

        const emoji = args
            .filter((x, i) => i !== 0 && i !== colorIndex)
            .join(' ');

        return createRole(interaction, name, color, emoji);
    }
};

async function createRole(interaction, name, color, emoji) {
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply(
            '❌ I need **Manage Roles** permission.'
        );
    }

    try {
        const role = await interaction.guild.roles.create({
            name: emoji ? `${emoji} ${name}` : name,
            color: color,
            reason: `Created by ${interaction.user.tag}`
        });

        return interaction.reply(
            `✅ Created **${role.name}**`
        );
    } catch (error) {
        console.error('MROLE ERROR:', error);

        return interaction.reply(
            '❌ I could not create the role. Make sure my bot role is above the new role.'
        );
    }
}
