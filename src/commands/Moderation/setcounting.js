import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';

import {
  getCountingGameConfig,
  saveCountingGameConfig,
  refreshCountingRules
} from '../../services/countingGameService.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setcounting')
    .setDescription('Set the counting channel')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Counting channel')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.BanMembers
    ),

  category: 'Moderation',

  abuseProtection: {
    enabled: false
  },

  async execute(
    interaction,
    config,
    client
  ) {
    return setupCounting(
      interaction,
      client
    );
  },

  async prefixExecute(
    interaction,
    config,
    client
  ) {
    return setupCounting(
      interaction,
      client
    );
  }
};

async function setupCounting(
  interaction,
  client
) {
  // BAN MEMBERS PERMISSION REQUIRED
  if (
    !interaction.member.permissions.has(
      PermissionFlagsBits.BanMembers
    )
  ) {
    return InteractionHelper.universalReply(
      interaction,
      {
        content:
          '❌ You need **Ban Members** permission to set the counting channel.',
        ephemeral: true
      }
    );
  }

  const channel =
    interaction.options.getChannel(
      'channel'
    );

  if (!channel) {
    return InteractionHelper.universalReply(
      interaction,
      {
        content:
          '❌ Please select a channel.',
        ephemeral: true
      }
    );
  }

  if (!channel.isTextBased()) {
    return InteractionHelper.universalReply(
      interaction,
      {
        content:
          '❌ Please select a text channel.',
        ephemeral: true
      }
    );
  }

  const oldConfig =
    await getCountingGameConfig(
      client,
      interaction.guild.id
    );

  const newConfig = {
    ...(oldConfig || {}),

    enabled: true,

    channelId: channel.id,

    nextNumber: 1,

    lastUserId: null,

    highScore:
      oldConfig?.highScore || 0,

    // Keep the existing rules message ID
    rulesMessageId:
      oldConfig?.rulesMessageId || null
  };

  await saveCountingGameConfig(
    client,
    interaction.guild.id,
    newConfig
  );

  await refreshCountingRules(
    channel,
    newConfig
  );

  return InteractionHelper.universalReply(
    interaction,
    {
      content:
        `✅ Counting has been set to ${channel}.\n` +
        `The next number is **1**.`
    }
  );
}
