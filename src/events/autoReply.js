import { Events } from 'discord.js';
import { handleAutoReply } from '../services/autoReplyService.js';

// Answers questions like "how to get image perm" (texts live in src/config/autoReplies.js)
export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        await handleAutoReply(message);
    },
};
