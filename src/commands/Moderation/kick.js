import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

const DEFAULT_REASON = 'No reason provided';
const MAX_REASON_LENGTH = 500;

export default {
    data: new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a user from the server")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("The user to kick")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Reason for the kick (optional)")
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    category: "moderation",

    // Slash command: /kick target:@user reason:...
    async execute(interaction, config, client) {
        const user = interaction.options.getUser("target");

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to kick.',
                { subtype: 'invalid_user' },
            );
        }

        const member =
            interaction.options.getMember("target") ||
            await interaction.guild.members.fetch(user.id).catch(() => null);

        const reason =
            interaction.options.getString("reason")?.trim() || DEFAULT_REASON;

        return kickMember(interaction, client, user, member, reason);
    },

    // Prefix command: .kick @user reason   or   .kick userID reason
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'kick')
            .split(/\s+/)
            .filter(Boolean);

        const userId = extractUserId(parts[0]);

        if (!userId) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'User not found',
                        'Use `.kick @user reason` or `.kick userID reason`.\n' +
                        'The reason is optional.\n' +
                        'Example: `.kick 123456789012345678 spamming`'
                    ),
                ],
                ephemeral: true,
            });
        }

        const member = await guild.members.fetch(userId).catch(() => null);

        if (!member) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'Member not found',
                        'I could not find that member in this server. Check the ID and make sure they have not left.'
                    ),
                ],
                ephemeral: true,
            });
        }

        const reason = parts.slice(1).join(' ') || DEFAULT_REASON;

        return kickMember(interaction, client, member.user, member, reason);
    },
};

// Gets the text after ".COMMAND" from a prefix command.
function getPrefixText(interaction, commandName) {
    const realMessage =
        interaction.message ??
        interaction._responseCoordinator?.message ??
        null;

    const content = realMessage?.content?.trim();

    if (content) {
        const match = content.match(
            new RegExp(`^\\S*?${commandName}(?:\\s+|$)`, 'i')
        );

        if (match) {
            return content.slice(match[0].length).trim();
        }
    }

    const args =
        interaction.options?._hoistedOptions?.map(option =>
            String(option.value)
        ) || [];

    return args.join(' ').trim();
}

// Accepts <@123>, <@!123> or a plain user ID.
function extractUserId(value) {
    if (!value) return null;

    const text = String(value).trim();

    const mention = text.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];

    if (/^\d+$/.test(text)) return text;

    return null;
}

function errorBox(title, description) {
    return createEmbed({
        title: `❌ ${title}`,
        description,
        color: 'error',
    });
}

// Shared by the slash and prefix versions
async function kickMember(interaction, client, user, member, reason) {
    // Only people with the Kick Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        throw new TitanBotError(
            'Missing Kick Members permission',
            ErrorTypes.PERMISSION,
            'You need the **Kick Members** permission to use this command.',
        );
    }

    if (!member) {
        throw new TitanBotError(
            "Target not found",
            ErrorTypes.USER_INPUT,
            "The target user is not currently in this server.",
            { subtype: 'user_not_found' },
        );
    }

    if (user.id === interaction.user.id) {
        throw new TitanBotError(
            "Cannot kick self",
            ErrorTypes.VALIDATION,
            "You cannot kick yourself.",
        );
    }

    if (user.id === client.user.id) {
        throw new TitanBotError(
            "Cannot kick bot",
            ErrorTypes.VALIDATION,
            "You cannot kick the bot.",
        );
    }

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
        );
    }

    const result = await ModerationService.kickUser({
        guild: interaction.guild,
        member,
        moderator: interaction.member,
        reason,
    });

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: '👢 Member Kicked',
                description: `${user} has been kicked.`,
                color: 'warning',
                thumbnail: user.displayAvatarURL?.({ size: 256 }) || null,
                fields: [
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                    { name: '📝 Reason', value: reason, inline: true },
                ],
                footer: `Case #${result.caseId}`,
                timestamp: true,
            }),
        ],
    });
}
