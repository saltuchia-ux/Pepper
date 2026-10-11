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
        .setName('kick')
        .setDescription('Kick a member')
        .addUserOption(o =>
            o.setName('target').setDescription('Member').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason'))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    category: 'Moderation',

    async prefixExecute(interaction, config, client) {
        const args = interaction.options._positional || [];
        const targetId = getTargetId(args[0]);
        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!targetId)
            return interaction.reply('Usage: .kick @user/userID reason');

        if (targetId === interaction.user.id)
            return interaction.reply('You cannot kick yourself.');

        const member = await interaction.guild.members
            .fetch(targetId).catch(() => null);

        if (!member)
            return interaction.reply('That user is not in this server.');

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers))
            return interaction.reply('You need Kick Members permission.');

        if (!member.kickable)
            return interaction.reply('I cannot kick that member. Check my role position and permissions.');

        try {
            const result = await ModerationService.kickUser({
                guild: interaction.guild,
                member,
                moderator: interaction.member,
                reason
            });

            return interaction.reply(
                `👢 Kicked **${member.user.tag}**\nReason: ${reason}\nCase: #${result.caseId}`
            );
        } catch (error) {
            console.error(error);
            return interaction.reply('Kick failed. Check the bot permissions and logs.');
        }
    },

    async execute(interaction, config, client) {
        const member = interaction.options.getMember('target');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!member?.kickable)
            return InteractionHelper.universalReply(interaction, {
                content: 'I cannot kick that member. Check permissions and role positions.'
            });

        const result = await ModerationService.kickUser({
            guild: interaction.guild,
            member,
            moderator: interaction.member,
            reason
        });

        return InteractionHelper.universalReply(interaction, {
            embeds: [successEmbed(
                `👢 Kicked ${member.user.tag}`,
                `Reason: ${reason}\nCase: #${result.caseId}`
            )]
        });
    }
};
