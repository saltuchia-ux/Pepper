import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { handleLockCommand } from '../../services/channelLockService.js';

// .unlock  -> puts the channel back the way it was. The bot reacts with 🔓
export default {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlock this channel again')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',

    async execute(interaction) {
        return handleLockCommand(interaction, false);
    },

    async prefixExecute(interaction) {
        return handleLockCommand(interaction, false);
    },
};
