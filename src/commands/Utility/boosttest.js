import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { plainPayload } from '../../utils/replyStyle.js';
import { buildBoostPayload, giveBoostRoles } from '../../services/boostService.js';

// ==========================================
// .boosttest        -> shows the boost thank-you message here
// .boosttest role   -> gives YOU the boost role(s), to test the role part
// Admins only.
// ==========================================

async function run(interaction, word) {
    const guild = interaction.guild;
    if (!guild) return;

    if (String(word ?? '').trim().toLowerCase() === 'role') {
        const member = interaction.member
            ?? await guild.members.fetch(interaction.user.id).catch(() => null);

        if (!member) {
            return InteractionHelper.universalReply(interaction, plainPayload('Could not find you in this server'));
        }

        const results = await giveBoostRoles(member);

        return InteractionHelper.universalReply(
            interaction,
            plainPayload(results.join('\n') || 'No roles are set in boostDefaults.js (giveRoleIds)'),
        );
    }

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
        .setDescription('Preview the boost thank-you message (type "role" to test the role)')
        .addStringOption((option) =>
            option
                .setName('what')
                .setDescription('Type role to test the boost role')
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'Utility',

    async execute(interaction) {
        return run(interaction, interaction.options.getString('what'));
    },

    async prefixExecute(interaction) {
        const message = interaction._responseCoordinator?.message ?? interaction.message;

        const text = (message?.content ?? '')
            .replace(/^\S*?boosttest(?:\s+|$)/i, '')
            .trim();

        return run(interaction, text);
    },
};
