import { EmbedBuilder, PermissionsBitField } from 'discord.js';

// ==========================================
// SHORT MESSAGE STYLES (same look as the bleed bot)
//   plain text   -> no embed (no box around it)
//   green box    -> it worked
//   yellow box   -> missing permission
//   blue box     -> info (role restore)
// ==========================================

export const COLORS = {
    success: 0x9be564,
    warning: 0xf5a623,
    info: 0x2ea6d9,
};

// Plain text message. Mentions are shown but nobody gets pinged.
export function plainPayload(text, { ping = false } = {}) {
    return ping
        ? { content: text }
        : { content: text, allowedMentions: { parse: [] } };
}

// Same as boxPayload, but keeps emojis (the normal embed text cleaner removes them)
export function rawBoxPayload(color, text) {
    const embed = new EmbedBuilder().setColor(color);
    embed.data.description = text;

    return { embeds: [embed] };
}

export function boxPayload(color, text) {
    return {
        embeds: [new EmbedBuilder().setColor(color).setDescription(text)],
    };
}

// ✅ @mod: Changed name's nickname to `x`
export function successPayload(text) {
    return boxPayload(COLORS.success, `✅ ${text}`);
}

// @mod: Added roles to @user: **A**, **B**
export function infoPayload(text) {
    return boxPayload(COLORS.info, text);
}

// ⚠️ @user: You're **missing** permission: `ban_members`
export function missingPermissionPayload(userId, permissions) {
    const names = permissionNames(permissions);

    return boxPayload(
        COLORS.warning,
        `⚠️ <@${userId}>: You're **missing** permission: ${names.map((name) => `\`${name}\``).join(', ')}`,
    );
}

// PermissionFlagsBits.BanMembers  ->  ['ban_members']
export function permissionNames(permissions) {
    const list = [];

    for (const item of [].concat(permissions)) {
        if (typeof item === 'string' && !/^\d+$/.test(item)) {
            list.push(snake(item));
        } else {
            for (const name of new PermissionsBitField(BigInt(item)).toArray()) {
                list.push(snake(name));
            }
        }
    }

    return list.length ? list : ['unknown'];
}

function snake(name) {
    return String(name).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// "Syntax: .ban (user) (reason)\nExample: .ban John annoying"
export function syntaxText(prefix, syntax, example) {
    return `Syntax: ${prefix}${syntax}\nExample: ${prefix}${example}`;
}
