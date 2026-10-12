import { logger } from '../utils/logger.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { Mutex } from '../utils/mutex.js';
import { logModerationAction } from '../utils/moderation.js';

// ==========================================
// TEMPORARY BANS
// .ban @user 3 days reason  ->  the bot unbans them by itself when the time is over.
// The list is saved in the database, so it still works after the bot restarts.
// ==========================================

const TEMP_BANS_KEY = 'moderation_temp_bans';
const CHECK_INTERVAL_MS = 30 * 1000;   // how often the bot checks for finished bans
const MAX_ATTEMPTS = 5;                // give up after this many failed unban tries

// The ban reason always contains this text for temporary bans.
// Before unbanning, the bot checks for it, so it never lifts a ban that
// someone else made permanent in the meantime.
export const TEMP_BAN_MARKER = '[temp ban:';

let checker = null;
let running = false;

export async function addTempBan({ guildId, userId, unbanAt, moderatorId }) {
    await Mutex.runExclusive(TEMP_BANS_KEY, async () => {
        const list = await getFromDb(TEMP_BANS_KEY, []);

        const next = list.filter(
            (entry) => !(entry.guildId === guildId && entry.userId === userId)
        );

        next.push({ guildId, userId, unbanAt, moderatorId, attempts: 0 });

        await setInDb(TEMP_BANS_KEY, next);
    });
}

export async function removeTempBan(guildId, userId) {
    await Mutex.runExclusive(TEMP_BANS_KEY, async () => {
        const list = await getFromDb(TEMP_BANS_KEY, []);

        const next = list.filter(
            (entry) => !(entry.guildId === guildId && entry.userId === userId)
        );

        if (next.length !== list.length) {
            await setInDb(TEMP_BANS_KEY, next);
        }
    });
}

async function saveUnbanCase(client, guild, userId) {
    try {
        const user = await client.users.fetch(userId).catch(() => null);
        const tag = user?.tag ?? userId;

        await logModerationAction({
            client,
            guild,
            event: {
                action: 'Member Unbanned',
                target: `${tag} (${userId})`,
                executor: `${client.user.tag} (${client.user.id})`,
                reason: 'Temporary ban expired',
                metadata: {
                    userId,
                    moderatorId: client.user.id,
                },
            },
        });
    } catch (error) {
        logger.debug(`Could not log temp ban expiry for ${userId}: ${error.message}`);
    }
}

async function processExpiredBans(client) {
    if (running) return;
    running = true;

    try {
        const now = Date.now();
        const list = await getFromDb(TEMP_BANS_KEY, []);
        const due = list.filter((entry) => entry.unbanAt <= now);

        if (!due.length) return;

        const finished = new Set();
        const attemptsByKey = new Map();

        for (const entry of due) {
            const key = `${entry.guildId}:${entry.userId}`;
            const guild = client.guilds.cache.get(entry.guildId);

            // The bot is no longer in that server
            if (!guild) {
                finished.add(key);
                continue;
            }

            try {
                const ban = await guild.bans.fetch(entry.userId).catch((error) => {
                    if (error?.code === 10026) return null; // already unbanned
                    throw error;
                });

                if (!ban) {
                    finished.add(key);
                    continue;
                }

                // Someone made it a different (permanent) ban, so leave it alone
                if (!String(ban.reason || '').includes(TEMP_BAN_MARKER)) {
                    finished.add(key);
                    continue;
                }

                await guild.members.unban(entry.userId, 'Temporary ban expired');
                await saveUnbanCase(client, guild, entry.userId);

                logger.info(`Temporary ban expired, unbanned ${entry.userId} in guild ${entry.guildId}`);
                finished.add(key);
            } catch (error) {
                const attempts = (entry.attempts || 0) + 1;

                if (attempts >= MAX_ATTEMPTS) {
                    logger.error(`Giving up unbanning ${entry.userId} in ${entry.guildId}: ${error.message}`);
                    finished.add(key);
                } else {
                    logger.warn(`Could not unban ${entry.userId} yet (try ${attempts}): ${error.message}`);
                    attemptsByKey.set(key, attempts);
                }
            }
        }

        await Mutex.runExclusive(TEMP_BANS_KEY, async () => {
            const latest = await getFromDb(TEMP_BANS_KEY, []);
            const next = [];

            for (const entry of latest) {
                const key = `${entry.guildId}:${entry.userId}`;

                if (finished.has(key)) continue;

                if (attemptsByKey.has(key)) {
                    entry.attempts = attemptsByKey.get(key);
                }

                next.push(entry);
            }

            await setInDb(TEMP_BANS_KEY, next);
        });
    } catch (error) {
        logger.error('Temp ban checker error:', error);
    } finally {
        running = false;
    }
}

// Call this once when the bot is ready (it is added to ready.js)
export function startTempBanChecker(client) {
    if (checker) return;

    processExpiredBans(client);

    checker = setInterval(() => processExpiredBans(client), CHECK_INTERVAL_MS);
    checker.unref?.();
}
