// Media-only channels: a message with ONLY text is deleted.
//   text only            -> deleted
//   media only           -> kept
//   media + text         -> kept
// "Media" = an uploaded image / video / GIF / audio file, a sticker, or a GIF / image / video link
// (the GIF picker sends a tenor.com link, so that counts).
export const MEDIA_ONLY = {
    // Set to false to turn this off.
    enabled: true,

    // Every channel inside a category whose name contains this text (capitals, numbers and symbols are ignored,
    // so "005 | MEDIA & CREATIVE" matches "MEDIA & CREATIVE").
    categoryNames: ['MEDIA & CREATIVE'],

    // Extra channels by name, even if they are outside that category (empty = only the category above).
    // Example: channelNames: ['selfies', 'pets']
    channelNames: [],

    // Channels (by ID) that are never checked.
    ignoredChannelIds: [],

    // true = staff (Administrator / Manage Messages / Manage Server) can send text-only messages.
    // false = everyone follows the rule, staff included.
    exemptStaff: false,

    // What the bot says (it pings the person and deletes this notice after a few seconds).
    warning: '{user} this channel is for media only. Send a picture, video or GIF (you can add text with it).',
};
