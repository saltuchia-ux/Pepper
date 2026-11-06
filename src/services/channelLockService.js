import { ChannelType, PermissionFlagsBits } from 'discord.js';
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

// Sets the permissions, then removes the overwrite again if it became empty
async function applyPermissions(channel, target, patch, reason) {
    await channel.permissionOverwrites.edit(target, patch, { reason });

    const id = typeof target === 'string' ? target : target.id;
    const overwrite = channel.permissionOverwrites.cache.get(id);

    if (overwrite && overwrite.allow.bitfield === 0n && overwrite.deny.bitfield === 0n) {
        await overwrite.delete(reason).catch(() => {});
    }
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
    const alreadyLocked = saved && everyoneNow.SendMessages === false;

    const before = {
        everyone: alreadyLocked ? saved.before.everyone : everyoneNow,
        roles: alreadyLocked ? saved.before.roles : {},
        bot: alreadyLocked ? saved.before.bot : snapshot(channel, botId, ALLOWED_FOR_STAFF),
    };

    // Every role that has the Ban Members permission can still type
    const staffRoles = channel.guild.roles.cache.filter(
        (role) => role.id !== everyoneId && role.permissions.has(PermissionFlagsBits.BanMembers),
    );

    if (!alreadyLocked) {
        for (const role of staffRoles.values()) {
            before.roles[role.id] = snapshot(channel, role.id, ALLOWED_FOR_STAFF);
        }
    }

    // Save first, so .unlock can always undo it
    await setInDb(keyFor(channel.id), { before });

    const allow = Object.fromEntries(ALLOWED_FOR_STAFF.map((name) => [name, true]));
    const deny = Object.fromEntries(LOCKED_FOR_EVERYONE.map((name) => [name, false]));

    for (const role of staffRoles.values()) {
        await applyPermissions(channel, role, allow, reason);
    }

    await applyPermissions(channel, botId, allow, reason);
    await applyPermissions(channel, everyoneId, deny, reason);
}

async function unlockChannel(channel, moderator) {
    const everyoneId = channel.guild.roles.everyone.id;
    const botId = channel.client.user.id;
    const reason = `Channel unlocked by ${moderator.tag ?? moderator.username}`;

    const saved = await getFromDb(keyFor(channel.id), null).catch(() => null);

    if (saved?.before) {
        // Put everybody back the way they were
        await applyPermissions(channel, everyoneId, saved.before.everyone, reason);

        for (const [roleId, state] of Object.entries(saved.before.roles || {})) {
            if (channel.guild.roles.cache.has(roleId)) {
                await applyPermissions(channel, roleId, state, reason);
            }
        }

        await applyPermissions(channel, botId, saved.before.bot, reason);

        await deleteFromDb(keyFor(channel.id)).catch(() => {});
        return;
    }

    // The bot did not lock this channel (no saved state): just give typing back to everyone
    const open = Object.fromEntries(LOCKED_FOR_EVERYONE.map((name) => [name, null]));

    await applyPermissions(channel, everyoneId, open, reason);
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
