import { getFromDb, setInDb } from '../utils/database.js';
import { logger } from '../utils/logger.js';

// ==========================================
// SEEN  -  remembers the last time each person did anything in a server
// (sent a message, joined / left / moved voice).
// The newest time is kept in memory, and saved to the database at most once a minute per person,
// so normal chatting does not hit the database all the time.
// ==========================================

const SAVE_EVERY_MS = 60 * 1000;

const latest = new Map();    // key -> last time (ms)
const lastSaved = new Map(); // key -> when we last wrote it to the database

const keyFor = (guildId, userId) => `user_last_seen_${guildId}_${userId}`;

// Call this every time the person does something
export function recordSeen(guildId, userId) {
    const key = keyFor(guildId, userId);
    const now = Date.now();

    latest.set(key, now);

    if (now - (lastSaved.get(key) ?? 0) < SAVE_EVERY_MS) return;

    lastSaved.set(key, now);

    setInDb(key, { at: now }).catch((error) => {
        logger.error('Could not save last seen time:', error);
    });
}

// Returns the time in ms, or null if we have nothing
export async function getLastSeen(guildId, userId) {
    const key = keyFor(guildId, userId);

    const fromMemory = latest.get(key);
    if (fromMemory) return fromMemory;

    try {
        const data = await getFromDb(key, null);
        const at = Number(data?.at);

        return at > 0 ? at : null;
    } catch (error) {
        logger.error('Could not read last seen time:', error);
        return null;
    }
}
