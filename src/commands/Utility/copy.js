import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { getPrefixText } from '../../utils/punishmentTools.js';

// ==========================================
// .copy  -  copies an emoji or a sticker into THIS server
//
//   Reply to a message that has an emoji or a sticker and type   .copy
//   .copy <the emoji>                  (paste the emoji)
//   .copy 123456789012345678           (emoji ID or sticker ID)
//   .copy <the emoji> newname          (give it a new name)
// ==========================================

const MANAGE_EXPRESSIONS = PermissionFlagsBits.ManageGuildExpressions;
const MAX_ITEMS = 10;
const EMOJI_MARKUP = /<(a?):(\w{2,32}):(\d{15,25})>/g;
const LOTTIE = 3;   // sticker format that only verified servers can upload

export default {
    data: new SlashCommandBuilder()
        .setName('copy')
        .setDescription('Copy an emoji or sticker into this server (reply to a message with .copy)')
        .addStringOption((option) =>
            option
                .setName('item')
                .setDescription('The emoji, or the emoji / sticker ID, to copy')
                .setRequired(false),
        )
        .setDefaultMemberPermissions(MANAGE_EXPRESSIONS),
    category: 'utility',

    // Slash command: /copy item:<emoji or id>
    async execute(interaction, config, client) {
        const text = interaction.options.getString('item') || '';

        return copyItems(interaction, client, text, null);
    },

    // Prefix command: .copy   (as a reply)   or   .copy <emoji>   or   .copy <id>
    async prefixExecute(interaction, config, client) {
        const text = getPrefixText(interaction, 'copy');
        const original = interaction.message ?? interaction._responseCoordinator?.message ?? null;

        return copyItems(interaction, client ?? interaction.client, text, original);
    },
};

// Reads the text: emojis pasted in it, plain IDs, and an optional new name
function parseText(text) {
    const targets = [];
    const seen = new Set();

    for (const match of text.matchAll(EMOJI_MARKUP)) {
        if (seen.has(match[3])) continue;
        seen.add(match[3]);
        targets.push({ type: 'emoji', animated: match[1] === 'a', name: match[2], id: match[3] });
    }

    const rest = text.replace(EMOJI_MARKUP, ' ').split(/\s+/).filter(Boolean);
    const leftovers = [];

    for (const word of rest) {
        if (/^\d{15,25}$/.test(word)) {
            if (seen.has(word)) continue;
            seen.add(word);
            targets.push({ type: 'unknown', id: word });
        } else {
            leftovers.push(word);
        }
    }

    // ".copy <emoji> newname"
    const newName = leftovers.length ? cleanName(leftovers[0]) : null;

    return { targets, newName };
}

