import { EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { BOOST_DEFAULTS } from '../config/boostDefaults.js';
import { logger } from '../utils/logger.js';

// ==========================================
// When someone boosts the server, post a thank-you in the boosters channel.
// The "Server Booster" role is given by Discord by itself, nothing to do here.
// ==========================================

const clean = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');

export function findBoostChannel(guild) {
    if (BOOST_DEFAULTS.channelId) {
        const exact = guild.channels.cache.get(BOOST_DEFAULTS.channelId);
        if (exact) return exact;
    }

    const wanted = clean(BOOST_DEFAULTS.channelName);
    const texts = [...guild.channels.cache.values()].filter(
        (c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement,
    );

    // only a channel named exactly "boosters" (emojis and symbols are ignored)
    return texts.find((c) => clean(c.name) === wanted) || null;
}

// Makes the message (an embed with a black bar on the left)
export function buildBoostPayload({ guild, user, position }) {
    const { serverName, gifts, smallNote, color } = BOOST_DEFAULTS;

    const lines = [`<@${user.id}> Thank you for boosting **${serverName}**!`];

    if (position) {
        lines.push(`You boosted at **#${position}**`);
    }

    lines.push('', '**Gifts for Booster**', ...gifts.map((gift) => `• ${gift}`));

    if (smallNote) {
        lines.push('', `-# ${smallNote}`);
    }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: serverName, iconURL: guild.iconURL() ?? undefined })
        .setDescription(lines.join('\n'))
        .setThumbnail(user.displayAvatarURL({ size: 256 }));

    return {
        embeds: [embed],
        allowedMentions: { parse: [] },
    };
}

export async function sendBoostThanks(member) {
    try {
        if (!BOOST_DEFAULTS.enabled) return;

        const guild = member.guild;

        // ask Discord for the newest boost count
        const fresh = await guild.fetch().catch(() => guild);
        const position = fresh.premiumSubscriptionCount || null;

        const channel = findBoostChannel(guild);
        if (!channel) {
            logger.warn(`Boost thank-you: no boosters channel found in ${guild.name}`);
            return;
        }

        const me = guild.members.me;
        const allowed = me && channel.permissionsFor(me)?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
        ]);

        if (!allowed) {
            logger.warn(`Boost thank-you: missing permission in #${channel.name}`);
            return;
        }

        await channel.send(buildBoostPayload({ guild, user: member.user, position }));
    } catch (error) {
        logger.error('Boost thank-you failed:', error);
    }
}
