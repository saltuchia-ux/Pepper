import { PermissionFlagsBits } from 'discord.js';
import { getCommandPrefix } from '../config/bot.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { logger } from '../utils/logger.js';

// ==========================================
// Word reactions
//   .reaction (or .react, capitals don't matter) a <word> <emoji> <emoji> ...   -> bot reacts to that word (no limit on words or emojis)
//   .reaction r <word> [emoji ...]           -> remove the emoji(s), or the whole word if no emoji is given
//   .reaction list                           -> show everything
// Needs the Ban Members permission. Capital letters don't matter (kiwi = Kiwi = KIWI).
// ==========================================

const KEY = (guildId) => `word_reactions:${guildId}`;

// custom emoji <:name:id> / <a:name:id>, normal emoji (with skin tones, joined emojis), flags, keycaps
const EMOJI_PATTERN = /<a?:\w{2,32}:\d{17,20}>|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])?)*/gu;

const cache = new Map(); // guildId -> { words: { word: [emoji] }, regex: Map(word -> RegExp) }

export function extractEmojis(text) {
    const seen = new Set();
    const out = [];
    for (const match of String(text ?? '').matchAll(EMOJI_PATTERN)) {
        if (!seen.has(match[0])) {
            seen.add(match[0]);
            out.push(match[0]);
        }
    }
    return out;
}

const normalizeWord = (word) => String(word ?? '').trim().toLowerCase();

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The word must stand on its own: "kiwi" matches "I love Kiwi!" but not "kiwis" or "akiwi".
function buildRegex(word) {
    const body = word.split(/\s+/).map(escapeRegex).join('\\s+'); // extra spaces between words are fine
    return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'iu');
}

export async function getWordReactions(guildId) {
    let entry = cache.get(guildId);
    if (!entry) {
        const saved = await getFromDb(KEY(guildId), {});
        entry = { words: saved && typeof saved === 'object' ? saved : {}, regex: new Map() };
        cache.set(guildId, entry);
    }
    return entry;
}

async function save(guildId, entry) {
    entry.regex.clear();
    await setInDb(KEY(guildId), entry.words);
}

/** Adds emojis to a word. Returns the emojis that are now saved for it. */
export async function addWordReactions(guildId, word, emojis) {
    const entry = await getWordReactions(guildId);
    const key = normalizeWord(word);
    const list = entry.words[key] ?? [];
    for (const emoji of emojis) if (!list.includes(emoji)) list.push(emoji);
    entry.words[key] = list;
    await save(guildId, entry);
    return list;
}

/** Removes some emojis from a word, or the whole word when no emoji is given. Returns false if the word wasn't there. */
export async function removeWordReactions(guildId, word, emojis = []) {
    const entry = await getWordReactions(guildId);
    const key = normalizeWord(word);
    if (!entry.words[key]) return false;

    if (!emojis.length) {
        delete entry.words[key];
    } else {
        entry.words[key] = entry.words[key].filter((emoji) => !emojis.includes(emoji));
        if (!entry.words[key].length) delete entry.words[key];
    }
    await save(guildId, entry);
    return true;
}

/** Emojis the bot should add to this message text (all matching words, no repeats). */
export async function emojisForText(guildId, text) {
    const entry = await getWordReactions(guildId);
    const found = [];
    for (const [word, emojis] of Object.entries(entry.words)) {
        let regex = entry.regex.get(word);
        if (!regex) {
            regex = buildRegex(word);
            entry.regex.set(word, regex);
        }
        if (regex.test(text)) for (const emoji of emojis) if (!found.includes(emoji)) found.push(emoji);
    }
    return found;
}

const reply = (message, content) =>
    message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);

const show = (emojis) => emojis.join(' ');

