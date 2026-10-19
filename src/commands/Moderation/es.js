import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getPrefixText, errorBox } from '../../utils/punishmentTools.js';
import { getEditedMessages } from '../../services/snipeService.js';

const MAX_TEXT = 1000;

export default {
    data: new SlashCommandBuilder()
        .setName('es')
        .setDescription('Edit snipe: show a recently edited message in this channel')
        .addIntegerOption((option) =>
            option
                .setName('number')
                .setDescription('1 = newest edited message, 2 = the one before, and so on')
                .setMinValue(1)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: 'moderation',

    // Slash command: /es number:2
    async execute(interaction, config, client) {
        const number = interaction.options.getInteger('number') || 1;

        return showEditSnipe(interaction, number);
    },

    // Prefix command: .es   or   .es 2
    async prefixExecute(interaction, config, client) {
        const parts = getPrefixText(interaction, 'es')
            .split(/\s+/)
            .filter(Boolean);

        if (parts.length && !/^\d{1,4}$/.test(parts[0])) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'Wrong number',
                        'Use `.es` for the newest edited message, or `.es 2` for the one before it.'
                    ),
                ],
                ephemeral: true,
            });
        }

        const number = parts.length ? parseInt(parts[0], 10) : 1;

        return showEditSnipe(interaction, Math.max(1, number));
    },
};

function cut(text) {
    const value = text || '*(empty)*';

    return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value;
}

async function showEditSnipe(interaction, number) {
    // Only people with the Manage Messages permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        throw new TitanBotError(
            'Missing Manage Messages permission',
            ErrorTypes.PERMISSION,
            'You need the **Manage Messages** permission to use this command.',
        );
    }

    const list = getEditedMessages(interaction.channel.id);

    if (!list.length) {
        return InteractionHelper.universalReply(interaction, {
            embeds: [
                errorBox(
                    'Nothing to snipe',
                    'There are no edited messages saved for this channel.\n' +
                    'Edited messages are kept for 2 hours.'
                ),
            ],
            ephemeral: true,
        });
    }

    if (number > list.length) {
        return InteractionHelper.universalReply(interaction, {
            embeds: [
                errorBox(
                    'Not that many',
                    `There ${list.length === 1 ? 'is only 1 edited message' : `are only ${list.length} edited messages`} saved for this channel.`
                ),
            ],
            ephemeral: true,
        });
    }

    const entry = list[number - 1];

    const editedAt = Math.floor(entry.editedAt / 1000);

    return InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                description: `[Jump to message](${entry.url})`,
                color: 'primary',
                author: { name: entry.authorName, iconURL: entry.avatarURL || undefined },
                fields: [
                    { name: '📝 Before', value: cut(entry.before) },
                    { name: '✏️ After', value: cut(entry.after) },
                    { name: '🕒 Edited', value: `<t:${editedAt}:R>`, inline: true },
                ],
                footer: `Edited message ${number} of ${list.length}`,
                timestamp: true,
            }),
        ],
    });
}
