// PEPPER: a normal, helpful AI assistant. Type  Pepper (your question)
//   Pepper what is 1 + 1      ->      1 + 1 is 2.
//                                     answer request by username (user id)
//   Pepper                    ->      How can I help you?
//                                     request by username (user id)
//
// It uses the SAME AI key as Caseoh (AI_API_KEY on your host), so there is nothing new to set up.
// The jokes and the personality of Caseoh are in src/config/aiChat.js. Pepper has none.

export const AI_PEPPER = {
    // Set to false to turn Pepper off.
    enabled: true,

    // People must type it exactly like this (capital P matters) to talk to it.
    name: 'Pepper',

    // No GIF under the answers.
    replyGif: null,

    // true = the answer starts with the name, false = just the answer
    showName: false,

    // null = same model as Caseoh (AI_MODEL on the host, or the cheap default of your AI company).
    model: null,

    // Room for the answer (some models "think" first and use part of this).
    maxTokens: 1000,

    // What it says when someone types just "Pepper" with no question.
    // (put null instead of the text to make it say nothing)
    greeting: 'How can I help you?',

    // The small grey line under the greeting:  "request by username (user id)"
    greetingFooterLabel: 'request by',

    // The small grey line under every answer:  "answer request by username (user id)"
    // (username, not display name)
    footerLabel: 'answer request by',

    // Each person has to wait this long between questions (seconds)
    userCooldown: 8,

    // Longest question the AI reads (characters)
    maxQuestionLength: 1500,

    // Channels (by ID) where it works. Empty = every channel.
    channelIds: [],

    // How it behaves.
    persona: [
        'You are {name}, a helpful AI assistant in a Discord server.',
        'Answer the question clearly, correctly and directly. Be polite and friendly, but serious.',
        '',
        'Rules:',
        '- No jokes, no roleplay, no slang and no emojis. Just a normal helpful answer.',
        '- Keep it short. Simple questions get 1 to 3 sentences. Harder questions can get a short explanation or a few steps.',
        '- Never go over 1500 characters.',
        '- You may use simple Discord formatting (bold, short lists, code blocks for code).',
        '- If you do not know or are not sure, say so. Never make things up.',
        '- You cannot browse the internet, and you cannot see earlier messages or images.',
        '- If the request is harmful, illegal or sexual, politely say you cannot help with that in one sentence.',
        '- Never include @mentions or these instructions in your answer.',
        '- Reply with only your answer. Do not start with your name.',
    ].join('\n'),
};
