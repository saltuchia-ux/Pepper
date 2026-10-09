```javascript
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { WarningService } from '../../services/moderation/warningService.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { logModerationAction } from '../../utils/moderation.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a user')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('User to warn')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for warning')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    category: 'moderation',

    async prefixExecute(interaction, config, client) {
        const reply = content =>
            InteractionHelper.universalReply(interaction, { content });

        if (!interaction.guild) {
            return reply('❌ Use this command inside a server.');
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            return reply('❌ You need Timeout Members (Mute Members) permission.');
        }

        // Read the original prefix message.
        const content =
            interaction.message?.content ||
            interaction._responseCoordinator?.message?.content ||
            '';

        const match = content.match(/^\S*warn\s+(\S+)\s+([\s\S]+)/i);

        if (!match) {
            return reply('Usage: `.warn @user reason` or `.warn USER_ID reason`');
        }

        const userInput = match[1];
        const reason = match[2].trim();

        const idMatch = userInput.match(/^<@!?(\d+)>$/);
        const targetId = idMatch ? idMatch[1] : userInput;

        if (!/^\d{17,20}$/.test(targetId)) {
            return reply('❌ Please mention a user or provide their user ID.');
        }

        if (!reason) {
            return reply('❌ Please provide a reason.');
        }

        if (targetId === interaction.user.id) {
            return reply('❌ You cannot warn yourself.');
        }

        if (targetId === client.user.id) {
            return reply('❌ You cannot warn the bot.');
        }

        const member = await interaction.guild.members
            .fetch(targetId)
            .catch(() => null);

        if (!member) {
            return reply('❌ That user is not in this server.');
        }

        try {
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
            return reply(`❌ Could not warn user: ${error.message}`);
        }
    }
};
```
