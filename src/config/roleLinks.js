// Role links: anyone who HAS the trigger role automatically ALSO gets "alsoGive".
// A trigger can be a role ID ("whenHas") and/or exact role names ("whenHasNames").
// Names ignore capitals, emojis and symbols, so "Mod" also matches "🛡️│Mod" - but NOT "Trial Mod".
// Add "removeWhenLost: true" to a link to also take the linked role away when they lose the trigger role(s).
// Add more lines to this list for more links. No setup command needed, and nothing is lost on restart.
export const ROLE_LINKS = [
    { whenHas: '1555604759287832677', alsoGive: '1556313427079729182' },

    // Mod, Head Mod and Manager automatically get the ticket staff role
    // removeWhenLost: when they lose ALL of those roles, the bot takes the linked role away too.
    { whenHasNames: ['Mod', 'Head Mod', 'Manager'], alsoGive: '1563706590182375515', removeWhenLost: true },
];
