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

    async prefixExecute(interaction, config, client) {
        return freeJail(interaction);
    },
};

async function freeJail(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Timeout Members** permission to use `.freejail`.',
            ephemeral: true,
        });
    }

    const target = interaction.options.getMember('user');

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
