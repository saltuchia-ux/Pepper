import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getJailConfig, jailChannelIds, lockChannelForJail } from '../services/jailService.js';

// When a new channel is made, the Jailed role is stopped from seeing it
export default {
    name: Events.ChannelCreate,
    once: false,

    async execute(channel) {
        try {
            if (!channel?.guild || channel.isThread?.()) return;

            const config = await getJailConfig(channel.guild.id);

            if (!config?.roleId) return;

            // the jail category and everything inside it (tickets) is handled by the jail system itself
            if (jailChannelIds(config).includes(channel.id) || channel.parentId === config.categoryId) return;

            const role = channel.guild.roles.cache.get(config.roleId);

            if (!role) return;

            await lockChannelForJail(channel, role, 'New channel: hidden from the Jailed role');
        } catch (error) {
            logger.debug(`Could not hide the new channel from the Jailed role: ${error.message}`);
        }
    },
};
