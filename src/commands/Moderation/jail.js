import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const JAIL_INMATE_ROLE_ID = '1556347741846642698';

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

    async prefixExecute(interaction, config, client) {
        return jailUser(interaction);
    },
};

async function jailUser(interaction) {
    // Require Timeout Members / Moderate Members permission
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Timeout Members** permission to use `.jail`.',
            ephemeral: true,
        });
    }

    const target = interaction.options.getMember('user');
    const reason =
        interaction.options.getString('reason')?.trim() ||
        'No reason provided';

    if (!target) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ User not found.',
            ephemeral: true,
        });
    }

    if (target.id === interaction.user.id) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You cannot jail yourself.',
            ephemeral: true,
        });
    }

    if (target.user.bot) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You cannot jail a bot.',
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

    // Check the bot can manage the Jail Inmate role
    if (!jailRole.editable) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I cannot manage the **Jail Inmate** role. Make sure my bot role is above it.',
            ephemeral: true,
        });
    }

    // Check the bot can manage the target
    if (!target.manageable) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I cannot manage that user. Make sure my bot role is higher than their highest role.',
            ephemeral: true,
        });
    }

    try {
        // Remove all roles except @everyone
        await target.roles.set(
            [JAIL_INMATE_ROLE_ID],
            `Jailed permanently: ${reason}`
        );

        return InteractionHelper.universalReply(interaction, {
            content:
                `🔒 **${target.user.tag}** has been **jailed permanently**.\n` +
                `📝 **Reason:** ${reason}`,
        });
    } catch (error) {
        console.error('JAIL ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content: '❌ I could not jail that user. Check my **Manage Roles** permission and role hierarchy.',
            ephemeral: true,
        });
    }
}
