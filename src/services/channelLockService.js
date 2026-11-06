import { ChannelType, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { getFromDb, setInDb, deleteFromDb } from '../utils/database.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { plainReply, missingPermission } from '../utils/punishmentTools.js';
import { logger } from '../utils/logger.js';

// ==========================================
// .lock / .unlock
//
// .lock    -> nobody can type in the channel, EXCEPT people who have the Ban Members permission
//             (and the bot). The bot reacts to your message with 🔒
// .unlock  -> puts everything back the way it was. The bot reacts with 🔓
//
// Only people with the Ban Members permission can use these commands.
// What the channel looked like before the lock is saved in the database,
// so .unlock puts it back exactly (even after the bot restarted).
// ==========================================

// What "locked" takes away from everyone
const LOCKED_FOR_EVERYONE = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'];

// What the staff roles and the bot are given, so they can still type
const ALLOWED_FOR_STAFF = ['SendMessages', 'SendMessagesInThreads'];

const keyFor = (channelId) => `channel_lock_${channelId}`;

// true = allowed, false = denied, null = not set
function stateOf(overwrite, permissionName) {
    const flag = PermissionFlagsBits[permissionName];

    if (overwrite?.allow.has(flag)) return true;
    if (overwrite?.deny.has(flag)) return false;

    return null;
}

function snapshot(channel, targetId, names) {
    const overwrite = channel.permissionOverwrites.cache.get(targetId);

    return Object.fromEntries(names.map((name) => [name, stateOf(overwrite, name)]));
}

// Builds the NEW full list of permission overwrites for the channel.
// "changes" is a Map:  id -> { SendMessages: true | false | null, ... }   (null = not set)
// Everything is sent to Discord in ONE request, which is much faster than changing one by one.
function buildOverwrites(channel, changes) {
    const result = new Map();

    for (const overwrite of channel.permissionOverwrites.cache.values()) {
        result.set(overwrite.id, {
            id: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow.bitfield,
            deny: overwrite.deny.bitfield,
        });
    }

    for (const [id, patch] of changes) {
        const entry = result.get(id) ?? {
            id,
            type: channel.guild.roles.cache.has(id) ? OverwriteType.Role : OverwriteType.Member,
            allow: 0n,
            deny: 0n,
        };

        for (const [name, value] of Object.entries(patch)) {
            const flag = PermissionFlagsBits[name];

            entry.allow &= ~flag;
            entry.deny &= ~flag;

            if (value === true) entry.allow |= flag;
            if (value === false) entry.deny |= flag;
        }

        result.set(id, entry);
    }

    // empty overwrites are not needed
    return [...result.values()].filter((entry) => entry.allow !== 0n || entry.deny !== 0n);
}

function isTextChannel(channel) {
    return channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement;
}

// The bot needs these permissions to change a channel
function botCanChange(channel) {
    const me = channel.guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;

    return Boolean(
        perms?.has(PermissionFlagsBits.ViewChannel) &&
        perms.has(PermissionFlagsBits.ManageChannels) &&
        perms.has(PermissionFlagsBits.ManageRoles),
    );
}

async function lockChannel(channel, moderator) {
    const everyoneId = channel.guild.roles.everyone.id;
    const botId = channel.client.user.id;
    const reason = `Channel locked by ${moderator.tag ?? moderator.username}`;

    const saved = await getFromDb(keyFor(channel.id), null).catch(() => null);

    // Already locked by the bot: keep the ORIGINAL "before" state, so unlock goes back to it
    const everyoneNow = snapshot(channel, everyoneId, LOCKED_FOR_EVERYONE);
    const alreadyLocked = Boolean(saved?.before) && everyoneNow.SendMessages === false;

    // Every role that has the Ban Members permission can still type
    const staffRoles = channel.guild.roles.cache.filter(
        (role) => role.id !== everyoneId && role.permissions.has(PermissionFlagsBits.BanMembers),
    );

    const before = alreadyLocked
        ? saved.before
        : {
            everyone: everyoneNow,
            roles: Object.fromEntries(
                [...staffRoles.keys()].map((id) => [id, snapshot(channel, id, ALLOWED_FOR_STAFF)]),
            ),
            bot: snapshot(channel, botId, ALLOWED_FOR_STAFF),
        };

    const allow = Object.fromEntries(ALLOWED_FOR_STAFF.map((name) => [name, true]));
    const deny = Object.fromEntries(LOCKED_FOR_EVERYONE.map((name) => [name, false]));

    const changes = new Map();
    for (const id of staffRoles.keys()) changes.set(id, allow);
    changes.set(botId, allow);
    changes.set(everyoneId, deny);

    // ONE request to Discord, and the "before" state is saved at the same time
    await Promise.all([
        channel.permissionOverwrites.set(buildOverwrites(channel, changes), reason),
        alreadyLocked ? Promise.resolve() : setInDb(keyFor(channel.id), { before }),
    ]);
}

async function unlockChannel(channel, moderator) {
    const everyoneId = channel.guild.roles.everyone.id;
    const botId = channel.client.user.id;
    const reason = `Channel unlocked by ${moderator.tag ?? moderator.username}`;

    const saved = await getFromDb(keyFor(channel.id), null).catch(() => null);

    const changes = new Map();

    if (saved?.before) {
        // Put everybody back the way they were
        changes.set(everyoneId, saved.before.everyone);

        for (const [roleId, state] of Object.entries(saved.before.roles || {})) {
            if (channel.guild.roles.cache.has(roleId)) changes.set(roleId, state);
        }

        changes.set(botId, saved.before.bot);
    } else {
        // The bot did not lock this channel (no saved state): just give typing back to everyone
        changes.set(everyoneId, Object.fromEntries(LOCKED_FOR_EVERYONE.map((name) => [name, null])));
    }

    await channel.permissionOverwrites.set(buildOverwrites(channel, changes), reason);

    if (saved?.before) await deleteFromDb(keyFor(channel.id)).catch(() => {});
}

// Shared by .lock and .unlock  (lock = true / false)
export async function handleLockCommand(interaction, lock) {
    const channel = interaction.channel;

    // Only people with the Ban Members permission
    if (!interaction.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw missingPermission('ban_members');
    }

    if (!isTextChannel(channel)) {
        return plainReply(interaction, '⚠️ You can only lock normal text channels');
    }

    if (!botCanChange(channel)) {
        return plainReply(interaction, '⚠️ I need the **Manage Channels** and **Manage Roles** permissions here');
    }

    try {
        if (lock) {
            await lockChannel(channel, interaction.user);
        } else {
            await unlockChannel(channel, interaction.user);
        }
    } catch (error) {
        logger.error(`Could not ${lock ? 'lock' : 'unlock'} channel ${channel.id}:`, error);

        return plainReply(
            interaction,
            `⚠️ I could not ${lock ? 'lock' : 'unlock'} this channel. Make sure my role is above the roles I need to change.`,
        );
    }

    const emoji = lock ? '🔒' : '🔓';

    // .lock / .unlock: react to the message that was typed
    const message = interaction._responseCoordinator?.message ?? interaction.message ?? null;

    if (interaction._isPrefixCommand && message?.react) {
        try {
            await message.react(emoji);
            return;
        } catch {
            // no permission to react: say it with a message instead
        }
    }

    return InteractionHelper.universalReply(interaction, {
        content: `${emoji} Channel ${lock ? 'locked' : 'unlocked'}`,
        allowedMentions: { parse: [] },
    });
}
