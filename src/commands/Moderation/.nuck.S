import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('nuck')
        .setDescription('Delete messages in this channel'),

    abuseProtection: {
        enabled: false
    },

    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply('❌ Administrator permission required.');
        }

        try {
            let deleted = 0;

            while (true) {
                const messages = await interaction.channel.messages.fetch({
                    limit: 100
                });

                if (messages.size === 0) break;

                const result = await interaction.channel.bulkDelete(messages, true);
                deleted += result.size;

                if (messages.size < 100) break;
            }

            await interaction.reply(`💥 Channel nuked! Deleted ${deleted} messages.`);
        } catch (error) {
            console.error(error);
            await interaction.reply('❌ I could not delete the messages.');
        }
    }
};
