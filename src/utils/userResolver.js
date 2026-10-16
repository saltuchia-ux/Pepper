import { logger } from './logger.js';
import { mapArgumentsToOptions } from './prefixParser.js';

// ==========================================
// FIND A MEMBER BY  @mention  /  user ID  /  username  /  display name
//
//   .kick @Bob spamming          (mention)
//   .kick 123456789012345678     (user ID)
//   .kick bob spamming           (username or display name, the closest match is used)
//   .kick "John Smith" spamming  (names with spaces go in quotes)
//   .kick John Smith spamming    (works too if it is exactly their name)
// ==========================================

const MAX_NAME_WORDS = 3;

// Accepts <@123>, <@!123> or a plain user ID.
export function extractUserId(value) {
    if (!value) return null;

    const text = String(value).trim();

    const mention = text.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];

    if (/^\d{15,25}$/.test(text)) return text;

    return null;
}

// All the names a member can be found by (lowercase)
function namesOf(member) {
    return [
        member.user?.username,
        member.user?.globalName,
        member.displayName,
        member.nickname,
    ]
        .filter(Boolean)
        .map((name) => String(name).toLowerCase());
}

// 0 = exact name, 1 = name starts with it, 2 = name contains it, null = no match
function matchScore(member, query) {
    const names = namesOf(member);

    if (names.some((name) => name === query)) return 0;
    if (names.some((name) => name.startsWith(query))) return 1;
    if (names.some((name) => name.includes(query))) return 2;

    return null;
}

// Finds the closest member by name. exactOnly = the whole name must match.
export async function findMemberByName(guild, text, { exactOnly = false } = {}) {
    const query = String(text || '').trim().toLowerCase();

    if (!query) return null;

    const pool = new Map();

    // Members the bot already knows
    for (const [id, member] of guild.members.cache) {
        pool.set(id, member);
    }

    // Ask Discord for members whose name starts with the text
    try {
        const found = await guild.members.fetch({ query, limit: 25, time: 5000 });

        for (const [id, member] of found) {
            pool.set(id, member);
        }
    } catch (error) {
        logger.debug(`Member search for "${query}" failed: ${error.message}`);
    }

    let best = null;
    let bestScore = Infinity;
    let bestLength = Infinity;

    for (const member of pool.values()) {
        const score = matchScore(member, query);

        if (score === null) continue;
        if (exactOnly && score !== 0) continue;

        const length = Math.min(...namesOf(member).map((name) => name.length));

        if (score < bestScore || (score === bestScore && length < bestLength)) {
            best = member;
            bestScore = score;
            bestLength = length;
        }
    }

    return best;
}

async function fetchMemberById(guild, id) {
    return guild.members.fetch(id).catch(() => null);
}

