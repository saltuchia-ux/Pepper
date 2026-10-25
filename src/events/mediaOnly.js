import { Events } from 'discord.js';
import { enforceMediaOnly } from '../services/mediaOnlyService.js';

// Deletes text-only messages in the media-only channels (rules live in src/config/mediaOnly.js)
export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        await enforceMediaOnly(message);
    },
};
