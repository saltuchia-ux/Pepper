import { getFromDb, setInDb } from '../utils/database.js';
import { Mutex } from '../utils/mutex.js';
import { logger } from '../utils/logger.js';

// ==========================================
// REMINDERS  (.remind drink water 10m)
// The list is saved in the database, so reminders still arrive after the bot restarts.
// If the bot was offline when a reminder was due, it is sent as soon as the bot is back.
// ==========================================

const KEY = 'reminders_list';
const CHECK_INTERVAL_MS = 5 * 1000;
const MAX_ATTEMPTS = 3;

export const MIN_MS = 10 * 1000;                    // shortest: 10 seconds
export const MAX_MS = 5 * 365 * 24 * 60 * 60 * 1000; // longest: 5 years
export const MAX_TEXT_LENGTH = 500;
export const MAX_PER_USER = 25;

let list = null;     // all waiting reminders (kept in memory, saved to the database)
let checker = null;
let running = false;

// ------------------------------------------
// TIME WORDS:  10m  10 min  1hour  2 days  1y ...
// ------------------------------------------

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const UNITS = {
    s: SECOND, sec: SECOND, secs: SECOND, second: SECOND, seconds: SECOND,
    m: MINUTE, min: MINUTE, mins: MINUTE, minute: MINUTE, minutes: MINUTE,
    h: HOUR, hr: HOUR, hrs: HOUR, hour: HOUR, hours: HOUR,
    d: DAY, day: DAY, days: DAY,
    w: 7 * DAY, wk: 7 * DAY, wks: 7 * DAY, week: 7 * DAY, weeks: 7 * DAY,
    y: 365 * DAY, yr: 365 * DAY, yrs: 365 * DAY, year: 365 * DAY, years: 365 * DAY,
};

// "10m"  or  "10" + "minutes"   ->  { ms, count } (count = how many words it used) or null
function readTime(first, second) {
    const joined = /^(\d+)([a-z]+)$/i.exec(first ?? '');

    if (joined && UNITS[joined[2].toLowerCase()]) {
        return { ms: Number(joined[1]) * UNITS[joined[2].toLowerCase()], count: 1 };
    }

    if (/^\d+$/.test(first ?? '') && UNITS[(second ?? '').toLowerCase()]) {
        return { ms: Number(first) * UNITS[second.toLowerCase()], count: 2 };
    }

    return null;
}

// Takes the time from the END of the words (".remind drink water 10m"),
// or from the START (".remind 10m drink water").
// Returns { ms, textWords } or null.
export function splitTimeAndText(words) {
    const n = words.length;

    const fromEnd = readTime(words[n - 1]) ?? (n >= 2 ? readTime(words[n - 2], words[n - 1]) : null);

    if (fromEnd && n - fromEnd.count > 0) {
        let textWords = words.slice(0, n - fromEnd.count);

        // ".remind drink water in 10m"
        if (textWords.length > 1 && textWords[textWords.length - 1].toLowerCase() === 'in') {
            textWords = textWords.slice(0, -1);
        }

        return { ms: fromEnd.ms, textWords };
    }

    const fromStart = readTime(words[0], words[1]);

    if (fromStart && n - fromStart.count > 0) {
        return { ms: fromStart.ms, textWords: words.slice(fromStart.count) };
    }

    return null;
}

// 600000 -> "10 minutes"    93784000 -> "1 day 2 hours"
export function formatTime(ms) {
    let left = Math.round(ms / SECOND);

    const parts = [
        ['year', 365 * 24 * 3600],
        ['day', 24 * 3600],
        ['hour', 3600],
        ['minute', 60],
        ['second', 1],
    ];

    const out = [];

    for (const [name, size] of parts) {
        const count = Math.floor(left / size);
        left -= count * size;

        if (count > 0) out.push(`${count} ${name}${count === 1 ? '' : 's'}`);
        if (out.length === 2) break;
    }

    return out.join(' ') || '0 seconds';
}

// One line, no @everyone / @here pings
export function cleanText(text) {
    return String(text ?? '')
        .replace(/\s+/g, ' ')
        .replace(/@(everyone|here)/gi, '@\u200b$1')
        .trim();
}

// ------------------------------------------
// SAVED LIST
// ------------------------------------------

async function load() {
    if (list) return;

    const saved = await getFromDb(KEY, []);
    list = Array.isArray(saved) ? saved : [];
}

function save() {
    return Mutex.runExclusive(KEY, () => setInDb(KEY, list));
}

export async function countReminders(userId) {
    await load();

    return list.filter((entry) => entry.userId === userId).length;
}

export async function addReminder({ userId, guildId, channelId, text, ms }) {
    await load();

    list.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId,
        guildId,
        channelId,
        text,
        remindAt: Date.now() + ms,
        attempts: 0,
    });

    await save();
}

// ------------------------------------------
// SENDING
// ------------------------------------------

async function deliver(client, entry) {
    // 1) the DM (this is the normal way)
    const user = await client.users.fetch(entry.userId).catch(() => null);

    if (user) {
        try {
            await user.send({
                content: `⏰ **Reminder:** ${entry.text}`,
                allowedMentions: { parse: [] },
            });
            return true;
        } catch {
            // DMs are closed -> try the channel below
        }
    }

    // 2) DMs closed: say it in the channel where the reminder was made
    const channel = await client.channels.fetch(entry.channelId).catch(() => null);

    if (channel?.send) {
        try {
            await channel.send({
                content: `<@${entry.userId}> ⏰ **Reminder:** ${entry.text}`,
                allowedMentions: { users: [entry.userId] },
            });
            return true;
        } catch {
            // could not send there either
        }
    }

    return false;
}

async function processDue(client) {
    if (running) return;
    running = true;

    try {
        await load();

        const now = Date.now();
        const due = list.filter((entry) => entry.remindAt <= now);

        if (!due.length) return;

        const finished = new Set();

        for (const entry of due) {
            const sent = await deliver(client, entry);

            if (sent) {
                logger.info(`Reminder sent to ${entry.userId}`);
                finished.add(entry.id);
                continue;
            }

            entry.attempts = (entry.attempts || 0) + 1;

            if (entry.attempts >= MAX_ATTEMPTS) {
                logger.warn(`Giving up on reminder for ${entry.userId} (could not DM or post it)`);
                finished.add(entry.id);
            }
        }

        list = list.filter((entry) => !finished.has(entry.id));

        await save();
    } catch (error) {
        logger.error('Reminder checker error:', error);
    } finally {
        running = false;
    }
}

// Call this once when the bot is ready (it is added to ready.js)
export function startReminderChecker(client) {
    if (checker) return;

    logger.info('Reminder checker started');

    processDue(client);

    checker = setInterval(() => processDue(client), CHECK_INTERVAL_MS);
    checker.unref?.();
}
