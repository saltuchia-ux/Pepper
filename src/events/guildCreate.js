import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig, setGuildConfig } from '../services/config/guildConfig.js';
import { isGuildUnlocked, sendKeyPrompt } from '../services/accessKeyService.js';

export default {
  name: Events.GuildCreate,
  async execute(guild, client) {
    try {
      logger.info('Bot joined guild', {
        event: 'guild.create',
        guildId: guild.id,
        guildName: guild.name,
        memberCount: guild.memberCount,
      });

      const config = await getGuildConfig(client, guild.id);
      await setGuildConfig(client, guild.id, config);

      // New servers start locked: ask for the key
      if (!(await isGuildUnlocked(client, guild.id))) {
        await sendKeyPrompt(client, guild);
      }
    } catch (error) {
      logger.error(`Error initializing guild ${guild?.id} on join:`, error);
    }
  },
};
