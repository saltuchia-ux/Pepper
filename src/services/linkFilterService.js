import { PermissionFlagsBits } from 'discord.js';
import { LINK_FILTER } from '../config/linkFilter.js';
import { logger } from '../utils/logger.js';

const TLDS = 'com|net|org|io|gg|co|me|tv|xyz|app|dev|ly|link|site|online|shop|store|info|us|uk|ru|de|fr|in|to|cc|ws|fm|be|ai|cloud|club|live|top|vip|fun';

const URL_PATTERNS = [
    /(?:https?:\/\/|www\.)[^\s<>()|]+/gi,
    /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[^\s<>()|]+/gi,
    new RegExp(`\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})\\b(?:\\/[^\\s<>()|]*)?`, 'gi'),
];

const warnCooldown = new Map();

function hostOf(rawUrl) {
    return rawUrl
        .replace(/^[a-z]+:\/\//i, '')
        .replace(/^[^@/]*@/, '')
        .split(/[/?#:]/)[0]
        .replace(/^www\./i, '')
        .toLowerCase();
}

function hostAllowed(host, allowed) {
    return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Every link found in the text, as hostnames. */
export function findLinkHosts(text) {
    const hosts = new Set();
    for (const pattern of URL_PATTERNS) {
        for (const match of String(text ?? '').matchAll(pattern)) {
            const host = hostOf(match[0]);
            if (host) hosts.add(host);
        }
    }
    return [...hosts];
}

function isStaff(member) {
    return member.permissions.has(PermissionFlagsBits.Administrator)
        || member.permissions.has(PermissionFlagsBits.ManageMessages)
        || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function hasMediaRole(member) {
    const names = LINK_FILTER.mediaRoleNames.map((n) => n.toLowerCase());
    return member.roles.cache.some(
        (role) => LINK_FILTER.mediaRoleIds.includes(role.id) || names.includes(role.name.toLowerCase()),
    );
}

/** Deletes the message if it has a link the sender isn't allowed to send. Returns true if deleted. */
export async function enforceLinkFilter(message) {
    try {
        if (!LINK_FILTER.enabled) return false;
        if (!message.guild || message.author?.bot || message.webhookId || message.system) return false;
        if (LINK_FILTER.ignoredChannelIds.includes(message.channelId)) return false;

        const hosts = findLinkHosts(message.content);
        if (!hosts.length) return false;

        const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member) return false;

        if (isStaff(member)) return false;
        if (member.roles.cache.some((role) => LINK_FILTER.exemptRoleIds.includes(role.id))) return false;

        const mediaOnly = hasMediaRole(member);
        const blocked = hosts.some((host) =>
            !(hostAllowed(host, LINK_FILTER.allowedForEveryone ?? [])
                || (mediaOnly && hostAllowed(host, LINK_FILTER.allowedMediaHosts))));
        if (!blocked) return false;

        const me = message.guild.members.me;
        if (!me?.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages)) return false;

        await message.delete().catch(() => null);

        const last = warnCooldown.get(message.author.id) ?? 0;
        if (Date.now() - last > 10000) {
            warnCooldown.set(message.author.id, Date.now());
            const notice = await message.channel.send({
                content: LINK_FILTER.warning.replace('{user}', `<@${message.author.id}>`),
                allowedMentions: { users: [message.author.id] },
            }).catch(() => null);
            if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000).unref?.();
        }

        return true;
    } catch (error) {
        logger.error('Link filter error:', error);
        return false;
    }
}
