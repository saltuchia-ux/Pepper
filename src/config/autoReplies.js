// Auto replies: the bot answers by itself when a message contains certain words (no command needed).
// To add another one, copy a block and change the pattern and the text.
export const AUTO_REPLIES = [
    {
        name: 'media-perms',

        // Works ANYWHERE in a message. Matches "image perm", "img perm", "media perm" (also perms / permission),
        // and the other way round: "perms for images", "permission to send media" ...
        pattern: new RegExp(
            '\\b(?:image|img|media|pic|picture|photo)s?\\s*\\/?\\s*(?:perm|perms|permission|permissions)\\b'
            + '|\\b(?:perm|perms|permission|permissions)\\s+(?:for|to|of|on)?\\s*(?:send\\s+|sending\\s+|post\\s+|posting\\s+)?(?:image|images|img|imgs|media|pic|pics|picture|pictures|photo|photos)\\b',
            'i',
        ),

        // Wait this long before answering the same person / the same channel again (seconds)
        userCooldown: 60,
        channelCooldown: 20,

        // Black-bordered box (no emojis)
        embed: {
            color: 0x010101,
            title: 'Image Perms',
            description: [
                'Want to send **images**? You get **image perms** by doing **any one** of these:',
                '',
                '• **Boost the server** and enjoy the server perks',
                '• **Put the server link in your status**',
                '• **Reach level 10**',
                '',
                'Do any one of them and you\'ll get image perms.',
            ].join('\n'),
        },
    },
];

// Channels (by ID) where auto replies stay quiet.
export const AUTO_REPLY_IGNORED_CHANNEL_IDS = [];
