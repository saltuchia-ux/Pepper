import { logger } from '../utils/logger.js';

// ==========================================
// SNIPE STORAGE
// Remembers deleted and edited messages for each channel (in memory only).
// Every saved message is removed automatically after 2 hours.
// ==========================================

export const SNIPE_TTL_MS = 2 * 60 * 60 * 1000;   // 2 hours
const MAX_PER_CHANNEL = 50;                        // how many messages are kept per channel
const CLEANUP_INTERVAL_MS = 1000;                   // checks every second and throws away anything older than 2 hours

const deletedStore = new Map();   // channelId -> [entries]  (oldest first)
const editedStore = new Map();

function save(store, channelId, entry) {
    const list = store.get(channelId) || [];

    list.push(entry);

    if (list.length > MAX_PER_CHANNEL) {
        list.splice(0, list.length - MAX_PER_CHANNEL);
    }

    store.set(channelId, list);
}

function freshEntries(store, channelId) {
    const cutoff = Date.now() - SNIPE_TTL_MS;
    const list = (store.get(channelId) || []).filter((entry) => entry.savedAt >= cutoff);

    if (list.length) {
        store.set(channelId, list);
    } else {
        store.delete(channelId);
    }

    return list;
}

function describeAuthor(message) {
    const author = message.author;

    return {
        authorId: author.id,
        authorName: message.member?.displayName || author.globalName || author.username || 'Unknown',
        avatarURL: author.displayAvatarURL?.({ size: 128 }) || null,
    };
}

function describeAttachments(message) {
    return [...(message.attachments?.values?.() || [])].map((attachment) => ({
        name: attachment.name || 'file',
        url: attachment.url,
        isImage: (attachment.contentType || '').startsWith('image/'),
    }));
}

// Called when a message is deleted
export function recordDeletedMessage(message) {
    try {
        if (!message?.guild || !message.author || message.author.bot) return;

        const attachments = describeAttachments(message);

        // Nothing to show (for example the message was not in the bot's memory)
        if (!message.content && !attachments.length) return;

        save(deletedStore, message.channelId, {
            id: message.id,
            ...describeAuthor(message),
            content: message.content || '',
            attachments,
            createdAt: message.createdTimestamp || Date.now(),
            deletedAt: Date.now(),
            savedAt: Date.now(),
        });
    } catch (error) {
        logger.debug(`Snipe could not save a deleted message: ${error.message}`);
    }
}

// Called when a message is edited
export function recordEditedMessage(oldMessage, newMessage) {
    try {
        if (!newMessage?.guild || !newMessage.author || newMessage.author.bot) return;

        // The old text is only known if the bot had the message in memory
        if (oldMessage?.content === null || oldMessage?.content === undefined) return;
        if (oldMessage.content === newMessage.content) return;

        save(editedStore, newMessage.channelId, {
            id: newMessage.id,
            ...describeAuthor(newMessage),
            before: oldMessage.content || '',
            after: newMessage.content || '',
            url: newMessage.url,
            createdAt: newMessage.createdTimestamp || Date.now(),
            editedAt: Date.now(),
            savedAt: Date.now(),
        });
    } catch (error) {
        logger.debug(`Snipe could not save an edited message: ${error.message}`);
    }
}

// Newest first
export function getDeletedMessages(channelId) {
    return [...freshEntries(deletedStore, channelId)].reverse();
}

export function getEditedMessages(channelId) {
    return [...freshEntries(editedStore, channelId)].reverse();
}

// Clears one channel. Returns how many were removed.
export function clearSnipes(channelId) {
    const deleted = freshEntries(deletedStore, channelId).length;
    const edited = freshEntries(editedStore, channelId).length;

    deletedStore.delete(channelId);
    editedStore.delete(channelId);

    return { deleted, edited };
}

// Throws away everything older than 2 hours (checked every second)
setInterval(() => {
    for (const store of [deletedStore, editedStore]) {
        for (const channelId of [...store.keys()]) {
            freshEntries(store, channelId);
        }
    }
}, CLEANUP_INTERVAL_MS).unref?.();
