import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

const JAIL_INMATE_ROLE_ID = '1556347741846642698';
const DEFAULT_REASON = 'No reason provided';

export default {
    data: new SlashCommandBuilder()
        .setName('jail')
        .setDescription('Jail a user permanently')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to jail')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('reason')
                .setDescription('Reason for the jail')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        return jailUser(interaction);
    },

    // .jail (user id or @user) reason here
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ This command can only be used in a server.',
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'jail')
            .split(/\s+/)
            .filter(Boolean);

        const userId = extractUserId(parts[0]);

        if (!userId) {
            return InteractionHelper.universalReply(interaction, {
                content:
                    '❌ User not found. Use `.jail @user reason` or `.jail userID reason`.',
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

        const reason = parts.slice(1).join(' ');

        return jailUser(interaction, member, reason);
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

async function jailUser(interaction, suppliedMember = null, suppliedReason = null) {
    // Timeout Members permission
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Timeout Members** permission to use `.jail`.',
            ephemeral: true,
        });
    }

    // Get the user from the prefix command
    const target =
        suppliedMember ||
        interaction.options.getMember('user') ||
        interaction.options.getUser('user');

    if (!target) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ User not found. Use `.jail @user reason`.',
            ephemeral: true,
        });
    }

    const reason =
        suppliedReason?.trim() ||
        interaction.options.getString('reason')?.trim() ||
        DEFAULT_REASON;

    const targetMember =
        target.member || target;

    if (!targetMember.roles) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I could not find that member in this server.',
            ephemeral: true,
        });
    }

    if (targetMember.id === interaction.user.id) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You cannot jail yourself.',
            ephemeral: true,
        });
    }

    if (targetMember.user?.bot) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You cannot jail a bot.',
            ephemeral: true,
        });
    }

    const guild = interaction.guild;
    const jailRole = guild.roles.cache.get(JAIL_INMATE_ROLE_ID);

    if (!jailRole) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ **Jail Inmate** role was not found.',
            ephemeral: true,
        });
    }

    const botMember = guild.members.me;

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I need **Manage Roles** permission.',
            ephemeral: true,
        });
    }

    if (!jailRole.editable) {
        return InteractionHelper.universalReply(interaction, {
            content:
                '❌ I cannot manage the **Jail Inmate** role. Put the Jail Inmate role below my bot role.',
            ephemeral: true,
        });
    }

    if (!targetMember.manageable) {
        return InteractionHelper.universalReply(interaction, {
            content:
                '❌ I cannot manage that user because their highest role is above my bot role.',
            ephemeral: true,
        });
    }

    try {
        // Remove every role and give Jail Inmate
        await targetMember.roles.set(
            [JAIL_INMATE_ROLE_ID],
            `Permanently jailed by ${interaction.user.tag}: ${reason}`
        );

        // Tell the user in a DM (silently skipped if their DMs are closed)
        await sendJailDm({
            guild,
            user: targetMember.user ?? targetMember,
            reason,
        });

        const avatar = (targetMember.user ?? targetMember).displayAvatarURL?.({ size: 256 });

        return InteractionHelper.universalReply(interaction, {
            embeds: [
                createEmbed({
                    title: '🔒 Member Jailed',
                    description: `${targetMember} has been **jailed permanently**.`,
                    color: 'error',
                    thumbnail: avatar || null,
                    fields: [
                        { name: '🛡️ Moderator', value: `${interaction.user}`, inline: true },
                        { name: '📝 Reason', value: reason, inline: true },
                    ],
                    timestamp: true,
                }),
            ],
        });

    } catch (error) {
        console.error('JAIL ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content:
                '❌ I could not jail that user. Check **Manage Roles** and the bot role hierarchy.',
            ephemeral: true,
        });
    }
}

// DM sent to the jailed user:
//   "You have been jailed in <server> for: <reason>"  (or "no reason")
async function sendJailDm({ guild, user, reason }) {
    try {
        const reasonText = reason === DEFAULT_REASON ? 'no reason' : reason;

        const embed = createEmbed({
            title: '🔒 You have been jailed',
            description: `You have been jailed in **${guild.name}** for: **${reasonText}**`,
            color: 'error',
            thumbnail: guild.iconURL?.({ size: 256 }) || null,
            timestamp: true,
        });

        await user.send({ embeds: [embed] });
        return true;
    } catch (error) {
        logger.debug(`Could not DM jail notice to ${user.id}: ${error.message}`);
        return false;
    }
}