function emojiToId(emoji) {
    return emoji.id
        ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`
        : emoji.name;
}

// Emojis the bot can actually use. The bot's emoji list can be out of date (for example an emoji you
// uploaded after the bot started), so it refreshes the server's emojis and, if it still isn't sure,
// really tries the emoji on the command message.
async function usable(message, emojis) {
    const ok = [];
    const bad = [];
    let refreshed = false;

    for (const emoji of emojis) {
        const id = emoji.match(/^<a?:\w+:(\d+)>$/)?.[1];
        if (!id) { ok.push(emoji); continue; }

        if (!message.client.emojis.cache.has(id) && !refreshed) {
            refreshed = true;
            await message.guild.emojis.fetch().catch(() => {});
        }
        if (message.client.emojis.cache.has(id)) { ok.push(emoji); continue; }

        try {
            const reaction = await message.react(emoji);
            await reaction.users.remove(message.client.user.id).catch(() => {});
            ok.push(emoji);
        } catch {
            bad.push(emoji);
        }
    }
    return { ok, bad };
}

const USAGE = [
    '**Word reactions**',
    '`.reaction a <word> <emoji> <emoji> ...` the bot reacts when someone says the word',
    '`.reaction a <word>` then react to the bot\'s message with the emojis you want',
    '`.reaction r <word>` removes the word, `.reaction r <word> <emoji>` removes only that emoji',
    '`.reaction list` shows everything',
    'Words with spaces: `.reaction a "good morning" ☀️`',
].join('\n');

/** Handles ".reaction ..." messages. Returns true if the message was a reaction command. */
export async function handleReactionCommand(message) {
    const prefix = getCommandPrefix();
    const parts = (message.content.slice(prefix.length).trim().match(/"[^"]*"|\S+/g) || [])
        .map((part) => (part.length > 1 && part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part));

    if (!message.content.startsWith(prefix) || !['reaction', 'react'].includes(parts[0]?.toLowerCase())) return false;

    if (!message.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
        await reply(message, 'You need the **Ban Members** permission to use this.');
        return true;
    }

    const action = parts[1]?.toLowerCase();
    const guildId = message.guild.id;

    if (['a', 'add'].includes(action)) {
        const word = normalizeWord(parts[2]);
        if (!word) { await reply(message, USAGE); return true; }

        const typed = extractEmojis(parts.slice(3).join(' '));
        if (typed.length) {
            const { ok, bad } = await usable(message, typed);
            let text = '';
            if (ok.length) {
                const list = await addWordReactions(guildId, word, ok);
                text = `✅ I will react to **${word}** with ${show(list)}`;
            }
            if (bad.length) text += `${text ? '\n' : ''}⚠️ I can't use ${show(bad)} (I'm not in the server that emoji is from).`;
            await reply(message, text);
            return true;
        }

        // No emoji typed: let them react to the bot's message instead.
        const prompt = await reply(message, `React to this message with the emojis you want for **${word}**. I'll save them when you stop (15 seconds).`);
        if (!prompt) return true;

        const picked = [];
        const collector = prompt.createReactionCollector({
            filter: (_reaction, user) => user.id === message.author.id,
            idle: 15000,
            time: 60000,
        });
        collector.on('collect', (reaction) => picked.push(emojiToId(reaction.emoji)));
        collector.on('end', async () => {
            try {
                const { ok, bad } = await usable(prompt, [...new Set(picked)]);
                if (!ok.length) {
                    await prompt.edit({ content: `No emojis picked, **${word}** was not changed.` }).catch(() => {});
                    return;
                }
                const list = await addWordReactions(guildId, word, ok);
                let text = `✅ I will react to **${word}** with ${show(list)}`;
                if (bad.length) text += `\n⚠️ I can't use ${show(bad)}.`;
                await prompt.edit({ content: text }).catch(() => {});
            } catch (error) {
                logger.error('Word reactions: could not save picked emojis:', error);
            }
        });
        return true;
    }

    if (['r', 'remove', 'rm', 'delete'].includes(action)) {
        const word = normalizeWord(parts[2]);
        if (!word) { await reply(message, USAGE); return true; }

        const emojis = extractEmojis(parts.slice(3).join(' '));
        const removed = await removeWordReactions(guildId, word, emojis);
        await reply(message, removed
            ? (emojis.length ? `✅ Removed ${show(emojis)} from **${word}**` : `✅ I will no longer react to **${word}**`)
            : `**${word}** is not in the list.`);
        return true;
    }

    if (['l', 'list'].includes(action)) {
        const { words } = await getWordReactions(guildId);
        const lines = Object.entries(words).map(([word, emojis]) => `**${word}** → ${show(emojis)}`);
        await reply(message, lines.length ? lines.join('\n').slice(0, 1900) : 'No word reactions yet. Add one with `.reaction a <word> <emoji>`');
        return true;
    }

    await reply(message, USAGE);
    return true;
}

/** Reacts to a normal message that contains a saved word. */
export async function reactToWords(message) {
    const text = message.content;
    if (!text) return;

    const me = message.guild.members.me;
    const perms = me && message.channel.permissionsFor(me);
    if (!perms?.has([PermissionFlagsBits.AddReactions, PermissionFlagsBits.ReadMessageHistory])) return;

    const emojis = await emojisForText(message.guild.id, text);
    for (const emoji of emojis) {
        try {
            await message.react(emoji);
        } catch (error) {
            // 30010 = Discord's limit of 20 different reactions on one message
            if (error?.code === 30010) break;
            logger.debug(`Word reactions: could not react with ${emoji}: ${error.message}`);
        }
    }
}
