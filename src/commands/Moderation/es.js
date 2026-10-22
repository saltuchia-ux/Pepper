import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getPrefixText, errorBox } from '../../utils/punishmentTools.js';
import { getEditedMessages } from '../../services/snipeService.js';
import { missingPermission, syntaxReply, plainReply } from '../../utils/punishmentTools.js';

const MAX_TEXT = 4000;
const EMBED_COLOR = 0x4e5058;

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
            return syntaxReply(interaction, 'es');
        }

        const number = parts.length ? parseInt(parts[0], 10) : 1;

        return showEditSnipe(interaction, Math.max(1, number));
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

async function showEditSnipe(interaction, number) {
    // Only people with the Manage Messages permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        throw missingPermission('manage_messages');
    }

    const list = getEditedMessages(interaction.channel.id);

    if (!list.length) {
        return plainReply(interaction, 'Nothing to snipe');
    }

    if (number > list.length) {
        return plainReply(interaction, `Only ${list.length} ${list.length === 1 ? 'edited message' : 'edited messages'} saved.`);
    }

    const entry = list[number - 1];

    // Only the text from BEFORE the edit, exactly as it was written
    const description = (entry.before || '*(empty)*').slice(0, MAX_TEXT);

    // Built directly (not with createEmbed) so it looks the same as .s
    const data = {
        color: EMBED_COLOR,
        author: {
            name: entry.authorName,
            ...(entry.avatarURL ? { icon_url: entry.avatarURL } : {}),
        },
        description,
        footer: {
            text: `Edited ${timeAgo(entry.editedAt)} • ${number}/${list.length} message${list.length === 1 ? '' : 's'}`,
            ...(interaction.guild?.iconURL?.({ size: 64 })
                ? { icon_url: interaction.guild.iconURL({ size: 64 }) }
                : {}),
        },
    };

    return InteractionHelper.universalReply(interaction, {
        embeds: [new EmbedBuilder(data)],
    });
}
