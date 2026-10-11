import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';

function getTargetId(value) {
    const text = String(value || '').trim();
    return text.match(/^<@!?(\d+)>$/)?.[1] ||
        (/^\d+$/.test(text) ? text : null);
}

export default {
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout a member for 10 minutes')
        .addUserOption(o =>
            o.setName('target').setDescription('Member').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    category: 'Moderation',

    async prefixExecute(interaction, config, client) {
        const args = interaction.options._positional || [];
        const targetId = getTargetId(args[0]);
        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!targetId)
            return interaction.reply('Usage: .timeout @user/userID reason');

        if (targetId === interaction.user.id)
            return interaction.reply('You cannot timeout yourself.');

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers))
            return interaction.reply('You need Moderate Members permission.');

        const member = await interaction.guild.members
            .fetch(targetId).catch(() => null);

        if (!member)
            return interaction.reply('That user is not in this server.');

        if (!member.moderatable)
            return interaction.reply('I cannot timeout that member. Check role positions and permissions.');

        try {
            const result = await ModerationService.timeoutUser({
                guild: interaction.guild,
                member,
                moderator: interaction.member,
                durationMs: 10 * 60 * 1000,
                reason
            });

            return interaction.reply(
                `⏳ Timed out **${member.user.tag}** for 10 minutes.\nReason: ${reason}\nCase: #${result.caseId}`
            );
        } catch (error) {
            console.error(error);
            return interaction.reply('Timeout failed. Check the bot permissions and logs.');
        }
    },

    async execute(interaction, config, client) {
        const member = interaction.options.getMember('target');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!member?.moderatable)
            return InteractionHelper.universalReply(interaction, {
                content: 'I cannot timeout that member. Check permissions and role positions.'
            });

        const result = await ModerationService.timeoutUser({
            guild: interaction.guild,
            member,
            moderator: interaction.member,
            durationMs: 10 * 60 * 1000,
            reason
        });

        return InteractionHelper.universalReply(interaction, {
            embeds: [successEmbed(
                `⏳ Timed out ${member.user.tag} for 10 minutes`,
                `Reason: ${reason}\nCase: #${result.caseId}`
            )]
        });
    }
};
