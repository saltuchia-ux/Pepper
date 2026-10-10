import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getUserModerationHistory } from '../../services/moderation/historyService.js';
import { formatDate } from '../../utils/helpers.js';
import { createEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hs')
    .setDescription('View moderation history for a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to check history for')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('userid')
        .setDescription('User ID to check history for')
        .setRequired(false)
    ),

async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

try {
      // Get target user from option or user ID
      let targetUser = interaction.options.getUser('user');
      const userId = interaction.options.getString('userid');

if (!targetUser && !userId) {
        return interaction.editReply({
          embeds: [createEmbed('error', '❌ Please provide a user or user ID.')]
        });
      }

// Fetch user by ID if provided
      if (!targetUser && userId) {
        try {
          targetUser = await interaction.client.users.fetch(userId);
        } catch (error) {
          return interaction.editReply({
            embeds: [createEmbed('error', `❌ Could not find user with ID: \`${userId}\``)]
          });
        }
      }

// Get moderation history
      const history = await getUserModerationHistory(
        interaction.client,
        interaction.guild.id,
        targetUser.id
      );

// Build embed
      const embed = new EmbedBuilder()
        .setColor('#FF6B6B')
        .setAuthor({
          name: `${targetUser.tag} - Moderation History`,
          iconURL: targetUser.displayAvatarURL({ dynamic: true })
        })
        .setFooter({ text: `User ID: ${targetUser.id}` })
        .setTimestamp();

// Check if user has any history
      if (history.total === 0) {
        embed.setDescription('✅ This user has a clean moderation record.');
        return interaction.editReply({ embeds: [embed] });
      }

// Add statistics
      embed.addFields({
        name: '📊 Summary',
        value: [
          ``Total Cases:` ${history.total}`,
          `⛔ Bans: ${history.counts.ban || 0}`,
          `👢 Kicks: ${history.counts.kick || 0}`,
          `⏱️ Timeouts: ${history.counts.timeout || 0}`,
          `⚠️ Warnings: ${history.counts.warn || 0}`,
          `🔒 Jails: ${history.counts.jail || 0}`
        ].join('\n'),
        inline: false
      });

// Group actions by type
      const types = ['ban', 'kick', 'timeout', 'warn', 'jail'];
      
      for (const type of types) {
        const actions = history.actions.filter(a => a.type === type);
        if (actions.length === 0) continue;

const icon = {
          ban: '⛔',
          kick: '👢',
          timeout: '⏱️',
          warn: '⚠️',
          jail: '🔒'
        }[type];

const typeLabel = type.charAt(0).toUpperCase() + type.slice(1) + 's';
        
        // Show latest 3 per type to avoid embed limits
        const displayActions = actions.slice(0, 3);
        const remaining = actions.length - 3;

const fieldValue = displayActions.map(action => {
          const date = new Date(action.timestamp);
          const dateStr = `<t:${Math.floor(date.getTime() / 1000)}:R>`;
          const moderator = action.moderatorTag || 'Unknown';
          const reason = action.reason || 'No reason provided';
          
          return `${dateStr} • `${moderator}`\n└ ${reason.substring(0, 80)}${reason.length > 80 ? '...' : ''}`;
        }).join('\n\n');

embed.addFields({
          name: `${icon} ${typeLabel} (${actions.length})`,
          value: fieldValue + (remaining > 0 ? `\n\n*...and ${remaining} more*` : ''),
          inline: false
        });
      }

// Check for embed size limit
      if (embed.data.fields && embed.data.fields.length > 6) {
        embed.data.fields = embed.data.fields.slice(0, 6);
        embed.setDescription('⚠️ *History truncated due to size. Showing most recent entries.*');
      }

await interaction.editReply({ embeds: [embed] });

} catch (error) {
      console.error('Error in history command:', error);
      await interaction.editReply({
        embeds: [createEmbed('error', '❌ An error occurred while fetching moderation history.')]
      });
    }
  }
};
