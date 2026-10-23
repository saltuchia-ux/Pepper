import { getFromDb, setInDb, deleteFromDb, getAFKKey } from '../utils/database.js';
import { logger } from '../utils/logger.js';

// ==========================================
// AFK  -  remembers who is AFK, their status, and since when
// (kept in memory too, so normal chatting does not hit the database)
// ==========================================

const cache = new Map(); // key -> { status, since } or null

const DEFAULT_STATUS = 'AFK';
const MAX_STATUS_LENGTH = 100;

// Makes the status safe: one line, no @everyone pings, not too long
export function cleanStatus(text) {
    const status = String(text ?? '')
        .replace(/\s+/g, ' ')
        .replace(/@(everyone|here)/gi, '@\u200b$1')
        .trim()
        .slice(0, MAX_STATUS_LENGTH);

    return status || DEFAULT_STATUS;
}

// 5 minutes / 1 hour 3 minutes / 2 days 4 hours
export function formatDuration(ms) {
    const totalMinutes = Math.floor(Math.max(0, ms) / 60000);

    if (totalMinutes < 1) return 'a few seconds';

    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    if (days > 0) return hours > 0 ? `${unit(days, 'day')} ${unit(hours, 'hour')}` : unit(days, 'day');
    if (hours > 0) return minutes > 0 ? `${unit(hours, 'hour')} ${unit(minutes, 'minute')}` : unit(hours, 'hour');

    return unit(minutes, 'minute');
}

export async function getAfk(guildId, userId) {
    const key = getAFKKey(guildId, userId);

    if (cache.has(key)) return cache.get(key);

    let data = null;

    try {
        data = (await getFromDb(key, null)) || null;
    } catch (error) {
        logger.error('Could not read AFK data:', error);
    }

    cache.set(key, data);

    return data;
}

export async function setAfk(guildId, userId, status) {
    const key = getAFKKey(guildId, userId);
    const data = { status: cleanStatus(status), since: Date.now() };

    cache.set(key, data);

    try {
        await setInDb(key, data);
    } catch (error) {
        logger.error('Could not save AFK data:', error);
    }

    return data;
}

export async function clearAfk(guildId, userId) {
    const key = getAFKKey(guildId, userId);

    cache.set(key, null);

    try {
        await deleteFromDb(key);
    } catch (error) {
        logger.error('Could not remove AFK data:', error);
    }
}
