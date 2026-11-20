import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';

// If someone REPLIES to one of the bot's messages and says "i hate you",
// the bot replies "i hate you too".
const HATE_REGEX = /\bi\s+hate\s+(you|u|ya)\b/i;

export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        try {
            if (!message.guild || message.author?.bot || message.webhookId || message.system) return;
            if (!message.reference?.messageId) return;
            if (!HATE_REGEX.test(message.content || '')) return;

            // is it a reply to a message the bot sent?
            const replied = await message.fetchReference().catch(() => null);

            if (!replied || replied.author?.id !== message.client.user.id) return;

            await message.reply({
                content: 'i hate you too',
                allowedMentions: { repliedUser: false },
            });
        } catch (error) {
            logger.error('Hate reply error:', error);
        }
    },
};
