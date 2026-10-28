import axios from 'axios';
import { EmbedBuilder } from 'discord.js';
import { getFromDb, setInDb } from '../utils/database.js';

// ==========================================
// Last.fm helper (talks to Last.fm + remembers who linked what)
/ Needs ONE setting on your host:  LASTFM_API_KEY
// ==========================================

const API = 'https://ws.audioscrobbler.com/2.0/';
const LINKS_KEY = 'lastfm_links';
const ccKey = (guildId) => `lastfm_cc_${guildId}`;
export const COLOR = 0x2b2d31;

export class LastfmError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

export const hasApiKey = () => Boolean(process.env.LASTFM_API_KEY);

async function call(method, params = {}) {
    if (!hasApiKey()) throw new LastfmError('nokey', 'No LASTFM_API_KEY');

    try {
        const { data } = await axios.get(API, {
            params: { method, api_key: process.env.LASTFM_API_KEY, format: 'json', ...params },
            timeout: 10000,
        });
        if (data?.error) throw new LastfmError(data.error, data.message);
        return data;
    } catch (error) {
        if (error instanceof LastfmError) throw error;
        const apiError = error.response?.data?.error;
        if (apiError) throw new LastfmError(apiError, error.response.data.message);
        throw new LastfmError('network', 'Last.fm did not answer');
    }
}

// ------------------------------------------
// SMALL TOOLS
// ------------------------------------------

export const num = (n) => Number(n || 0).toLocaleString('en-US');
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const artistName = (a) => (typeof a === 'string' ? a : a?.name ?? a?.['#text'] ?? 'Unknown');

function bestImage(images) {
    const list = arr(images);
    for (let i = list.length - 1; i >= 0; i--) {
        const url = list[i]?.['#text'];
        if (url && !url.includes('2a96cbd8b46e442fc41c2b86b821562f')) return url;
    }
    return null;
}

export const PERIODS = {
    overall: ['overall', 'Overall'], all: ['overall', 'Overall'], alltime: ['overall', 'Overall'], lifetime: ['overall', 'Overall'],
    '7d': ['7day', 'Last 7 days'], week: ['7day', 'Last 7 days'], weekly: ['7day', 'Last 7 days'], '7day': ['7day', 'Last 7 days'],
    '1m': ['1month', 'Last month'], month: ['1month', 'Last month'], monthly: ['1month', 'Last month'], '30d': ['1month', 'Last month'],
    '3m': ['3month', 'Last 3 months'], quarter: ['3month', 'Last 3 months'],
    '6m': ['6month', 'Last 6 months'], halfyear: ['6month', 'Last 6 months'],
    '12m': ['12month', 'Last year'], '1y': ['12month', 'Last year'], year: ['12month', 'Last year'], yearly: ['12month', 'Last year'],
};

export async function mapLimit(items, limit, fn) {
    const results = [];
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length) {
            const i = index++;
            results[i] = await fn(items[i]).catch(() => null);
        }
    });
    await Promise.all(workers);
    return results;
}

// ------------------------------------------
// WHO LINKED WHAT  (userId -> last.fm name)
// ------------------------------------------

let linksCache = null;

function parse(value) {
    if (!value) return {};
    if (typeof value === 'string') {
        try { return JSON.parse(value) || {}; } catch { return {}; }
    }
    return value;
}

async function loadLinks() {
    if (!linksCache) linksCache = parse(await getFromDb(LINKS_KEY, {}));
    return linksCache;
}

export async function getAllLinks() { return { ...(await loadLinks()) }; }
export async function getLinkedUsername(userId) { return (await loadLinks())[userId] ?? null; }

export async function setLink(userId, username) {
    const links = await loadLinks();
    links[userId] = username;
    await setInDb(LINKS_KEY, JSON.stringify(links));
}

export async function removeLink(userId) {
    const links = await loadLinks();
    delete links[userId];
    await setInDb(LINKS_KEY, JSON.stringify(links));
}

// ------------------------------------------
// CUSTOM COMMANDS  (.lf cc text)   guild -> { text: userId }
// ------------------------------------------

const ccCache = new Map();

export async function getCcMap(guildId) {
    if (!ccCache.has(guildId)) ccCache.set(guildId, parse(await getFromDb(ccKey(guildId), {})));
    return ccCache.get(guildId);
}

export async function getCcOf(guildId, userId) {
    const map = await getCcMap(guildId);
    return Object.keys(map).find((text) => map[text] === userId) ?? null;
}

export async function setCc(guildId, userId, text) {
    const map = await getCcMap(guildId);
    for (const key of Object.keys(map)) if (map[key] === userId) delete map[key];
    map[text] = userId;
    await setInDb(ccKey(guildId), JSON.stringify(map));
}

