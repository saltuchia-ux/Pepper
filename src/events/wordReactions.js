import { Events } from 'discord.js';
import { handleReactionCommand, reactToWords } from '../services/wordReactionService.js';
import { logger } from '../utils/logger.js';

// ".reaction a <word> <emoji>" makes the bot react to that word. Needs Ban Members to change the list.
export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        try {
            if (!message.guild || message.author?.bot || message.webhookId || message.system) return;

            if (await handleReactionCommand(message)) return;
            await reactToWords(message);
        } catch (error) {
            logger.error('Word reactions error:', error);
        }
    },
};
