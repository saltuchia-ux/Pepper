import { Events } from 'discord.js';
import { recordEditedMessage } from '../services/snipeService.js';

// Saves edited messages for the .es (edit snipe) command
export default {
    name: Events.MessageUpdate,
    once: false,

    async execute(oldMessage, newMessage) {
        recordEditedMessage(oldMessage, newMessage);
    },
};
