import { SlashCommandBuilder } from 'discord.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { getPrefixText, plainReply, syntaxReply, userNotFoundReply } from '../../utils/punishmentTools.js';
import { getLastSeen } from '../../services/seenService.js';
import { formatDuration } from '../../services/afkService.js';

// ==========================================
// .seen @user      -> "👀 Last seen @user: 5 minutes ago"
//                     (or "no data" if the bot never saw them)
// Everyone can use it.
// ==========================================

async function showSeen(interaction, userId, member) {
    // Sitting in a voice channel right now
    if (member?.voice?.channelId) {
        return plainReply(interaction, `👀 Last seen <@${userId}>: now (in voice)`);
    }

    const at = await getLastSeen(interaction.guildId, userId);

    if (!at) {
        return plainReply(interaction, `👀 Last seen <@${userId}>: no data`);
    }

    return plainReply(interaction, `👀 Last seen <@${userId}>: ${formatDuration(Date.now() - at)} ago`);
}

export default {
    data: new SlashCommandBuilder()
        .setName('seen')
        .setDescription('See when someone was last active in this server')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The person to check')
                .setRequired(true),
        ),
    category: 'Utility',

    // /seen user:@someone
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const member = interaction.guild?.members.cache.get(user.id) ?? null;

        return showSeen(interaction, user.id, member);
    },

    // .seen @someone    .seen name    .seen userID
    async prefixExecute(interaction) {
        const guild = interaction.guild;

        if (!guild) return;

        const words = getPrefixText(interaction, 'seen').split(/\s+/).filter(Boolean);

        if (!words.length) return syntaxReply(interaction, 'seen');

        const target = await takeUserFromWords(guild, words);

        if (!target) return userNotFoundReply(interaction);

        return showSeen(interaction, target.id, target.member);
    },
};
