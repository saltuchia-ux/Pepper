// Ticket hub: 3 ticket types (General / Ideas / Verify) with a panel that posts itself.
// Everything is set here in code, so there is nothing to set up with commands and nothing is lost on restart.
export const TICKET_HUB = {
    // Set to false to turn the hub off.
    enabled: true,

    // The bot finds these channels by name (emojis and symbols in the name are ignored,
    // so ".tickets" and "tickets" both match).
    panelChannelName: 'tickets',
    logChannelName: 'ticket-logs',

    // Staff who can see and manage ALL tickets: paste role IDs here, e.g. ['123456789012345678'].
    // People with Manage Channels (and admins) can always manage tickets.
    staffRoleIds: ['1563706590182375515'],

    // Levels
    ideasMinLevel: 0, // 0 = no level needed. Set a number (e.g. 20) to require that level for Ideas tickets
    customRoleLevel: 25, // only shown in the panel text (claiming custom role happens in a General ticket)

    types: {
        general: {
            label: 'General',
            emoji: '🎫',
            style: 'Primary', // blue
            minLevel: 0,
            asksReason: true,
            modalTitle: 'General Ticket',
            modalLabel: 'What do you need help with?',
        },
        ideas: {
            label: 'Ideas',
            emoji: '💡',
            style: 'Success', // green
            minLevel: 0, // no level needed (the Ideas level is set by ideasMinLevel above)
            asksReason: true,
            modalTitle: 'Ideas Ticket',
            modalLabel: 'What is your idea?',
        },
        verify: {
            label: 'Verify',
            emoji: '✅',
            style: 'Secondary', // gray
            minLevel: 0,
            asksReason: false, // opens straight away, no form
            intro:
                'Send a **video** of yourself saying:\n'
                + '`1.` Your username\n'
                + '`2.` Today\'s date\n\n'
                + '**Your face must be visible.**',
        },
    },
};

// Ideas tickets follow the single ideasMinLevel setting above.
TICKET_HUB.types.ideas.minLevel = TICKET_HUB.ideasMinLevel;
