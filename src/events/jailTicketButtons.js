import { Events, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
    getJailConfig,
    openJailTicket,
    closeJailTicket,
    findTicketOwner,
    TICKET_OPEN_ID,
    TICKET_CLOSE_ID,
} from '../services/jailService.js';

const PRIVATE = MessageFlags.Ephemeral;

// Handles the "Open Ticket" button (jailed people) and the "Close Ticket" button (staff)
export default {
    name: Events.InteractionCreate,
    once: false,

    async execute(interaction) {
        if (!interaction.isButton?.()) return;

        const id = interaction.customId;

        if (id !== TICKET_OPEN_ID && id !== TICKET_CLOSE_ID) return;

        try {
            if (!interaction.guild || !interaction.member) return;

            const config = await getJailConfig(interaction.guild.id);
            const role = config?.roleId ? interaction.guild.roles.cache.get(config.roleId) : null;

            if (!config || !role) {
                return interaction.reply({ content: 'Jail is not set up on this server.', flags: PRIVATE });
            }

            if (id === TICKET_OPEN_ID) {
                // Only people who are in jail can open a ticket
                if (!interaction.member.roles.cache.has(role.id)) {
                    return interaction.reply({ content: 'Only people who are in jail can open a jail ticket.', flags: PRIVATE });
                }

                await interaction.deferReply({ flags: PRIVATE });

                const { channel, created } = await openJailTicket(interaction.guild, interaction.member, config, role);

                return interaction.editReply({
                    content: created
                        ? `Your ticket is ready: ${channel}`
                        : `You already have a ticket: ${channel}`,
                });
            }

            // Close Ticket: only staff
            if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                return interaction.reply({ content: 'Only moderators can close a ticket.', flags: PRIVATE });
            }

            const ownerId = await findTicketOwner(interaction.guild.id, interaction.channel.id);

            if (!ownerId) {
                return interaction.reply({ content: 'This is not a jail ticket.', flags: PRIVATE });
            }

            await interaction.reply({ content: 'Closing this ticket in 5 seconds...' });

            setTimeout(() => {
                closeJailTicket(interaction.guild, ownerId, {
                    closedBy: `${interaction.user}`,
                    reason: 'Closed with the Close Ticket button',
                }).catch(() => {});
            }, 5000);
        } catch (error) {
            logger.error('Jail ticket button failed:', error);

            const answer = { content: 'Something went wrong. Please try again or ask a moderator.', flags: PRIVATE };

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(answer).catch(() => {});
            } else {
                await interaction.reply(answer).catch(() => {});
            }
        }
    },
};
