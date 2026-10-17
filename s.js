import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getPrefixText, errorBox } from '../../utils/punishmentTools.js';
import { getDeletedMessages } from '../../services/snipeService.js';

const MAX_TEXT = 3900;

export default {
    data: new SlashCommandBuilder()
        .setName('s')
        .setDescription('Snipe: show a recently deleted message in this channel')
        .addIntegerOption((option) =>
            option
                .setName('number')
                .setDescription('1 = newest deleted message, 2 = the one before, and so on')
                .setMinValue(1)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: 'moderation',

    // Slash command: /s number:2
    async execute(interaction, config, client) {
        const number = interaction.options.getInteger('number') || 1;

        return showSnipe(interaction, number);
    },

    // Prefix command: .s   or   .s 2
    async prefixExecute(interaction, config, client) {
        const parts = getPrefixText(interaction, 's')
            .split(/\s+/)
            .filter(Boolean);

        if (parts.length && !/^\d{1,4}$/.test(parts[0])) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'Wrong number',
                        'Use `.s` for the newest deleted message, or `.s 2` for the one before it.'
                    ),
                ],
                ephemeral: true,
            });
        }

        const number = parts.length ? parseInt(parts[0], 10) : 1;

        return showSnipe(interaction, Math.max(1, number));
    },
};

async function showSnipe(interaction, number) {
    // Only people with the Manage Messages permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        throw new TitanBotError(
            'Missing Manage Messages permission',
            ErrorTypes.PERMISSION,
            'You need the **Manage Messages** permission to use this command.',
        );
    }

    const list = getDeletedMessages(interaction.channel.id);

    if (!list.length) {
        return InteractionHelper.universalReply(interaction, {
            embeds: [
                errorBox(
                    'Nothing to snipe',
                    'There are no deleted messages saved for this channel.\n' +
                    'Deleted messages are kept for 2 hours.'
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
                    `There ${list.length === 1 ? 'is only 1 deleted message' : `are only ${list.length} deleted messages`} saved for this channel.`
                ),
            ],
            ephemeral: true,
        });
    }

    const entry = list[number - 1];

    const deletedAt = Math.floor(entry.deletedAt / 1000);
    const sentAt = Math.floor(entry.createdAt / 1000);

    const fields = [
        { name: '🗑️ Deleted', value: `<t:${deletedAt}:R>`, inline: true },
        { name: '✉️ Sent', value: `<t:${sentAt}:R>`, inline: true },
    ];

    if (entry.attachments.length) {
        fields.push({
            name: '📎 Attachments',
            value: entry.attachments
                .slice(0, 5)
                .map((attachment) => `[${attachment.name}](${attachment.url})`)
                .join('\n')
                .slice(0, 1000),
        });
    }

    const firstImage = entry.attachments.find((attachment) => attachment.isImage);

    return InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                description: (entry.content || '*(no text)*').slice(0, MAX_TEXT),
                color: 'primary',
                author: { name: entry.authorName, iconURL: entry.avatarURL || undefined },
                fields,
                image: firstImage ? firstImage.url : null,
                footer: `Deleted message ${number} of ${list.length}`,
                timestamp: true,
            }),
        ],
    });
}
