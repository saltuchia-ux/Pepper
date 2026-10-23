import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isBotOwner, getCommandPrefix } from '../../config/bot.js';
import {
    withoutEditing,
    listMessages,
    getMessageEntry,
    setMessageEdit,
    resetMessageEdit,
    resetAllMessageEdits,
    messageStats,
} from '../../services/messageEditorService.js';

const PAGE_SIZE = 10;
const TYPES = ['error', 'success', 'warning', 'info', 'text', 'other'];

const TYPE_HELP = {
    error: 'red error boxes',
    success: 'green "it worked" boxes',
    warning: 'yellow warning / missing permission boxes',
    info: 'blue info boxes',
    text: 'plain text replies (no box)',
    other: 'everything else (menus, panels, dashboards...)',
};

function shorten(text, max) {
    const flat = String(text).replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

// In prefix mode every word arrives as its own argument, so rebuild the full text from them.
function readInput(interaction) {
    if (interaction._isPrefixCommand) {
        const words = (interaction.options._hoistedOptions ?? []).map((o) => String(o.value));
        const [sub, ...rest] = words;
        return { prefix: true, sub: sub?.toLowerCase() ?? null, rest };
    }
    return { prefix: false, sub: interaction.options.getSubcommand(false), rest: [] };
}

function pickArgs(interaction, input) {
    if (!input.prefix) {
        return {
            id: interaction.options.getString('id'),
            text: interaction.options.getString('text'),
            type: interaction.options.getString('type'),
            search: interaction.options.getString('search'),
            page: interaction.options.getInteger('page'),
            edited: interaction.options.getBoolean('edited'),
        };
    }

    // .messages list [type] [page]      .messages list search words
    // .messages view <id>               .messages reset <id>
    // .messages edit <id> <new text...>
    const rest = [...input.rest];
    const args = { id: null, text: null, type: null, search: null, page: null, edited: null };

    if (input.sub === 'edit' || input.sub === 'view' || input.sub === 'reset') {
        args.id = rest.shift() ?? null;
        if (input.sub === 'edit') args.text = rest.join(' ') || null;
    } else if (input.sub === 'list') {
        const searchWords = [];
        for (const word of rest) {
            const lower = word.toLowerCase();
            if (TYPES.includes(lower)) args.type = lower;
            else if (lower === 'edited') args.edited = true;
            else if (/^\d+$/.test(word)) args.page = Number(word);
            else searchWords.push(word);
        }
        args.search = searchWords.join(' ') || null;
    }

    return args;
}

function buildListEmbed({ type, search, edited, page }) {
    const all = listMessages({ type, search, onlyEdited: edited === true });
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, page || 1), pages);
    const slice = all.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

    const lines = slice.map((entry) => {
        const tag = entry.edited ? ' (edited)' : '';
        return `\`${entry.id}\` **${entry.type}**${tag} x${entry.count}\n> ${shorten(entry.editedText ?? entry.template, 110)}`;
    });

    const prefix = getCommandPrefix();
    const footerLines = [
        `Page ${current}/${pages} - ${all.length} message(s)`,
        `Edit one: ${prefix}messages edit <id> <new text>`,
    ];

    return createEmbed({
        title: 'Bot Messages',
        description: lines.length
            ? `${lines.join('\n')}`
            : 'Nothing here yet. The bot adds a message to this list the first time it sends it, so use some commands (or trigger an error) and check again.',
        footer: footerLines.join(' | '),
    });
}

async function reply(interaction, payload) {
    return InteractionHelper.safeEditReply(interaction, payload);
}

