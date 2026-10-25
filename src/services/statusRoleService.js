import { ActivityType, ChannelType, escapeMarkdown } from 'discord.js';
import { STATUS_ROLE } from '../config/statusRole.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { logger } from '../utils/logger.js';

const INVITE_PATTERN = /(?:discord\.gg|discord(?:app)?\.com\/invite|\.gg)\/([a-z0-9-]+)/gi;
const INVITE_CACHE_MS = 10 * 60 * 1000;

const inviteCache = new Map(); // guildId -> { codes:Set, fetchedAt }
const busy = new Set();
const warned = new Set();

const normalize = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(message);
}

export function extractInviteCodes(text) {
    return [...String(text ?? '').matchAll(INVITE_PATTERN)].map((match) => match[1].toLowerCase());
}

/** The text of someone's custom status (the "what's on your mind" line). */
export function customStatusText(presence) {
    const custom = presence?.activities?.find((activity) => activity.type === ActivityType.Custom);
    return custom?.state ?? '';
}

async function getServerInviteCodes(guild) {
    const cached = inviteCache.get(guild.id);
    if (cached && Date.now() - cached.fetchedAt < INVITE_CACHE_MS) return cached.codes;

    const codes = new Set(STATUS_ROLE.inviteCodes.map((code) => String(code).toLowerCase()));
    if (guild.vanityURLCode) codes.add(guild.vanityURLCode.toLowerCase());

    try {
        const invites = await guild.invites.fetch();
        for (const invite of invites.values()) codes.add(invite.code.toLowerCase());
    } catch {
        warnOnce(`invites:${guild.id}`, `Status role: I can't read the invites of "${guild.name}". Give me Manage Server, or list your invite code in config/statusRole.js`);
    }

    inviteCache.set(guild.id, { codes, fetchedAt: Date.now() });
    return codes;
}

// Who currently has the server link in their status. A thank-you is sent each time someone
// goes from "no link" to "link", so it repeats if they remove it and put it back later.
const activeCache = new Map(); // guildId -> Set(userId)

async function getActive(guildId) {
    if (activeCache.has(guildId)) return activeCache.get(guildId);

    let saved = await getFromDb(`cache:status_role:active:${guildId}`, null);
    if (!Array.isArray(saved)) {
        // First run of this version: start from the people who were already thanked, so nobody is thanked twice.
        saved = await getFromDb(`cache:status_role:thanked:${guildId}`, []);
    }

    const set = new Set(Array.isArray(saved) ? saved : []);
    activeCache.set(guildId, set);
    return set;
}

async function saveActive(guildId, set) {
    await setInDb(`cache:status_role:active:${guildId}`, [...set]);
}

async function thank(guild, member) {
    const wanted = normalize(STATUS_ROLE.channelName);
    const channel = guild.channels.cache.find(
        (c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) && normalize(c.name) === wanted,
    );
    if (!channel) return;

    const text = STATUS_ROLE.message.replace('{username}', escapeMarkdown(member.user.username));

    // Black-bordered box. parse: [] -> nobody is pinged, whatever the username looks like.
    await channel.send({
        embeds: [{ color: 0x010101, description: text }],
        allowedMentions: { parse: [] },
    })
        .catch((error) => logger.error('Status role: could not send the thank-you message:', error));
}

/** Checks one presence: gives the role and thanks them each time the server link newly appears in their status. */
export async function handlePresence(presence) {
    try {
        if (!STATUS_ROLE.enabled || !presence?.guild) return;

        const guild = presence.guild;
        const userId = presence.userId ?? presence.user?.id;
        if (!userId || busy.has(`${guild.id}:${userId}`)) return;

        busy.add(`${guild.id}:${userId}`);
        try {
            const found = extractInviteCodes(customStatusText(presence));
            let hasLink = false;
            if (found.length) {
                const serverCodes = await getServerInviteCodes(guild);
                hasLink = found.some((code) => serverCodes.has(code));
            }

            const active = await getActive(guild.id);
            const wasActive = active.has(userId);

            if (!hasLink) {
                // Offline presences carry no status text, so only a real online/idle/dnd update can clear it.
                if (wasActive && presence.status && presence.status !== 'offline') {
                    active.delete(userId);
                    await saveActive(guild.id, active);
                }
                return;
            }

            const member = presence.member ?? await guild.members.fetch(userId).catch(() => null);
            if (!member || member.user.bot) return;

            const role = guild.roles.cache.get(STATUS_ROLE.roleId);
            if (!role) return;

            if (!member.roles.cache.has(role.id)) {
                const me = guild.members.me;
                if (!me?.permissions.has('ManageRoles')) {
                    warnOnce(`perm:${guild.id}`, `Status role: I need the Manage Roles permission in "${guild.name}"`);
                    return;
                }
                if (me.roles.highest.position <= role.position) {
                    warnOnce(`pos:${guild.id}`, `Status role: move my bot role above "${role.name}" in "${guild.name}" so I can give it`);
                    return;
                }
                await member.roles.add(role, 'Server link in status');
            }

            if (!wasActive) {
                active.add(userId);
                await saveActive(guild.id, active); // saved first, so a quick second update can't thank twice
                await thank(guild, member);
            }
        } finally {
            busy.delete(`${guild.id}:${userId}`);
        }
    } catch (error) {
        logger.error('Status role error:', error);
    }
}

/** On startup: check everyone whose status is already known. */
export async function syncAllStatusRoles(client) {
    if (!STATUS_ROLE.enabled) return;

    for (const guild of client.guilds.cache.values()) {
        if (!guild.roles.cache.has(STATUS_ROLE.roleId)) continue;
        for (const presence of guild.presences.cache.values()) {
            await handlePresence(presence);
        }
    }
}
