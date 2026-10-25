import { Events } from 'discord.js';
import { handlePresence } from '../services/statusRoleService.js';

// Fires when someone changes their status (rules live in src/config/statusRole.js)
export default {
    name: Events.PresenceUpdate,
    once: false,

    async execute(oldPresence, newPresence) {
        await handlePresence(newPresence);
    },
};