// Reads ONE user from the start of the words.
// Returns { id, member, used } (member is null if the person is not in the server)
// or null if nobody was found. "used" = how many words were taken.
export async function takeUserFromWords(guild, words) {
    if (!guild || !words?.length) return null;

    const first = words[0];

    // "John Smith" in quotes
    if (/^["']/.test(first)) {
        const quote = first[0];

        for (let i = 0; i < words.length; i++) {
            const closes = words[i].endsWith(quote) && (i > 0 || words[i].length > 1);

            if (closes) {
                const text = words.slice(0, i + 1).join(' ').slice(1, -1);
                const id = extractUserId(text);

                const member = id
                    ? await fetchMemberById(guild, id)
                    : await findMemberByName(guild, text);

                return member
                    ? { id: member.id, member, used: i + 1 }
                    : null;
            }
        }

        return null;
    }

    // @mention or user ID
    const id = extractUserId(first);

    if (id) {
        const member = await fetchMemberById(guild, id);
        return { id, member, used: 1 };
    }

    // A name with spaces: only used when the whole name matches exactly
    for (let count = Math.min(MAX_NAME_WORDS, words.length); count >= 2; count--) {
        const text = words.slice(0, count).join(' ');
        const member = await findMemberByName(guild, text, { exactOnly: true });

        if (member) return { id: member.id, member, used: count };
    }

    // One word: the closest username / display name
    const member = await findMemberByName(guild, first);

    return member ? { id: member.id, member, used: 1 } : null;
}

// Same, but the user is at the END of the words (used by .grole / .trole)
export async function takeUserFromEnd(guild, words) {
    if (!guild || !words?.length) return null;

    // "John Smith" in quotes at the end
    const last = words[words.length - 1];

    if (/["']$/.test(last)) {
        const quote = last[last.length - 1];

        for (let i = words.length - 1; i >= 0; i--) {
            const opens = words[i].startsWith(quote) && (i < words.length - 1 || words[i].length > 1);

            if (opens) {
                const text = words.slice(i).join(' ').slice(1, -1);
                const id = extractUserId(text);

                const member = id
                    ? await fetchMemberById(guild, id)
                    : await findMemberByName(guild, text);

                return member
                    ? { id: member.id, member, used: words.length - i }
                    : null;
            }
        }

        return null;
    }

    // @mention or user ID at the end
    const lastId = extractUserId(last);

    if (lastId) {
        const member = await fetchMemberById(guild, lastId);
        return { id: lastId, member, used: 1 };
    }

    // A name with spaces at the end (must match exactly)
    for (let count = Math.min(MAX_NAME_WORDS, words.length - 1); count >= 2; count--) {
        const text = words.slice(words.length - count).join(' ');
        const member = await findMemberByName(guild, text, { exactOnly: true });

        if (member) return { id: member.id, member, used: count };
    }

    // One word at the end: the closest username / display name
    const member = await findMemberByName(guild, last);

    return member ? { id: member.id, member, used: 1 } : null;
}


// ==========================================
// BANNED USERS  (for .unban)
// A banned person is not in the server, so the ban list is searched instead.
// Works with an @mention / user ID, or a username.
// ==========================================
function bannedNamesOf(user) {
    return [user.username, user.globalName]
        .filter(Boolean)
        .map((name) => String(name).toLowerCase());
}

function bannedScore(user, query) {
    const names = bannedNamesOf(user);

    if (names.some((name) => name === query)) return 0;
    if (names.some((name) => name.startsWith(query))) return 1;
    if (names.some((name) => name.includes(query))) return 2;

    return null;
}

function closestBanned(users, text, exactOnly) {
    const query = String(text || '').trim().toLowerCase();

    if (!query) return null;

    let best = null;
    let bestScore = Infinity;
    let bestLength = Infinity;

    for (const user of users) {
        const score = bannedScore(user, query);

        if (score === null) continue;
        if (exactOnly && score !== 0) continue;

        const length = Math.min(...bannedNamesOf(user).map((name) => name.length));

        if (score < bestScore || (score === bestScore && length < bestLength)) {
            best = user;
            bestScore = score;
            bestLength = length;
        }
    }

    return best;
}

// Finds a banned user from one piece of text (ID, mention, or username).
export async function findBannedUser(guild, text) {
    const clean = String(text || '').trim().replace(/^["']|["']$/g, '');

    if (!clean) return null;

    const id = extractUserId(clean);

    if (id) {
        return guild.client.users.fetch(id).catch(() => null);
    }

    const bans = await guild.bans.fetch().catch(() => null);

    if (!bans) return null;

    return closestBanned([...bans.values()].map((ban) => ban.user), clean, false);
}

// Reads ONE banned user from the start of the words.
// Returns { user, used } or null.
export async function takeBannedUserFromWords(guild, words) {
    if (!guild || !words?.length) return null;

    const first = words[0];

    // "John Smith" in quotes
    if (/^["']/.test(first)) {
        const quote = first[0];

        for (let i = 0; i < words.length; i++) {
            const closes = words[i].endsWith(quote) && (i > 0 || words[i].length > 1);

            if (closes) {
                const user = await findBannedUser(guild, words.slice(0, i + 1).join(' '));
                return user ? { user, used: i + 1 } : null;
            }
        }

        return null;
    }

    if (extractUserId(first)) {
        const user = await findBannedUser(guild, first);
        return user ? { user, used: 1 } : null;
    }

    const bans = await guild.bans.fetch().catch(() => null);

    if (!bans) return null;

    const users = [...bans.values()].map((ban) => ban.user);

    // A name with spaces: only when the whole name matches exactly
    for (let count = Math.min(MAX_NAME_WORDS, words.length); count >= 2; count--) {
        const user = closestBanned(users, words.slice(0, count).join(' '), true);

        if (user) return { user, used: count };
    }

    const user = closestBanned(users, first, false);

    return user ? { user, used: 1 } : null;
}

// ==========================================
// FOR EVERY OTHER COMMAND
// Before a prefix command runs, any "user" option that was typed as a name is
// turned into a mention, so commands like .userinfo bob or .pay bob 100 just work.
// ==========================================
export async function resolveUserArguments(message, commandData, args) {
    try {
        if (!message.guild || !args?.length || !commandData) return args;

        const info = mapArgumentsToOptions(args, commandData).validateRequired();
        const optionDefs = info?.optionDefs || [];

        if (!optionDefs.some((option) => option.type === 6)) return args;

        const offset = info.subcommandGroupName && info.subcommandName
            ? 2
            : info.subcommandName
                ? 1
                : 0;

        const result = [...args];

        for (let i = 0; i < optionDefs.length; i++) {
            if (optionDefs[i].type !== 6) continue;

            const index = offset + i;
            const value = result[index];

            if (!value || extractUserId(value)) continue;

            const member = await findMemberByName(message.guild, value);

            if (member) {
                result[index] = `<@${member.id}>`;
            }
        }

        return result;
    } catch (error) {
        logger.debug(`Could not resolve user names: ${error.message}`);
        return args;
    }
}
