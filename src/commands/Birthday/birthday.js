import { SlashCommandBuilder, MessageFlags, ChannelType } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';

import birthdaySet from './modules/birthday_set.js';
import birthdayInfo from './modules/birthday_info.js';
import birthdayList from './modules/birthday_list.js';
import birthdayRemove from './modules/birthday_remove.js';
import nextBirthdays from './modules/next_birthdays.js';
import birthdaySetchannel from './modules/birthday_setchannel.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { setBirthday, getUserBirthday } from '../../services/birthdayService.js';
import { parseBirthdayDate } from '../../utils/birthdayParser.js';
import { resolveSubcommandAlias } from '../../config/commands/commandAliases.js';
import { syntaxReply } from '../../utils/punishmentTools.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { getCommandPrefix } from '../../config/bot.js';
import { rawBoxPayload, COLORS } from '../../utils/replyStyle.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// "@John", a user ID or a name -> the user (or null)
async function findUser(interaction, words, client) {
    const target = await takeUserFromWords(interaction.guild, words);

    if (!target) return null;

    return target.member?.user ?? await client.users.fetch(target.id).catch(() => null);
}

// Shows one person's birthday (or tells them it is not set)
async function showBirthday(interaction, user, client) {
    const isSelf = user.id === interaction.user.id;
    const data = await getUserBirthday(client, interaction.guildId, user.id);

    if (!data) {
        const text = isSelf
            ? `${user}: You have not set your birthday yet. Use \`${getCommandPrefix()}bday set (date)\``
            : `${user}: has not set their birthday yet.`;

        return InteractionHelper.universalReply(interaction, rawBoxPayload(COLORS.info, text));
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const next = new Date(now.getFullYear(), data.month - 1, data.day);

    if (next < today) next.setFullYear(next.getFullYear() + 1);

    const daysLeft = Math.round((next - today) / DAY_MS);
    const dateText = `**${data.monthName} ${data.day}**`;

    let text;

    if (daysLeft === 0) {
        text = isSelf
            ? `🎂 ${user}: Your birthday is **today**! Happy birthday! 🎊`
            : `🎂 ${user}: Their birthday is **today**! Happy birthday! 🎊`;
    } else {
        const when = daysLeft === 1 ? 'tomorrow' : `in **${daysLeft}** days`;

        text = isSelf
            ? `🎂 ${user}: Your birthday is on ${dateText} (${when}).`
            : `🎂 ${user}: Their birthday is on ${dateText} (${when}).`;
    }

    return InteractionHelper.universalReply(interaction, rawBoxPayload(COLORS.info, text));
}

export default {
    // We read the date ourselves for the prefix version (".birthday set March 3, 2002")
    customPrefixValidation: true,

    data: new SlashCommandBuilder()
        .setName('birthday')
        .setDescription('Birthday system commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set your birthday')
                .addIntegerOption(option =>
                    option
                        .setName('month')
                        .setDescription('Birth month (1-12)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(12)
                )
                .addIntegerOption(option =>
                    option
                        .setName('day')
                        .setDescription('Birth day (1-31)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(31)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('View birthday information')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('User to check birthday for')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all birthdays in the server')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove your birthday')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('next')
                .setDescription('Show upcoming birthdays')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setchannel')
                .setDescription('Set or disable the channel for birthday announcements. (Manage Server required)')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('The text channel for announcements. Leave empty to disable.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)
                )
        ),

    // Prefix command:
    //   .bday                      -> your birthday
    //   .bday @user                -> their birthday
    //   .bday set March 3, 2002    -> set yours
    //   .bday list / next / remove / info @user
    async prefixExecute(interaction, config, client) {
        const words = (interaction.options._hoistedOptions || []).map((option) => String(option.value));
        const first = words[0] ? resolveSubcommandAlias(words[0].toLowerCase()) : null;

        if (!first) {
            return showBirthday(interaction, interaction.user, client);
        }

        if (first === 'set') {
            const dateText = words.slice(1).join(' ');
            const date = dateText ? parseBirthdayDate(dateText) : null;

            if (!date) return syntaxReply(interaction, 'birthday set');

            const result = await setBirthday(client, interaction.guildId, interaction.user.id, date.month, date.day);

            return InteractionHelper.universalReply(
                interaction,
                rawBoxPayload(
                    COLORS.success,
                    `🎂 ${interaction.user}: Your birthday is now set to **${result.data.monthName} ${result.data.day}**`,
                ),
            );
        }

        if (first === 'info') {
            if (words.length < 2) return showBirthday(interaction, interaction.user, client);

            const user = await findUser(interaction, words.slice(1), client);

            return user
                ? showBirthday(interaction, user, client)
                : InteractionHelper.universalReply(interaction, { content: 'User not found', allowedMentions: { parse: [] } });
        }

        if (['list', 'remove', 'next', 'setchannel'].includes(first)) {
            return this.execute(interaction, config, client);
        }

        // ".bday @user"
        const user = await findUser(interaction, words, client);

        return user ? showBirthday(interaction, user, client) : syntaxReply(interaction, 'birthday');
    },

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'set':
                return await birthdaySet.execute(interaction, config, client);
            case 'info':
                return await birthdayInfo.execute(interaction, config, client);
            case 'list':
                return await birthdayList.execute(interaction, config, client);
            case 'remove':
                return await birthdayRemove.execute(interaction, config, client);
            case 'next':
                return await nextBirthdays.execute(interaction, config, client);
            case 'setchannel':
                return await birthdaySetchannel.execute(interaction, config, client);
            default:
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Unknown subcommand' });
        }
    }
};