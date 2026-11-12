import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import { WarningService } from '../services/moderation/warningService.js';
import { successEmbed } from '../utils/embeds.js';
import { createTicket, getUserTicketCount } from '../services/ticket.js';
import { getGuildConfig } from '../services/config/guildConfig.js';
import { getMemberLevel, findTicketCategory } from '../services/ticketHubService.js';
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
            return info.application
                ? `You do not meet the requirements: you need to be **level ${info.minLevel}** or higher to apply for staff. You're level ${level}.`
                : `You need to be **level ${info.minLevel}** or higher to open an ${info.label} ticket. You're level ${level}.`;
        }
    }

    if (info.application) {
        const warnings = await WarningService.getWarningCount(interaction.guildId, interaction.user.id).catch(() => 0);
        if (warnings > TICKET_HUB.staffApp.maxWarnings) {
            return 'You do not meet the requirements for a staff application: you need a good history in the server.';
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
        findTicketCategory(interaction.guild)?.id || config.ticketCategoryId || null,
        reason,
        'none',
        { type, label: info.label, intro: info.intro ?? null },
    );

    await interaction.editReply({
        embeds: [successEmbed('Ticket Created', `Your ${info.label} ticket is ready: ${channel}`)],
    });
}

// ---------------------------------------------------------------------------
// Staff Application (one form, 5 questions: Discord's limit)
// ---------------------------------------------------------------------------

function textInput(id, label, { style = TextInputStyle.Short, max = 100, min = 1, placeholder } = {}) {
    const input = new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label) // Discord cuts labels at 45 characters
        .setStyle(style)
        .setRequired(true)
        .setMinLength(min)
        .setMaxLength(max);
    if (placeholder) input.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(input);
}

function buildStaffModal() {
    return new ModalBuilder()
        .setCustomId('hub_ticket_modal:staff')
        .setTitle('Staff Application')
        .addComponents(
            textInput('role', 'Chat Mod or VC Mod?', { max: 20, placeholder: 'Chat Mod / VC Mod' }),
            textInput('age', 'How old are you?', { max: 3, placeholder: 'Example: 16' }),
            textInput('why', 'Why should we pick you? What do you bring?', { style: TextInputStyle.Paragraph, max: 700, min: 10 }),
            textInput('abuse', 'A higher-up abuses power. What will you do?', { style: TextInputStyle.Paragraph, max: 500, min: 10 }),
            textInput('demote', 'Staff abusing power: demote? (Yes/No)', { max: 3, min: 2, placeholder: 'Yes or No' }),
        );
}

function parseRole(text) {
    const t = text.toLowerCase();
    if (/\b(vc|voice)\b/.test(t)) return 'VC Mod';
    if (/chat/.test(t)) return 'Chat Mod';
    return null;
}

// Called from hubTicketModalHandler when type === 'staff' (form sent, already deferred).
async function handleStaffModal(interaction, client) {
    const problem = await checkCanOpen(interaction, client, 'staff');
    if (problem) return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: problem });

    const retry = 'Press the Staff Application button to try again.';

    const role = parseRole(interaction.fields.getTextInputValue('role'));
    if (!role) {
        return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: `Question 1: please answer **Chat Mod** or **VC Mod**. ${retry}` });
    }

    const ageText = interaction.fields.getTextInputValue('age').trim();
    const age = /^\d{1,3}$/.test(ageText) ? parseInt(ageText, 10) : NaN;
    if (Number.isNaN(age)) {
        return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: `Question 2: please type your age as a number. ${retry}` });
    }
    if (age < TICKET_HUB.staffApp.minAge) {
        return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: `You do not meet the requirements: you must be at least **${TICKET_HUB.staffApp.minAge}** years old to apply for staff. No ticket was made.` });
    }

    const demote = interaction.fields.getTextInputValue('demote').trim().toLowerCase();
    if (demote !== 'yes' && demote !== 'no') {
        return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: `Question 5: answer only **Yes** or **No**. ${retry}` });
    }

    const why = interaction.fields.getTextInputValue('why').trim();
    const abuse = interaction.fields.getTextInputValue('abuse').trim();

    const info = TICKET_HUB.types.staff;
    const intro = [
        '**🌙 Moonlit Staff Application**',
        '',
        `**1. Chat Mod or VC Mod?**\n${role}`,
        `**2. How old are you?**\n${age}`,
        `**3. Why should we pick you? What do you bring to the server?**\n${why}`,
        `**4. A higher-up abuses power. What will you do?**\n${abuse}`,
        `**5. Staff abusing power: demote?**\n${demote === 'yes' ? 'Yes' : 'No'}`,
    ].join('\n');

    const config = await getGuildConfig(client, interaction.guildId);
    const { channel } = await createTicket(
        interaction.guild,
        interaction.member,
        findTicketCategory(interaction.guild)?.id || config.ticketCategoryId || null,
        'Staff application',
        'none',
        { type: 'staff', label: info.label, intro },
    );

    await interaction.editReply({
        embeds: [successEmbed('Application Sent', `Your staff application ticket is ready: ${channel}`)],
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

            // Staff Application: step 1 form (questions 1-5)
            if (info.application) {
                await interaction.showModal(buildStaffModal());
                return;
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

            if (type === 'staff') return await handleStaffModal(interaction, client);

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
