import { PermissionFlagsBits } from 'discord.js';
import { getFromDb, setInDb, deleteFromDb } from './database.js';
import { logger } from './logger.js';
import { TitanBotError, ErrorTypes } from './errorHandler.js';

export const MAX_NICK_LENGTH = 32;

const forcedNickKey = (guildId, userId) => `guild:${guildId}:forcednick:${userId}`;

export const getForcedNick = (guildId, userId) =>
    getFromDb(forcedNickKey(guildId, userId), null);

export const setForcedNick = (guildId, userId, nick, setBy) =>
    setInDb(forcedNickKey(guildId, userId), { nick, setBy, at: Date.now() });

export const clearForcedNick = (guildId, userId) =>
    deleteFromDb(forcedNickKey(guildId, userId));

// Removes wrapping quotes: "John Smith" -> John Smith
export function cleanNickText(text) {
    return String(text || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
}

// Re-applies the forced nickname if the member's nickname is different
export async function enforceForcedNick(member) {
    try {
        const data = await getForcedNick(member.guild.id, member.id);

        if (!data?.nick) return;
        if (member.nickname === data.nick) return;
        if (!member.manageable) return;

        await member.setNickname(data.nick, 'Forced nickname (.fn)');
    } catch (error) {
        logger.error(`Failed to enforce forced nickname for ${member.id}:`, error);
    }
}

// Shared permission checks for .nick and .fn
export function assertCanChangeNick(interaction, member) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
        throw new TitanBotError(
            'Missing Manage Nicknames permission',
            ErrorTypes.PERMISSION,
            'You need the **Manage Nicknames** permission to use this command.',
        );
    }

    if (!member) {
        throw new TitanBotError(
            'Target not found',
            ErrorTypes.USER_INPUT,
            'That user is not in this server.',
            { subtype: 'user_not_found' },
        );
    }

    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const isSelf = member.id === interaction.user.id;

    if (
        !isOwner &&
        !isSelf &&
        member.roles.highest.position >= interaction.member.roles.highest.position
    ) {
        throw new TitanBotError(
            'Hierarchy',
            ErrorTypes.PERMISSION,
            'You cannot change the nickname of someone with an equal or higher role than you.',
        );
    }

    if (!member.manageable) {
        throw new TitanBotError(
            'Not manageable',
            ErrorTypes.PERMISSION,
            "I cannot change that user's nickname (they are the server owner or have a higher role than me).",
        );
    }
}
