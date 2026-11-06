import { Events } from 'discord.js';
import { recordSeen } from '../services/seenService.js';

// .seen  -  every message counts as "the person was here"
export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        if (!message.guild || message.author.bot) return;

        recordSeen(message.guild.id, message.author.id);
    },
};
