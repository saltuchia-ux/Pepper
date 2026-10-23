// memoryStorage.js

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

class MemoryStorage {
    // Pass { file: 'path/to/file.json' } to keep the data in a file, so it survives restarts.
    constructor({ file = null } = {}) {
        this.data = new Map();
        this.expirationTimes = new Map();
        this.file = file ? path.resolve(file) : null;
        this.writeTimer = null;

        if (this.file) {
            this.loadFromFile();
            process.once('exit', () => this.writeFileNow());
        }
    }

    loadFromFile() {
        try {
            if (!fs.existsSync(this.file)) return;

            const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            const now = Date.now();

            for (const [key, value] of Object.entries(saved.data ?? {})) {
                const expires = saved.expires?.[key];
                if (expires && now > expires) continue; // already expired
                this.data.set(key, value);
                if (expires) this.expirationTimes.set(key, expires);
            }

            logger.info(`Loaded ${this.data.size} saved entries from ${this.file}`);
        } catch (error) {
            logger.error(`Could not read saved data file ${this.file} (starting empty):`, error);
        }
    }

    writeFileNow() {
        if (!this.file) return;

        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });

            const payload = JSON.stringify({
                data: Object.fromEntries(this.data),
                expires: Object.fromEntries(this.expirationTimes),
            });

            // Write to a temp file first so a crash can never leave a half-written save file.
            const temp = `${this.file}.tmp`;
            fs.writeFileSync(temp, payload);
            fs.renameSync(temp, this.file);
        } catch (error) {
            logger.error(`Could not save data file ${this.file}:`, error);
        }
    }

    schedulePersist() {
        if (!this.file || this.writeTimer) return;

        this.writeTimer = setTimeout(() => {
            this.writeTimer = null;
            this.writeFileNow();
        }, 500);
        this.writeTimer.unref?.();
    }

    async get(key, defaultValue = null) {
        const value = this.data.get(key);
        
        if (this.expirationTimes.has(key)) {
            const expirationTime = this.expirationTimes.get(key);
            if (Date.now() > expirationTime) {
                this.data.delete(key);
                this.expirationTimes.delete(key);
                return defaultValue;
            }
        }
        
        return value !== undefined ? value : defaultValue;
    }

    async set(key, value, ttl = null) {
        this.data.set(key, value);
        
        if (ttl && ttl > 0) {
            this.expirationTimes.set(key, Date.now() + (ttl * 1000));
        }

        this.schedulePersist();
        return true;
    }

    async delete(key) {
        this.data.delete(key);
        this.expirationTimes.delete(key);
        this.schedulePersist();
        return true;
    }

    async list(prefix) {
        const keys = [];
        for (const key of this.data.keys()) {
            if (key.startsWith(prefix)) {
                if (this.expirationTimes.has(key)) {
                    const expirationTime = this.expirationTimes.get(key);
                    if (Date.now() > expirationTime) {
                        this.data.delete(key);
                        this.expirationTimes.delete(key);
                        continue;
                    }
                }
                keys.push(key);
            }
        }
        return keys;
    }

    async exists(key) {
        const value = this.data.get(key);
        
        if (this.expirationTimes.has(key)) {
            const expirationTime = this.expirationTimes.get(key);
            if (Date.now() > expirationTime) {
                this.data.delete(key);
                this.expirationTimes.delete(key);
                return false;
            }
        }
        
        return value !== undefined;
    }

    async increment(key, amount = 1) {
        const current = await this.get(key, 0);
        const newValue = current + amount;
        await this.set(key, newValue);
        return newValue;
    }

    async decrement(key, amount = 1) {
        const current = await this.get(key, 0);
        const newValue = current - amount;
        await this.set(key, newValue);
        return newValue;
    }

    async clear() {
        this.data.clear();
        this.expirationTimes.clear();
        this.schedulePersist();
        return true;
    }
}

export { MemoryStorage };