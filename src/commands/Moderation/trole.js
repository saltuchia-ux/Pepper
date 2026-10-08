import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('trole')
        .setDescription('Take a role from a user')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Role to remove')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to remove the role from')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        return takeRole(interaction);
    },

    // .trole role name here (user id or @user)
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ This command can only be used in a server.',
                ephemeral: true,
            });
        }

        const raw = getPrefixText(interaction, 'trole');
        const { roleText, userText } = splitRoleAndUser(raw);

        if (!roleText) {
            return InteractionHelper.universalReply(interaction, {
                content:
                    '❌ Usage: `.trole role name (user id or @user)`\n' +
                    'Example: `.trole cool kids 123456789012345678`',
                ephemeral: true,
            });
        }

        const userId = extractUserId(userText);

        if (!userId) {
            return InteractionHelper.universalReply(interaction, {
                content:
                    '❌ User not found. Put the user **last**, as an @mention or a user ID.\n' +
                    'Example: `.trole cool kids 123456789012345678`',
                ephemeral: true,
            });
        }

        const { role, error } = await findRole(guild, roleText);

        if (!role) {
            return InteractionHelper.universalReply(interaction, {
                content: error,
                ephemeral: true,
            });
        }

        const target = await guild.members.fetch(userId).catch(() => null);

        if (!target) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ I could not find that user in this server.',
                ephemeral: true,
            });
        }

        return takeRole(interaction, role, target);
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
