import { SlashCommandBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { boxPayload } from '../../utils/replyStyle.js';
import { setAfk } from '../../services/afkService.js';

// ==========================================
// .afk            -> you are AFK  (status: AFK)
// .afk sleeping   -> you are AFK  (status: sleeping)
//
// When someone pings you or replies to you, the bot tells them you are AFK
// (that part is in src/events/afkMessage.js).
// Everyone can use it.
// ==========================================

async function goAfk(interaction, statusText) {
    const { status } = await setAfk(interaction.guildId, interaction.user.id, statusText);

    return InteractionHelper.universalReply(
        interaction,
        boxPayload(
            0x2b2d31,
            `<@${interaction.user.id}>: 👍👍 You are now AFK\n**Status:** ${status}`,
        ),
    );
}

export default {
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Tell people you are away')
        .addStringOption((option) =>
            option
                .setName('status')
                .setDescription('Why you are away (for example: sleeping)')
                .setMaxLength(100)
                .setRequired(false),
        ),
    category: 'Utility',

    // /afk status:sleeping
    async execute(interaction) {
        return goAfk(interaction, interaction.options.getString('status'));
    },

    // .afk     .afk sleeping
    async prefixExecute(interaction) {
        const message = interaction._responseCoordinator?.message ?? interaction.message;

        const text = (message?.content ?? '')
            .replace(/^\S*?afk(?:\s+|$)/i, '')
            .trim();

        return goAfk(interaction, text);
    },
};
