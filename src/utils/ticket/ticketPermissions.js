// ticketPermissions.js

import { PermissionFlagsBits } from 'discord.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { getTicketData } from '../database.js';
import { getStaffRoleIds } from '../../services/ticketHubService.js';

export async function getTicketPermissionContext({ client, interaction }) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;

  const [config, ticketData] = await Promise.all([
    getGuildConfig(client, guildId),
    getTicketData(guildId, channelId)
  ]);

  const hasManageChannels = interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
  const hasTicketStaffRole = getStaffRoleIds(config).some((roleId) => interaction.member.roles?.cache?.has(roleId));
  const isTicketCreator = Boolean(
    ticketData?.userId && String(ticketData.userId) === String(interaction.user.id),
  );

  return {
    config,
    ticketData,
    hasManageChannels,
    hasTicketStaffRole,
    isTicketCreator,
    canManageTicket: hasManageChannels || hasTicketStaffRole,
    canCloseTicket: hasManageChannels || hasTicketStaffRole || isTicketCreator,
  };
}