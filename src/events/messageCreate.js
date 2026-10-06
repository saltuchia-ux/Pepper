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

// ==========================================
// MESSAGE CREATE
// ==========================================

export default {
    name: Events.MessageCreate,

    async execute(message, client) {
        try {
            // Ignore bots and DMs
            if (message.author.bot || !message.guild) return;

            logger.debug(
                `Message received from ${message.author.tag}: ${message.content}`
            );

            // ==========================================
            // NUCK COMMAND
            // ==========================================

            if (message.content.trim().toLowerCase() === '.nuck') {
                if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                    return;
                }

                const botMember =
                    message.guild.members.me ||
                    await message.guild.members.fetchMe().catch(() => null);

                if (!botMember?.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return message.reply(
                        '❌ I need Manage Messages permission.'
                    );
                }

                try {
                    let totalDeleted = 0;

                    while (true) {
                        const messages =
                            await message.channel.messages.fetch({
                                limit: 100
                            });

                        if (messages.size === 0) break;

                        const recent = messages.filter(
                            msg =>
                                Date.now() - msg.createdTimestamp <
                                14 * 24 * 60 * 60 * 1000
                        );

                        if (recent.size === 0) break;

                        const deleted =
                            await message.channel.bulkDelete(
                                recent,
                                true
                            );

                        totalDeleted += deleted.size;

                        if (deleted.size < 100) break;
                    }

                    await message.channel.send(
                        `🧹 Deleted **${totalDeleted}** messages.`
                    );
                } catch (error) {
                    console.error('NUCK ERROR:', error);

                    await message.channel.send(
                        '❌ I could not delete the messages.'
                    );
                }

                return;
            }

            // ==========================================
            // COUNTING GAME
            // ==========================================

            const countingProcessed =
                await handleCountingGame(message, client);

            if (countingProcessed) {
                return;
            }

            // ==========================================
            // OLD PREFIX COMMAND SYSTEM
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
        const guildConfig =
            await getGuildConfig(
                client,
                message.guild.id
            );

        const prefix =
            guildConfig?.prefix ||
            getCommandPrefix();

        if (!message.content.startsWith(prefix)) {
            return;
        }

        const parts =
            message.content
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

        // Keep the old command system working
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
        // LEVEL 10 ROLE → MEDIA ROLE
        // ==========================================

        await checkLevel10MediaRole(message);

    } catch (error) {
        logger.error(
            'Error handling leveling for message:',
            error
        );
    }
}

// ==========================================
// AUTOMATIC LEVEL 10 → MEDIA ROLE
// ==========================================

async function checkLevel10MediaRole(message) {
    try {
        const guild = message.guild;
        const member = message.member;

        if (!guild || !member) {
            return;
        }

        // Make sure we have the newest member roles
        const freshMember =
            await guild.members
                .fetch(member.id)
                .catch(() => null);

        if (!freshMember) {
            return;
        }

        // ==========================================
        // CHECK FOR LEVEL 10 ROLE
        // ==========================================

        const hasLevel10Role =
            freshMember.roles.cache.has(
                LEVEL_10_ROLE_ID
            );

        if (!hasLevel10Role) {
            return;
        }

        // ==========================================
        // GET MEDIA ROLE
        // ==========================================

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

        // ==========================================
        // GET BOT MEMBER
        // ==========================================

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

        // ==========================================
        // CHECK MANAGE ROLES
        // ==========================================

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

        // ==========================================
        // CHECK MANAGED ROLE
        // ==========================================

        if (mediaRole.managed) {
            logger.error(
                `MEDIA ROLE ERROR: ${mediaRole.name} is a managed role.`
            );

            return;
        }

        // ==========================================
        // CHECK ROLE HIERARCHY
        // ==========================================

        if (
            botMember.roles.highest.position <=
            mediaRole.position
        ) {
            logger.error(
                `MEDIA ROLE ERROR: Bot role is not above ${mediaRole.name}.`
            );

            return;
        }

        // ==========================================
        // ALREADY HAS MEDIA ROLE
        // ==========================================

        if (
            freshMember.roles.cache.has(
                MEDIA_ROLE_ID
            )
        ) {
            return;
        }

        // ==========================================
        // GIVE MEDIA ROLE
        // ==========================================

        await freshMember.roles.add(
            mediaRole,
            'Automatically awarded for having the Level 10 role'
        );

        logger.info(
            `🎬 MEDIA ROLE: ${freshMember.user.tag} received the Media role because they have the Level 10 role in ${guild.name}`
        );

    } catch (error) {
        logger.error(
            `MEDIA ROLE ERROR for ${message.author.tag}:`,
            error
        );
    }
}
