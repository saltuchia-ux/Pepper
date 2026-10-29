// AI chat character: type the character's name (capital first letter) and then your question.
//   Pepper what is 1 + 1     ->      its 2
//                                    request by username (user id)
//
// NEEDS one setting on your host, same place as LASTFM_API_KEY:   ANTHROPIC_API_KEY
// (a key from console.anthropic.com - using it costs a little money per answer)
export const AI_CHAT = {
    // Set to false to turn this off.
    enabled: true,

    // The character's name. People must type it exactly like this (capital letters matter) to talk to it.
    name: 'Pepper',

    // true  = the answer starts with the name  ("Pepper: its 2")
    // false = just the answer                   ("its 2")
    showName: false,

    model: 'claude-haiku-5-5',
    maxTokens: 300,

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
