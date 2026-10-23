import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getAfk, clearAfk, formatDuration } from '../services/afkService.js';

// ==========================================
// AFK watcher (runs on every message, next to the normal message handler)
//   - someone pings / replies to an AFK person -> "💤 @them is AFK: status - 5 minutes ago"
//   - the AFK person talks again               -> AFK is removed ("Welcome back")
// ==========================================

const NOTICE_COOLDOWN_MS = 15000; // same AFK person, same channel: at most one notice per 15s
const MAX_PEOPLE_PER_MESSAGE = 5;

const lastNotice = new Map();

const NO_PINGS = { parse: [], repliedUser: false };

function sendQuietReply(message, text) {
    return message
        .reply({ content: text, allowedMentions: NO_PINGS })
        .catch(() => message.channel.send({ content: text, allowedMentions: NO_PINGS }).catch(() => null));
}

// Everyone this message pings, plus the person being replied to (even with the reply ping turned off)
async function getTargets(message) {
    const ids = new Set(message.mentions.users.keys());

    if (message.mentions.repliedUser) ids.add(message.mentions.repliedUser.id);

    const refId = message.reference?.messageId;

    if (refId) {
        let ref = message.channel.messages?.cache?.get(refId) ?? null;

        if (!ref) ref = await message.fetchReference().catch(() => null);

        if (ref?.author) ids.add(ref.author.id);
    }

    ids.delete(message.author.id);

    return [...ids].slice(0, MAX_PEOPLE_PER_MESSAGE);
}

export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        if (!message.guild || message.author.bot) return;

        const guildId = message.guild.id;

        // 1) the AFK person is back (but typing ".afk" itself must not cancel it)
        if (!/^\.afk(?:\s|$)/i.test(message.content)) {
            const mine = await getAfk(guildId, message.author.id);

            if (mine) {
                await clearAfk(guildId, message.author.id);

                logger.info('AFK removed', { userId: message.author.id, guildId });

                await sendQuietReply(
                    message,
                    `👋 Welcome back <@${message.author.id}>, you were AFK for **${formatDuration(Date.now() - mine.since)}**`,
                );
            }
        }

        // 2) someone pinged / replied to an AFK person
        const targets = await getTargets(message);

        if (targets.length === 0) return;

        const lines = [];

        for (const userId of targets) {
            const afk = await getAfk(guildId, userId);

            if (!afk) continue;

            const cooldownKey = `${message.channel.id}:${userId}`;
            const last = lastNotice.get(cooldownKey) ?? 0;

            if (Date.now() - last < NOTICE_COOLDOWN_MS) continue;

            lastNotice.set(cooldownKey, Date.now());

            lines.push(`💤 <@${userId}> is AFK: ${afk.status} - ${formatDuration(Date.now() - afk.since)} ago`);
        }

        if (lines.length > 0) await sendQuietReply(message, lines.join('\n'));
    },
};
