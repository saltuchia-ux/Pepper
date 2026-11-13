import { Events } from 'discord.js';
import { setupAllChannelRules } from '../services/channelRulesService.js';
import { logger } from '../utils/logger.js';

// When the bot starts, post the rules box in the channels from src/config/channelRules.js
export default {
    name: Events.ClientReady,
    once: true,

    async execute(client) {
        setupAllChannelRules(client).catch((error) => logger.error('Channel rules setup failed:', error));
    },
};
