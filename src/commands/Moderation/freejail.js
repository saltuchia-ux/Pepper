import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const JAIL_INMATE_ROLE_ID = '1556347741846642698';

export default {
    data: new SlashCommandBuilder()
        .setName('freejail')
        .setDescription('Remove a user from jail')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('The user to free from jail')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        return freeJail(interaction);
    },

    // .freejail (user id or @user)
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ This command can only be used in a server.',
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'freejail')
            .split(/\s+/)
            .filter(Boolean);

        const userId = extractUserId(parts[0]);

        if (!userId) {
            return InteractionHelper.universalReply(interaction, {
                content:
                    '❌ User not found. Use `.freejail @user` or `.freejail userID`.',
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

        return freeJail(interaction, member);
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

async function freeJail(interaction, suppliedMember = null) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Timeout Members** permission to use `.freejail`.',
            ephemeral: true,
        });
    }

    const target = suppliedMember || interaction.options.getMember('user');

    if (!target) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ User not found.',
            ephemeral: true,
        });
    }

    const jailRole = interaction.guild.roles.cache.get(JAIL_INMATE_ROLE_ID);

    if (!jailRole) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ Jail Inmate role was not found.',
            ephemeral: true,
        });
    }

    if (!target.roles.cache.has(JAIL_INMATE_ROLE_ID)) {
        return InteractionHelper.universalReply(interaction, {
            content: `❌ **${target.user.tag}** is not jailed.`,
            ephemeral: true,
        });
    }

    try {
        await target.roles.remove(
            JAIL_INMATE_ROLE_ID,
            'User released from jail'
        );

        return InteractionHelper.universalReply(interaction, {
            content: `🔓 **${target.user.tag}** has been **freed from jail**.`,
        });
    } catch (error) {
        console.error('FREEJAIL ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content: '❌ I could not free that user. Check my **Manage Roles** permission and role hierarchy.',
            ephemeral: true,
        });
    }
}
