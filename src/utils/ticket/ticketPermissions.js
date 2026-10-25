// ticketPermissions.js

import { PermissionFlagsBits } from 'discord.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { getTicketData } from '../database.js';
import { getStaffRoleIds, memberCanCloseTickets } from '../../services/ticketHubService.js';

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
    // Only the role in config/ticketHub.js can close tickets (not even the person who made the ticket).
    canCloseTicket: memberCanCloseTickets(interaction.member)
      ?? (hasManageChannels || hasTicketStaffRole || isTicketCreator),
  };
}