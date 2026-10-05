import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
} from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';

import {
    getCountingGameConfig,
    saveCountingGameConfig,
} from '../../services/countingGameService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('counting')
        .setDescription('Manage the counting game')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(false)

        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set up the counting channel')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('The channel where counting will happen')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show the counting status')
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset the counting game')
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable the counting game')
        ),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    // =========================
    // SLASH COMMAND
    // =========================

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        if (
            !interaction.member?.permissions?.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ Only **Administrators** can use this command.',
                ephemeral: true,
            });
        }

        if (subcommand === 'setup') {
            const channel = interaction.options.getChannel('channel');

            return setupCounting(
                interaction,
                channel,
                client
            );
        }

        if (subcommand === 'status') {
            return countingStatus(
                interaction,
                client
            );
        }

        if (subcommand === 'reset') {
            return resetCounting(
                interaction,
                client
            );
        }

        if (subcommand === 'disable') {
            return disableCounting(
                interaction,
                client
            );
        }
    },

    // =========================
    // PREFIX COMMAND
    // =========================

    async prefixExecute(interaction, config, client) {
        const message = interaction.message || interaction;

        if (
            !message.member?.permissions?.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ Only **Administrators** can use this command.',
                ephemeral: true,
            });
        }

        const content = message.content?.trim() || '';

        const parts = content.split(/\s+/);

        // .counting setup #channel
        // .counting status
        // .counting reset
        // .counting disable

        const subcommand = parts[1]?.toLowerCase();

        if (!subcommand) {
            return InteractionHelper.universalReply(interaction, {
                content:
                    '❌ Usage:\n' +
                    '`.counting setup #channel`\n' +
                    '`.counting status`\n' +
                    '`.counting reset`\n' +
                    '`.counting disable`',
                ephemeral: true,
            });
        }

        // =========================
        // SETUP
        // =========================

        if (subcommand === 'setup') {
            let channel = null;

            // Try channel mention first
            if (message.mentions?.channels?.first()) {
                channel = message.mentions.channels.first();
            }

            // Try channel ID
            if (!channel && parts[2]) {
                const channelId = parts[2].replace(/[<#>]/g, '');

                if (/^\d+$/.test(channelId)) {
                    channel =
                        message.guild?.channels.cache.get(channelId) ||
                        await message.guild?.channels
                            .fetch(channelId)
                            .catch(() => null);
                }
            }

            // If no channel was provided, use current channel
            if (!channel) {
                channel = message.channel;
            }

            return setupCounting(
                interaction,
                channel,
                client
            );
        }

        // =========================
        // STATUS
        // =========================

        if (subcommand === 'status') {
            return countingStatus(
                interaction,
                client
            );
        }

        // =========================
        // RESET
        // =========================

        if (subcommand === 'reset') {
            return resetCounting(
                interaction,
                client
            );
        }

        // =========================
        // DISABLE
        // =========================

        if (subcommand === 'disable') {
            return disableCounting(
                interaction,
                client
            );
        }

        return InteractionHelper.universalReply(interaction, {
            content:
                '❌ Unknown counting command.\n\n' +
                'Use:\n' +
                '`.counting setup #channel`\n' +
                '`.counting status`\n' +
                '`.counting reset`\n' +
                '`.counting disable`',
            ephemeral: true,
        });
    },
};

// ============================================================
// SETUP
// ============================================================

async function setupCounting(interaction, channel, client) {
    if (!channel) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I could not find that channel.',
            ephemeral: true,
        });
    }

    if (channel.type !== ChannelType.GuildText) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ The counting channel must be a normal text channel.',
            ephemeral: true,
        });
    }

    const guild = interaction.guild;

    if (!guild) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ This command can only be used inside a server.',
            ephemeral: true,
        });
    }

    try {
        const oldConfig = await getCountingGameConfig(
            client,
            guild.id
        );

        const newConfig = {
            ...(oldConfig || {}),

            enabled: true,

            channelId: channel.id,

            // Counting starts at 1
            nextNumber: 1,

            // No one has counted yet
            lastUserId: null,

            // Current streak
            currentStreak: 0,
        };

        await saveCountingGameConfig(
            client,
            guild.id,
            newConfig
        );

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔢 Counting Game')
            .setDescription(
                [
                    '**Counting has been enabled!**',
                    '',
                    `📍 Channel: ${channel}`,
                    '',
                    'Rules:',
                    '• Start with **1**',
                    '• Send the numbers in order',
                    '• You cannot count twice in a row',
                    '• Only numbers are allowed',
                    '• Breaking the chain resets it',
                    '',
                    'Good luck! 🎯',
                ].join('\n')
            );

        await channel.send({
            embeds: [embed],
        }).catch(() => {});

        return InteractionHelper.universalReply(interaction, {
            content:
                `✅ Counting has been enabled in ${channel}!\n` +
                `The first number is **1**.`,
        });

    } catch (error) {
        console.error('COUNTING SETUP ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content:
                `❌ I could not set up counting.\n` +
                `Error: \`${error.message}\``,
            ephemeral: true,
        });
    }
}

