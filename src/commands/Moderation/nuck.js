import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('nuck')
        .setDescription('Delete all recent messages in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    category: 'moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            return await InteractionHelper.universalReply(interaction, {
                content: '❌ You need Administrator permission to use this command.',
                ephemeral: true,
            });
        }

        const channel = interaction.channel;

        if (!channel || !channel.isTextBased()) {
            return await InteractionHelper.universalReply(interaction, {
                content: '❌ This command can only be used in a text channel.',
                ephemeral: true,
            });
        }

        try {
            let totalDeleted = 0;

            while (true) {
                const messages = await channel.messages.fetch({ limit: 100 });

                if (messages.size === 0) break;

                const recentMessages = messages.filter(
                    message =>
                        Date.now() - message.createdTimestamp <
                        14 * 24 * 60 * 60 * 1000
                );

                if (recentMessages.size === 0) break;

                const deleted = await channel.bulkDelete(recentMessages, true);

                totalDeleted += deleted.size;

                if (deleted.size === 0 || deleted.size < 100) break;
            }

            await InteractionHelper.universalReply(interaction, {
                content: `🧹 Deleted **${totalDeleted}** messages.`,
            });

        } catch (error) {
            console.error('Nuck command error:', error);

            await InteractionHelper.universalReply(interaction, {
                content: '❌ I could not delete the messages. Make sure the bot has **Manage Messages** permission.',
                ephemeral: true,
            });
        }
    },
};
