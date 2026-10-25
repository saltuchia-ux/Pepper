import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { MEDIA_ONLY } from '../config/mediaOnly.js';
import { logger } from '../utils/logger.js';

const MEDIA_FILE = /\.(png|jpe?g|gif|webp|bmp|avif|heic|mp4|mov|webm|mkv|avi|m4v|mp3|wav|ogg|m4a|flac)(?:[?#]|$)/i;
const MEDIA_HOSTS = [
    'tenor.com', 'media.tenor.com', 'giphy.com', 'media.giphy.com',
    'cdn.discordapp.com', 'media.discordapp.net',
];
const URL_PATTERN = /https?:\/\/[^\s<>()|]+/gi;

const warnCooldown = new Map();
const normalize = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function isMediaAttachment(attachment) {
    const type = String(attachment.contentType ?? '').toLowerCase();
    if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) return true;
    return MEDIA_FILE.test(attachment.name ?? attachment.url ?? '');
}

function hostOf(url) {
    return url.replace(/^https?:\/\//i, '').split(/[/?#:]/)[0].replace(/^www\./i, '').toLowerCase();
}

/** True if the message contains media (upload, sticker, or a GIF / image / video link). */
export function messageHasMedia(message) {
    if (message.attachments?.some(isMediaAttachment)) return true;
    if (message.stickers?.size > 0) return true;

    for (const url of String(message.content ?? '').match(URL_PATTERN) ?? []) {
        const host = hostOf(url);
        if (MEDIA_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
        if (MEDIA_FILE.test(url)) return true;
    }

    return false;
}

/** Is this one of the media-only channels? (threads are ignored so people can talk about the media there) */
export function isMediaOnlyChannel(channel) {
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) return false;
    if (MEDIA_ONLY.ignoredChannelIds.includes(channel.id)) return false;

    const channelNames = MEDIA_ONLY.channelNames.map(normalize);
    if (channelNames.includes(normalize(channel.name))) return true;

    const parent = normalize(channel.parent?.name);
    return Boolean(parent) && MEDIA_ONLY.categoryNames.some((name) => parent.includes(normalize(name)));
}

/** Deletes the message if it is text-only in a media-only channel. Returns true if deleted. */
export async function enforceMediaOnly(message) {
    try {
        if (!MEDIA_ONLY.enabled) return false;
        if (!message.guild || message.author?.bot || message.webhookId || message.system) return false;
        if (!isMediaOnlyChannel(message.channel)) return false;
        if (messageHasMedia(message)) return false;

        if (MEDIA_ONLY.exemptStaff) {
            const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
            if (member && (
                member.permissions.has(PermissionFlagsBits.Administrator)
                || member.permissions.has(PermissionFlagsBits.ManageMessages)
                || member.permissions.has(PermissionFlagsBits.ManageGuild)
            )) return false;
        }

        const me = message.guild.members.me;
        if (!me?.permissionsIn(message.channel).has(PermissionFlagsBits.ManageMessages)) return false;

        await message.delete().catch(() => null);

        const last = warnCooldown.get(message.author.id) ?? 0;
        if (Date.now() - last > 10000) {
            warnCooldown.set(message.author.id, Date.now());
            const notice = await message.channel.send({
                content: MEDIA_ONLY.warning.replace('{user}', `<@${message.author.id}>`),
                allowedMentions: { users: [message.author.id] },
            }).catch(() => null);
            if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000).unref?.();
        }

        return true;
    } catch (error) {
        logger.error('Media-only filter error:', error);
        return false;
    }
}
