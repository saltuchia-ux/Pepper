// Status role: if a member puts YOUR server's invite link in their custom status,
// the bot gives them a role and thanks them in a channel.
//
// NEEDS the "Presence Intent" switched on in the Discord Developer Portal (Bot page).
export const STATUS_ROLE = {
    // Set to false to turn this off.
    enabled: true,

    // Role given to people who have the server link in their status.
    roleId: '1556313427079729182',

    // Channel (by name) where the thank-you message is posted. Emojis/symbols in the name are ignored.
    channelName: 'supporter',

    // The thank-you message. {username} = their username (plain text, never a ping or an ID).
    message: '{username} Thank you for promoting the server',

    // Which links count: the bot reads the server's own invites automatically (it needs the Manage Server permission).
    // You can also list invite codes here, e.g. ['moonlit'] for discord.gg/moonlit.
    inviteCodes: [],
};
