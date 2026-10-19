import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getPrefixText } from '../../utils/punishmentTools.js';
import { getJailConfig, setupJail } from '../../services/jailService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('jailsetup')
        .setDescription('Set up the jail system (role, jail category, jail chat, log channel)')
        .addStringOption((option) =>
            option
                .setName('action')
                .setDescription('Run the setup, or just look at the current setup')
                .setRequired(false)
                .addChoices(
                    { name: 'setup (create or repair everything)', value: 'setup' },
                    { name: 'status (show what is set up)', value: 'status' },
                ),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'moderation',

    // Slash command: /jailsetup action:setup
    async execute(interaction, config, client) {
        const action = interaction.options.getString('action') || 'setup';

        return run(interaction, action, true);
    },

    // Prefix command: .jailsetup   or   .jailsetup status
    async prefixExecute(interaction, config, client) {
        const word = getPrefixText(interaction, 'jailsetup').split(/\s+/)[0]?.toLowerCase();

        return run(interaction, word === 'status' ? 'status' : 'setup', false);
    },
};

async function run(interaction, action, isSlash) {
    // Only administrators can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        throw new TitanBotError(
            'Missing Administrator permission',
            ErrorTypes.PERMISSION,
            'You need the **Administrator** permission to use this command.',
        );
    }

    const guild = interaction.guild;

    if (action === 'status') {
        const config = await getJailConfig(guild.id);

        if (!config) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    createEmbed({
                        title: 'Jail is not set up',
                        description: 'Run `.jailsetup` to create everything.',
                        color: 'warning',
                    }),
                ],
            });
        }

        const mention = (id, type) => (id ? (type === 'role' ? `<@&${id}>` : `<#${id}>`) : 'missing');

        return InteractionHelper.universalReply(interaction, {
            embeds: [
                createEmbed({
                    title: 'Jail setup',
                    description:
                        `**Role:** ${mention(config.roleId, 'role')}\n` +
                        `**Category:** ${mention(config.categoryId)}\n` +
                        `**Jail chat:** ${mention(config.chatChannelId)}\n` +
                        `**Staff log:** ${mention(config.logChannelId)}\n\n` +
                        'Run `.jailsetup` again to repair it or to include new staff roles.',
                    color: 'primary',
                }),
            ],
        });
    }

    // Setup can take a little while because every channel has to be hidden from the Jailed role
    let progress = null;

    if (isSlash) {
        await InteractionHelper.safeDefer(interaction);
    } else {
        progress = await InteractionHelper.universalReply(interaction, {
            content: 'Setting up jail. This can take a minute...',
        });
    }

    const { role, category, chat, logs, staffRoles, result } = await setupJail(guild, {
        setupBy: interaction.user.id,
    });

    const lines = [
        `**Role:** ${role} ${result.createdRole ? '(created)' : '(already existed)'}`,
        `**Category:** ${category} ${result.createdCategory ? '(created)' : '(already existed)'}`,
        `**Jail chat:** ${chat} ${result.createdChat ? '(created)' : '(already existed)'}`,
        `**Staff log:** ${logs} ${result.createdLogs ? '(created)' : '(already existed)'}`,
        `**Hidden from jailed people:** ${result.locked + result.alreadyLocked} channels` +
            (result.failed ? ` (${result.failed} could not be changed, check my permissions there)` : ''),
        `**Staff who can see the jail:** ${staffRoles.length ? staffRoles.map((r) => r.toString()).join(' ') : 'only administrators'}`,
        '',
        'Now use `.jail @user reason`, `.unjail @user` and `.restore @user`.',
    ];

    const embed = createEmbed({
        title: 'Jail is ready',
        description: lines.join('\n'),
        color: 'success',
    });

    if (progress?.edit) {
        return progress.edit({ content: null, embeds: [embed] }).catch(() =>
            InteractionHelper.universalReply(interaction, { embeds: [embed] }),
        );
    }

    return InteractionHelper.universalReply(interaction, { embeds: [embed] });
}
