import { Events } from 'discord.js';
import { enforceLinkFilter } from '../services/linkFilterService.js';

// Also checks edited messages, so nobody can sneak a link in by editing it later
export default {
    name: Events.MessageUpdate,
    once: false,

    async execute(oldMessage, newMessage) {
        if (newMessage.partial) {
            newMessage = await newMessage.fetch().catch(() => null);
            if (!newMessage) return;
        }
        if (oldMessage.content === newMessage.content) return;
        await enforceLinkFilter(newMessage);
    },
};
