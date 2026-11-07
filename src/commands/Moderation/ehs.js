import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { commandAliases } from '../../config/commands/commandAliases.js';
import { runCaseCommand } from '../../services/caseEditService.js';

// .ehs 5 new reason     (also  .edit hs 5 new reason   and   .e hs 5 new reason)
// Edits the reason of a warn / timeout / kick / jail / ban shown in .hs.  Needs the Timeout Members permission.
commandAliases.edit = 'ehs';
commandAliases.e = 'ehs';

export default {
    data: new SlashCommandBuilder()
        .setName('ehs')
        .setDescription('Edit the reason of a punishment shown in .hs')
        .addIntegerOption((option) =>
            option.setName('case').setDescription('The case number').setMinValue(1).setRequired(true),
        )
        .addStringOption((option) =>
            option.setName('reason').setDescription('The new reason').setMaxLength(500).setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'Moderation',

    async execute(interaction) {
        return runCaseCommand(interaction, 'edit');
    },

    async prefixExecute(interaction) {
        return runCaseCommand(interaction, 'edit');
    },

    // the command reads the message itself
    customPrefixValidation: true,
};
