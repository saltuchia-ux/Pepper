import { syntaxText } from '../../utils/replyStyle.js';

// ==========================================
// HOW TO USE EACH COMMAND
// Shown (as plain text) when someone types a command wrong.
//   Syntax: .ban (user) (reason)
//   Example: .ban John annoying
// ==========================================

export const COMMAND_SYNTAX = {
    ban:      { syntax: 'ban (user) (reason)',            example: 'ban John annoying' },
    tempban:  { syntax: 'tempban (user) (time) (reason)', example: 'tempban John 3d spamming' },
    unban:    { syntax: 'unban (user) (reason)',          example: 'unban John appealed' },
    kick:     { syntax: 'kick (user) (reason)',           example: 'kick John annoying' },
    mute:     { syntax: 'mute (user) (time) (reason)',    example: 'mute John 10m spamming' },
    unmute:   { syntax: 'unmute (user) (reason)',         example: 'unmute John calmed down' },
    warn:     { syntax: 'warn (user) (reason)',           example: 'warn John annoying' },
    jail:     { syntax: 'jail (user) (reason)',           example: 'jail John annoying' },
    unjail:   { syntax: 'unjail (user) (reason)',         example: 'unjail John sorry' },
    nick:     { syntax: 'nick (user) (name)',             example: 'nick John Cool John' },
    fn:       { syntax: 'fn (user) (name)',               example: 'fn John Cool John' },
    role:     { syntax: 'role (c / g / r / e / d / restore) ...', example: 'role g cool kids John' },
    'role create':  { syntax: 'role c (name) (#color)',  example: 'role c cool kids #ff0000' },
    'role give':    { syntax: 'role g (role) (user)',    example: 'role g cool kids John' },
    'role remove':  { syntax: 'role r (user) (role)   |   role r (user) (new role), (old role)', example: 'role r John cool kids   |   role r John Verified, Member' },
    'role edit':    { syntax: 'role e (role) #color (new name) (one emoji)  - use any of the three, or all', example: 'role e cool kids #ff0000 Chill Crew 🔥' },
    'role delete':  { syntax: 'role d (role)   |   role d (role 1), (role 2)', example: 'role d cool kids' },
    'role restore': { syntax: 'role restore (user)',     example: 'role restore John' },
    hs:       { syntax: 'hs (user)',                      example: 'hs John' },
    ms:       { syntax: 'ms (user)',                      example: 'ms John' },
    s:        { syntax: 's (number)',                     example: 's 2' },
    es:       { syntax: 'es (number)',                    example: 'es 2' },
    birthday:      { syntax: 'birthday (user)',                example: 'birthday @John' },
    'birthday set':      { syntax: 'birthday set (date)',      example: 'birthday set March 3, 2002' },
    'birthday info':     { syntax: 'birthday info (user)',     example: 'birthday info @John' },
    'birthday list':     { syntax: 'birthday list',            example: 'birthday list' },
    'birthday next':     { syntax: 'birthday next',            example: 'birthday next' },
    'birthday remove':   { syntax: 'birthday remove',          example: 'birthday remove' },
    counting: { syntax: 'counting (setup/status/reset/disable)', example: 'counting setup #general' },
};

// Looks up one saved entry: "ban" or "birthday set". Returns { syntax, example } or null.
export function getSyntaxEntry(key) {
    return COMMAND_SYNTAX[String(key || '').toLowerCase()] ?? null;
}

// Returns the finished text, or null if this command has no syntax saved
export function buildSyntaxText(prefix, commandName) {
    const entry = COMMAND_SYNTAX[String(commandName || '').toLowerCase()];

    return entry ? syntaxText(prefix, entry.syntax, entry.example) : null;
}
