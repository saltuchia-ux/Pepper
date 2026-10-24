// Built-in welcome setup, so nobody has to run /welcome setup (and nothing is lost on restart/update).
//
// Used ONLY in servers where welcome was never configured with /welcome setup.
// Once someone uses /welcome setup or /greet dashboard, those saved settings win.
export const WELCOME_DEFAULTS = {
    // Set to false to turn this built-in welcome off.
    enabled: true,

    // Channel name to post in. Emojis and symbols in the name are ignored,
    // so "💬│chat" and "chat" both match.
    channelName: 'chat',
};
