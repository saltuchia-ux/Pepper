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

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply('❌ Administrator only.');
        }

        if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
            return interaction.reply('❌ Color must look like `#ff0000`');
        }

        try {
            const role = await interaction.guild.roles.create({
                name: emoji ? `${emoji} ${name}` : name,
                color: color
            });

            await interaction.reply(`✅ Created **${role.name}**`);
        } catch (error) {
            console.error(error);
            await interaction.reply('❌ I could not create the role.');
        }
    },

    async prefixExecute(interaction) {
        const args = interaction.options._hoistedOptions.map(x => x.value);

        if (args.length < 2) {
            return interaction.reply(
                '❌ Use: `.mrole RoleName #ff0000`'
            );
        }

        const name = args[0];
        const color = args.find(x => /^#[0-9A-Fa-f]{6}$/.test(x));
        const emoji = args.find(x => x !== name && x !== color);

        if (!color) {
            return interaction.reply('❌ Invalid color.');
        }

        try {
            const role = await interaction.guild.roles.create({
                name: emoji ? `${emoji} ${name}` : name,
                color: color
            });

            await interaction.reply(`✅ Created **${role.name}**`);
        } catch (error) {
            console.error(error);
            await interaction.reply('❌ I could not create the role.');
        }
    }
};
