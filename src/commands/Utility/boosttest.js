import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { buildBoostPayload } from '../../services/boostService.js';

// ==========================================
// .boosttest  -> shows the boost thank-you message here, so you can
// check how it looks without boosting. Admins only.
// ==========================================

async function preview(interaction) {
    const guild = interaction.guild;
    if (!guild) return;

    return InteractionHelper.universalReply(
        interaction,
        buildBoostPayload({
            guild,
            user: interaction.user,
            position: guild.premiumSubscriptionCount || 1,
        }),
    );
}

export default {
    data: new SlashCommandBuilder()
        .setName('boosttest')
        .setDescription('Preview the server boost thank-you message')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'Utility',

    async execute(interaction) {
        return preview(interaction);
    },

    async prefixExecute(interaction) {
        return preview(interaction);
    },
};
