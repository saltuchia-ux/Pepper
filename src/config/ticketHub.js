// Ticket hub: 3 ticket types (General / Ideas / Verify) with a panel that posts itself.
// Everything is set here in code, so there is nothing to set up with commands and nothing is lost on restart.
export const TICKET_HUB = {
    // Set to false to turn the hub off.
    enabled: true,

    // The bot finds these channels by name (emojis and symbols in the name are ignored,
    // so ".tickets" and "tickets" both match).
    panelChannelName: 'tickets',
    logChannelName: 'ticket-logs',

    // New General / Ideas / Verify tickets are created inside the category with this name
    // (emojis and symbols are ignored). Jail tickets are NOT affected, they have their own category.
    ticketCategoryName: 'Tickets',

    // Staff who can see and manage ALL tickets: paste role IDs here, e.g. ['123456789012345678'].
    // People with Manage Channels (and admins) can always manage tickets.
    staffRoleIds: ['1563706590182375515'],

    // Levels
    ideasMinLevel: 0, // 0 = no level needed. Set a number (e.g. 20) to require that level for Ideas tickets
    customRoleLevel: 25, // only shown in the panel text (claiming custom role happens in a General ticket)

    // Staff Application rules. A ticket is ONLY made if the member meets all of them.
    staffApp: {
        // The staff application panel posts itself in the channel with this name (emojis/symbols ignored), e.g. #staff-apply.
        // The channel must already exist. The old #tickets panel is not changed.
        panelChannelName: 'staff-apply',
        minLevel: 0, // 0 = no level needed
        minAge: 14,
        maxWarnings: 0, // "good history" = no warnings. Set higher to allow some.
    },

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
        staff: {
            label: 'Staff Application',
            emoji: '🌙',
            style: 'Danger', // red
            minLevel: 0, // kept in sync with staffApp.minLevel below
            application: true, // opens the 2-step application form instead of the normal reason box
            intro: '',
        },
    },
};

// Keep the staff level in one place.
TICKET_HUB.types.staff.minLevel = TICKET_HUB.staffApp.minLevel;

// Ideas tickets follow the single ideasMinLevel setting above.
TICKET_HUB.types.ideas.minLevel = TICKET_HUB.ideasMinLevel;
