import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getPrefixText, errorBox } from '../../utils/punishmentTools.js';
import { getDeletedMessages } from '../../services/snipeService.js';

const MAX_TEXT = 4000;
const EMBED_COLOR = 0x4e5058;

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

// 5 minutes ago, 2 hours ago, ...
function timeAgo(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

    if (seconds < 10) return 'just now';

    const units = [
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
        ['second', 1],
    ];

    for (const [name, size] of units) {
        const count = Math.floor(seconds / size);

        if (count >= 1) return `${count} ${name}${count === 1 ? '' : 's'} ago`;
    }

    return 'just now';
}

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

    // Text of the deleted message, exactly as it was written
    let description = entry.content || '';

    const otherFiles = entry.attachments.filter((attachment) => !attachment.isImage);

    if (otherFiles.length) {
        const links = otherFiles
            .slice(0, 5)
            .map((attachment) => `[${attachment.name}](${attachment.url})`)
            .join('\n');

        description = description ? `${description}\n\n${links}` : links;
    }

    description = description.slice(0, MAX_TEXT);

    const firstImage = entry.attachments.find((attachment) => attachment.isImage);

    // This embed is built directly (not with createEmbed) so the deleted message
    // keeps its emojis and spacing, and the footer shows exactly what we write.
    const data = {
        color: EMBED_COLOR,
        author: {
            name: entry.authorName,
            ...(entry.avatarURL ? { icon_url: entry.avatarURL } : {}),
        },
        footer: {
            text: `Deleted ${timeAgo(entry.deletedAt)} • ${number}/${list.length} message${list.length === 1 ? '' : 's'}`,
            ...(interaction.guild?.iconURL?.({ size: 64 })
                ? { icon_url: interaction.guild.iconURL({ size: 64 }) }
                : {}),
        },
    };

    if (description) data.description = description;
    if (firstImage) data.image = { url: firstImage.url };

    return InteractionHelper.universalReply(interaction, {
        embeds: [new EmbedBuilder(data)],
    });
}
