import { logger } from './logger.js';
import { mapArgumentsToOptions } from './prefixParser.js';
import { extractUserId, findMemberByName } from './userResolver.js';
import { findRole, normalizeName } from './roleResolver.js';

// ==========================================
// SMART ARGUMENTS FOR EVERY PREFIX COMMAND  (old ones AND future ones)
//
// Before a prefix command runs, this looks at what the command asks for
// (user / channel / role / mentionable options) and works out which typed words
// belong together, so names with spaces, + or - just work:
//
//   .something Cool Kids being rude      role option  -> <@&id>   rest -> text
//   .something general chat hello        channel option -> <#id>
//   .something John Smith 100            user option -> <@id>
//
// A NEW command does not need any code for this: just declare
// addUserOption / addRoleOption / addChannelOption in its SlashCommandBuilder.
//
// How it decides (for each option, in order):
//   1) a mention or ID is used as is
//   2) the LONGEST group of words that is exactly a name wins ("Cool Kids" before "Cool")
//   3) a single word may be a close match (fuzzy) - several words must be exact
//   4) nothing found -> the words are left alone for the command to report
// ==========================================

const MAX_WORDS = 5;

function channelClean(channel) {
    return normalizeName(channel.name);
}

function findChannelByText(guild, text, { exactOnly }) {
    const id = String(text).match(/^<#(\d+)>$/)?.[1] ?? (/^\d{15,25}$/.test(text) ? text : null);

    if (id) return guild.channels.cache.get(id) ?? null;

    const wanted = normalizeName(String(text).replace(/^#/, ''));

    if (!wanted) return null;

    const channels = [...guild.channels.cache.values()].map((channel) => ({ channel, clean: channelClean(channel) }));

    const exact = channels.filter((entry) => entry.clean === wanted);

    if (exact.length) return exact[0].channel;
    if (exactOnly) return null;

    const starts = channels
        .filter((entry) => entry.clean.startsWith(wanted))
        .sort((a, b) => a.clean.length - b.clean.length);

    return starts[0]?.channel ?? null;
}

// Tries to read ONE value of the given option type from the start of the words.
// Returns { text, used } (text = what replaces those words) or null.
// "18 +" and "18+" are the same: a lone + or - sticks to the word before it.
// Returns the glued words, and how many typed words each one used.
function glueSigns(words) {
    const glued = [];
    const spans = [];

    for (const word of words) {
        if (/^[+-]+$/.test(word) && glued.length) {
            glued[glued.length - 1] += word;
            spans[spans.length - 1] += 1;
        } else {
            glued.push(word);
            spans.push(1);
        }
    }

    return { glued, spans };
}

async function takeOne(guild, allWords, type) {
    const { glued: words, spans } = glueSigns(allWords);
    const longest = Math.min(MAX_WORDS, words.length);

    for (let count = longest; count >= 1; count--) {
        const text = words.slice(0, count).join(' ');
        const fuzzy = count === 1;
        const used = spans.slice(0, count).reduce((sum, n) => sum + n, 0);

        if (type === 6 || type === 9) {
            const id = extractUserId(text);

            if (id) return { text: `<@${id}>`, used };

            if (/^<@&\d+>$/.test(text) && type === 9) return { text, used };

            const member = await findMemberByName(guild, text, { exactOnly: !fuzzy });

            if (member) return { text: `<@${member.id}>`, used };
        }

        if (type === 8 || type === 9) {
            if (count > 1) {
                // several words: the role's name must match exactly (ignoring capitals / emoji)
                const wanted = normalizeName(text);
                const same = wanted
                    ? [...guild.roles.cache.values()].find((role) => role.id !== guild.id && normalizeName(role.name) === wanted)
                    : null;

                if (same) return { text: `<@&${same.id}>`, used };
            } else {
                const { role } = await findRole(guild, text);

                if (role) return { text: `<@&${role.id}>`, used };
            }
        }

        if (type === 7) {
            const channel = findChannelByText(guild, text, { exactOnly: !fuzzy });

            if (channel) return { text: `<#${channel.id}>`, used };
        }
    }

    return null;
}

export async function resolveSmartArguments(message, commandData, args) {
    try {
        if (!message.guild || !args?.length || !commandData) return args;

        const info = mapArgumentsToOptions(args, commandData).validateRequired();
        const optionDefs = info?.optionDefs || [];

        if (!optionDefs.some((option) => [6, 7, 8, 9].includes(option.type))) return args;

        const offset = info.subcommandGroupName && info.subcommandName
            ? 2
            : info.subcommandName
                ? 1
                : 0;

        await message.guild.roles.fetch().catch(() => null);

        const result = args.slice(0, offset);
        let pointer = offset;

        for (const option of optionDefs) {
            if (pointer >= args.length) break;

            // text / number / choice options take exactly one word here (the parser gives the LAST text option the rest)
            if (![6, 7, 8, 9].includes(option.type)) {
                result.push(args[pointer]);
                pointer += 1;
                continue;
            }

            const found = await takeOne(message.guild, args.slice(pointer), option.type);

            if (found) {
                result.push(found.text);
                pointer += found.used;
            } else {
                result.push(args[pointer]);
                pointer += 1;
            }
        }

        // anything left over stays as typed
        return [...result, ...args.slice(pointer)];
    } catch (error) {
        logger.debug(`Could not resolve smart arguments: ${error.message}`);
        return args;
    }
}
