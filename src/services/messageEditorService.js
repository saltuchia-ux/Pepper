// messageEditorService.js
//
// Lets the bot owner SEE and EDIT every message the bot sends (errors, success,
// warnings, plain text, embed titles/descriptions/fields...).
//
// How it works:
//   1. discord.js builds every outgoing message through MessagePayload.resolveBody().
//      We wrap that one function, so nothing the bot sends can slip past.
//   2. Each text is turned into a "template" (mentions, numbers, ids become {1} {2} ...)
//      and saved in a catalog with a short ID.
//   3. If the owner saved an edit for that ID, the text is swapped before it is sent.
//
// Use the /messages command (or .messages) to list / view / edit / reset.

import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { MessagePayload } from 'discord.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { botConfig } from '../config/bot.js';
import { COLORS as SHORT_COLORS } from '../utils/replyStyle.js';
import { logger } from '../utils/logger.js';

const OVERRIDES_KEY = 'cache:bot_messages:overrides';
const CATALOG_KEY = 'cache:bot_messages:catalog';
const MAX_CATALOG = 3000;
const MAX_TEXT = 4000;
const SAVE_DELAY_MS = 20_000;

// Things that change from message to message and must not be part of the template.
const VARIABLE_PATTERN =
    /<a?:\w+:\d+>|<@[!&]?\d+>|<#\d+>|<t:-?\d+(?::[a-zA-Z])?>|\d+(?:[.,]\d+)*/g;

const skipStore = new AsyncLocalStorage();

let overrides = {}; // id -> { text, template, updatedAt }
let catalog = {}; // id -> { template, type, kind, count, lastSeen }
let loaded = false;
let hooked = false;
let saveTimer = null;
let catalogDirty = false;

// ---------------------------------------------------------------- helpers

function colorToNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.startsWith('#')) {
        return parseInt(value.slice(1), 16);
    }
    return null;
}

function typeFromColor(color) {
    if (color === null || color === undefined) return 'info';

    const palette = botConfig.embeds?.colors ?? {};
    const table = [
        ['error', colorToNumber(palette.error)],
        ['success', colorToNumber(palette.success)],
        ['success', SHORT_COLORS.success],
        ['warning', colorToNumber(palette.warning)],
        ['warning', SHORT_COLORS.warning],
        ['info', colorToNumber(palette.info)],
        ['info', SHORT_COLORS.info],
    ];

    for (const [type, value] of table) {
        if (value !== null && value === color) return type;
    }
    return 'other';
}

/** "You have 5 coins <@123>" -> { template: "You have {1} coins {2}", vars: ["5", "<@123>"] } */
export function toTemplate(text) {
    const vars = [];
    const template = String(text).replace(VARIABLE_PATTERN, (match) => {
        vars.push(match);
        return `{${vars.length}}`;
    });
    return { template, vars };
}

function fillTemplate(template, vars) {
    return template.replace(/\{(\d+)\}/g, (whole, n) => {
        const value = vars[Number(n) - 1];
        return value === undefined ? whole : value;
    });
}

function makeId(template) {
    const hash = crypto.createHash('sha1').update(template).digest('hex');
    for (let length = 6; length <= 12; length += 2) {
        const id = hash.slice(0, length);
        if (!catalog[id] || catalog[id].template === template) return id;
    }
    return hash.slice(0, 12);
}

function worthTracking(text) {
    return typeof text === 'string' && text.length >= 2 && text.length <= MAX_TEXT && /[A-Za-z]/.test(text);
}

function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        if (!catalogDirty) return;
        catalogDirty = false;
        await setInDb(CATALOG_KEY, catalog).catch(() => {});
    }, SAVE_DELAY_MS);
    saveTimer.unref?.();
}

function trimCatalog() {
    const ids = Object.keys(catalog);
    if (ids.length <= MAX_CATALOG) return;

    // Drop the oldest, least-used entries that have no saved edit.
    const removable = ids
        .filter((id) => !overrides[id])
        .sort((a, b) => catalog[a].lastSeen - catalog[b].lastSeen);

    for (const id of removable.slice(0, ids.length - MAX_CATALOG)) {
        delete catalog[id];
    }
}

// ---------------------------------------------------------------- core: process one text

function processText(text, { type, kind }) {
    if (!worthTracking(text)) return text;

    const { template, vars } = toTemplate(text);
    const id = makeId(template);
    const now = Date.now();

    const entry = catalog[id];
    if (entry) {
        entry.count += 1;
        entry.lastSeen = now;
        // Keep the most specific type we have seen (errors beat "other").
        if (entry.type === 'other' && type !== 'other') entry.type = type;
    } else {
        catalog[id] = { template, type, kind, count: 1, lastSeen: now };
        trimCatalog();
    }
    catalogDirty = true;
    scheduleSave();

    const edit = overrides[id];
    if (edit) {
        return fillTemplate(edit.text, vars).slice(0, MAX_TEXT);
    }
    return text;
}

