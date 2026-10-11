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
        .setName('ban')
        .setDescription('Ban a user')
        .addUserOption(o =>
            o.setName('target').setDescription('User').setRequired(true))
        .addStringOption(o =>
            o.setName('reason').setDescription('Reason'))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    category: 'Moderation',

    async prefixExecute(interaction, config, client) {
        const args = interaction.options._positional || [];
        const targetId = getTargetId(args[0]);
        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!targetId)
            return interaction.reply('Usage: .ban @user/userID reason');

        if (targetId === interaction.user.id)
            return interaction.reply('You cannot ban yourself.');

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers))
            return interaction.reply('You need Ban Members permission.');

        const user = await client.users.fetch(targetId).catch(() => null);

        if (!user)
            return interaction.reply('Could not find that user. Check the ID.');

        try {
            const result = await ModerationService.banUser({
                guild: interaction.guild,
                user,
                moderator: interaction.member,
                reason
            });

            return interaction.reply(
                `🔨 Banned **${user.tag}**\nReason: ${reason}\nCase: #${result.caseId}`
            );
        } catch (error) {
            console.error(error);
            return interaction.reply('Ban failed. Check the bot permissions and logs.');
        }
    },

    async execute(interaction, config, client) {
        const user = interaction.options.getUser('target');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        const result = await ModerationService.banUser({
            guild: interaction.guild,
            user,
            moderator: interaction.member,
            reason
        });

        return InteractionHelper.universalReply(interaction, {
            embeds: [successEmbed(
                `🔨 Banned ${user.tag}`,
                `Reason: ${reason}\nCase: #${result.caseId}`
            )]
        });
    }
};