async function run(interaction) {
    const member = interaction.member;
    const allowed = isBotOwner(interaction.user?.id)
        || member?.guild?.ownerId === member?.id
        || member?.permissions?.has?.(PermissionFlagsBits.Administrator);

    if (!allowed) {
        await InteractionHelper.safeReply(interaction, {
            content: 'You need the Administrator permission to use this command.',
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return;
    }

    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

    const input = readInput(interaction);
    const args = pickArgs(interaction, input);
    const prefix = getCommandPrefix();

    switch (input.sub) {
        case 'list': {
            if (args.type && !TYPES.includes(args.type)) {
                await reply(interaction, {
                    embeds: [createEmbed({ title: 'Unknown type', description: `Types: ${TYPES.join(', ')}`, color: 'error' })],
                });
                return;
            }
            await reply(interaction, { embeds: [buildListEmbed(args)] });
            return;
        }

        case 'view': {
            const entry = args.id ? getMessageEntry(args.id) : null;
            if (!entry) {
                await reply(interaction, {
                    embeds: [createEmbed({ title: 'Not found', description: `No message with that ID. Use \`${prefix}messages list\` to see IDs.`, color: 'error' })],
                });
                return;
            }

            const fields = [
                { name: 'Original', value: `\`\`\`\n${entry.template.slice(0, 1000)}\n\`\`\``, inline: false },
            ];
            if (entry.edited) {
                fields.push({ name: 'Your edit', value: `\`\`\`\n${entry.editedText.slice(0, 1000)}\n\`\`\``, inline: false });
            }
            fields.push(
                { name: 'Type', value: `${entry.type} (${entry.kind})`, inline: true },
                { name: 'Times sent', value: String(entry.count), inline: true },
                { name: 'Last sent', value: `<t:${Math.floor(entry.lastSeen / 1000)}:R>`, inline: true },
            );

            await reply(interaction, {
                embeds: [createEmbed({
                    title: `Message ${entry.id}`,
                    description: 'Parts like `{1}` `{2}` are things that change each time (a user mention, a number...). Keep them in your edit to show them.',
                    fields,
                })],
            });
            return;
        }

        case 'edit': {
            if (!args.id || !args.text) {
                await reply(interaction, {
                    embeds: [createEmbed({ title: 'Missing info', description: `Use: \`${prefix}messages edit <id> <new text>\``, color: 'error' })],
                });
                return;
            }

            const result = await setMessageEdit(args.id, args.text);
            const problems = {
                not_found: `No message with that ID. Use \`${prefix}messages list\` to see IDs.`,
                empty: 'The new text cannot be empty.',
                too_long: 'The new text is too long (max 4000 characters).',
            };

            if (!result.ok) {
                await reply(interaction, {
                    embeds: [createEmbed({ title: 'Could not edit', description: problems[result.reason] ?? 'Something went wrong.', color: 'error' })],
                });
                return;
            }

            const entry = getMessageEntry(args.id);
            await reply(interaction, {
                embeds: [createEmbed({
                    title: 'Message updated',
                    description: `\`${entry.id}\` will now say:\n> ${shorten(entry.editedText, 300)}${result.saved ? '' : '\n\nCould not save to the database; this edit is lost on restart.'}`,
                    color: 'success',
                })],
            });
            return;
        }

        case 'reset': {
            const result = args.id ? await resetMessageEdit(args.id) : { ok: false };
            await reply(interaction, {
                embeds: [createEmbed(result.ok
                    ? { title: 'Reset', description: `\`${args.id}\` is back to the original text.`, color: 'success' }
                    : { title: 'Could not reset', description: 'That ID does not exist or was never edited.', color: 'error' })],
            });
            return;
        }

        case 'resetall': {
            const count = await resetAllMessageEdits();
            await reply(interaction, {
                embeds: [createEmbed({ title: 'Reset', description: `Removed ${count} edit(s). All messages are back to the originals.`, color: 'success' })],
            });
            return;
        }

        case 'stats': {
            const stats = messageStats();
            const breakdown = TYPES
                .filter((t) => stats.byType[t])
                .map((t) => `**${t}**: ${stats.byType[t]} - ${TYPE_HELP[t]}`)
                .join('\n');
            await reply(interaction, {
                embeds: [createEmbed({
                    title: 'Message stats',
                    description: `Known messages: **${stats.total}**\nEdited: **${stats.edited}**\n\n${breakdown || 'Nothing recorded yet.'}`,
                })],
            });
            return;
        }

        default: {
            await reply(interaction, {
                embeds: [createEmbed({
                    title: 'Bot Messages',
                    description: [
                        `\`${prefix}messages list [error|success|warning|info|text|other] [page]\``,
                        `\`${prefix}messages list edited\``,
                        `\`${prefix}messages list <search words>\``,
                        `\`${prefix}messages view <id>\``,
                        `\`${prefix}messages edit <id> <new text>\``,
                        `\`${prefix}messages reset <id>\``,
                        `\`${prefix}messages resetall\``,
                        `\`${prefix}messages stats\``,
                    ].join('\n'),
                })],
            });
        }
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('messages')
        .setDescription('Admins only: see and edit every message the bot sends')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((sub) => sub
            .setName('list')
            .setDescription('Show the messages the bot has sent')
            .addStringOption((o) => o
                .setName('type')
                .setDescription('Only this kind of message')
                .addChoices(...TYPES.map((t) => ({ name: `${t} - ${TYPE_HELP[t]}`.slice(0, 100), value: t }))))
            .addStringOption((o) => o.setName('search').setDescription('Only messages containing this text'))
            .addBooleanOption((o) => o.setName('edited').setDescription('Only messages you already edited'))
            .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)))
        .addSubcommand((sub) => sub
            .setName('view')
            .setDescription('Show one message in full')
            .addStringOption((o) => o.setName('id').setDescription('Message ID from the list').setRequired(true)))
        .addSubcommand((sub) => sub
            .setName('edit')
            .setDescription('Change what a message says')
            .addStringOption((o) => o.setName('id').setDescription('Message ID from the list').setRequired(true))
            .addStringOption((o) => o.setName('text').setDescription('New text (keep {1} {2} to show changing parts)').setRequired(true).setMaxLength(4000)))
        .addSubcommand((sub) => sub
            .setName('reset')
            .setDescription('Put one message back to the original')
            .addStringOption((o) => o.setName('id').setDescription('Message ID from the list').setRequired(true)))
        .addSubcommand((sub) => sub
            .setName('resetall')
            .setDescription('Put every edited message back to the original'))
        .addSubcommand((sub) => sub
            .setName('stats')
            .setDescription('How many messages are known, by type')),

    async execute(interaction) {
        try {
            // Don't catalog or edit the editor's own replies (so a bad edit can never lock you out).
            await withoutEditing(() => run(interaction));
        } catch (error) {
            logger.error('Messages command error:', error);
            throw error;
        }
    },
};
