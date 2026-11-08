import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { plainReply } from '../../utils/punishmentTools.js';
import { runCmdSet } from '../../services/commandSettingsService.js';

// ==========================================
// .cmdset  -  ONLY the server owner can use this.
//
//   .cmdset show ban                          see a command
//   .cmdset words ban ban bn                  words that run it (replaces the old ones)
//   .cmdset add ban bn   /  .cmdset remove ban bn
//   .cmdset who ban ModerateMembers @Role     who can use it
//   .cmdset off ban   /  .cmdset on ban
//   .cmdset reset ban                         back to src/config/commandSettings.js
//   .cmdset list
//
// The changes are saved for THIS server only and sit on top of the settings file.
// ==========================================

async function handle(interaction, text) {
    const guild = interaction.guild;

    if (!guild) return;

    // the owner check is strict: it does not look at permissions or at commandSettings.js
    if (interaction.user.id !== guild.ownerId) {
        return plainReply(interaction, '⚠️ Only the server owner can use this command.');
    }

    return plainReply(interaction, await runCmdSet({ client: interaction.client, guild, text }));
}

export default {
    data: new SlashCommandBuilder()
        .setName('cmdset')
        .setDescription('Change command settings for this server (server owner only)')
        .addStringOption((option) =>
            option
                .setName('text')
                .setDescription('Example: show ban   or   words ban ban bn   or   who ban ModerateMembers')
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'Core',

    async execute(interaction) {
        return handle(interaction, interaction.options.getString('text') ?? '');
    },

    // .cmdset words ban ban bn
    async prefixExecute(interaction) {
        const message = interaction.message ?? interaction._responseCoordinator?.message ?? null;

        const text = (message?.content ?? '')
            .trim()
            .replace(/^<@!?\d+>\s*/, '') // if the bot mention is the prefix
            .replace(/^\S+\s*/, '');     // the command word

        return handle(interaction, text);
    },

    customPrefixValidation: true,
};
