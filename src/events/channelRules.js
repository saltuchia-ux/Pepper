import { Events } from 'discord.js';
import { refreshChannelRules, findRulesFor, isRulesBox } from '../services/channelRulesService.js';
import { getCountingGameConfig, refreshCountingRules } from '../services/countingGameService.js';
import { getMeowConfig, refreshMeowRules, isMeowRulesBox } from '../services/meowCountingService.js';
import { logger } from '../utils/logger.js';

// Keeps the rules box at the bottom of the channels in src/config/channelRules.js,
// and in the counting channel after messages from bots (people's messages are handled in messageCreate.js).
// Every single message counts, including the bot's own messages (like "Welcome back, you were AFK").
export default {
    name: Events.MessageCreate,
    once: false,

    async execute(message) {
        try {
            if (!message.guild || message.system) return;

            // ----- counting channel: messages from bots (our own rules box is skipped) -----
            if (message.author?.bot) {
                const counting = await getCountingGameConfig(message.client, message.guild.id);
                if (counting?.enabled && counting.channelId === message.channel.id) {
                    const description = message.embeds?.[0]?.description ?? '';
                    const isCountingRules = description.includes('**COUNTING**') && description.includes('Channel Rules');
                    if (!isCountingRules) await refreshCountingRules(message.channel, counting);
                    return;
                }
            }

            // ----- meow counting channel: messages from bots (our own rules box is skipped) -----
            if (message.author?.bot) {
                const meow = await getMeowConfig(message.guild.id);
                if (meow?.enabled && meow.channelId === message.channel.id) {
                    if (!isMeowRulesBox(message)) await refreshMeowRules(message.channel, meow);
                    return;
                }
            }

            // ----- the other channels in channelRules.js -----
            if (!findRulesFor(message.channel)) return;
            if (isRulesBox(message)) return; // the rules box itself

            await refreshChannelRules(message.channel);
        } catch (error) {
            logger.error('Channel rules event error:', error);
        }
    },
};
