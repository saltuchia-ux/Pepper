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
    // Timeout Members permission
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Timeout Members** permission to use `.jail`.',
            ephemeral: true,
        });
    }

    // Get the user from the prefix command
    const target =
        interaction.options.getMember('user') ||
        interaction.options.getUser('user');

    if (!target) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ User not found. Use `.jail @user reason`.',
            ephemeral: true,
        });
    }

    const reason =
        interaction.options.getString('reason')?.trim() ||
        'No reason provided';

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

        return InteractionHelper.universalReply(interaction, {
            content:
                `🔒 ${targetMember} has been **jailed permanently**.\n` +
                `📝 **Reason:** ${reason}`,
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
