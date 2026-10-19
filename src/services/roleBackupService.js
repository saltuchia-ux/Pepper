import { logger } from '../utils/logger.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { Mutex } from '../utils/mutex.js';

// ==========================================
// ROLE BACKUP
// When someone is jailed, kicked or banned, their roles are saved for 2 hours.
// .restore can give them back during that time. After 2 hours the backup is gone.
// ==========================================

export const ROLE_BACKUP_TTL_MS = 2 * 60 * 60 * 1000;   // 2 hours

const keyFor = (guildId) => `role_backups_${guildId}`;

function isFresh(backup) {
    return backup && Date.now() - backup.savedAt < ROLE_BACKUP_TTL_MS;
}

// Saves the role IDs of a person. Old backups (over 2 hours) are cleaned out at the same time.
export async function saveRoleBackup({ guildId, userId, roleIds, reason }) {
    if (!roleIds?.length) return false;

    try {
        await Mutex.runExclusive(keyFor(guildId), async () => {
            const all = await getFromDb(keyFor(guildId), {});

            for (const [id, backup] of Object.entries(all)) {
                if (!isFresh(backup)) delete all[id];
            }

            all[userId] = { roleIds, reason, savedAt: Date.now() };

            await setInDb(keyFor(guildId), all);
        });

        return true;
    } catch (error) {
        logger.error('Could not save role backup:', error);
        return false;
    }
}

// Returns { roleIds, reason, savedAt } or null if there is none (or it is older than 2 hours)
export async function getRoleBackup(guildId, userId) {
    try {
        const all = await getFromDb(keyFor(guildId), {});
        const backup = all[userId];

        return isFresh(backup) ? backup : null;
    } catch (error) {
        logger.error('Could not read role backup:', error);
        return null;
    }
}

export async function deleteRoleBackup(guildId, userId) {
    try {
        await Mutex.runExclusive(keyFor(guildId), async () => {
            const all = await getFromDb(keyFor(guildId), {});

            if (all[userId]) {
                delete all[userId];
                await setInDb(keyFor(guildId), all);
            }
        });
    } catch (error) {
        logger.error('Could not delete role backup:', error);
    }
}

// How many minutes are left before the backup is deleted
export function backupMinutesLeft(backup) {
    return Math.max(0, Math.ceil((ROLE_BACKUP_TTL_MS - (Date.now() - backup.savedAt)) / 60000));
}
