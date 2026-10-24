// ==========================================
// BOOST THANK-YOU SETTINGS  (easy to edit)
// ==========================================

export const BOOST_DEFAULTS = {
    enabled: true,

    // Name shown in the message
    serverName: 'Moonlit',

    // The bot only posts in the channel named exactly this.
    // Emojis and symbols are ignored, so "boosters" and "💎・boosters" both work.
    // Nothing is saved in the database, so updates/resets never need setup.
    channelName: 'boosters',

    // Optional: paste the channel ID here to always use that exact channel.
    channelId: '',

    // Black bar on the left side of the message
    color: 0x000000,

    // The gifts list
    gifts: ['Server Booster Role', 'Custom Role'],

    // Small grey text at the bottom
    smallNote: 'To get your Custom Role, make a ticket',
};
