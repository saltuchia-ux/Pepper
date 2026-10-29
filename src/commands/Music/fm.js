import { SlashCommandBuilder, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { extractUserId } from '../../utils/punishmentTools.js';
import { successPayload } from '../../utils/replyStyle.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';
import { logger } from '../../utils/logger.js';
import { commandAliases } from '../../config/commands/commandAliases.js';
import * as fm from '../../services/lastfmService.js';

// ==========================================
// Last.fm commands  (prefix is  .)
//
//   .fm  /  .lf                 your now playing        (.fm @someone = theirs)
//   .lf set (username)          link your Last.fm       (.lf remove = unlink)
//   .lf cc (text)               custom command: type that text = your .fm
//   .lf recent                  last 10 songs
//   .lf topartists / toptracks / topalbums  [7d 1m 3m 6m 12m all]
//   .lf profile                 your Last.fm numbers
//   .wk [artist]                who knows this artist in the server
//   .wkt artist - song          who knows this song
//   .wka artist - album         who knows this album
//   .lf lb [period]             artist leaderboard of the server
//   .lf help                    this list
// ==========================================

// short names -> this command (the bot looks short names up in this list)
Object.assign(commandAliases, {
    lf: 'fm', lastfm: 'fm',
    wk: 'fm', whoknows: 'fm', wkt: 'fm', whoknowstrack: 'fm', wka: 'fm', whoknowsalbum: 'fm',
    ta: 'fm', topartists: 'fm', tt: 'fm', toptracks: 'fm', tal: 'fm', topalbums: 'fm',
    recent: 'fm', artistlb: 'fm',
});

// what the person typed first -> what to do
const DIRECT = {
    wk: 'whoknows', whoknows: 'whoknows', wkt: 'whoknowstrack', whoknowstrack: 'whoknowstrack',
    wka: 'whoknowsalbum', whoknowsalbum: 'whoknowsalbum',
    ta: 'topartists', topartists: 'topartists', tt: 'toptracks', toptracks: 'toptracks',
    tal: 'topalbums', topalbums: 'topalbums', recent: 'recent', artistlb: 'artistlb',
};

// .lf (word)  ->  what to do
const SUB = {
    set: 'set', link: 'set', login: 'set',
    remove: 'remove', unlink: 'remove', logout: 'remove', reset: 'remove',
    cc: 'cc', customcommand: 'cc', custom: 'cc',
    profile: 'profile', p: 'profile', me: 'profile', user: 'profile',
    recent: 'recent', rt: 'recent', history: 'recent',
    topartists: 'topartists', ta: 'topartists', artists: 'topartists', top: 'topartists',
    toptracks: 'toptracks', tt: 'toptracks', tracks: 'toptracks',
    topalbums: 'topalbums', tal: 'topalbums', albums: 'topalbums',
    whoknows: 'whoknows', wk: 'whoknows',
    whoknowstrack: 'whoknowstrack', wkt: 'whoknowstrack',
    whoknowsalbum: 'whoknowsalbum', wka: 'whoknowsalbum',
    artistlb: 'artistlb', lb: 'artistlb', leaderboard: 'artistlb', serverartists: 'artistlb',
    np: 'np', nowplaying: 'np', now: 'np',
    help: 'help', commands: 'help',
};

const MEDALS = ['🥇', '🥈', '🥉'];
const rank = (i) => MEDALS[i] ?? `**${i + 1}.**`;
const MAX_MEMBERS = 100;

// ------------------------------------------
// REPLY HELPERS
// ------------------------------------------

const send = (interaction, payload) => InteractionHelper.universalReply(interaction, payload);

// message that pings only the person who typed the command
const warn = (interaction, text) =>
    send(interaction, { content: `⚠️ <@${interaction.user.id}>: ${text}`, allowedMentions: { users: [interaction.user.id] } });

const embedPayload = (embed) => ({ embeds: [embed], allowedMentions: { parse: [] } });

const profileUrl = (name) => `https://www.last.fm/user/${encodeURIComponent(name)}`;

function errorText(error) {
    switch (String(error.code)) {
        case 'nokey': return "Last.fm isn't set up yet. The bot owner must add `LASTFM_API_KEY`";
        case '6': return "I couldn't find that Last.fm user";
        case '17': return 'That Last.fm account hides its listening. Turn off "Hide recent listening information" in Last.fm privacy settings';
        case '29': return 'Last.fm is busy right now, try again in a few seconds';
        default: return "Last.fm isn't answering right now, try again in a moment";
    }
}

async function nameOf(guild, userId, fallback = 'Unknown') {
    const member = guild?.members.cache.get(userId) ?? (await guild?.members.fetch(userId).catch(() => null));
    return member?.displayName ?? member?.user?.username ?? fallback;
}

// pull "@someone" and "7d"/"month" words out of the typed words
function readArgs(words, selfId) {
    let target = selfId;
    let period = null;
    const left = [];

    for (const word of words) {
        const id = extractUserId(word);
        if (id) { target = id; continue; }
        if (!period && fm.PERIODS[word.toLowerCase()]) { period = fm.PERIODS[word.toLowerCase()]; continue; }
        left.push(word);
    }

    return { target, period: period ?? fm.PERIODS.overall, left };
}

// Tries to link the person's Last.fm by itself, so nobody has to run ".lf set" first.
// It tries the name they typed (if any), then their Discord username / display name.
async function autoLink(interaction, userId, typedName = null) {
    const guild = interaction.guild;
    const member = guild?.members.cache.get(userId) ?? (await guild?.members.fetch(userId).catch(() => null));
    const user = member?.user ?? (userId === interaction.user.id ? interaction.user : null);

    const clean = (name) => String(name ?? '').trim().replace(/^https?:\/\/(www\.)?last\.fm\/user\//i, '').replace(/\/.*$/, '');
    const tried = new Set();
    const names = [typedName, user?.username, user?.globalName, member?.displayName]
        .map(clean)
        // Last.fm names: 2-15 characters, start with a letter, then letters / numbers / _ / -
        .filter((name) => /^[A-Za-z][A-Za-z0-9_-]{1,14}$/.test(name))
        .filter((name) => !tried.has(name.toLowerCase()) && tried.add(name.toLowerCase()));

    for (const name of names.slice(0, 4)) {
        try {
            const info = await fm.getUserInfo(name);
            await fm.setLink(userId, info.name);
            logger.info('Last.fm linked automatically', { userId, lastfm: info.name });
            // true when the bot guessed the name (not typed by the person)
            interaction._linkWasGuess = !(typedName && clean(typedName).toLowerCase() === name.toLowerCase());
            return info.name;
        } catch (error) {
            if (error instanceof fm.LastfmError && String(error.code) === '6') continue; // no such Last.fm user, try the next name
            throw error;
        }
    }

    return null;
}

async function requireLink(interaction, targetId, typedName = null) {
    const username = await fm.getLinkedUsername(targetId);
    if (username) return username;

    if (targetId === interaction.user.id) {
        const found = await autoLink(interaction, targetId, typedName);
        if (found) {
            interaction._autoLinked = found;
            return found;
        }
        await warn(interaction, "I couldn't find your Last.fm by your Discord name. Type your Last.fm name once, like `.fm rj`");
    } else {
        await warn(interaction, `<@${targetId}> hasn't linked Last.fm`);
    }
    return null;
}

// ------------------------------------------
// ACTIONS
// ------------------------------------------

async function doNowPlaying(interaction, words) {
    const { target, left } = readArgs(words, interaction.user.id);
    const username = await requireLink(interaction, target, left[0] ?? null);
    if (!username) return;

    const name = await nameOf(interaction.guild, target);
    const payload = await fm.buildNowPlayingPayload(username, name);

    if (interaction._autoLinked) {
        payload.content = interaction._linkWasGuess
            ? `-# Linked to Last.fm **${interaction._autoLinked}** automatically. Wrong account? Use \`.lf set (your Last.fm name)\``
            : `-# Linked to Last.fm **${interaction._autoLinked}**`;
    }

    const sent = await send(interaction, payload);
    await fm.addVoteReactions(sent);
    return sent;
}

async function doSet(interaction, words) {
    const typed = words[0]?.replace(/^https?:\/\/(www\.)?last\.fm\/user\//i, '').replace(/\/.*$/, '');

    if (!typed) {
        return send(interaction, embedPayload(new EmbedBuilder().setColor(fm.COLOR)
            .setTitle('Command: lf set')
            .setDescription('Link your Last.fm account\n```Syntax: .lf set (username)\nExample: .lf set rj```')));
    }

    const info = await fm.getUserInfo(typed);
    await fm.setLink(interaction.user.id, info.name);

    logger.info('Last.fm linked', { userId: interaction.user.id, lastfm: info.name });

    return send(interaction, successPayload(`<@${interaction.user.id}>: Your Last.fm is now set to [${info.name}](${profileUrl(info.name)})`));
}

async function doRemove(interaction) {
    await fm.removeLink(interaction.user.id);
    if (interaction.guild) await fm.removeCc(interaction.guild.id, interaction.user.id);
    return send(interaction, successPayload(`<@${interaction.user.id}>: Your Last.fm was unlinked`));
}

async function doCc(interaction, words) {
    const guild = interaction.guild;
    if (!guild) return;

    const first = words[0]?.toLowerCase();

    if (!first) {
        const current = await fm.getCcOf(guild.id, interaction.user.id);
        return send(interaction, embedPayload(new EmbedBuilder().setColor(fm.COLOR)
            .setTitle('Command: lf cc')
            .setDescription(
                (current ? `Your custom command is \`${current}\`\n\n` : '') +
                'Set a word that shows your now playing when you type it (no setup needed)\n```Syntax: .lf cc (text)\nExample: .lf cc np2\nRemove:  .lf cc remove```')));
    }

    if (['remove', 'clear', 'off', 'delete', 'none'].includes(first)) {
        const removed = await fm.removeCc(guild.id, interaction.user.id);
        return removed
            ? send(interaction, successPayload(`<@${interaction.user.id}>: Your custom command was removed`))
            : warn(interaction, "You don't have a custom command");
    }

    const text = first.replace(/^\./, '');

    if (text.length < 1 || text.length > 20 || /[<>@`]/.test(text)) {
        return warn(interaction, 'Use one short word (up to 20 letters), like `.lf cc np2`');
    }

    const client = interaction.client;
    if (client?.commands?.has(text) || commandAliases[text]) {
        return warn(interaction, 'That word is already a bot command, pick another one');
    }

    const map = await fm.getCcMap(guild.id);
    if (map[text] && map[text] !== interaction.user.id) {
        return warn(interaction, 'Someone in this server already uses that word');
    }

    // No ".lf set" needed: link Last.fm here if it isn't linked yet (name typed after the word, or their Discord name)
    let note = '';
    if (!(await fm.getLinkedUsername(interaction.user.id))) {
        const found = await autoLink(interaction, interaction.user.id, words[1] ?? null);
        if (!found) {
            return warn(interaction, `I couldn't find your Last.fm by your Discord name. Add your Last.fm name once: \`.lf cc ${text} (your Last.fm name)\``);
        }
        note = interaction._linkWasGuess
            ? ` (Linked to Last.fm **${found}** automatically. Wrong account? Use \`.lf set (your Last.fm name)\`)`
            : ` (Linked to Last.fm **${found}**)`;
    }

    await fm.setCc(guild.id, interaction.user.id, text);

    return send(interaction, successPayload(`<@${interaction.user.id}>: Done! Type \`${text}\` and I'll show what you're listening to${note}`));
}

async function doProfile(interaction, words) {
    const { target } = readArgs(words, interaction.user.id);
    const username = await requireLink(interaction, target);
    if (!username) return;

    const [user, top] = await Promise.all([
        fm.getUserInfo(username),
        fm.getTop(username, 'artists', 'overall', 3).catch(() => []),
    ]);

    const embed = new EmbedBuilder()
        .setColor(fm.COLOR)
        .setAuthor({ name: `${await nameOf(interaction.guild, target)} on Last.fm` })
        .setTitle(user.name)
        .setURL(profileUrl(user.name));

    const image = [...(user.image ?? [])].reverse().find((i) => i['#text'])?.['#text'];
    if (image) embed.setThumbnail(image);

    const lines = [`**Scrobbles:** ${fm.num(user.playcount)}`];
    if (user.artist_count) lines.push(`**Artists:** ${fm.num(user.artist_count)}`);
    if (user.track_count) lines.push(`**Tracks:** ${fm.num(user.track_count)}`);
    if (user.album_count) lines.push(`**Albums:** ${fm.num(user.album_count)}`);
    if (user.registered?.unixtime) lines.push(`**Joined:** <t:${user.registered.unixtime}:D>`);
    if (top.length) lines.push(`**Top artists:** ${top.map((t) => t.name).join(', ')}`);
    embed.setDescription(lines.join('\n'));

    return send(interaction, embedPayload(embed));
}

async function doRecent(interaction, words) {
    const { target } = readArgs(words, interaction.user.id);
    const username = await requireLink(interaction, target);
    if (!username) return;

    const tracks = await fm.getRecent(username, 10);
    if (!tracks.length) return warn(interaction, 'No scrobbles yet');

    const lines = tracks.map((t) =>
        `${t.nowPlaying ? '▶️' : '•'} **${escapeMarkdown(t.name)}** - ${escapeMarkdown(t.artist)}${t.date ? ` <t:${t.date}:R>` : ''}`);

    const embed = new EmbedBuilder().setColor(fm.COLOR)
        .setAuthor({ name: `Recent tracks - ${await nameOf(interaction.guild, target)}`, url: profileUrl(username) })
        .setDescription(lines.join('\n'));
    if (tracks[0].image) embed.setThumbnail(tracks[0].image);

    return send(interaction, embedPayload(embed));
}

async function doTop(interaction, kind, words) {
    const { target, period } = readArgs(words, interaction.user.id);
    const username = await requireLink(interaction, target);
    if (!username) return;

    const list = await fm.getTop(username, kind, period[0], 10);
    if (!list.length) return warn(interaction, 'Nothing found for that time');

    const lines = list.map((x, i) => {
        const title = kind === 'artists' ? `**${escapeMarkdown(x.name)}**` : `**${escapeMarkdown(x.name)}** - ${escapeMarkdown(x.artist)}`;
        return `${rank(i)} ${title} • ${fm.num(x.plays)} plays`;
    });

    const embed = new EmbedBuilder().setColor(fm.COLOR)
        .setAuthor({ name: `Top ${kind} - ${await nameOf(interaction.guild, target)}`, url: profileUrl(username) })
        .setDescription(lines.join('\n'))
        .setFooter({ text: period[1] });

    return send(interaction, embedPayload(embed));
}

// everybody in this server who linked Last.fm
async function serverListeners(guild) {
    const links = await fm.getAllLinks();
    const ids = Object.keys(links).slice(0, MAX_MEMBERS * 3);

    await guild.members.fetch({ user: ids.slice(0, MAX_MEMBERS) }).catch(() => null);

    return ids
        .filter((id) => guild.members.cache.has(id))
        .slice(0, MAX_MEMBERS)
        .map((id) => ({ id, username: links[id], name: guild.members.cache.get(id).displayName }));
}

async function doWhoKnows(interaction, kind, words) {
    const guild = interaction.guild;
    if (!guild) return;

    let artist = null;
    let title = null;
    const typed = words.join(' ').trim();

    if (typed) {
        if (kind === 'artist') {
            artist = typed;
        } else {
            const split = typed.split(/\s+-\s+/);
            if (split.length < 2) {
                const what = kind === 'track' ? 'song' : 'album';
                return warn(interaction, `Type it like \`.${kind === 'track' ? 'wkt' : 'wka'} artist - ${what}\``);
            }
            artist = split.shift();
            title = split.join(' - ');
        }
    } else {
        // no text: use what you're listening to
        const username = await requireLink(interaction, interaction.user.id);
        if (!username) return;
        const [now] = await fm.getRecent(username, 1);
        if (!now) return warn(interaction, "You haven't scrobbled anything yet");
        artist = now.artist;
        if (kind === 'track') title = now.name;
        if (kind === 'album') {
            if (!now.album) return warn(interaction, "I couldn't see an album for that song");
            title = now.album;
        }
    }

    const members = await serverListeners(guild);
    if (!members.length) return warn(interaction, 'Nobody in this server has used Last.fm yet. Try `.fm` first');

    const results = await fm.mapLimit(members, 5, async (m) => {
        const r = await fm.getUserPlays(m.username, kind, artist, title);
        return { ...m, ...r };
    });

    const known = results.filter((r) => r && r.plays > 0).sort((a, b) => b.plays - a.plays);
    const first = results.find(Boolean);
    const label = kind === 'artist' ? (first?.name ?? artist) : `${first?.name ?? title} - ${first?.artist ?? artist}`;

    if (!known.length) {
        return send(interaction, embedPayload(new EmbedBuilder().setColor(fm.COLOR)
            .setTitle(`Who knows ${label}?`).setDescription('Nobody in this server has listened to this yet')));
    }

    const lines = known.slice(0, 10).map((r, i) =>
        `${rank(i)} [${escapeMarkdown(r.name)}](${profileUrl(r.username)}) • **${fm.num(r.plays)}** plays`);

    const myIndex = known.findIndex((r) => r.id === interaction.user.id);
    if (myIndex >= 10) lines.push('…', `**${myIndex + 1}.** [${escapeMarkdown(known[myIndex].name)}](${profileUrl(known[myIndex].username)}) • **${fm.num(known[myIndex].plays)}** plays`);

    const total = known.reduce((s, r) => s + r.plays, 0);

    const embed = new EmbedBuilder().setColor(fm.COLOR)
        .setTitle(`Who knows ${label} in ${guild.name}?`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${known.length} listener${known.length === 1 ? '' : 's'} • ${fm.num(total)} total plays` });

    return send(interaction, embedPayload(embed));
}

async function doArtistLb(interaction, words) {
    const guild = interaction.guild;
    if (!guild) return;

    const { period } = readArgs(words, interaction.user.id);
    const members = await serverListeners(guild);
    if (!members.length) return warn(interaction, 'Nobody in this server has used Last.fm yet. Try `.fm` first');

    const all = await fm.mapLimit(members, 5, (m) => fm.getTop(m.username, 'artists', period[0], 50));

    const totals = new Map();
    all.forEach((list, i) => {
        for (const a of list ?? []) {
            const key = a.name.toLowerCase();
            const row = totals.get(key) ?? { name: a.name, plays: 0, listeners: new Set() };
            row.plays += a.plays;
            row.listeners.add(members[i].id);
            totals.set(key, row);
        }
    });

    const sorted = [...totals.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);
    if (!sorted.length) return warn(interaction, 'No listening data found yet');

    const lines = sorted.map((a, i) =>
        `${rank(i)} **${escapeMarkdown(a.name)}** • ${fm.num(a.plays)} plays • ${a.listeners.size} listener${a.listeners.size === 1 ? '' : 's'}`);

    const embed = new EmbedBuilder().setColor(fm.COLOR)
        .setTitle(`Top artists in ${guild.name}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `${period[1]} • ${members.length} linked member${members.length === 1 ? '' : 's'}` });

    return send(interaction, embedPayload(embed));
}

function doHelp(interaction) {
    const embed = new EmbedBuilder().setColor(fm.COLOR)
        .setTitle('Last.fm commands')
        .setDescription([
            '`.fm` or `.lf` - your now playing (`.fm @user` for someone else)',
            '`.lf set (username)` - use a different Last.fm account  •  `.lf remove` - unlink (not needed to start: `.fm` finds yours)',
            '`.lf cc (text)` - custom word: type it to show your now playing',
            '`.lf recent` - last 10 songs',
            '`.lf topartists` / `toptracks` / `topalbums` `[7d 1m 3m 6m 12m all]`',
            '`.lf profile` - your Last.fm numbers',
            '`.wk [artist]` - who knows this artist here',
            '`.wkt artist - song` / `.wka artist - album`',
            '`.lf lb [period]` - artist leaderboard of this server',
        ].join('\n'));
    return send(interaction, embedPayload(embed));
}

// ------------------------------------------
// ROUTER
// ------------------------------------------

async function run(interaction, word, args) {
    if (!fm.hasApiKey()) return warn(interaction, errorText({ code: 'nokey' }));

    let action;
    let rest;

    if (DIRECT[word]) {
        action = DIRECT[word];
        rest = args;
    } else {
        const sub = args[0]?.toLowerCase();
        if (sub && SUB[sub]) { action = SUB[sub]; rest = args.slice(1); }
        else { action = 'np'; rest = args; }
    }

    if (!(await checkRateLimit(`fm:${interaction.user.id}`, 8, 20000))) {
        return warn(interaction, 'Slow down, try again in a few seconds');
    }

    try {
        if (interaction._isPrefixCommand) await interaction.channel?.sendTyping?.().catch(() => {});

        switch (action) {
            case 'set': return await doSet(interaction, rest);
            case 'remove': return await doRemove(interaction);
            case 'cc': return await doCc(interaction, rest);
            case 'profile': return await doProfile(interaction, rest);
            case 'recent': return await doRecent(interaction, rest);
            case 'topartists': return await doTop(interaction, 'artists', rest);
            case 'toptracks': return await doTop(interaction, 'tracks', rest);
            case 'topalbums': return await doTop(interaction, 'albums', rest);
            case 'whoknows': return await doWhoKnows(interaction, 'artist', rest);
            case 'whoknowstrack': return await doWhoKnows(interaction, 'track', rest);
            case 'whoknowsalbum': return await doWhoKnows(interaction, 'album', rest);
            case 'artistlb': return await doArtistLb(interaction, rest);
            case 'help': return await doHelp(interaction);
            default: return await doNowPlaying(interaction, rest);
        }
    } catch (error) {
        if (error instanceof fm.LastfmError) {
            if (error.code !== 6 && error.code !== '6' && error.code !== 17) logger.warn('Last.fm error', { code: error.code, message: error.message });
            return warn(interaction, errorText(error));
        }
        throw error;
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('fm')
        .setDescription('Last.fm: now playing, top lists, who knows, leaderboards (try /fm input:help)')
        .addStringOption((option) =>
            option.setName('input').setDescription('e.g. set username, recent, topartists, whoknows Radiohead').setRequired(false)),
    category: 'Music',

    async execute(interaction) {
        await InteractionHelper.safeDefer(interaction);
        const words = (interaction.options.getString('input') || '').split(/\s+/).filter(Boolean);
        return run(interaction, 'fm', words);
    },

    // .fm   .lf   .lf set rj   .wk Radiohead   ...
    async prefixExecute(interaction) {
        const message = interaction._responseCoordinator?.message ?? interaction.message;
        const body = (message?.content ?? '').trim().slice(1);
        const words = body.split(/\s+/).filter(Boolean);
        const word = (words.shift() ?? 'fm').toLowerCase();
        return run(interaction, word, words);
    },
};
