import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';

import {
  getLevelingConfig,
  getUserLevelData
} from '../services/leveling/leveling.js';

import { addXp } from '../services/leveling/xpSystem.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { executePrefixCommand } from '../utils/messageAdapter.js';

import {
  getCountingGameConfig,
  saveCountingGameConfig,
  isValidCountingMessage,
  recordCorrectCount,
  refreshCountingRules
} from '../services/countingGameService.js';

const MESSAGE_XP_RATE_LIMIT_ATTEMPTS = 12;
const MESSAGE_XP_RATE_LIMIT_WINDOW_MS = 10000;

export default {
  name: Events.MessageCreate,

  async execute(message, client) {
    try {
      if (message.author.bot || !message.guild) {
        return;
      }

      // ==========================================
      // NUCK COMMAND
      // ==========================================

      if (
        message.content.trim().toLowerCase() === '.nuck'
      ) {
        if (
          !message.member.permissions.has(
            'Administrator'
          )
        ) {
          return;
        }

        if (
          !message.guild.members.me.permissions.has(
            'ManageMessages'
          )
        ) {
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

            if (messages.size === 0) {
              break;
            }

            const recent = messages.filter(
              msg =>
                Date.now() -
                  msg.createdTimestamp <
                14 * 24 * 60 * 60 * 1000
            );

            if (recent.size === 0) {
              break;
            }

            const deleted =
              await message.channel.bulkDelete(
                recent,
                true
              );

            totalDeleted += deleted.size;

            if (deleted.size < 100) {
              break;
            }
          }

          await message.channel.send(
            `🧹 Deleted **${totalDeleted}** messages.`
          );
        } catch (error) {
          console.error(
            'NUCK ERROR:',
            error
          );

          await message.channel.send(
            '❌ I could not delete the messages.'
          );
        }

        return;
      }

      logger.debug(
        `Message received from ${message.author.tag}: ${message.content}`
      );

      // ==========================================
      // PREFIX COMMANDS
      // ==========================================

      await handlePrefixCommand(
        message,
        client
      );

      // ==========================================
      // COUNTING GAME
      // ==========================================

      const countingProcessed =
        await handleCountingGame(
          message,
          client
        );

      if (countingProcessed) {
        return;
      }

      // ==========================================
      // XP / LEVELING
      // ==========================================

      await handleLeveling(
        message,
        client
      );

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

async function handlePrefixCommand(
  message,
  client
) {
  try {
    const prefix = '.';

    if (
      !message.content.startsWith(prefix)
    ) {
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
      client.commands.get(
        commandName
      );

    if (!command) {
      return;
    }

    console.log(
      `PREFIX COMMAND FOUND: ${commandName}`
    );

    await executePrefixCommand(
      command,
      message,
      parts,
      client,
      prefix,
      {
        prefix: '.'
      }
    );

  } catch (error) {
    console.error(
      'PREFIX COMMAND ERROR:',
      error
    );
  }
}


// ==========================================
// COUNTING GAME
// ==========================================

async function handleCountingGame(
  message,
  client
) {
  try {
    const config =
      await getCountingGameConfig(
        client,
        message.guild.id
      );

    if (
      !config?.enabled ||
      !config.channelId
    ) {
      return false;
    }

    if (
      message.channel.id !==
      config.channelId
    ) {
      return false;
    }

    const content =
      message.content.trim();

    // Allow prefix commands
    if (content.startsWith('.')) {
      return false;
    }

    // Ignore non-number messages
    if (
      !isValidCountingMessage(content)
    ) {
      return true;
    }

    const number =
      Number(content);

    const expected =
      config.nextNumber || 1;

    // ==========================================
    // SAME PERSON TWICE
    // ==========================================

    if (
      config.lastUserId ===
      message.author.id
    ) {
      const resetConfig = {
        ...config,
        nextNumber: 1,
        lastUserId: null
      };

      await saveCountingGameConfig(
        client,
        message.guild.id,
        resetConfig
      );

      await message
        .react('❌')
        .catch(() => {});

      await message.channel.send({
        embeds: [
          {
            color: 0xED4245,

            description:
              `💥 **You can't count two numbers in a row!**\n` +
              `The next number is **1**.`
          }
        ]
      }).catch(() => {});

      await refreshCountingRules(
        message.channel,
        resetConfig
      );

      return true;
    }

    // ==========================================
    // WRONG NUMBER
    // ==========================================

    if (
      number !== expected
    ) {
      const resetConfig = {
        ...config,
        nextNumber: 1,
        lastUserId: null
      };

      await saveCountingGameConfig(
        client,
        message.guild.id,
        resetConfig
      );

      await message
        .react('❌')
        .catch(() => {});

      await message.channel.send({
        embeds: [
          {
            color: 0xED4245,

            title: '💥 Wrong! Chain Broken',

            description:
              `The next number was **${expected}**.`
          }
        ]
      }).catch(() => {});

      await refreshCountingRules(
        message.channel,
        resetConfig
      );

      return true;
    }

    // ==========================================
    // CORRECT NUMBER
    // ==========================================

    const updatedConfig =
      await recordCorrectCount(
        client,
        message.guild.id,
        message.author.id,
        number
      );

    await message
      .react('✅')
      .catch(() => {});

    await refreshCountingRules(
      message.channel,
      updatedConfig
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

async function handleLeveling(
  message,
  client
) {
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

    if (
      !levelingConfig?.enabled
    ) {
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
          .fetch(
            message.author.id
          )
          .catch(() => null);

      if (
        member &&
        member.roles.cache.some(
          role =>
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

    await addXp(
      client,
      message.guild.id,
      message.author.id,
      message
    );

  } catch (error) {
    logger.error(
      'Error handling leveling:',
      error
    );
  }
}
