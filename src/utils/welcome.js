// welcome.js

import { logger } from './logger.js';

// Used when the server never wrote its own welcome message.
export const RICH_WELCOME_TITLE = '🌙 Welcome to {server}';
export const RICH_WELCOME_TEMPLATE = [
    '{user}, we hope you have a good time here! 💜',
    '🚀 Boost the server for a **custom role** and **server perks** 💎',
    '📜 Read the rules in {rules}',
].join('\n');

// Near-black (pure 0 would show no colored bar at all in Discord).
export const RICH_WELCOME_COLOR = 0x010101;

const STOCK_MESSAGES = new Set([
    'welcome {user} to {server}!',
    'welcome {user} to {server}',
]);

/** True when the message is empty or just the bot's built-in default (so we can use the nicer one). */
export function isStockWelcomeMessage(message) {
    const text = String(message ?? '').trim().toLowerCase();
    return !text || STOCK_MESSAGES.has(text);
}

/** Finds the rules channel: Discord's rules channel, else a channel named "rules". */
export function findRulesChannelMention(guild) {
    if (!guild) return 'the rules channel';

    const rules = guild.rulesChannel
        ?? guild.channels?.cache?.find((c) => c.isTextBased?.() && /^rules?$/i.test(c.name.replace(/[^a-z]/gi, '')))
        ?? guild.channels?.cache?.find((c) => c.isTextBased?.() && /rules/i.test(c.name));

    return rules ? `<#${rules.id}>` : 'the rules channel';
}

const DEFAULT_TEMPLATES = {
    welcome: 'Welcome {user} to {server}!',
    goodbye: '{user.tag} has left the server.'
};

function replaceAll(message, token, value) {
    if (value === undefined || value === null) {
        return message;
    }
    return message.split(token).join(String(value));
}

export function truncateForEmbedField(value, maxLength = 1024) {
    const text = String(value ?? '').trim();
    if (!text) {
        return '—';
    }
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function formatWelcomeMessage(message, data) {
    
    if (typeof message !== 'string') return '';
    if (!message) return '';
    if (!data || typeof data !== 'object') return message;

    const user = data?.user;
    const guild = data?.guild;
    const joinedAt = data?.member?.joinedTimestamp ?? Date.now();
    const joinedTs = Math.floor(joinedAt / 1000);

    if (!user || typeof user !== 'object') {
        logger.warn('Invalid user object passed to formatWelcomeMessage');
    }
    if (!guild || typeof guild !== 'object') {
        logger.warn('Invalid guild object passed to formatWelcomeMessage');
    }

    const tokens = {
        '{user}': user?.toString?.() || 'User',
        '{user.mention}': user?.toString?.() || 'User',
        '{user.tag}': user?.tag || 'Unknown#0000',
        '{user.username}': user?.username || 'Unknown',
        '{username}': user?.username || 'Unknown',
        '{user.discriminator}': user?.discriminator || '0000',
        '{user.id}': user?.id || 'unknown',
        '{server}': guild?.name || 'Server',
        '{server.name}': guild?.name || 'Server',
        '{guild.name}': guild?.name || 'Server',
        '{guild.id}': guild?.id || 'unknown',
        '{guild.memberCount}': guild?.memberCount?.toString?.() || '0',
        '{memberCount}': guild?.memberCount?.toString?.() || '0',
        '{membercount}': guild?.memberCount?.toString?.() || '0',
        '{position}': guild?.memberCount?.toString?.() || '0',
        '{joined}': `<t:${joinedTs}:D>`,
        '{joined.time}': `<t:${joinedTs}:f>`,
        '{joined.relative}': `<t:${joinedTs}:R>`,
        '{rules}': findRulesChannelMention(guild),
    };

    let result = message;
    for (const [token, value] of Object.entries(tokens)) {
        if (value === undefined || value === null) continue;
        result = replaceAll(result, token, String(value));
    }

    return result;
}

export function getDefaultWelcomeMessage() {
    return DEFAULT_TEMPLATES.welcome;
}

export function getDefaultGoodbyeMessage() {
    return DEFAULT_TEMPLATES.goodbye;
}