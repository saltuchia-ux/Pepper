import axios from 'axios';
import { escapeMarkdown, PermissionFlagsBits } from 'discord.js';
import { AI_CHAT } from '../config/aiChat.js';
import { logger } from '../utils/logger.js';

// ==========================================
// Talks to ANY AI company. Settings on the host: AI_API_KEY (+ optional AI_PROVIDER, AI_MODEL, AI_BASE_URL)
// ==========================================

// Google keeps retiring its Gemini model names. These names always point to a CURRENT model,
// so the bot keeps working without anyone changing the model.
//   FAST   = quick and cheap, perfect for chatting (used first)
//   LATEST = the bigger Flash model (used if the fast one does not answer)
const GEMINI_FAST = 'gemini-flash-lite-latest';
const GEMINI_LATEST = 'gemini-flash-latest';

// "kind" = how the company's API is shaped. Most use the OpenAI shape.
const PROVIDERS = {
    anthropic: { kind: 'anthropic', url: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-5-5' },
    openai: { kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', tokenParam: 'max_completion_tokens' },
    gemini: { kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: GEMINI_FAST },
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

// ==========================================
// Asking several Gemini models "like a relay race":
//  - the first model is asked right away
//  - if it has not answered after 7 seconds (or it fails), the next model is asked too
//  - the first answer wins, the others are cancelled
// So one slow or broken model does not make the bot wait forever.
// ==========================================
const GEMINI_TIMEOUT_MS = 40000;   // longest wait for ONE model
const HEDGE_DELAY_MS = 7000;       // after this long, the next model is asked as well
const MAX_WAIT_MS = 45000;         // longest wait in total

function raceModels(models, askOne) {
    return new Promise((resolve, reject) => {
        const controllers = [];
        const timers = [];
        const tried = [];
        let done = false;
        let running = 0;
        let nextIndex = 0;
        let lastError;

        const finish = (callback, value) => {
            if (done) return;
            done = true;
            timers.forEach(clearTimeout);
            controllers.forEach((controller) => controller.abort());
            callback(value);
        };

        const fail = (error) => {
            error.triedModels = [...tried];
            finish(reject, error);
        };

        const startNext = () => {
            if (done || nextIndex >= models.length) return false;

            const model = models[nextIndex++];
            const controller = new AbortController();

            controllers.push(controller);
            tried.push(model);
            running++;

            askOne(model, controller.signal).then(
                (answer) => finish(resolve, answer),
                (error) => {
                    running--;

                    if (done) return;

                    lastError = error;

                    const status = error.response?.status;

                    logger.warn(`Gemini model ${model} failed (${status ?? error.message})`);

                    // a wrong key or a bad request: another model will not help
                    if (status && ![404, 429, 500, 502, 503, 504].includes(status)) {
                        return fail(error);
                    }

                    // this model is down or too busy: ask the next one right away
                    if (!startNext() && running === 0) fail(lastError);
                },
            );

            return true;
        };

        startNext();

        for (let i = 1; i < models.length; i++) {
            timers.push(setTimeout(() => startNext(), HEDGE_DELAY_MS * i));
        }

        timers.push(setTimeout(
            () => fail(lastError ?? new Error(`no model answered within ${MAX_WAIT_MS / 1000} seconds`)),
            MAX_WAIT_MS,
        ));
    });
}

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
        const ask = async (model, { thinking, signal }) => {
            const { data } = await axios.post(`${ai.base}/models/${encodeURIComponent(model)}:generateContent`, {
                systemInstruction: { parts: [{ text: system }] },
                contents: [{ role: 'user', parts: [{ text: userText }] }],
                generationConfig: {
                    maxOutputTokens: AI_CHAT.maxTokens,
                    // chatting does not need long "thinking", it only makes the answer slow
                    ...(thinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
                },
            }, {
                headers: { 'x-goog-api-key': ai.key, 'content-type': 'application/json' },
                timeout: GEMINI_TIMEOUT_MS,
                signal,
            });
            return (data?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
        };

        // one model: first without "thinking"; if the model refuses that setting (400) ask again without it
        const askOne = async (model, signal) => {
            try {
                return await ask(model, { thinking: true, signal });
            } catch (error) {
                if (error.response?.status === 400 && !signal.aborted) {
                    return ask(model, { thinking: false, signal });
                }

                throw error;
            }
        };

        // The model from the settings first, then the two Gemini names that always exist
        return raceModels([...new Set([ai.model, GEMINI_FAST, GEMINI_LATEST])], askOne);
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

        // A normal message (no box, no border): the answer and a small grey line with who asked
        // (username, not display name). The GIF link is hidden inside an invisible link,
        // so only the GIF itself is shown.
        const sendBox = (text) => message.channel.send({
            content: [
                text,
                `-# request sent by ${escapeMarkdown(message.author.username)} (${message.author.id})` +
                    (AI_CHAT.replyGif ? ` [\u200b](${AI_CHAT.replyGif})` : ''),
            ].join('\n'),
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

        // "typing..." goes away after 10 seconds, so it is shown again while we wait
        const typingTimer = setInterval(() => message.channel.sendTyping?.().catch(() => {}), 8000);

        const askerName = message.member?.displayName ?? message.author.username;
        let answer;
        try {
            answer = (await askModel(
                ai,
                AI_CHAT.persona.replaceAll('{name}', AI_CHAT.name),
                `${askerName} asks: ${asked.slice(0, AI_CHAT.maxQuestionLength)}`,
            )).trim();
        } catch (error) {
            clearInterval(typingTimer);
            const status = error.response?.status;
            const detail = error.response?.data?.error?.message ?? error.response?.data?.message ?? error.message;
            logger.warn('AI chat request failed', { provider: ai.provider, model: ai.model, status, detail });

            let text = status === 429
                ? `${AI_CHAT.name} is too busy right now, try again in a bit`
                : `${AI_CHAT.name} can't think right now, try again later`;

            // Admins also see WHY it failed (keys are hidden), so they can fix it without digging in the logs
            if (message.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
                text += `\n-# admin info: ${ai.provider} / ${(error.triedModels ?? [ai.model]).join(' > ')} / ${status ?? 'no response'}: ${hideKeys(detail)}`;
            }

            await message.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
            return;
        }

        clearInterval(typingTimer);

        if (!answer) return;

        // Nobody can be pinged, whatever the AI writes.
        await sendBox(`${AI_CHAT.showName ? `**${AI_CHAT.name}:** ` : ''}${answer.slice(0, 1500)}`);
    } catch (error) {
        logger.error('AI chat error:', error);
    }
}
