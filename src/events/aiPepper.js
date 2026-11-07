import { Events } from 'discord.js';
import { handleAiChat } from '../services/aiChatService.js';
import { AI_PEPPER } from '../config/aiPepper.js';

// Pepper: a normal helpful AI. Answers when a message starts with "Pepper" (settings: src/config/aiPepper.js).
// Uses the same AI key as Caseoh.
export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        await handleAiChat(message, AI_PEPPER);
    },
};
