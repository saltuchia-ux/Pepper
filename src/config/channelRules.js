// Channel rules: the bot keeps a rules box at the BOTTOM of these channels.
// Every time someone sends a message, the old rules box is deleted and a new one is sent,
// so the rules are always the last thing in the channel (same as the counting channel).
//
// To change a rule, edit the lines. To add a channel, copy a block and change "channel" (the channel's
// name, emojis and symbols ignored; a list of names also works, so "📸│selfies" and "selfies" both match).
// Set enabled to false to turn this off.
export const CHANNEL_RULES = {
    enabled: true,

    color: 0x5865F2, // same blue as the counting rules

    footer: '**Violation of these rules WILL HAVE consequences and punishment.**',

    channels: [
        {
            channel: 'introduction',
            title: 'INTRODUCTION',
            rules: [
                'Introduce yourself: name or nickname, age, hobbies',
                'Never share private info (address, phone number, school)',
                'Be honest and be nice to new people',
                'No spam and no advertising',
            ],
        },
        {
            channel: 'venting',
            title: 'VENTING',
            rules: [
                'Be kind and supportive, no judging or mocking',
                'No hate, no bullying, no calling people out',
                'No graphic details about self-harm or violence',
                'If you are in danger or need help, tell a staff member',
            ],
        },
        {
            channel: 'selfies',
            title: 'SELFIES',
            rules: [
                'Only post pictures of yourself',
                'No NSFW',
                'No shirtless pics',
                'No spam',
                'Be respectful, no mean comments about anyone\'s looks',
            ],
        },
        {
            channel: 'pets',
            title: 'PETS',
            rules: [
                'Pet pictures and videos only',
                'No NSFW or gore',
                'No spam',
                'Be kind to every pet and owner',
            ],
        },
        {
            channel: 'media',
            title: 'MEDIA',
            rules: [
                'Share pictures, videos and clips',
                'No NSFW or gore',
                'No spam',
                'Be respectful',
            ],
        },
        {
            channel: 'memes',
            title: 'MEMES',
            rules: [
                'Memes only',
                'No NSFW',
                'No offensive or hateful memes',
                'No spam',
            ],
        },
        {
            channel: 'showcase-art',
            title: 'SHOWCASE ART',
            rules: [
                'Only post your own art',
                'Never claim or steal someone else\'s work',
                'No NSFW',
                'Be kind, only helpful feedback',
            ],
        },
    ],
};
