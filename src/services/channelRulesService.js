import { ChannelType } from 'discord.js';
import { CHANNEL_RULES } from '../config/channelRules.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { logger } from '../utils/logger.js';

const normalize = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const KEY = (channelId) => `channel_rules:last:${channelId}`;

const known = new Map();   // channelId -> id of the rules message we sent last
const running = new Map(); // channelId -> { again }

/** The rules for this channel, or null when it has none. */
export function findRulesFor(channel) {
    if (!CHANNEL_RULES.enabled || !channel?.guild) return null;
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return null;

    const name = normalize(channel.name);
    return CHANNEL_RULES.channels.find((entry) => [].concat(entry.channel).some((wanted) => normalize(wanted) === name)) ?? null;
}

function buildEmbed(entry) {
    return {
        color: CHANNEL_RULES.color,
        description:
            `**${entry.title}**\n\n`
            + '### **Channel Rules**\n\n'
            + entry.rules.map((rule) => `• ${rule}`).join('\n')
            + `\n${CHANNEL_RULES.footer}`,
    };
}

/** True when this message is the rules box itself (so it never triggers a refresh). */
export function isRulesBox(message) {
    const entry = findRulesFor(message.channel);
    return Boolean(entry) && message.embeds?.[0]?.description === buildEmbed(entry).description;
}

async function deleteOld(channel, entry, me) {
    // 1) the one we sent last
    const lastId = known.get(channel.id) ?? await getFromDb(KEY(channel.id), null);
    if (lastId) {
        const old = await channel.messages.fetch(lastId).catch(() => null);
        await old?.delete().catch(() => {});
    }

    // 2) first time after a restart: also remove leftovers with the same text (duplicates)
    if (!known.has(channel.id)) {
        const wanted = buildEmbed(entry).description;
        const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
        for (const message of recent?.values() ?? []) {
            if (message.author?.id === me.id && message.embeds?.[0]?.description === wanted) {
                await message.delete().catch(() => {});
            }
        }
    }
}

/** Puts the rules box at the bottom of the channel (old one deleted). Several quick messages = one extra run, never duplicates. */
export async function refreshChannelRules(channel) {
    const entry = findRulesFor(channel);
    if (!entry) return;

    const state = running.get(channel.id);
    if (state) {
        state.again = true;
        return;
    }

    const mine = { again: false };
    running.set(channel.id, mine);

    try {
        const me = channel.guild.members.me;
        const perms = me && channel.permissionsFor(me);
        if (!perms?.has(['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'])) return;

        do {
            mine.again = false;
            await deleteOld(channel, entry, me);
            const sent = await channel.send({ embeds: [buildEmbed(entry)], allowedMentions: { parse: [] } });
            known.set(channel.id, sent.id);
            await setInDb(KEY(channel.id), sent.id);
        } while (mine.again);
    } catch (error) {
        logger.error(`Channel rules: could not refresh #${channel.name}:`, error);
    } finally {
        running.delete(channel.id);
    }
}

/** On startup: make sure every channel in the list has its rules box. */
export async function setupAllChannelRules(client) {
    if (!CHANNEL_RULES.enabled) return;

    for (const guild of client.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
            if (findRulesFor(channel)) await refreshChannelRules(channel);
        }
    }
}
