import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { commandAliases } from '../../config/commands/commandAliases.js';
import { runCaseCommand } from '../../services/caseEditService.js';

// .dhs 5     (also  .delete hs 5   and   .d hs 5)
// Deletes a warn / timeout / kick / jail / ban from .hs.  Needs the Timeout Members permission.
// It only removes the record, it does not unban or un-timeout anyone.
commandAliases.delete = 'dhs';
commandAliases.d = 'dhs';

export default {
    data: new SlashCommandBuilder()
        .setName('dhs')
        .setDescription('Delete a punishment from .hs')
        .addIntegerOption((option) =>
            option.setName('case').setDescription('The case number').setMinValue(1).setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'Moderation',

    async execute(interaction) {
        return runCaseCommand(interaction, 'delete');
    },

    async prefixExecute(interaction) {
        return runCaseCommand(interaction, 'delete');
    },

    customPrefixValidation: true,
};
