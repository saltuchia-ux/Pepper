import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    EmbedBuilder,
} from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { missingPermissionPayload } from '../../utils/replyStyle.js';
import { getCountingGameConfig } from '../../services/countingGameService.js';
import {
    getMeowConfig,
    saveMeowConfig,
    resetMeowChain,
    refreshMeowRules,
} from '../../services/meowCountingService.js';

// .meowcounting setup #channel   -> makes that channel the meow counting channel
// .meowcounting status | reset | disable
// Needs the Ban Members permission.

const USAGE =
    '**Meow counting**\n' +
    '`.meowcounting setup #channel` — set the meow channel (no channel = this one)\n' +
    '`.meowcounting status` — show the chain and the record\n' +
    '`.meowcounting reset` — put the chain back to 0\n' +
    '`.meowcounting disable` — turn it off';

export default {
    data: new SlashCommandBuilder()
        .setName('meowcounting')
        .setDescription('Manage the meow counting channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .setDMPermission(false)
        .addSubcommand((sub) =>
            sub
                .setName('setup')
                .setDescription('Set the meow counting channel')
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('The channel where everyone meows')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) => sub.setName('status').setDescription('Show the meow chain and the record'))
        .addSubcommand((sub) => sub.setName('reset').setDescription('Put the meow chain back to 0'))
        .addSubcommand((sub) => sub.setName('disable').setDescription('Turn meow counting off')),

    category: 'Moderation',

    abuseProtection: { enabled: false },

    async execute(interaction, config, client) {
        if (!interaction.member?.permissions?.has(PermissionFlagsBits.BanMembers)) {
            return InteractionHelper.universalReply(interaction, missingPermissionPayload(interaction.user.id, PermissionFlagsBits.BanMembers));
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'setup') return setup(interaction, interaction.options.getChannel('channel'), client);
        if (sub === 'status') return status(interaction);
        if (sub === 'reset') return reset(interaction);
        if (sub === 'disable') return disable(interaction);
    },

    async prefixExecute(interaction, config, client) {
        const message = interaction.message || interaction;

        if (!message.member?.permissions?.has(PermissionFlagsBits.BanMembers)) {
            return InteractionHelper.universalReply(interaction, missingPermissionPayload(interaction.user.id, PermissionFlagsBits.BanMembers));
        }

        const parts = (message.content?.trim() || '').split(/\s+/);
        const sub = parts[1]?.toLowerCase();

        if (sub === 'setup') {
            let channel = message.mentions?.channels?.first() ?? null;

            if (!channel && parts[2]) {
                const id = parts[2].replace(/[<#>]/g, '');
                if (/^\d+$/.test(id)) {
                    channel = message.guild.channels.cache.get(id) ?? await message.guild.channels.fetch(id).catch(() => null);
                }
            }

            return setup(interaction, channel ?? message.channel, client);
        }

        if (sub === 'status') return status(interaction);
        if (sub === 'reset') return reset(interaction);
        if (sub === 'disable') return disable(interaction);

        return InteractionHelper.universalReply(interaction, { content: USAGE });
    },
};

const say = (interaction, content) => InteractionHelper.universalReply(interaction, { content });

async function setup(interaction, channel, client) {
    if (!channel) return say(interaction, '❌ I could not find that channel.');
    if (channel.type !== ChannelType.GuildText) return say(interaction, '❌ The meow channel must be a normal text channel.');

    const guild = interaction.guild;

    // one channel can't be both games
    const counting = await getCountingGameConfig(client, guild.id);
    if (counting?.enabled && counting.channelId === channel.id) {
        return say(interaction, '❌ That is the counting channel. Pick a different channel for meowing.');
    }

    try {
        const old = await getMeowConfig(guild.id);

        const saved = await saveMeowConfig(guild.id, {
            ...(old || {}),
            enabled: true,
            channelId: channel.id,
            streak: 0,
            lastUserId: null,
            highScore: old?.highScore || 0,
            totalMeows: old?.totalMeows || 0,
            rulesMessageId: old?.rulesMessageId || null,
        });

        await refreshMeowRules(channel, saved);

        return say(interaction, `✅ Meow counting is on in ${channel}. Time to **meow** 🐱`);
    } catch (error) {
        console.error('MEOW SETUP ERROR:', error);
        return say(interaction, `❌ I could not set up meow counting.\nError: \`${error.message}\``);
    }
}

async function status(interaction) {
    const config = await getMeowConfig(interaction.guild.id);

    if (!config?.enabled || !config.channelId) return say(interaction, '⚠️ Meow counting is currently **off**.');

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🐱 Meow Counting')
        .addFields(
            { name: 'Channel', value: `<#${config.channelId}>`, inline: true },
            { name: 'Meows in a row', value: `${config.streak || 0}`, inline: true },
            { name: 'Record', value: `${config.highScore || 0}`, inline: true },
            { name: 'Total meows', value: `${config.totalMeows || 0}`, inline: true },
        );

    return InteractionHelper.universalReply(interaction, { embeds: [embed] });
}

async function reset(interaction) {
    const config = await getMeowConfig(interaction.guild.id);

    if (!config?.enabled || !config.channelId) return say(interaction, '⚠️ Meow counting is not on.');

    const { config: fresh } = await resetMeowChain(interaction.guild.id);

    const channel = interaction.guild.channels.cache.get(config.channelId);
    if (channel) await refreshMeowRules(channel, fresh).catch(() => {});

    return say(interaction, '🔄 The meow chain is back to **0**.');
}

async function disable(interaction) {
    const config = await getMeowConfig(interaction.guild.id);

    if (!config?.enabled) return say(interaction, '⚠️ Meow counting is already off.');

    await saveMeowConfig(interaction.guild.id, { ...config, enabled: false });

    return say(interaction, '🛑 Meow counting is off.');
}
