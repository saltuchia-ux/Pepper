import axios from 'axios';
import { escapeMarkdown, PermissionFlagsBits } from 'discord.js';
import { AI_CHAT } from '../config/aiChat.js';
import { logger } from '../utils/logger.js';

// ==========================================
// Talks to ANY AI company. Settings on the host: AI_API_KEY (+ optional AI_PROVIDER, AI_MODEL, AI_BASE_URL)
// ==========================================

// "kind" = how the company's API is shaped. Most use the OpenAI shape.
const PROVIDERS = {
    anthropic: { kind: 'anthropic', url: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-5-5' },
    openai: { kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', tokenParam: 'max_completion_tokens' },
    gemini: { kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash' },
    openrouter: { kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
    groq: { kind: 'openai', base: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant' },
    deepseek: { kind: 'openai', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
    mistral: { kind: 'openai', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
    xai: { kind: 'openai', base: 'https://api.x.ai/v1', model: null },
    custom: { kind: 'openai', base: null, model: null },
};

// If AI_API_KEY isn't set, these company-specific names are also understood
const KEY_NAMES = [
    ['ANTHROPIC_API_KEY', 'anthropic'], ['OPENAI_API_KEY', 'openai'], ['GEMINI_API_KEY', 'gemini'],
    ['GOOGLE_API_KEY', 'gemini'], ['OPENROUTER_API_KEY', 'openrouter'], ['GROQ_API_KEY', 'groq'],
    ['DEEPSEEK_API_KEY', 'deepseek'], ['MISTRAL_API_KEY', 'mistral'], ['XAI_API_KEY', 'xai'],
];

function detectProvider(key) {
    if (key.startsWith('sk-ant-')) return 'anthropic';
    if (key.startsWith('sk-or-')) return 'openrouter';
    if (key.startsWith('AIza')) return 'gemini';
    if (key.startsWith('gsk_')) return 'groq';
    if (key.startsWith('xai-')) return 'xai';
    if (key.startsWith('sk-')) return 'openai';
    return null;
}

/** Works out which AI to use from the host settings. */
export function resolveAi(env = process.env) {
    let key = env.AI_API_KEY?.trim();
    let provider = env.AI_PROVIDER?.trim().toLowerCase();

    if (!key) {
        for (const [name, company] of KEY_NAMES) {
            if (env[name]?.trim()) {
                key = env[name].trim();
                provider = provider || company;
                break;
            }
        }
    }
    if (!key) return { error: 'nokey' };

    provider = provider || detectProvider(key) || (env.AI_BASE_URL ? 'custom' : null);
    if (!provider || !PROVIDERS[provider]) return { error: 'noprovider' };

    const def = PROVIDERS[provider];
    const model = env.AI_MODEL?.trim() || AI_CHAT.model || def.model;
    const base = (env.AI_BASE_URL?.trim() || def.base || '').replace(/\/+$/, '');

    if (!model) return { error: 'nomodel', provider };
    if (def.kind === 'openai' && !base) return { error: 'nobase', provider };

    return { provider, kind: def.kind, key, model, base, url: def.url, tokenParam: def.tokenParam ?? 'max_tokens' };
}

const lastAsked = new Map();
const lastWarning = new Map();

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// "Pepper what is 1 + 1"  ->  { question: "what is 1 + 1" }   (capital letters matter; "pepper ..." does nothing)
// "Pepper" on its own     ->  { greeting: true }
function readMessage(content) {
    const text = String(content ?? '').trim();

    if (new RegExp(`^${escapeRegExp(AI_CHAT.name)}[\\s,.:!?]*$`).test(text)) return { greeting: true };

    const match = new RegExp(`^${escapeRegExp(AI_CHAT.name)}[\\s,:!?]+([\\s\\S]+)$`).exec(text);
    return match ? { question: match[1].trim() } : null;
}

// Hides anything that looks like an API key before showing an error in chat
const hideKeys = (text) => String(text ?? '')
    .replace(/(sk-|gsk_|xai-|AIza)[A-Za-z0-9_\-*.]{4,}/g, '[key]')
    .replace(/\s+/g, ' ')
    .slice(0, 160);

async function askModel(ai, system, userText) {
    if (ai.kind === 'anthropic') {
        const { data } = await axios.post(ai.url, {
            model: ai.model,
            max_tokens: AI_CHAT.maxTokens,
            system,
            messages: [{ role: 'user', content: userText }],
        }, {
            headers: { 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            timeout: 25000,
        });
        return (data?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    }

    if (ai.kind === 'gemini') {
        const { data } = await axios.post(`${ai.base}/models/${encodeURIComponent(ai.model)}:generateContent`, {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: userText }] }],
            generationConfig: { maxOutputTokens: AI_CHAT.maxTokens },
        }, {
            headers: { 'x-goog-api-key': ai.key, 'content-type': 'application/json' },
            timeout: 25000,
        });
        return (data?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
    }

    // OpenAI shape: OpenAI, OpenRouter, Groq, DeepSeek, Mistral, xAI and most others
    const { data } = await axios.post(`${ai.base}/chat/completions`, {
        model: ai.model,
        [ai.tokenParam]: AI_CHAT.maxTokens,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: userText },
        ],
    }, {
        headers: { Authorization: `Bearer ${ai.key}`, 'content-type': 'application/json' },
        timeout: 25000,
    });

    const content = data?.choices?.[0]?.message?.content;
    return Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : (content ?? '');
}

const SETUP_NOTES = {
    nokey: () => 'The bot owner must add `AI_API_KEY`',
    noprovider: () => "I can't tell which AI company the key is from. The bot owner must add `AI_PROVIDER` (like `openai` or `gemini`)",
    nomodel: () => 'The bot owner must add `AI_MODEL` (the model name to use)',
    nobase: () => 'The bot owner must add `AI_BASE_URL` (the address of the AI service)',
};

export async function handleAiChat(message) {
    try {
        if (!AI_CHAT.enabled || !message.guild || message.author?.bot || message.webhookId || message.system) return;
        if (AI_CHAT.channelIds.length && !AI_CHAT.channelIds.includes(message.channelId)) return;

        const parsed = readMessage(message.content);
        if (!parsed) return;

        const sendBox = (text) => message.channel.send({
            embeds: [{
                color: 0x010101,
                description: `${text}\n-# request by ${escapeMarkdown(message.author.username)} (${message.author.id})`,
            }],
            allowedMentions: { parse: [] },
        });

        // Just the name, nothing else: say hi (no AI needed)
        if (parsed.greeting) {
            const nowHi = Date.now();
            if (nowHi - (lastAsked.get(message.author.id) ?? 0) < AI_CHAT.userCooldown * 1000) return;
            lastAsked.set(message.author.id, nowHi);
            await sendBox(AI_CHAT.greeting);
            return;
        }

        const asked = parsed.question;
        const ai = resolveAi();
        if (ai.error) {
            // Tell people at most once every 10 minutes, and log what to fix
            if (Date.now() - (lastWarning.get(ai.error) ?? 0) > 10 * 60 * 1000) {
                lastWarning.set(ai.error, Date.now());
                logger.warn(`AI chat is not set up (${ai.error}): ${SETUP_NOTES[ai.error]()}`);
                await message.channel.send({
                    content: `${AI_CHAT.name} isn't set up yet. ${SETUP_NOTES[ai.error]()}`,
                    allowedMentions: { parse: [] },
                }).catch(() => {});
            }
            return;
        }

        const now = Date.now();
        if (now - (lastAsked.get(message.author.id) ?? 0) < AI_CHAT.userCooldown * 1000) return;
        lastAsked.set(message.author.id, now);

        await message.channel.sendTyping?.().catch(() => {});

        const askerName = message.member?.displayName ?? message.author.username;
        let answer;
        try {
            answer = (await askModel(
                ai,
                AI_CHAT.persona.replaceAll('{name}', AI_CHAT.name),
                `${askerName} asks: ${asked.slice(0, AI_CHAT.maxQuestionLength)}`,
            )).trim();
        } catch (error) {
            const status = error.response?.status;
            const detail = error.response?.data?.error?.message ?? error.response?.data?.message ?? error.message;
            logger.warn('AI chat request failed', { provider: ai.provider, model: ai.model, status, detail });

            let text = status === 429
                ? `${AI_CHAT.name} is too busy right now, try again in a bit`
                : `${AI_CHAT.name} can't think right now, try again later`;

            // Admins also see WHY it failed (keys are hidden), so they can fix it without digging in the logs
            if (message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
                text += `\n-# admin info: ${ai.provider} / ${ai.model} / ${status ?? 'no response'}: ${hideKeys(detail)}`;
            }

            await message.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
            return;
        }

        if (!answer) return;

        // Black-bordered box. Nobody can be pinged, whatever the AI writes.
        await sendBox(`${AI_CHAT.showName ? `**${AI_CHAT.name}:** ` : ''}${answer.slice(0, 1500)}`);
    } catch (error) {
        logger.error('AI chat error:', error);
    }
}
