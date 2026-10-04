import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('mrole')
        .setDescription('Create a custom role')
        .addStringOption(option =>
            option
                .setName('name')
                .setDescription('Name of the role')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('emoji')
                .setDescription('Emoji for the role (optional)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('Role color, e.g. #ff0000 (optional)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        return createRole(interaction);
    },

    async prefixExecute(interaction, config, client) {
        return createRole(interaction);
    },
};

async function createRole(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Ban Members** permission to use `.mrole`.',
            ephemeral: true,
        });
    }

    const guild = interaction.guild;

    const botMember =
        guild.members.me ?? await guild.members.fetchMe().catch(() => null);

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

    let name = interaction.options.getString('name')?.trim();
    let emoji = interaction.options.getString('emoji')?.trim();
    let color = interaction.options.getString('color')?.trim();

    // Fix prefix commands:
    // .mrole meow #ff5566
    // The prefix parser may put #ff5566 into the emoji option.
    if (
        emoji &&
        /^#?[0-9A-Fa-f]{6}$/.test(emoji) &&
        !color
    ) {
        color = emoji;
        emoji = null;
    }

    if (!name) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need to provide a role name.',
            ephemeral: true,
        });
    }

    let roleColor;

    if (color) {
        if (!/^#?[0-9A-Fa-f]{6}$/.test(color)) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ Invalid color. Use a hex color like `#ff0000`.',
                ephemeral: true,
            });
        }

        roleColor = color.startsWith('#')
            ? color
            : `#${color}`;
    }

    try {
        const role = await guild.roles.create({
            name,
            color: roleColor,
            unicodeEmoji: emoji || undefined,
            permissions: [],
            reason: `Created by ${interaction.user.tag}`,
        });

        return InteractionHelper.universalReply(interaction, {
            content:
                `✅ Created ${role} successfully!\n` +
                `🎨 **Name:** ${role.name}\n` +
                `${emoji ? `😀 **Emoji:** ${emoji}\n` : ''}` +
                `${roleColor ? `🌈 **Color:** ${roleColor}` : ''}`,
        });
    } catch (error) {
        console.error('MROLE ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content:
                `❌ I could not create the role.\n` +
                `\`\`\`${error.message}\`\`\``,
            ephemeral: true,
        });
    }
}
