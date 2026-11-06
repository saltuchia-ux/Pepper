import { recordSeen } from '../services/seenService.js';

// .seen  -  joining, leaving or moving between voice channels counts too
export default {
    name: 'voiceStateUpdate',
    once: false,

    async execute(oldState, newState) {
        const member = newState.member ?? oldState.member;

        if (!member || member.user.bot) return;
        if (oldState.channelId === newState.channelId) return; // only mute / deafen changes

        recordSeen(newState.guild.id, member.id);
    },
};
