import { EmbedBuilder } from 'discord.js';
import { getSyntaxEntry } from '../config/commands/commandSyntax.js';

// ==========================================
// THE "COMMAND GUIDE" BOX (same look as the bleed bot)
//
//   [icon] Pepper help
//   Command: birthday set
//   Set your birthday
//   ┌──────────────────────────────────────┐
//   │ Syntax: .birthday set (date)         │   <- code block (the "black cube")
//   │ Example: .birthday set March 3, 2002 │
//   └──────────────────────────────────────┘
// ==========================================

const GUIDE_COLOR = 0x2b2d31;

function getCommandJson(commandData) {
    return commandData?.toJSON ? commandData.toJSON() : commandData;
}

// "birthday set" -> the description of that subcommand (falls back to the command's own)
function findDescription(client, key) {
    const [name, ...path] = key.split(' ');
    const command = client?.commands?.get(name);
    const json = getCommandJson(command?.data);

    if (!json) return null;

    let node = json;

    for (const part of path) {
        const child = node.options?.find((option) => (option.type === 1 || option.type === 2) && option.name === part);

        if (!child) break;

        node = child;
    }

    return node.description || json.description || null;
}

// ------------------------------------------
// MAKING THE SYNTAX + EXAMPLE FROM THE COMMAND ITSELF
// (used for every command that has no hand-written entry in commandSyntax.js)
// ------------------------------------------

const OPTION_STRING = 3;
const OPTION_INTEGER = 4;
const OPTION_BOOLEAN = 5;
const OPTION_USER = 6;
const OPTION_CHANNEL = 7;
const OPTION_ROLE = 8;
const OPTION_MENTIONABLE = 9;
const OPTION_NUMBER = 10;

// Example words for common option names
const NAME_HINTS = {
    reason: 'breaking the rules',
    text: 'hello',
    message: 'hello',
    name: 'Cool Name',
    title: 'My title',
    description: 'Some text',
    query: 'cats',
    search: 'cats',
    term: 'hello',
    word: 'hello',
    url: 'https://example.com',
    link: 'https://example.com',
    city: 'London',
    location: 'London',
    time: '10m',
    duration: '10m',
    amount: '100',
    bet: '100',
    number: '5',
    quantity: '1',
    count: '5',
    page: '1',
    level: '5',
    xp: '100',
    item: 'item_id',
    id: '123456789',
    color: '#ff0000',
    colour: '#ff0000',
    prize: 'Nitro',
    winners: '1',
    emoji: '😀',
    expression: '2 + 2',
    password: 'mypassword',
    length: '16',
    date: 'March 3, 2002',
    timezone: 'UTC',
    value: '10',
    song: 'never gonna give you up',
    query_text: 'cats',
};

function exampleValue(option) {
    const hint = NAME_HINTS[option.name];

    if (option.choices?.length) return String(option.choices[0].value);

    switch (option.type) {
        case OPTION_USER:
        case OPTION_MENTIONABLE:
            return 'John';
        case OPTION_CHANNEL:
            return '#general';
        case OPTION_ROLE:
            return 'Member';
        case OPTION_BOOLEAN:
            return 'true';
        case OPTION_INTEGER:
        case OPTION_NUMBER:
            if (hint && /^[\d.]+$/.test(hint)) return hint;
            return String(option.min_value ?? 5);
        case OPTION_STRING:
        default:
            return hint ?? option.name;
    }
}

// Walks "birthday set" / "role restore" down to the node that holds the real options
function findNode(json, path) {
    let node = json;

    for (const part of path) {
        const child = node.options?.find((option) => (option.type === 1 || option.type === 2) && option.name === part);

        if (!child) break;

        node = child;
    }

    return node;
}

/**
 * Builds { syntax, example } (without the prefix) from the slash command definition:
 *   required options -> (user)      optional options -> [reason]
 */
export function buildUsageFromCommand(client, key) {
    const [name, ...path] = key.split(' ');
    const json = getCommandJson(client?.commands?.get(name)?.data);

    if (!json) return null;

    const node = findNode(json, path);
    const options = (node.options || []).filter((option) => option.type !== 1 && option.type !== 2 && option.type !== 11);

    // Subcommand-only command (".birthday" on its own): show the subcommand names
    if (!options.length && node.options?.some((option) => option.type === 1 || option.type === 2)) {
        const names = node.options.filter((option) => option.type === 1 || option.type === 2).map((option) => option.name);

        return {
            syntax: `${key} (${names.join('/')})`,
            example: `${key} ${names[0]}`,
        };
    }

    // Required options always come first in Discord, so the order is already right
    const syntaxParts = options.map((option) => (option.required ? `(${option.name})` : `[${option.name}]`));
    const exampleParts = options.filter((option) => option.required).map(exampleValue);

    // A command that only has optional options gets one filled-in option in its example
    if (!exampleParts.length && options.length) exampleParts.push(exampleValue(options[0]));

    return {
        syntax: [key, ...syntaxParts].join(' '),
        example: [key, ...exampleParts].join(' '),
    };
}

/**
 * key       = "ban" or "birthday set"
 * usageLine = last-resort syntax if the command cannot be found (".birthday set [month] [day]")
 */
export function buildHelpPayload({ client, prefix, key, usageLine = null }) {
    const saved = getSyntaxEntry(key);
    const entry = saved ?? buildUsageFromCommand(client, key);

    const syntax = entry ? `${prefix}${entry.syntax}` : (usageLine || `${prefix}${key}`);
    const example = entry?.example ? `${prefix}${entry.example}` : null;
    const description = findDescription(client, key);

    const block = '```\n' + `Syntax: ${syntax}` + (example ? `\nExample: ${example}` : '') + '\n```';

    const embed = new EmbedBuilder().setColor(GUIDE_COLOR).setTitle(`Command: ${key}`);

    const botName = client?.user?.username || 'Bot';
    const botIcon = client?.user?.displayAvatarURL?.();

    embed.setAuthor({ name: `${botName} help`, ...(botIcon ? { iconURL: botIcon } : {}) });

    // Written straight into the embed so the bot's text cleaner cannot squash the code block
    embed.data.description = (description ? `${description}\n` : '') + block;

    return { embeds: [embed], allowedMentions: { parse: [] } };
}
