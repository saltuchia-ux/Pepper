import { SlashCommandBuilder } from 'discord.js';
import { getPrefixText, plainReply, syntaxReply } from '../../utils/punishmentTools.js';
import {
    splitTimeAndText,
    formatTime,
    cleanText,
    addReminder,
    countReminders,
    MIN_MS,
    MAX_MS,
    MAX_TEXT_LENGTH,
    MAX_PER_USER,
} from '../../services/reminderService.js';

// ==========================================
// .remind (text) (time)
//
//   .remind drink water 10m
//   .remind call mom 2 hours
//   .remind pay rent 1d
//
// The bot answers "Got it, I'll remind you in 10 minutes",
// and when the time comes it sends you the text in a DM.
// Times: 10s  10m  10min  1h  1hour  1d  1day  1w  1y  1year   (also "10 minutes")
// Everyone can use it.
// ==========================================

async function createReminder(interaction, text, timeText) {
    const words = `${text} ${timeText}`.split(/\s+/).filter(Boolean);
    const parsed = splitTimeAndText(words);

    if (!parsed) return syntaxReply(interaction, 'remind');

    const reminderText = cleanText(parsed.textWords.join(' '));

    if (!reminderText) return syntaxReply(interaction, 'remind');

    if (parsed.ms < MIN_MS) {
        return plainReply(interaction, '⚠️ The shortest time is **10 seconds**');
    }

    if (parsed.ms > MAX_MS) {
        return plainReply(interaction, '⚠️ The longest time is **5 years**');
    }

    if (reminderText.length > MAX_TEXT_LENGTH) {
        return plainReply(interaction, `⚠️ The reminder text must be ${MAX_TEXT_LENGTH} characters or less`);
    }

    if (await countReminders(interaction.user.id) >= MAX_PER_USER) {
        return plainReply(interaction, `⚠️ You already have ${MAX_PER_USER} reminders waiting`);
    }

    await addReminder({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channel?.id ?? interaction.channelId,
        text: reminderText,
        ms: parsed.ms,
    });

    // the text is NOT repeated here, only the time
    return plainReply(interaction, `Got it, I'll remind you in **${formatTime(parsed.ms)}**`);
}

export default {
    data: new SlashCommandBuilder()
        .setName('remind')
        .setDescription('Get a DM reminder after some time')
        .addStringOption((option) =>
            option
                .setName('text')
                .setDescription('What to remind you about')
                .setMaxLength(MAX_TEXT_LENGTH)
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('time')
                .setDescription('When, for example 10m, 1h, 1d, 1y')
                .setMaxLength(20)
                .setRequired(true),
        ),
    category: 'Utility',

    // /remind text:drink water time:10m
    async execute(interaction) {
        return createReminder(
            interaction,
            interaction.options.getString('text') ?? '',
            interaction.options.getString('time') ?? '',
        );
    },

    // .remind drink water 10m
    async prefixExecute(interaction) {
        const text = getPrefixText(interaction, 'remind');

        if (!text) return syntaxReply(interaction, 'remind');

        return createReminder(interaction, text, '');
    },

    // lets the bot read the whole sentence itself (instead of "missing option" errors)
    customPrefixValidation: true,
};
