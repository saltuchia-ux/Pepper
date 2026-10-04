import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('grole')
        .setDescription('Give a role to a user')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Role to give')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to give the role to')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        return giveRole(interaction);
    },

    async prefixExecute(interaction, config, client) {
        const args =
            interaction.options?._hoistedOptions?.map(option => String(option.value)) || [];

        const roleArg = args[0];
        const userArg = args[1];

        const roleId = extractRoleId(roleArg);
        const userId = extractUserId(userArg);

        if (!roleId) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ Role not found. Use a role mention like `@Role`.',
                ephemeral: true,
            });
        }

        if (!userId) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ User not found. Use a user mention like `@User`.',
                ephemeral: true,
            });
        }

        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        const target = await interaction.guild.members.fetch(userId).catch(() => null);

        if (!role) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ I could not find that role.',
                ephemeral: true,
            });
        }

        if (!target) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ I could not find that user.',
                ephemeral: true,
            });
        }

        return giveRole(interaction, role, target);
    },
};

function extractRoleId(value) {
    if (!value) return null;

    const text = String(value).trim();

    const mention = text.match(/^<@&(\d+)>$/);
    if (mention) return mention[1];

    if (/^\d+$/.test(text)) return text;

    return null;
}

function extractUserId(value) {
    if (!value) return null;

    const text = String(value).trim();

    const mention = text.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];

    if (/^\d+$/.test(text)) return text;

    return null;
}

async function giveRole(interaction, suppliedRole = null, suppliedTarget = null) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Ban Members** permission to use `.grole`.',
            ephemeral: true,
        });
    }

    const guild = interaction.guild;

    const role =
        suppliedRole || interaction.options.getRole('role');

    const target =
        suppliedTarget || interaction.options.getMember('user');

    if (!role) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ Role not found.',
            ephemeral: true,
        });
    }

    if (!target) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ User not found.',
            ephemeral: true,
        });
    }

    const botMember =
        guild.members.me ||
        await guild.members.fetchMe().catch(() => null);

    if (!botMember) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I could not find my bot member.',
            ephemeral: true,
        });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I need **Manage Roles** permission.',
            ephemeral: true,
        });
    }

    if (role.managed) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ That role is managed by Discord and cannot be assigned.',
            ephemeral: true,
        });
    }

    if (botMember.roles.highest.position <= role.position) {
        return InteractionHelper.universalReply(interaction, {
            content:
                `❌ I cannot manage ${role}.\n` +
                `My highest role: **${botMember.roles.highest.name}**\n` +
                `My position: **${botMember.roles.highest.position}**\n` +
                `Target position: **${role.position}**`,
            ephemeral: true,
        });
    }

    if (role.position >= interaction.member.roles.highest.position) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You cannot give a role equal to or higher than your highest role.',
            ephemeral: true,
        });
    }

    if (target.roles.cache.has(role.id)) {
        return InteractionHelper.universalReply(interaction, {
            content: `❌ ${target} already has ${role}.`,
            ephemeral: true,
        });
    }

    try {
        await target.roles.add(
            role,
            `Given by ${interaction.user.tag}`
        );

        return InteractionHelper.universalReply(interaction, {
            content: `✅ Gave ${role} to ${target}.`,
        });
    } catch (error) {
        console.error('GROLE ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content:
                `❌ Discord rejected the role change.\n` +
                `Error: \`${error.message}\``,
            ephemeral: true,
        });
    }
}
