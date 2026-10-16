import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getPrefixText, errorBox } from '../../utils/punishmentTools.js';
import {
    MAX_NICK_LENGTH,
    getForcedNick,
    cleanNickText,
    assertCanChangeNick,
} from '../../utils/forcedNick.js';

export default {
    data: new SlashCommandBuilder()
        .setName('nick')
        .setDescription("Change a user's nickname (they can change it back)")
        .addUserOption((option) =>
            option.setName('target').setDescription('The user').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('nickname')
                .setDescription('New nickname (leave empty to reset)')
                .setMaxLength(MAX_NICK_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),
    category: 'moderation',

    // /nick target:@user nickname:Bob
    async execute(interaction, config, client) {
        const user = interaction.options.getUser('target');
        const member =
            interaction.options.getMember('target') ||
            await interaction.guild.members.fetch(user.id).catch(() => null);
        const nickname = cleanNickText(interaction.options.getString('nickname'));

        return changeNick(interaction, member, nickname);
    },

    // .nick @user New Name   |   .nick userID New Name   |   .nick username New Name
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'nick').split(/\s+/).filter(Boolean);
        const target = await takeUserFromWords(guild, parts);

        if (!target?.member) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'User not found',
                        'Use `.nick @user New Name`, `.nick userID New Name` or `.nick username New Name`.\n' +
                        'Names with spaces go in quotes: `.nick "John Smith" New Name`.\n' +
                        'Leave the name out to reset the nickname.',
                    ),
                ],
                ephemeral: true,
            });
        }

        const nickname = cleanNickText(parts.slice(target.used).join(' '));

        return changeNick(interaction, target.member, nickname);
    },
};

async function changeNick(interaction, member, nickname) {
    assertCanChangeNick(interaction, member);

    if (nickname.length > MAX_NICK_LENGTH) {
        throw new TitanBotError(
            'Nickname too long',
            ErrorTypes.VALIDATION,
            `A nickname must be ${MAX_NICK_LENGTH} characters or less.`,
        );
    }

    const forced = await getForcedNick(interaction.guild.id, member.id);

    if (forced) {
        throw new TitanBotError(
            'Forced nickname active',
            ErrorTypes.VALIDATION,
            `${member} has a forced nickname. Use \`.fn ${member.user.username}\` to remove it first.`,
        );
    }

    const before = member.nickname || member.user.globalName || member.user.username;

    await member.setNickname(nickname || null, `Nickname changed by ${interaction.user.tag}`);

    return InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: nickname ? 'Nickname Changed' : 'Nickname Reset',
                description: nickname
                    ? `${member}'s nickname is now **${nickname}**.`
                    : `${member}'s nickname was reset.`,
                color: 'success',
                fields: [
                    { name: 'Before', value: before, inline: true },
                    { name: 'By', value: `${interaction.user}`, inline: true },
                ],
                timestamp: true,
            }),
        ],
    });
}
