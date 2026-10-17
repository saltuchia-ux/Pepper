import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { clearSnipes } from '../../services/snipeService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('cs')
        .setDescription('Clear the snipe history (deleted and edited messages) of this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: 'moderation',

    // Slash command: /cs
    async execute(interaction, config, client) {
        return clearHistory(interaction);
    },

    // Prefix command: .cs
    async prefixExecute(interaction, config, client) {
        return clearHistory(interaction);
    },
};

async function clearHistory(interaction) {
    // Only people with the Manage Messages permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        throw new TitanBotError(
            'Missing Manage Messages permission',
            ErrorTypes.PERMISSION,
            'You need the **Manage Messages** permission to use this command.',
        );
    }

    const { deleted, edited } = clearSnipes(interaction.channel.id);

    return InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: '🧹 Snipe cleared',
                description:
                    `Removed **${deleted}** deleted and **${edited}** edited message${deleted + edited === 1 ? '' : 's'} ` +
                    `from ${interaction.channel}.`,
                color: 'success',
                timestamp: true,
            }),
        ],
    });
}
