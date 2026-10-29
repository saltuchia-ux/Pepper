import { Events } from 'discord.js';
import { handleAiChat } from '../services/aiChatService.js';

// Talks to the AI character when a message starts with its name (settings: src/config/aiChat.js)
export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        await handleAiChat(message);
    },
};
