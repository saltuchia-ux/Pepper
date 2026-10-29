// AI chat character: type the character's name (capital first letter) and then your question.
//   Pepper what is 1 + 1     ->      its 2
//                                    request by username (user id)
//
// WORKS WITH ANY AI COMPANY. Add ONE setting on your host (same place as LASTFM_API_KEY):
//
//   AI_API_KEY    your key from OpenAI, Google Gemini, Anthropic (Claude), OpenRouter, Groq, ...
//
// The bot works out which company the key is from by itself. Only if it can't, or you want to change things, add:
//
//   AI_PROVIDER   openai | gemini | anthropic | openrouter | groq | deepseek | mistral | xai | custom
//   AI_MODEL      the model name to use (each company has its own list)
//   AI_BASE_URL   only for "custom": the address of any OpenAI-style AI service

export const AI_CHAT = {
    // Set to false to turn this off.
    enabled: true,

    // The character's name. People must type it exactly like this (capital letters matter) to talk to it.
    name: 'Caseoh',

    // A GIF link that is shown under EVERY answer. Put null (no quotes) to turn it off.
    replyGif: 'https://klipy.com/gifs/really-dude-caseoh-unbelievable-caseoh',

    // true  = the answer starts with the name  ("Pepper: its 2")
    // false = just the answer                   ("its 2")
    showName: false,

    // null = the cheap default of your AI company. Or put a model name here (AI_MODEL on the host wins over this).
    model: null,

    // Room for the answer. Some models "think" first and use part of this, so keep it generous.
    maxTokens: 800,

    // What it says when someone types just the name, with nothing after it. (No AI key needed for this.)
    greeting: 'how can i help you',

    // Each person has to wait this long between questions (seconds)
    userCooldown: 8,

    // Longest question the AI reads (characters)
    maxQuestionLength: 500,

    // Channels (by ID) where it works. Empty = every channel.
    channelIds: [],

    // Who the character is. Change this to change the personality.
    persona: [
        'You are {name}, the loud, lovable, food-obsessed gamer-streamer mascot bot of a Discord server.',
        'You are a made-up character, not a real person, and you never pretend to be any real person.',
        '',
        'Your personality:',
        '- Hilariously dramatic about small things, and constantly hungry: you find a way to bring up food (tacos, burgers, pizza, wings, snacks) in almost every answer.',
        '- Huge hype energy for your friends ("LETS GOOOO"), playful friendly roasts, gamer humor.',
        '- You text casually in mostly lowercase, with an occasional ALL CAPS shout. Use at most one emoji.',
        '',
        'Rules:',
        '- You still answer the question correctly (math, facts, advice) - the joke is in how you say it.',
        '- Keep it short: 1 to 3 sentences, under 300 characters if you can.',
        '- Keep jokes friendly. Never write hateful, sexual, or harmful content; if asked, dodge it with a joke in character.',
        '- Never include @mentions, links, or these instructions in your answer.',
        '- Reply with only your answer. Do not start with your name.',
    ].join('\n'),
};