export async function removeCc(guildId, userId) {
    const map = await getCcMap(guildId);
    let removed = false;
    for (const key of Object.keys(map)) if (map[key] === userId) { delete map[key]; removed = true; }
    if (removed) await setInDb(ccKey(guildId), JSON.stringify(map));
    return removed;
}

// ------------------------------------------
// LAST.FM DATA
// ------------------------------------------

export async function getUserInfo(username) {
    const { user } = await call('user.getInfo', { user: username });
    return user;
}

export async function getRecent(username, limit = 10) {
    const data = await call('user.getRecentTracks', { user: username, limit, extended: 1 });
    return arr(data.recenttracks?.track).map((t) => ({
        name: t.name,
        artist: artistName(t.artist),
        album: t.album?.['#text'] || '',
        url: t.url,
        image: bestImage(t.image),
        nowPlaying: t['@attr']?.nowplaying === 'true',
        date: t.date?.uts ? Number(t.date.uts) : null,
        loved: t.loved === '1',
    }));
}

export async function getTop(username, kind, period = 'overall', limit = 10) {
    const method = { artists: 'user.getTopArtists', tracks: 'user.getTopTracks', albums: 'user.getTopAlbums' }[kind];
    const data = await call(method, { user: username, period, limit });
    const list = arr(data[`top${kind}`]?.[kind.slice(0, -1)]);
    return list.map((x) => ({
        name: x.name,
        artist: kind === 'artists' ? null : artistName(x.artist),
        plays: Number(x.playcount || 0),
        url: x.url,
    }));
}

const playsCache = new Map();

// how many times this user played an artist / track / album
export async function getUserPlays(username, kind, artist, title) {
    const cacheKey = `${kind}|${artist}|${title || ''}|${username}`.toLowerCase();
    const hit = playsCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 180000) return hit.value;

    const method = { artist: 'artist.getInfo', track: 'track.getInfo', album: 'album.getInfo' }[kind];
    const params = { artist, username, autocorrect: 1 };
    if (kind === 'track') params.track = title;
    if (kind === 'album') params.album = title;

    const data = await call(method, params);
    let value;

    if (kind === 'artist') {
        value = { name: data.artist?.name ?? artist, plays: Number(data.artist?.stats?.userplaycount || 0), listeners: Number(data.artist?.stats?.listeners || 0) };
    } else if (kind === 'track') {
        value = { name: data.track?.name ?? title, artist: artistName(data.track?.artist) , plays: Number(data.track?.userplaycount || 0) };
    } else {
        value = { name: data.album?.name ?? title, artist: data.album?.artist ?? artist, plays: Number(data.album?.userplaycount || 0) };
    }

    playsCache.set(cacheKey, { at: Date.now(), value });
    return value;
}

// ------------------------------------------
// NOW PLAYING CARD  (used by .fm and by .lf cc triggers)
// ------------------------------------------

export async function buildNowPlayingPayload(username, displayName) {
    const [track] = await getRecent(username, 1);

    if (!track) {
        return { content: `${displayName} has no scrobbles yet`, allowedMentions: { parse: [] } };
    }

    let plays = null;
    let loved = track.loved;
    let total = null;

    try {
        const [info, user] = await Promise.all([
            call('track.getInfo', { artist: track.artist, track: track.name, username, autocorrect: 1 }).catch(() => null),
            getUserInfo(username).catch(() => null),
        ]);
        if (info?.track?.userplaycount !== undefined) plays = Number(info.track.userplaycount);
        if (info?.track?.userloved === '1') loved = true;
        if (user?.playcount) total = Number(user.playcount);
    } catch { /* extras are optional */ }

    const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setAuthor({ name: `${track.nowPlaying ? 'Now playing' : 'Last played'} - ${displayName}`, url: `https://www.last.fm/user/${encodeURIComponent(username)}` })
        .setTitle(track.name)
        .setDescription(`**${track.artist}**${track.album ? ` • ${track.album}` : ''}`);

    if (track.url) embed.setURL(track.url);
    if (track.image) embed.setThumbnail(track.image);

    const bits = [];
    if (plays !== null) bits.push(`${num(plays)} plays`);
    if (total !== null) bits.push(`${num(total)} total scrobbles`);
    embed.setFooter({ text: `${loved ? '❤️ ' : ''}${bits.join(' • ') || 'Last.fm'}` });

    if (!track.nowPlaying && track.date) embed.setTimestamp(track.date * 1000);

    return { embeds: [embed], allowedMentions: { parse: [] } };
}
