import {
    SlashCommandBuilder,
    PermissionFlagsBits
} from 'discord.js';

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
                .setDescription('Optional emoji')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('color')
                .setDescription('Role color, e.g. #ff0000')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(
            PermissionFlagsBits.BanMembers
        ),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(
        interaction,
        config,
        client
    ) {
        return createRole(interaction, false);
    },

    async prefixExecute(
        interaction,
        config,
        client
    ) {
        return createRole(interaction, true);
    },
};

async function createRole(
    interaction,
    isPrefix
) {
    // BAN MEMBERS PERMISSION
    if (
        !interaction.member.permissions.has(
            PermissionFlagsBits.BanMembers
        )
    ) {
        return InteractionHelper.universalReply(
            interaction,
            {
                content:
                    '❌ You need **Ban Members** permission to use `.mrole`.',
                ephemeral: true,
            }
        );
    }

    const guild = interaction.guild;

    if (!guild) {
        return InteractionHelper.universalReply(
            interaction,
            {
                content:
                    '❌ This command can only be used in a server.',
                ephemeral: true,
            }
        );
    }

    // FIND BOT
    const botMember =
        guild.members.me ??
        await guild.members
            .fetchMe()
            .catch(() => null);

    if (!botMember) {
        return InteractionHelper.universalReply(
            interaction,
            {
                content:
                    '❌ I could not find my bot member.',
                ephemeral: true,
            }
        );
    }

    // MANAGE ROLES
    if (
        !botMember.permissions.has(
            PermissionFlagsBits.ManageRoles
        )
    ) {
        return InteractionHelper.universalReply(
            interaction,
            {
                content:
                    '❌ I need **Manage Roles** permission.',
                ephemeral: true,
            }
        );
    }

    let name;
    let emoji = null;
    let color = null;

    // ==========================================
    // PREFIX COMMAND
    // ==========================================

    if (isPrefix) {
        const message =
            interaction.message ?? interaction;

        const content =
            message.content?.trim() || '';

        const prefixMatch =
            content.match(
                /^\.mrole(?:\s+|$)/i
            );

        if (!prefixMatch) {
            return InteractionHelper.universalReply(
                interaction,
                {
                    content:
                        '❌ Usage: `.mrole role name #color`',
                    ephemeral: true,
                }
            );
        }

        let raw =
            content
                .slice(prefixMatch[0].length)
                .trim();

        if (!raw) {
            return InteractionHelper.universalReply(
                interaction,
                {
                    content:
                        '❌ You need to provide a role name.',
                    ephemeral: true,
                }
            );
        }

        // ==========================================
        // EVERYTHING AFTER # IS COLOR
        // ==========================================

        const colorMatch =
            raw.match(
                /\s+(#[0-9A-Fa-f]{6})\s*$/
            );

        if (colorMatch) {
            color =
                colorMatch[1];

            raw =
                raw
                    .slice(
                        0,
                        colorMatch.index
                    )
                    .trim();
        }

        // EVERYTHING LEFT IS ROLE NAME
        name = raw;

    } else {
        // ==========================================
        // SLASH COMMAND
        // ==========================================

        name =
            interaction.options
                .getString('name')
                ?.trim();

        emoji =
            interaction.options
                .getString('emoji')
                ?.trim() || null;

        color =
            interaction.options
                .getString('color')
                ?.trim() || null;
    }

    // ==========================================
    // CHECK ROLE NAME
    // ==========================================

    if (!name) {
        return InteractionHelper.universalReply(
            interaction,
            {
                content:
                    '❌ You need to provide a role name.',
                ephemeral: true,
            }
        );
    }

    // ==========================================
    // CHECK COLOR
    // ==========================================

    let roleColor;

    if (color) {
        if (
            !/^#?[0-9A-Fa-f]{6}$/.test(color)
        ) {
            return InteractionHelper.universalReply(
                interaction,
                {
                    content:
                        '❌ Invalid color. Use a hex color like `#ff7527`.',
                    ephemeral: true,
                }
            );
        }

        roleColor =
            color.startsWith('#')
                ? color
                : `#${color}`;
    }

    // ==========================================
    // CREATE ROLE
    // ==========================================

    try {
        const role =
            await guild.roles.create({
                name,
                color:
                    roleColor || undefined,
                permissions: [],
                reason:
                    `Created by ${interaction.user.tag}`,
            });

        let response =
            `✅ Created ${role} successfully!\n` +
            `🎨 **Name:** ${role.name}`;

        if (roleColor) {
            response +=
                `\n🌈 **Color:** ${roleColor}`;
        }

        return InteractionHelper.universalReply(
            interaction,
            {
                content: response,
            }
        );

    } catch (error) {
        console.error(
            'MROLE ERROR:',
            error
        );

        return InteractionHelper.universalReply(
            interaction,
            {
                content:
                    `❌ I could not create the role.\n` +
                    `\`\`\`${error.message}\`\`\``,
                ephemeral: true,
            }
        );
    }
}