// ============================================================
// STATUS
// ============================================================

async function countingStatus(interaction, client) {
    const guild = interaction.guild;

    if (!guild) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ This command can only be used inside a server.',
            ephemeral: true,
        });
    }

    try {
        const config = await getCountingGameConfig(
            client,
            guild.id
        );

        if (!config?.enabled || !config?.channelId) {
            return InteractionHelper.universalReply(interaction, {
                content: '⚠️ Counting is currently **disabled**.',
            });
        }

        const currentNumber =
            Math.max(0, (config.nextNumber || 1) - 1);

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔢 Counting Status')
            .addFields(
                {
                    name: 'Status',
                    value: '🟢 Enabled',
                    inline: true,
                },
                {
                    name: 'Channel',
                    value: `<#${config.channelId}>`,
                    inline: true,
                },
                {
                    name: 'Current Count',
                    value: `${currentNumber}`,
                    inline: true,
                },
                {
                    name: 'Next Number',
                    value: `${config.nextNumber || 1}`,
                    inline: true,
                },
                {
                    name: 'Current Streak',
                    value: `${config.currentStreak || 0}`,
                    inline: true,
                }
            );

        return InteractionHelper.universalReply(interaction, {
            embeds: [embed],
        });

    } catch (error) {
        console.error('COUNTING STATUS ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content:
                `❌ I could not get the counting status.\n` +
                `Error: \`${error.message}\``,
            ephemeral: true,
        });
    }
}

// ============================================================
// RESET
// ============================================================

async function resetCounting(interaction, client) {
    const guild = interaction.guild;

    if (!guild) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ This command can only be used inside a server.',
            ephemeral: true,
        });
    }

    try {
        const config = await getCountingGameConfig(
            client,
            guild.id
        );

        if (!config?.enabled || !config?.channelId) {
            return InteractionHelper.universalReply(interaction, {
                content: '⚠️ Counting is not currently enabled.',
                ephemeral: true,
            });
        }

        const newConfig = {
            ...config,

            nextNumber: 1,
            lastUserId: null,
            currentStreak: 0,
        };

        await saveCountingGameConfig(
            client,
            guild.id,
            newConfig
        );

        return InteractionHelper.universalReply(interaction, {
            content:
                '🔄 Counting has been reset.\n' +
                'The next number is **1**.',
        });

    } catch (error) {
        console.error('COUNTING RESET ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content:
                `❌ I could not reset counting.\n` +
                `Error: \`${error.message}\``,
            ephemeral: true,
        });
    }
}

// ============================================================
// DISABLE
// ============================================================

async function disableCounting(interaction, client) {
    const guild = interaction.guild;

    if (!guild) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ This command can only be used inside a server.',
            ephemeral: true,
        });
    }

    try {
        const config = await getCountingGameConfig(
            client,
            guild.id
        );

        if (!config?.enabled) {
            return InteractionHelper.universalReply(interaction, {
                content: '⚠️ Counting is already disabled.',
            });
        }

        const newConfig = {
            ...config,
            enabled: false,
        };

        await saveCountingGameConfig(
            client,
            guild.id,
            newConfig
        );

        return InteractionHelper.universalReply(interaction, {
            content: '🛑 Counting has been disabled.',
        });

    } catch (error) {
        console.error('COUNTING DISABLE ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content:
                `❌ I could not disable counting.\n` +
                `Error: \`${error.message}\``,
            ephemeral: true,
        });
    }
}
