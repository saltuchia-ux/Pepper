import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('nuck')
        .setDescription('Delete all recent messages in this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    category: 'moderation',

    // Disable TitanBot cooldown/abuse protection for this command
    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        // Only Discord Administrators can use this command
        if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            return await InteractionHelper.universalReply(interaction, {
                content: '❌ You need **Administrator** permission to use `.nuck`.',
                ephemeral: true,
            });
        }

        const channel = interaction.channel;

        // Make sure this is a text-based channel
        if (!channel || !channel.isTextBased()) {
            return await InteractionHelper.universalReply(interaction, {
                content: '❌ This command can only be used in a text channel.',
                ephemeral: true,
            });
        }

        try {
            let totalDeleted = 0;

            // Fetch and delete messages in batches
            while (true) {
                const messages = await channel.messages.fetch({
                    limit: 100,
                });

                if (messages.size === 0) {
                    break;
                }

                // Discord bulk deletion only works for messages younger than 14 days
                const recentMessages = messages.filter(
                    (message) =>
                        Date.now() - message.createdTimestamp <
                        14 * 24 * 60 * 60 * 1000
                );

                if (recentMessages.size === 0) {
                    break;
                }

                const deleted = await channel.bulkDelete(recentMessages, true);

                totalDeleted += deleted.size;

                // Prevent an unnecessary loop
                if (deleted.size === 0) {
                    break;
                }

                if (deleted.size < 100) {
                    break;
                }
            }

            await InteractionHelper.universalReply(interaction, {
                content: `🧹 Successfully deleted **${totalDeleted}** messages.`,
            });

        } catch (error) {
            console.error('Nuck command error:', error);

            await InteractionHelper.universalReply(interaction, {
                content:
                    '❌ I could not delete the messages. Make sure the bot has **Manage Messages** permission in this channel.',
                ephemeral: true,
            });
        }
    },
};