function processBody(body) {
    if (!body || typeof body !== 'object') return;

    const hasEmbeds = Array.isArray(body.embeds) && body.embeds.length > 0;

    if (typeof body.content === 'string' && body.content) {
        body.content = processText(body.content, { type: hasEmbeds ? 'other' : 'text', kind: 'text' });
    }

    if (!hasEmbeds) return;

    // toJSON() is a shallow copy, so clone before editing to never touch the original builder.
    body.embeds = body.embeds.map((raw) => {
        const embed = {
            ...raw,
            fields: raw.fields?.map((field) => ({ ...field })),
            footer: raw.footer ? { ...raw.footer } : raw.footer,
            author: raw.author ? { ...raw.author } : raw.author,
        };
        const type = typeFromColor(embed.color);

        if (embed.title) embed.title = processText(embed.title, { type, kind: 'title' });
        if (embed.description) embed.description = processText(embed.description, { type, kind: 'description' });
        if (embed.fields) {
            for (const field of embed.fields) {
                if (field.name) field.name = processText(field.name, { type, kind: 'field name' });
                if (field.value) field.value = processText(field.value, { type, kind: 'field value' });
            }
        }
        if (embed.footer?.text) embed.footer.text = processText(embed.footer.text, { type, kind: 'footer' });
        if (embed.author?.name) embed.author.name = processText(embed.author.name, { type, kind: 'author' });

        return embed;
    });
}

// ---------------------------------------------------------------- setup

/** Wraps discord.js so every outgoing message passes through us. Safe to call twice. */
export function installMessageHook() {
    if (hooked) return;
    hooked = true;

    const original = MessagePayload.prototype.resolveBody;

    MessagePayload.prototype.resolveBody = function resolveBodyWithEditor(...args) {
        const result = original.apply(this, args);

        try {
            if (loaded && !skipStore.getStore()?.skip && this.body) {
                processBody(this.body);
            }
        } catch (error) {
            // Never let the editor break message sending.
            logger.error('Message editor hook failed (message sent unchanged):', error);
        }

        return result;
    };
}

/** Loads saved edits + catalog from the database. Call once after the database is ready. */
export async function loadMessageEditor() {
    try {
        const savedOverrides = await getFromDb(OVERRIDES_KEY, {});
        const savedCatalog = await getFromDb(CATALOG_KEY, {});
        overrides = savedOverrides && typeof savedOverrides === 'object' ? savedOverrides : {};
        catalog = savedCatalog && typeof savedCatalog === 'object' ? savedCatalog : {};
    } catch (error) {
        logger.error('Could not load message editor data, starting empty:', error);
        overrides = {};
        catalog = {};
    }

    loaded = true;
    logger.info(`Message editor ready: ${Object.keys(catalog).length} known messages, ${Object.keys(overrides).length} edited`);
}

/** Run something without cataloging/editing what it sends (used by the /messages command itself). */
export function withoutEditing(fn) {
    return skipStore.run({ skip: true }, fn);
}

// ---------------------------------------------------------------- API for the command

export function listMessages({ type = null, search = null, onlyEdited = false } = {}) {
    const needle = search ? search.toLowerCase() : null;

    return Object.entries(catalog)
        .filter(([id, entry]) => {
            if (type && entry.type !== type) return false;
            if (onlyEdited && !overrides[id]) return false;
            if (needle) {
                const haystack = `${entry.template} ${overrides[id]?.text ?? ''} ${id}`.toLowerCase();
                if (!haystack.includes(needle)) return false;
            }
            return true;
        })
        .map(([id, entry]) => ({
            id,
            ...entry,
            edited: Boolean(overrides[id]),
            editedText: overrides[id]?.text ?? null,
        }))
        .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
}

export function getMessageEntry(id) {
    const key = String(id).toLowerCase().replace(/^#/, '');
    const entry = catalog[key];
    if (!entry) return null;
    return { id: key, ...entry, edited: Boolean(overrides[key]), editedText: overrides[key]?.text ?? null };
}

export async function setMessageEdit(id, text) {
    const key = String(id).toLowerCase().replace(/^#/, '');
    const entry = catalog[key];
    if (!entry) return { ok: false, reason: 'not_found' };

    const clean = String(text).trim();
    if (!clean) return { ok: false, reason: 'empty' };
    if (clean.length > MAX_TEXT) return { ok: false, reason: 'too_long' };

    overrides[key] = { text: clean, template: entry.template, updatedAt: Date.now() };
    const saved = await setInDb(OVERRIDES_KEY, overrides);
    return { ok: true, saved };
}

export async function resetMessageEdit(id) {
    const key = String(id).toLowerCase().replace(/^#/, '');
    if (!overrides[key]) return { ok: false, reason: 'not_edited' };

    delete overrides[key];
    await setInDb(OVERRIDES_KEY, overrides);
    return { ok: true };
}

export async function resetAllMessageEdits() {
    const count = Object.keys(overrides).length;
    overrides = {};
    await setInDb(OVERRIDES_KEY, overrides);
    return count;
}

export function messageStats() {
    const entries = Object.values(catalog);
    const byType = {};
    for (const entry of entries) byType[entry.type] = (byType[entry.type] || 0) + 1;
    return { total: entries.length, edited: Object.keys(overrides).length, byType };
}
