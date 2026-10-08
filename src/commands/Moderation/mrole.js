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
                .setDescription('Optional emoji to put in front of the name')
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

    async execute(interaction, config, client) {
        return createRole(interaction, false);
    },

    async prefixExecute(interaction, config, client) {
        return createRole(interaction, true);
    },
};

// Pulls the text after ".mrole" out of a prefix command.
// Uses the real message first, then falls back to the split-up arguments.
function getPrefixText(interaction) {
    const realMessage =
        interaction.message ??
        interaction._responseCoordinator?.message ??
        null;

    const content = realMessage?.content?.trim();

    if (content) {
        const match = content.match(/^\S*?mrole(?:\s+|$)/i);
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

// Splits "🔥 meow meow #ff0000" into { name: "🔥 meow meow", color: "#ff0000" }
function splitNameAndColor(raw) {
    let name = raw.trim();
    let color = null;

    const colorMatch = name.match(/(?:^|\s)(#[0-9A-Fa-f]{6})\s*$/);

    if (colorMatch) {
        color = colorMatch[1];
        name = name.slice(0, colorMatch.index).trim();
    }

    return { name, color };
}

async function createRole(interaction, isPrefix) {
    const reply = (content) =>
        InteractionHelper.universalReply(interaction, {
            content,
            ephemeral: true,
        });

    // BAN MEMBERS PERMISSION
    if (!interaction.member?.permissions.has(PermissionFlagsBits.BanMembers)) {
        return reply('❌ You need **Ban Members** permission to use `.mrole`.');
    }

    const guild = interaction.guild;

    if (!guild) {
        return reply('❌ This command can only be used in a server.');
    }

    // FIND BOT
    const botMember =
        guild.members.me ??
        await guild.members.fetchMe().catch(() => null);

    if (!botMember) {
        return reply('❌ I could not find my bot member.');
    }

    // MANAGE ROLES
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return reply('❌ I need **Manage Roles** permission.');
    }

    let name;
    let color = null;

    if (isPrefix) {
        // .mrole 🔥 any words you want #ff0000
        const raw = getPrefixText(interaction);

        if (!raw) {
            return reply(
                '❌ Usage: `.mrole role name #color`\n' +
                'Example: `.mrole 🔥 cool kids #ff0000`'
            );
        }

        ({ name, color } = splitNameAndColor(raw));
    } else {
        name = interaction.options.getString('name')?.trim();

        const emoji = interaction.options.getString('emoji')?.trim();
        if (emoji) {
            name = `${emoji} ${name}`;
        }

        color = interaction.options.getString('color')?.trim() || null;
    }

    // CHECK ROLE NAME
    if (!name) {
        return reply('❌ You need to provide a role name.');
    }

    if (/<a?:\w+:\d+>/.test(name)) {
        return reply(
            '❌ Custom server emojis cannot be used in role names. ' +
            'Use a normal emoji like 🔥 instead.'
        );
    }

    if (name.length > 100) {
        return reply('❌ Role names can be at most 100 characters long.');
    }

    // CHECK COLOR
    let roleColor;

    if (color) {
        if (!/^#?[0-9A-Fa-f]{6}$/.test(color)) {
            return reply('❌ Invalid color. Use a hex color like `#ff7527`.');
        }

        roleColor = color.startsWith('#') ? color : `#${color}`;
    }

    // CREATE ROLE
    try {
        const role = await guild.roles.create({
            name,
            color: roleColor || undefined,
            permissions: [],
            reason: `Created by ${interaction.user.tag}`,
        });

        let response =
            `✅ Created ${role} successfully!\n` +
            `🎨 **Name:** ${role.name}`;

        if (roleColor) {
            response += `\n🌈 **Color:** ${roleColor}`;
        }

        return InteractionHelper.universalReply(interaction, {
            content: response,
            allowedMentions: { parse: [] },
        });

    } catch (error) {
        console.error('MROLE ERROR:', error);

        return reply(
            `❌ I could not create the role.\n\`\`\`${error.message}\`\`\``
        );
    }
}
