import { Events } from 'discord.js';
import { startReminderChecker } from '../services/reminderService.js';

// Starts the .remind checker by itself when the bot is ready (no edit in ready.js needed)
export default {
    name: Events.ClientReady,
    once: true,

    async execute(client) {
        startReminderChecker(client);
    },
};
