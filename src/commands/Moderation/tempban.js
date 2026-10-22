import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { addTempBan, TEMP_BAN_MARKER } from '../../services/tempBanService.js';
import {
    DEFAULT_REASON,
    MAX_REASON_LENGTH,
    getPrefixText,
    extractUserId,
    errorBox,
    parseDuration,
    formatDuration,
    getServerInvite,
    sendPunishmentDm,
    buildBanDm,
} from '../../utils/punishmentTools.js';
import { missingPermission, syntaxReply, userNotFoundReply } from '../../utils/punishmentTools.js';

// The longest temporary ban you can set
const MAX_BAN_MINUTES = 365 * 24 * 60;

const durationChoices = [
    { name: "1 hour", value: 60 },
    { name: "6 hours", value: 360 },
    { name: "1 day", value: 1440 },
    { name: "3 days", value: 4320 },
    { name: "1 week", value: 10080 },
    { name: "2 weeks", value: 20160 },
    { name: "30 days", value: 43200 },
];

export default {
    data: new SlashCommandBuilder()
        .setName("tempban")
        .setDescription("Ban a user for a set time. The bot unbans them by itself when it is over.")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("The user to ban")
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName("duration")
                .setDescription("How long the ban lasts")
                .setRequired(true)
                .addChoices(...durationChoices),
        )
        .addStringOption((option) =>
            option
                .setName("reason")
                .setDescription("Reason for the ban (optional)")
                .setMaxLength(MAX_REASON_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: "moderation",

    // Slash command: /tempban target:@user duration:3 days reason:...
    async execute(interaction, config, client) {
        const user = interaction.options.getUser("target");

        if (!user) {
            throw new TitanBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to ban.',
                { subtype: 'invalid_user' },
            );
        }

        const minutes = interaction.options.getInteger("duration");
        const reason =
            interaction.options.getString("reason")?.trim() || DEFAULT_REASON;

        return tempBanUser(interaction, client, user, minutes, reason);
    },

    // Prefix command: .tempban @user 3 days reason   or   .tempban userID 1w
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'tempban')
            .split(/\s+/)
            .filter(Boolean);

        const target = await takeUserFromWords(guild, parts);

        if (!target) {
            return parts.length ? userNotFoundReply(interaction) : syntaxReply(interaction, 'tempban');
        }

        const rest = parts.slice(target.used);
        const parsed = parseDuration(rest);

        if (!parsed) {
            return syntaxReply(interaction, 'tempban');
        }

        // A user ID works even if the person is not in the server
        const discordClient = client ?? interaction.client;
        const user =
            target.member?.user ??
            await discordClient.users.fetch(target.id).catch(() => null);

        if (!user) {
            return userNotFoundReply(interaction);
        }

        const reason = rest.slice(parsed.used).join(' ') || DEFAULT_REASON;

        return tempBanUser(interaction, client, user, parsed.minutes, reason);
    },
};

// Shared by the slash and prefix versions
async function tempBanUser(interaction, client, user, minutes, reason) {
    // Only people with the Ban Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw missingPermission('ban_members');
    }

    if (user.id === interaction.user.id) {
        throw new TitanBotError(
            'Cannot ban self',
            ErrorTypes.VALIDATION,
            'You cannot ban yourself.',
        );
    }

    if (user.id === client.user.id) {
        throw new TitanBotError(
            'Cannot ban bot',
            ErrorTypes.VALIDATION,
            'You cannot ban the bot.',
        );
    }

    if (reason.length > MAX_REASON_LENGTH) {
        throw new TitanBotError(
            'Reason too long',
            ErrorTypes.VALIDATION,
            `The reason must be ${MAX_REASON_LENGTH} characters or less.`,
        );
    }

    if (!Number.isFinite(minutes) || minutes < 1) {
        throw new TitanBotError(
            'Invalid ban time',
            ErrorTypes.VALIDATION,
            'A temporary ban must be at least 1 minute.',
        );
    }

    if (minutes > MAX_BAN_MINUTES) {
        throw new TitanBotError(
            'Ban too long',
            ErrorTypes.VALIDATION,
            'You can only tempban for 1 year max.',
            { plain: true },
        );
    }

    // The time is added to the saved reason (shows in the audit log and .hs).
    // The bot also uses it to be sure it only lifts its own temporary bans.
    const savedReason = `${reason} ${TEMP_BAN_MARKER} ${formatDuration(minutes)}]`;

    // The DM has to be sent BEFORE the ban (after it the bot can no longer reach them).
    // The link never expires, so it still works when the ban is over.
    const inviteUrl = await getServerInvite(interaction.guild, { neverExpires: true });
    const dmMessage = await sendPunishmentDm(
        user,
        buildBanDm({ guild: interaction.guild, reason, minutes, inviteUrl }),
    );

    let result;

    try {
        result = await ModerationService.banUser({
            guild: interaction.guild,
            user,
            moderator: interaction.member,
            reason: savedReason,
        });
    } catch (error) {
        // The ban did not happen, so take the DM back
        await dmMessage?.delete().catch(() => {});
        throw error;
    }

    const unbanAt = Date.now() + minutes * 60 * 1000;

    await addTempBan({
        guildId: interaction.guild.id,
        userId: user.id,
        unbanAt,
        moderatorId: interaction.user.id,
    });

    const unixTime = Math.floor(unbanAt / 1000);

    await InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: '🔨 Member Temporarily Banned',
                description: `${user} has been banned for ${formatDuration(minutes)}.`,
                color: 'error',
                thumbnail: user.displayAvatarURL?.({ size: 256 }) || null,
                fields: [
                    { name: '⏱️ Time', value: `${formatDuration(minutes)}\nEnds <t:${unixTime}:R>`, inline: true },
                    { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                    { name: '📝 Reason', value: reason },
                ],
                footer: `Case #${result.caseId}`,
                timestamp: true,
            }),
        ],
    });
}
