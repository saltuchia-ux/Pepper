import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { WarningService } from '../../services/moderation/warningService.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const DEFAULT_REASON = 'No reason provided';
const MAX_REASON_LENGTH = 500;

export default {
    data: new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a user")
        .addUserOption((o) =>
            o
                .setName("target")
                .setRequired(true)
                .setDescription("User to warn"),
        )
        .addStringOption((o) =>
            o
                .setName("reason")
                .setRequired(false)
                .setMaxLength(MAX_REASON_LENGTH)
                .setDescription("Reason for the warning"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    // Slash command: /warn target:@user reason:...
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Warn interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'warn'
            });
            return;
        }

        const target = interaction.options.getUser("target");

        if (!target) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to warn.',
                { subtype: 'invalid_user' },
            );
        }

        const member =
            interaction.options.getMember("target") ||
            await interaction.guild.members.fetch(target.id).catch(() => null);

        const reason =
            interaction.options.getString("reason")?.trim() || DEFAULT_REASON;

        return warnMember(interaction, client, target, member, reason);
    },

    // Prefix command: .warn @user reason   or   .warn userID reason
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ This command can only be used in a server.',
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'warn')
            .split(/\s+/)
            .filter(Boolean);

        const userId = extractUserId(parts[0]);

        if (!userId) {
            return InteractionHelper.universalReply(interaction, {
                content:
                    '❌ User not found. Use `.warn @user reason` or `.warn userID reason`.',
                ephemeral: true,
            });
        }

        const member = await guild.members.fetch(userId).catch(() => null);

        if (!member) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ I could not find that member in this server.',
                ephemeral: true,
            });
        }

        const reason = parts.slice(1).join(' ') || DEFAULT_REASON;

        return warnMember(interaction, client, member.user, member, reason);
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

// Shared by the slash and prefix versions
async function warnMember(interaction, client, target, member, reason) {
    const moderator = interaction.user;
    const guildId = interaction.guildId;

    if (!member) {
        throw new TitanBotError(
            "Target not found",
            ErrorTypes.USER_INPUT,
            "The target user is not currently in this server."
        );
    }

    if (target.id === moderator.id) {
        throw new TitanBotError(
            'Cannot warn yourself',
            ErrorTypes.USER_INPUT,
            'You cannot warn yourself.'
        );
    }

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Warning reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
            { subtype: 'invalid_input' },
        );
    }

    ModerationService.assertModerationHierarchy(interaction.member, member, 'warn');

    const { id, totalCount } = await WarningService.addWarning({
        guildId,
        userId: target.id,
        moderatorId: moderator.id,
        reason,
        timestamp: Date.now()
    });

    await logModerationAction({
        client,
        guild: interaction.guild,
        event: {
            action: "User Warned",
            target: `${target.tag} (${target.id})`,
            executor: `${moderator.tag} (${moderator.id})`,
            reason,
            metadata: {
                userId: target.id,
                moderatorId: moderator.id,
                totalWarns: totalCount,
                warningNumber: totalCount,
                warningId: id
            }
        }
    });

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            successEmbed(
                `⚠️ **Warned** ${target.tag}`,
                `**Reason:** ${reason}\n**Total Warns:** ${totalCount}`,
            ),
        ],
    });
}
