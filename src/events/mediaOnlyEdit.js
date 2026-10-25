import { Events } from 'discord.js';
import { enforceMediaOnly } from '../services/mediaOnlyService.js';

// Also checks edited messages, so removing the media from a post doesn't get around the rule
export default {
    name: Events.MessageUpdate,
    once: false,

    async execute(oldMessage, newMessage) {
        if (newMessage.partial) {
            newMessage = await newMessage.fetch().catch(() => null);
            if (!newMessage) return;
        }
        // Discord also fires an update when it adds a link preview, so only react to real edits
        if (oldMessage.content === newMessage.content
            && oldMessage.attachments?.size === newMessage.attachments?.size) return;

        await enforceMediaOnly(newMessage);
    },
};
