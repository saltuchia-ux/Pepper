import { Events, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
    getLevelingConfig,
    getUserLevelData
} from '../services/leveling/leveling.js';
import { addXp } from '../services/leveling/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { executePrefixCommand } from '../utils/messageAdapter.js';
import { getGuildConfig } from '../services/config/guildConfig.js';
import { getCommandPrefix } from '../config/bot.js';

import {
    getCountingGameConfig,
    saveCountingGameConfig,
    isValidCountingMessage,
    recordCorrectCount,
} from '../services/countingGameService.js';

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

// ==========================================
// AUTOMATIC ROLE SETTINGS
// ==========================================

const LEVEL_10_ROLE_ID = '1555604759287832677';
const MEDIA_ROLE_ID = '1556313427079729182';

export default {
    name: Events.MessageCreate,

    async execute(message, client) {
        try {
            if (message.author.bot || !message.guild) return;

            logger.debug(
                `Message received from ${message.author.tag}: ${message.content}`
            );

            // ==========================================
            // COUNTING GAME
            // ==========================================

            const countingProcessed = await handleCountingGame(
                message,
                client
            );

            if (countingProcessed) {
                return;
            }

            // ==========================================
            // PREFIX COMMANDS
            // ==========================================

            await handlePrefixCommand(message, client);

            // ==========================================
            // LEVELING
            // ==========================================

            await handleLeveling(message, client);

        } catch (error) {
            logger.error(
                'Error in messageCreate event:',
                error
            );
        }
    }
};

// ==========================================
// PREFIX COMMAND HANDLER
// ==========================================

async function handlePrefixCommand(message, client) {
    try {
        const guildConfig = await getGuildConfig(
            client,
            message.guild.id
        );

        const prefix =
            guildConfig?.prefix ||
            getCommandPrefix();

        if (!message.content.startsWith(prefix)) {
            return;
        }

        const parts = message.content
            .slice(prefix.length)
            .trim()
            .split(/\s+/);

        const commandName =
            parts.shift()?.toLowerCase();

        if (!commandName) {
            return;
        }

        const command =
            client.commands.get(commandName);

        if (!command) {
            return;
        }

        await executePrefixCommand(
            command,
            message,
            parts,
            client,
            prefix,
            guildConfig
        );

    } catch (error) {
        logger.error(
            'PREFIX COMMAND ERROR:',
            error
        );
    }
}

// ==========================================
// COUNTING GAME
// ==========================================

async function handleCountingGame(message, client) {
    try {
        const config =
            await getCountingGameConfig(
                client,
                message.guild.id
            );

        if (
            !config?.enabled ||
            !config.channelId ||
            message.channel.id !== config.channelId
        ) {
            return false;
        }

        const content =
            message.content.trim();

        const validCount =
            isValidCountingMessage(
                content,
                config
            );

        const invalidAttempt =
            !validCount ||
            message.author.id === config.lastUserId;

        if (invalidAttempt) {
            await message.delete().catch(() => {});

            await saveCountingGameConfig(
                client,
                message.guild.id,
                {
                    ...config,
                    nextNumber: 1,
                    lastUserId: null,
                    currentStreak: 0,
                }
            );

            const failureMessage =
                await message.channel.send(
                    `❌ Count broken by <@${message.author.id}>. The sequence has been reset to **1**.`
                );

            setTimeout(() => {
                failureMessage
                    .delete()
                    .catch(() => {});
            }, 10000);

            return true;
        }

        await recordCorrectCount(
            client,
            message.guild.id,
            message.author.id
        );

        return true;

    } catch (error) {
        logger.error(
            'Error handling counting game:',
            error
        );

        return false;
    }
}

// ==========================================
// LEVELING
// ==========================================

