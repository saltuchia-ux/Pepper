import { Events } from 'discord.js';
import { recordDeletedMessage } from '../services/snipeService.js';

// Saves deleted messages for the .s (snipe) command
export default {
    name: Events.MessageDelete,
    once: false,

    async execute(message) {
        recordDeletedMessage(message);
    },
};
