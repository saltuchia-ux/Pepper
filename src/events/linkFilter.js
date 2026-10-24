import { Events } from 'discord.js';
import { enforceLinkFilter } from '../services/linkFilterService.js';

// Checks every new message for links (rules live in src/config/linkFilter.js)
export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        await enforceLinkFilter(message);
    },
};
