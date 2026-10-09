```js
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { WarningService } from '../../services/moderation/warningService.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { logModerationAction } from '../../utils/moderation.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to warn')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for the warning')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    category: 'moderation',

    async prefixExecute(interaction, config, client) {
        const reply = content =>
            InteractionHelper.universalReply(interaction, { content });

        try {
            if (!interaction.guild) {
                return reply('❌ Use this command inside a server.');
            }

            if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return reply('❌ You need Timeout Members permission.');
            }

            const raw = interaction.message?.content || interaction.content || '';
            const match = raw.match(/^\s*\.warn\s+(\S+)\s+([\s\S]+)$/i);

            if (!match) {
                return reply('Usage: `.warn @user reason`');
            }

            const mention = match[1].match(/^<@!?(\d+)>$/);
            const userId = mention ? mention[1] : match[1];
            const reason = match[2].trim();

            if (!/^\d{17,20}$/.test(userId)) {
                return reply('❌ Mention a user or enter their user ID.');
            }

            if (userId === interaction.user.id || userId === client.user.id) {
                return reply('❌ You cannot warn yourself or the bot.');
            }

            const member = await interaction.guild.members.fetch(userId).catch(() => null);

            if (!member) {
                return reply('❌ That user is not in this server.');
            }

            ModerationService.assertModerationHierarchy(
                interaction.member,
                member,
                'warn'
            );

            const result = await WarningService.addWarning({
                guildId: interaction.guild.id,
                userId: member.id,
                moderatorId: interaction.user.id,
                reason,
                timestamp: Date.now()
            });

            await logModerationAction({
                client,
                guild: interaction.guild,
                event: {
                    action: 'User Warned',
                    target: `${member.user.tag} (${member.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason,
                    metadata: {
                        userId: member.id,
                        moderatorId: interaction.user.id,
                        totalWarns: result.totalCount
                    }
                }
            });

            return reply(
                `⚠️ **${member.user.tag} has been warned.**\n` +
                `**Reason:** ${reason}\n` +
                `**Total warnings:** ${result.totalCount}`
            );
        } catch (error) {
            logger.error('WARN COMMAND ERROR:', error);
            return reply(`❌ Warning failed: ${error.message}`);
        }
    }
};
```
