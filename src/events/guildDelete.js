import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { lockGuild } from '../services/accessKeyService.js';

export default {
  name: Events.GuildDelete,
  async execute(guild, client) {
    // A server outage is not a removal
    if (guild?.available === false) return;

    try {
      // Pepper was removed: the next time it is added, it asks for the key again.
      await lockGuild(client, guild.id);
      logger.info('Bot left guild, access key reset', { event: 'guild.delete', guildId: guild.id });
    } catch (error) {
      logger.error(`Error resetting access key for guild ${guild?.id}:`, error);
    }
  },
};
