import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('mrole')
        .setDescription('Create a role')
        .addStringOption(o =>
            o.setName('name')
                .setDescription('Role name')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('color')
                .setDescription('Color like #ff0000')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('emoji')
                .setDescription('Optional emoji')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    abuseProtection: {
        enabled: false
    },

    async execute(interaction) {
        const name = interaction.options.getString('name');
        const color = interaction.options.getString('color');
        const emoji = interaction.options.getString('emoji');

        try {
            const role = await interaction.guild.roles.create({
                name: emoji ? `${emoji} ${name}` : name,
                color: color
            });

            await interaction.reply(`✅ Created **${role.name}**`);
        } catch (error) {
            console.error('MROLE ERROR:', error);
            await interaction.reply('❌ I could not create the role.');
        }
    },

    async prefixExecute(interaction) {
        const values = interaction.options._hoistedOptions.map(x => String(x.value));

        const name = values[0];
        const color = values.find(x => /^#[0-9A-Fa-f]{6}$/.test(x));
        const emoji = values.find(x => x !== name && x !== color);

        if (!name) {
            return interaction.reply('❌ Use: `.mrole RoleName #ff0000`');
        }

        if (!color) {
            return interaction.reply('❌ Use a color like `#ff0000`.');
        }

        try {
            const role = await interaction.guild.roles.create({
                name: emoji ? `${emoji} ${name}` : name,
                color: color
            });

            await interaction.reply(`✅ Created **${role.name}**`);
        } catch (error) {
            console.error('MROLE ERROR:', error);
            await interaction.reply('❌ I could not create the role.');
        }
    }
};
