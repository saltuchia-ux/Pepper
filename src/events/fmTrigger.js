import { Events } from 'discord.js';
import { getCcMap, getLinkedUsername, buildNowPlayingPayload, addVoteReactions, hasApiKey } from '../services/lastfmService.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { logger } from '../utils/logger.js';

// ==========================================
// .lf cc (text)  -  when the person who set it types that word,
// the bot shows their now playing (same as .fm). Plain text only, no "." needed
// ==========================================

export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        if (!message.guild || message.author.bot || !hasApiKey()) return;

        const content = message.content?.trim();
        if (!content || content.length > 25 || /\s/.test(content)) return;

        const text = content.toLowerCase();
        const map = await getCcMap(message.guild.id);

        if (map[text] !== message.author.id) return;

        const username = await getLinkedUsername(message.author.id);
        if (!username) return;

        if (!(await checkRateLimit(`fmcc:${message.author.id}`, 6, 20000))) return;

        try {
            await message.channel.sendTyping?.().catch(() => {});
            const payload = await buildNowPlayingPayload(username, message.member?.displayName ?? message.author.username);
            const sent = await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } })
                .catch(() => message.channel.send(payload));
            await addVoteReactions(sent);
        } catch (error) {
            logger.warn('Last.fm custom command failed', { message: error.message });
        }
    },
};
