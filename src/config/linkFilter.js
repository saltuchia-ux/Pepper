// Link filter: deletes messages that contain links, except where allowed below.
//
// - Uploaded images / videos / files are never blocked (control those with the Attach Files permission).
// - Staff (Administrator / Manage Messages / Manage Server) can send any link.
// - Members with a media role can send GIF + Discord image links (GIF picker uses tenor.com), but nothing else.
export const LINK_FILTER = {
    // Set to false to turn the filter off.
    enabled: true,

    // Who counts as "media role": match by role name (any capitals) and/or role ID.
    mediaRoleNames: ['mediaperms'],
    mediaRoleIds: [],

    // Links ANYONE can send (no role needed). Everything else is deleted.
    // Spotify: open.spotify.com links, spotify.link and spotify.app.link share links.
    allowedForEveryone: [
        'spotify.com',
        'spotify.link',
        'spotify.app.link',
    ],

    // Link sites a media-role member may send.
    allowedMediaHosts: [
        'tenor.com',
        'media.tenor.com',
        'giphy.com',
        'media.giphy.com',
        'cdn.discordapp.com',
        'media.discordapp.net',
    ],

    // Roles that can send ANY link (add role IDs, e.g. trusted members).
    exemptRoleIds: [],

    // Channels where links are always fine (add channel IDs).
    ignoredChannelIds: [],

    // What the bot says (it pings the person and deletes this notice after a few seconds).
    warning: "{user} you can't send links here.",
};
