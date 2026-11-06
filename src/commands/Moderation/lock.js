import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { handleLockCommand } from '../../services/channelLockService.js';

// .lock  -> only people with the Ban Members permission can type here. The bot reacts with 🔒
export default {
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock this channel (only people with Ban Members can type)')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',

    async execute(interaction) {
        return handleLockCommand(interaction, true);
    },

    async prefixExecute(interaction) {
        return handleLockCommand(interaction, true);
    },
};
