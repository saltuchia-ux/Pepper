import { PermissionFlagsBits } from 'discord.js';
import { AUTO_REPLIES, AUTO_REPLY_IGNORED_CHANNEL_IDS } from '../config/autoReplies.js';
import { getCommandPrefix } from '../config/bot.js';
import { logger } from '../utils/logger.js';

const lastUser = new Map();    // "rule:user"    -> time
const lastChannel = new Map(); // "rule:channel" -> time

/** Which auto reply (if any) matches this text. */
export function findAutoReply(text) {
    return AUTO_REPLIES.find((rule) => rule.pattern.test(text)) ?? null;
}

export async function handleAutoReply(message) {
    try {
        if (!message.guild || message.author?.bot || message.webhookId || message.system) return;
        if (AUTO_REPLY_IGNORED_CHANNEL_IDS.includes(message.channelId)) return;

        const content = String(message.content ?? '');
        if (!content || content.startsWith(getCommandPrefix())) return; // commands are not questions

        const rule = findAutoReply(content);
        if (!rule) return;

        const now = Date.now();
        const userKey = `${rule.name}:${message.author.id}`;
        const channelKey = `${rule.name}:${message.channelId}`;
        if (now - (lastUser.get(userKey) ?? 0) < rule.userCooldown * 1000) return;
        if (now - (lastChannel.get(channelKey) ?? 0) < rule.channelCooldown * 1000) return;

        const me = message.guild.members.me;
        const perms = me && message.channel.permissionsFor(me);
        if (!perms?.has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return;

        lastUser.set(userKey, now);
        lastChannel.set(channelKey, now);

        // Just says it in the chat (not a reply to their message), pings nobody
        await message.channel.send({
            embeds: [rule.embed],
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        logger.error('Auto reply error:', error);
    }
}
