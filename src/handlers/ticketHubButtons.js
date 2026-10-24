import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import { successEmbed } from '../utils/embeds.js';
import { createTicket, getUserTicketCount } from '../services/ticket.js';
import { getGuildConfig } from '../services/config/guildConfig.js';
import { getMemberLevel } from '../services/ticketHubService.js';
import { TICKET_HUB } from '../config/ticketHub.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { replyUserError, ErrorTypes, handleInteractionError } from '../utils/errorHandler.js';

// Returns an error message if this person can't open this kind of ticket right now, otherwise null.
async function checkCanOpen(interaction, client, type) {
    const info = TICKET_HUB.types[type];
    if (!info) return 'That ticket type does not exist.';

    const config = await getGuildConfig(client, interaction.guildId);
    const maxTickets = config.maxTicketsPerUser || 3;
    const open = await getUserTicketCount(interaction.guildId, interaction.user.id);
    if (open >= maxTickets) {
        return `You already have ${open} open ticket(s) (max ${maxTickets}). Close one before opening a new one.`;
    }

    if (info.minLevel > 0) {
        const level = await getMemberLevel(client, interaction.guildId, interaction.user.id);
        if (level < info.minLevel) {
            return `You need to be **level ${info.minLevel}** or higher to open an ${info.label} ticket. You're level ${level}.`;
        }
    }

    return null;
}

async function openTicket(interaction, client, type, reason) {
    const info = TICKET_HUB.types[type];
    const config = await getGuildConfig(client, interaction.guildId);

    const { channel } = await createTicket(
        interaction.guild,
        interaction.member,
        config.ticketCategoryId || null,
        reason,
        'none',
        { type, label: info.label, intro: info.intro ?? null },
    );

    await interaction.editReply({
        embeds: [successEmbed('Ticket Created', `Your ${info.label} ticket is ready: ${channel}`)],
    });
}

export const hubTicketButtonHandler = {
    name: 'hub_ticket',
    async execute(interaction, client, args) {
        try {
            if (!interaction.guild || !interaction.member) {
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Tickets can only be opened inside the server.' });
            }

            const type = args?.[0];
            const info = TICKET_HUB.types[type];

            const allowed = await checkRateLimit(`${interaction.user.id}:hub_ticket`, 3, 60000);
            if (!allowed) {
                return await replyUserError(interaction, { type: ErrorTypes.RATE_LIMIT, message: 'You are opening tickets too quickly. Wait a minute and try again.' });
            }

            const problem = await checkCanOpen(interaction, client, type);
            if (problem) {
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: problem });
            }

            // Verify: no form, the ticket opens straight away
            if (!info.asksReason) {
                const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
                if (!deferred) return;
                await openTicket(interaction, client, type, `${info.label} request`);
                return;
            }

            const modal = new ModalBuilder()
                .setCustomId(`hub_ticket_modal:${type}`)
                .setTitle(info.modalTitle);

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel(info.modalLabel)
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMaxLength(1000),
                ),
            );

            await interaction.showModal(modal);
        } catch (error) {
            logger.error('Ticket hub button error:', error);
            if (interaction.deferred || interaction.replied) {
                await handleInteractionError(interaction, error, { type: 'button', handler: 'ticketHub', customId: interaction.customId });
            } else {
                await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Could not open the ticket right now. Please try again.' }).catch(() => {});
            }
        }
    },
};

export const hubTicketModalHandler = {
    name: 'hub_ticket_modal',
    async execute(interaction, client, args) {
        try {
            if (!interaction.guild || !interaction.member) return;

            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const type = args?.[0];

            // Check again here, things can change between pressing the button and sending the form.
            const problem = await checkCanOpen(interaction, client, type);
            if (problem) {
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: problem });
            }

            const reason = interaction.fields.getTextInputValue('reason').trim();
            await openTicket(interaction, client, type, reason);
        } catch (error) {
            await handleInteractionError(interaction, error, { type: 'modal', handler: 'ticketHub', customId: interaction.customId });
        }
    },
};