async function handleLeveling(message, client) {
    try {
        const rateLimitKey =
            `xp-event:${message.guild.id}:${message.author.id}`;

        const canProcess =
            await checkRateLimit(
                rateLimitKey,
                MESSAGE_XP_RATE_LIMIT_ATTEMPTS,
                MESSAGE_XP_RATE_LIMIT_WINDOW_MS
            );

        if (!canProcess) {
            return;
        }

        const levelingConfig =
            await getLevelingConfig(
                client,
                message.guild.id
            );

        if (!levelingConfig?.enabled) {
            return;
        }

        if (
            levelingConfig.ignoredChannels?.includes(
                message.channel.id
            )
        ) {
            return;
        }

        if (
            levelingConfig.ignoredRoles?.length > 0
        ) {
            const member =
                await message.guild.members
                    .fetch(message.author.id)
                    .catch(() => null);

            if (
                member &&
                member.roles.cache.some(role =>
                    levelingConfig.ignoredRoles.includes(
                        role.id
                    )
                )
            ) {
                return;
            }
        }

        if (
            levelingConfig.blacklistedUsers?.includes(
                message.author.id
            )
        ) {
            return;
        }

        if (
            !message.content ||
            message.content.trim().length === 0
        ) {
            return;
        }

        const userData =
            await getUserLevelData(
                client,
                message.guild.id,
                message.author.id
            );

        const cooldownTime =
            levelingConfig.xpCooldown || 60;

        const now = Date.now();

        const timeSinceLastMessage =
            now -
            (userData.lastMessage || 0);

        if (
            timeSinceLastMessage <
            cooldownTime * 1000
        ) {
            return;
        }

        const minXP =
            levelingConfig.xpRange?.min ||
            levelingConfig.xpPerMessage?.min ||
            15;

        const maxXP =
            levelingConfig.xpRange?.max ||
            levelingConfig.xpPerMessage?.max ||
            25;

        const safeMinXP =
            Math.max(1, minXP);

        const safeMaxXP =
            Math.max(
                safeMinXP,
                maxXP
            );

        const xpToGive =
            Math.floor(
                Math.random() *
                (
                    safeMaxXP -
                    safeMinXP +
                    1
                )
            ) +
            safeMinXP;

        let finalXP = xpToGive;

        if (
            levelingConfig.xpMultiplier &&
            levelingConfig.xpMultiplier > 1
        ) {
            finalXP =
                Math.floor(
                    finalXP *
                    levelingConfig.xpMultiplier
                );
        }

        // ==========================================
        // GIVE XP
        // ==========================================

        const result =
            await addXp(
                client,
                message.guild,
                message.member,
                finalXP
            );

        // ==========================================
        // LEVEL UP LOG
        // ==========================================

        if (result?.leveledUp) {
            logger.info(
                `${message.author.tag} leveled up to level ${result.level} in ${message.guild.name}`
            );
        }

        // ==========================================
        // AUTOMATIC LEVEL 10 → MEDIA ROLE
        // ==========================================

        if (result?.level >= 10) {
            await giveMediaRole(
                message,
                result.level
            );
        }

    } catch (error) {
        logger.error(
            'Error handling leveling for message:',
            error
        );
    }
}

// ==========================================
// AUTOMATIC MEDIA ROLE
// ==========================================

async function giveMediaRole(message, level) {
    try {
        const guild = message.guild;
        const member = message.member;

        if (!guild || !member) {
            return;
        }

        // Get Media role
        const mediaRole =
            guild.roles.cache.get(
                MEDIA_ROLE_ID
            ) ||
            await guild.roles
                .fetch(MEDIA_ROLE_ID)
                .catch(() => null);

        if (!mediaRole) {
            logger.error(
                `MEDIA ROLE ERROR: Role ${MEDIA_ROLE_ID} was not found in ${guild.name}`
            );

            return;
        }

        // Get bot member
        const botMember =
            guild.members.me ||
            await guild.members
                .fetchMe()
                .catch(() => null);

        if (!botMember) {
            logger.error(
                'MEDIA ROLE ERROR: Could not find bot member.'
            );

            return;
        }

        // Check Manage Roles
        if (
            !botMember.permissions.has(
                PermissionFlagsBits.ManageRoles
            )
        ) {
            logger.error(
                'MEDIA ROLE ERROR: Bot does not have Manage Roles permission.'
            );

            return;
        }

        // Managed roles cannot be assigned
        if (mediaRole.managed) {
            logger.error(
                `MEDIA ROLE ERROR: ${mediaRole.name} is a managed role.`
            );

            return;
        }

        // Bot role must be above Media role
        if (
            botMember.roles.highest.position <=
            mediaRole.position
        ) {
            logger.error(
                `MEDIA ROLE ERROR: Bot role is not above ${mediaRole.name}.`
            );

            return;
        }

        // Already has Media role
        if (
            member.roles.cache.has(
                MEDIA_ROLE_ID
            )
        ) {
            return;
        }

        // Give Media role
        await member.roles.add(
            mediaRole,
            `Automatically awarded for reaching Level ${level}`
        );

        logger.info(
            `🎬 MEDIA ROLE: ${member.user.tag} received the Media role for reaching Level ${level} in ${guild.name}`
        );

    } catch (error) {
        logger.error(
            `MEDIA ROLE ERROR for ${message.author.tag}:`,
            error
        );
    }
}
