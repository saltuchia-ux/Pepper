import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getPrefixText, errorBox } from '../../utils/punishmentTools.js';
import {
    MAX_NICK_LENGTH,
    getForcedNick,
    setForcedNick,
    clearForcedNick,
    cleanNickText,
    assertCanChangeNick,
} from '../../utils/forcedNick.js';

export default {
    data: new SlashCommandBuilder()
        .setName('fn')
        .setDescription('Force a nickname on a user (run again without a name to remove it)')
        .addUserOption((option) =>
            option.setName('target').setDescription('The user').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('nickname')
                .setDescription('Forced nickname (leave empty to remove the forced nickname)')
                .setMaxLength(MAX_NICK_LENGTH)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',

    // /fn target:@user nickname:Bob
    async execute(interaction, config, client) {
        const user = interaction.options.getUser('target');
        const member =
            interaction.options.getMember('target') ||
            await interaction.guild.members.fetch(user.id).catch(() => null);
        const nickname = cleanNickText(interaction.options.getString('nickname'));

        return toggleForcedNick(interaction, member, nickname);
    },

    // .fn @user New Name   (set)     .fn @user   (remove)
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'fn').split(/\s+/).filter(Boolean);
        const target = await takeUserFromWords(guild, parts);

        if (!target?.member) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'User not found',
                        'Use `.fn @user New Name` to force a nickname.\n' +
                        'Use `.fn @user` (no name) to remove it.\n' +
                        'You can use a mention, user ID, username or display name.',
                    ),
                ],
                ephemeral: true,
            });
        }

        const nickname = cleanNickText(parts.slice(target.used).join(' '));

        return toggleForcedNick(interaction, target.member, nickname);
    },
};

async function toggleForcedNick(interaction, member, nickname) {
    assertCanChangeNick(interaction, member, PermissionFlagsBits.BanMembers, 'Ban Members');

    const guildId = interaction.guild.id;
    const existing = await getForcedNick(guildId, member.id);

    // No name given: remove the forced nickname
    if (!nickname) {
        if (!existing) {
            throw new TitanBotError(
                'No nickname given',
                ErrorTypes.USER_INPUT,
                `${member} has no forced nickname. Add a name to force one: \`.fn @user New Name\`.`,
            );
        }

        await clearForcedNick(guildId, member.id);
        await member.setNickname(null, `Forced nickname removed by ${interaction.user.tag}`);

        return InteractionHelper.universalReply(interaction, {
            embeds: [
                createEmbed({
                    title: 'Forced Nickname Removed',
                    description: `${member} can change their nickname again. Their nickname was reset.`,
                    color: 'success',
                    fields: [{ name: 'By', value: `${interaction.user}`, inline: true }],
                    timestamp: true,
                }),
            ],
        });
    }

    if (nickname.length > MAX_NICK_LENGTH) {
        throw new TitanBotError(
            'Nickname too long',
            ErrorTypes.VALIDATION,
            `A nickname must be ${MAX_NICK_LENGTH} characters or less.`,
        );
    }

    // Save first so the member-update event sees it, then apply instantly
    await setForcedNick(guildId, member.id, nickname, interaction.user.id);
    await member.setNickname(nickname, `Forced nickname set by ${interaction.user.tag}`);

    return InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: 'Forced Nickname Set',
                description: `${member} is now locked to **${nickname}**. Run \`.fn ${member.user.username}\` again to remove it.`,
                color: 'warning',
                fields: [{ name: 'By', value: `${interaction.user}`, inline: true }],
                timestamp: true,
            }),
        ],
    });
}
