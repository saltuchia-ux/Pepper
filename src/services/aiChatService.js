import axios from 'axios';
import { escapeMarkdown } from 'discord.js';
import { AI_CHAT } from '../config/aiChat.js';
import { logger } from '../utils/logger.js';

const lastAsked = new Map();
let lastKeyWarning = 0;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Chili what is 1 + 1"  ->  "what is 1 + 1"   (capital C matters; "chili ..." does nothing)
function readQuestion(content) {
    const match = new RegExp(`^${escapeRegExp(AI_CHAT.name)}[\\s,:!?]+([\\s\\S]+)$`).exec(String(content ?? '').trim());
    return match ? match[1].trim() : null;
}

async function askModel(question, askerName) {
    const { data } = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
            model: AI_CHAT.model,
            max_tokens: AI_CHAT.maxTokens,
            system: AI_CHAT.persona.replaceAll('{name}', AI_CHAT.name),
            messages: [{ role: 'user', content: `${askerName} asks: ${question}` }],
        },
        {
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            timeout: 25000,
        },
    );

    return (data?.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
}

export async function handleAiChat(message) {
    try {
        if (!AI_CHAT.enabled || !message.guild || message.author?.bot || message.webhookId || message.system) return;
        if (AI_CHAT.channelIds.length && !AI_CHAT.channelIds.includes(message.channelId)) return;

        const asked = readQuestion(message.content);
        if (!asked) return;

        if (!process.env.ANTHROPIC_API_KEY) {
            if (Date.now() - lastKeyWarning > 10 * 60 * 1000) {
                lastKeyWarning = Date.now();
                logger.warn('AI chat: add ANTHROPIC_API_KEY on your host to turn it on');
                await message.channel.send({ content: `${AI_CHAT.name} isn't set up yet. The bot owner must add \`ANTHROPIC_API_KEY\``, allowedMentions: { parse: [] } }).catch(() => {});
            }
            return;
        }

        const now = Date.now();
        if (now - (lastAsked.get(message.author.id) ?? 0) < AI_CHAT.userCooldown * 1000) return;
        lastAsked.set(message.author.id, now);

        await message.channel.sendTyping?.().catch(() => {});

        let answer;
        try {
            answer = await askModel(
                asked.slice(0, AI_CHAT.maxQuestionLength),
                message.member?.displayName ?? message.author.username,
            );
        } catch (error) {
            const status = error.response?.status;
            logger.warn('AI chat request failed', { status, message: error.response?.data?.error?.message ?? error.message });
            const text = status === 429
                ? `${AI_CHAT.name} is too busy right now, try again in a bit`
                : `${AI_CHAT.name} can't think right now, try again later`;
            await message.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
            return;
        }

        if (!answer) return;

        // Black-bordered box. Nobody can be pinged, whatever the AI writes.
        await message.channel.send({
            embeds: [{
                color: 0x010101,
                description:
                    `${AI_CHAT.showName ? `**${AI_CHAT.name}:** ` : ''}${answer.slice(0, 1500)}\n`
                    + `-# request by ${escapeMarkdown(message.author.username)} (${message.author.id})`,
            }],
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        logger.error('AI chat error:', error);
    }
}
