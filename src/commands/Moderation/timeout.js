const { PermissionsBitField } = require('discord.js');

function parseDuration(timeStr) {
    const regex = /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hour|hours|d|day|days|w|week|weeks)$/i;
    const match = timeStr.match(regex);

    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const multipliers = {
        s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
        m: 60 * 1000, min: 60 * 1000, mins: 60 * 1000, minute: 60 * 1000, minutes: 60 * 1000,
        h: 60 * 60 * 1000, hour: 60 * 60 * 1000, hours: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000, day: 24 * 60 * 60 * 1000, days: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, weeks: 7 * 24 * 60 * 60 * 1000
    };

    return value * (multipliers[unit] || 0);
}

module.exports = {
    name: 'timeout',
    aliases: ['mute', 'stfu'],
    description: 'Timeout / Mute a member for a specified duration.',
    async execute(message, args) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
            return message.reply('❌ You do not have permission to use this command.');
        }

        const targetInput = args[0];
        if (!targetInput) {
            return message.reply('⚠️ Usage: `.timeout <user/id> <time> [reason]`\n*Examples: `.mute @User 5m` | `.stfu @User 1 min` | `.timeout 123456789 2 hours bad behavior`*');
        }

        const memberId = targetInput.replace(/<@!?(\d+)>/, '$1');
        const targetMember = await message.guild.members.fetch(memberId).catch(() => null);

        if (!targetMember) {
            return message.reply('❌ Could not find a member with that ID or mention.');
        }

        let duration = null;
        let timeInputStr = '';
        let reasonStartIndex = 2;

        if (args[1]) {
            duration = parseDuration(args[1]);
            timeInputStr = args[1];

            if (!duration && args[2]) {
                const combinedTime = `${args[1]} ${args[2]}`;
                duration = parseDuration(combinedTime);
                if (duration) {
                    timeInputStr = combinedTime;
                    reasonStartIndex = 3;
                }
            }
        }

        const maxTimeout = 28 * 24 * 60 * 60 * 1000;

        if (!duration || duration < 1000 || duration > maxTimeout) {
            return message.reply('❌ Invalid time format! Use time like `5m`, `1 min`, `2 hours`, `1d`, or `1 week`. Max is 28 days.');
        }

        const reason = args.slice(reasonStartIndex).join(' ') || 'No reason provided';

        try {
            await targetMember.timeout(duration, reason);
            return message.reply(`✅ Successfully timed out **${targetMember.user.tag}** for **${timeInputStr}**. Reason: ${reason}`);
        } catch (error) {
            console.error(error);
            return message.reply('❌ An error occurred while trying to timeout this user.');
        }
    }
};
