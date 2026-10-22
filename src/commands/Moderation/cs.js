import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { clearSnipes } from '../../services/snipeService.js';
import { missingPermission } from '../../utils/punishmentTools.js';

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
        throw missingPermission('manage_messages');
    }

    clearSnipes(interaction.channel.id);

    // Typed as .cs: the bot just reacts to the message with a check mark
    const original = interaction.message ?? interaction._responseCoordinator?.message ?? null;

    if (original?.react) {
        try {
            await original.react('✅');
            return;
        } catch (error) {
            // The bot cannot react here (no Add Reactions permission), so answer instead
        }
    }

    // Slash command (there is no message to react to) or the reaction failed
    return InteractionHelper.universalReply(interaction, {
        content: '✅ Snipe history cleared.',
        ephemeral: true,
    });
}