function cleanName(name) {
    const clean = String(name || '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 32);

    return clean.length >= 2 ? clean : null;
}

// Emojis and stickers on the message the person replied to
async function readReply(original) {
    const replyId = original?.reference?.messageId;

    if (!replyId) return [];

    const replied = await original.channel.messages.fetch(replyId).catch(() => null);

    if (!replied) return [];

    const targets = [];
    const seen = new Set();

    for (const match of (replied.content || '').matchAll(EMOJI_MARKUP)) {
        if (seen.has(match[3])) continue;
        seen.add(match[3]);
        targets.push({ type: 'emoji', animated: match[1] === 'a', name: match[2], id: match[3] });
    }

    for (const item of replied.stickers?.values?.() || []) {
        targets.push({ type: 'stickerItem', item });
    }

    return targets;
}

function friendlyError(error, kind) {
    const code = error?.code;

    if (code === 30008) return 'This server has no free emoji slots left.';
    if (code === 30039) return 'This server has no free sticker slots left.';
    if (code === 50013) return 'I do not have the **Manage Expressions** permission.';
    if (code === 50035) return `Discord rejected that ${kind} (the name or the file size is not allowed).`;
    if (code === 10057 || code === 404) return `I could not find that ${kind}.`;

    return `I could not copy that ${kind}.`;
}

// Checks if an emoji ID exists and if it is animated. Returns 'gif', 'png' or null.
async function probeEmoji(id) {
    try {
        const gif = await fetch(`https://cdn.discordapp.com/emojis/${id}.gif?size=64`);

        if (gif.ok && (gif.headers.get('content-type') || '').includes('gif')) return 'gif';

        const png = await fetch(`https://cdn.discordapp.com/emojis/${id}.png?size=64`);

        return png.ok ? 'png' : null;
    } catch (error) {
        logger.debug(`Emoji probe failed for ${id}: ${error.message}`);
        return null;
    }
}

async function copyEmoji(guild, target, newName, reason) {
    if (guild.emojis.cache.has(target.id)) {
        return { ok: false, text: `That emoji is already in this server (${guild.emojis.cache.get(target.id)}).` };
    }

    let animated = target.animated;

    if (animated === undefined) {
        const format = await probeEmoji(target.id);

        if (!format) return { ok: false, text: `I could not find an emoji with the ID \`${target.id}\`.` };

        animated = format === 'gif';
    }

    const name = newName || cleanName(target.name) || `copied_${target.id.slice(-4)}`;

    try {
        const created = await guild.emojis.create({
            attachment: `https://cdn.discordapp.com/emojis/${target.id}.${animated ? 'gif' : 'png'}?size=128`,
            name,
            reason,
        });

        return { ok: true, text: `Copied the emoji ${created} as \`${created.name}\`` };
    } catch (error) {
        logger.debug(`Could not copy emoji ${target.id}: ${error.message}`);
        return { ok: false, text: friendlyError(error, 'emoji') };
    }
}

async function copySticker(guild, sticker, newName, reason) {
    if (sticker.guildId === guild.id) {
        return { ok: false, text: `The sticker **${sticker.name}** is already in this server.` };
    }

    if (sticker.format === LOTTIE) {
        return {
            ok: false,
            text: `The sticker **${sticker.name}** is an animated Lottie sticker. Discord only lets verified servers upload those.`,
        };
    }

    try {
        const created = await guild.stickers.create({
            file: sticker.url,
            name: newName || sticker.name,
            tags: sticker.tags || sticker.name,
            description: sticker.description || undefined,
            reason,
        });

        return { ok: true, text: `Copied the sticker **${created.name}**` };
    } catch (error) {
        logger.debug(`Could not copy sticker ${sticker.id}: ${error.message}`);
        return { ok: false, text: friendlyError(error, 'sticker') };
    }
}

async function copyItems(interaction, client, text, original) {
    // Only people with the Manage Expressions permission can use this
    if (!interaction.member.permissions.has(MANAGE_EXPRESSIONS)) {
        throw new TitanBotError(
            'Missing Manage Expressions permission',
            ErrorTypes.PERMISSION,
            'You need the **Manage Expressions** permission to use this command.',
        );
    }

    const guild = interaction.guild;
    const me = guild.members.me ?? await guild.members.fetchMe();

    if (!me.permissions.has(MANAGE_EXPRESSIONS)) {
        throw new TitanBotError(
            'Bot permission missing',
            ErrorTypes.PERMISSION,
            'I need the **Manage Expressions** permission to copy emojis and stickers.',
        );
    }

    // 1) what to copy: the text first, otherwise the message that was replied to
    const parsed = parseText(text || '');
    let targets = parsed.targets;

    if (!targets.length && original) {
        targets = await readReply(original);
    }

    if (!targets.length) {
        throw new TitanBotError(
            'Nothing to copy',
            ErrorTypes.USER_INPUT,
            'Reply to a message that has an emoji or a sticker and type `.copy`.\n' +
            'Or use `.copy <emoji>` or `.copy <emoji or sticker ID>`.',
        );
    }

    const cut = targets.length > MAX_ITEMS;
    targets = targets.slice(0, MAX_ITEMS);

    const newName = targets.length === 1 ? cleanName(parsed.newName) : null;
    const reason = `Copied by ${interaction.user.tag}`;
    const lines = [];
    let copied = 0;

    // 2) copy each one
    for (const target of targets) {
        let result;

        if (target.type === 'emoji') {
            result = await copyEmoji(guild, target, newName, reason);
        } else if (target.type === 'stickerItem') {
            const sticker = await target.item.fetch().catch(() => null);

            result = sticker
                ? await copySticker(guild, sticker, newName, reason)
                : { ok: false, text: 'I could not read that sticker.' };
        } else {
            // only an ID was given: it can be a sticker or an emoji
            const sticker = await client.fetchSticker(target.id).catch(() => null);

            result = sticker
                ? await copySticker(guild, sticker, newName, reason)
                : await copyEmoji(guild, { id: target.id, animated: undefined, name: null }, newName, reason);
        }

        if (result.ok) copied++;

        lines.push(`${result.ok ? '✅' : '❌'} ${result.text}`);
    }

    if (cut) lines.push(`Only the first ${MAX_ITEMS} were copied.`);

    // plain message (not an embed) so the copied emoji shows
    return InteractionHelper.universalReply(interaction, {
        content: lines.join('\n'),
        allowedMentions: { parse: [] },
    });
}
