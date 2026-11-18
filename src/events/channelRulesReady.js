import { Events } from 'discord.js';

// The rules box is NOT posted on bot start anymore.
// It only gets (re)sent when someone types in the channel (see channelRules.js).
export default {
    name: Events.ClientReady,
    once: true,

    async execute() {
        // nothing on purpose
    },
};
