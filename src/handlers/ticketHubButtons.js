import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
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
// Staff Application (2 forms, because Discord allows only 5 questions per form)
// ---------------------------------------------------------------------------

// Answers from form 1 wait here until form 2 is sent (10 minutes).
const pendingApps = new Map();
const APP_TTL_MS = 10 * 60 * 1000;

function savePending(userId, answers) {
    pendingApps.set(userId, { answers, expires: Date.now() + APP_TTL_MS });
}

function takePending(userId) {
    const entry = pendingApps.get(userId);
    pendingApps.delete(userId);
    if (!entry || entry.expires < Date.now()) return null;
    return entry.answers;
}

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

function buildStaffModal1() {
    return new ModalBuilder()
        .setCustomId('hub_ticket_modal:staff')
        .setTitle('Staff Application (1/2)')
        .addComponents(
            textInput('role', 'Chat Mod or VC Mod?', { max: 20, placeholder: 'Chat Mod / VC Mod' }),
            textInput('age', 'How old are you?', { max: 3, placeholder: 'Example: 16' }),
            textInput('benefit', 'What benefit will you bring to the server?', { style: TextInputStyle.Paragraph, max: 500, min: 10 }),
            textInput('why', 'Why should we make you a moderator?', { style: TextInputStyle.Paragraph, max: 500, min: 10 }),
            textInput('abuse', 'A higher-up abuses power. What will you do?', { style: TextInputStyle.Paragraph, max: 500, min: 10 }),
        );
}

function buildStaffModal2() {
    return new ModalBuilder()
        .setCustomId('hub_staff_modal2')
        .setTitle('Staff Application (2/2)')
        .addComponents(
            textInput('demote', 'Staff abusing power: demote? (Yes/No)', { max: 3, min: 2, placeholder: 'Yes or No' }),
        );
}

function parseRole(text) {
    const t = text.toLowerCase();
    if (/\b(vc|voice)\b/.test(t)) return 'VC Mod';
    if (/chat/.test(t)) return 'Chat Mod';
    return null;
}

// Called from hubTicketModalHandler when type === 'staff' (form 1 sent).
async function handleStaffModal1(interaction, client) {
    const problem = await checkCanOpen(interaction, client, 'staff');
    if (problem) return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: problem });

    const role = parseRole(interaction.fields.getTextInputValue('role'));
    if (!role) {
        return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Question 1: please answer **Chat Mod** or **VC Mod**. Press the Staff Application button to try again.' });
    }

    const ageText = interaction.fields.getTextInputValue('age').trim();
    const age = /^\d{1,3}$/.test(ageText) ? parseInt(ageText, 10) : NaN;
    if (Number.isNaN(age)) {
        return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Question 2: please type your age as a number. Press the Staff Application button to try again.' });
    }
    if (age < TICKET_HUB.staffApp.minAge) {
        return replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: `You do not meet the requirements: you must be at least **${TICKET_HUB.staffApp.minAge}** years old to apply for staff. No ticket was made.` });
    }

    savePending(interaction.user.id, {
        role,
        age,
        benefit: interaction.fields.getTextInputValue('benefit').trim(),
        why: interaction.fields.getTextInputValue('why').trim(),
        abuse: interaction.fields.getTextInputValue('abuse').trim(),
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('hub_staff_next')
            .setLabel('Continue (Part 2)')
            .setStyle(ButtonStyle.Success),
    );

    await interaction.editReply({
        content: 'Part 1 saved ✅ Press **Continue** to answer the last question. (You have 10 minutes.)',
        components: [row],
    });
}

export const hubStaffNextButtonHandler = {
    name: 'hub_staff_next',
    async execute(interaction) {
        try {
            const entry = pendingApps.get(interaction.user.id);
            if (!entry || entry.expires < Date.now()) {
                pendingApps.delete(interaction.user.id);
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Your application expired. Press the Staff Application button to start again.' });
            }
            await interaction.showModal(buildStaffModal2());
        } catch (error) {
            logger.error('Staff application next button error:', error);
        }
    },
};

export const hubStaffModal2Handler = {
    name: 'hub_staff_modal2',
    async execute(interaction, client) {
        try {
            if (!interaction.guild || !interaction.member) return;
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) return;

            const answers = takePending(interaction.user.id);
            if (!answers) {
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Your application expired. Press the Staff Application button to start again.' });
            }

            const demote = interaction.fields.getTextInputValue('demote').trim().toLowerCase();
            if (demote !== 'yes' && demote !== 'no') {
                savePending(interaction.user.id, answers); // keep part 1, let them retry
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Question 6: answer only **Yes** or **No**. Press Continue again to retry.' });
            }

            // Requirements may have changed while they were typing.
            const problem = await checkCanOpen(interaction, client, 'staff');
            if (problem) return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: problem });

            const info = TICKET_HUB.types.staff;
            const intro = [
                '**🌙 Moonlit Staff Application**',
                '',
                `**1. Chat Mod or VC Mod?**\n${answers.role}`,
                `**2. How old are you?**\n${answers.age}`,
                `**3. What benefit will you bring to the server?**\n${answers.benefit}`,
                `**4. Why should we make you a moderator?**\n${answers.why}`,
                `**5. A higher-up abuses power. What will you do?**\n${answers.abuse}`,
                `**6. Should a staff member abusing power be demoted?**\n${demote === 'yes' ? 'Yes' : 'No'}`,
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
                content: '',
                components: [],
                embeds: [successEmbed('Application Sent', `Your staff application ticket is ready: ${channel}`)],
            });
        } catch (error) {
            await handleInteractionError(interaction, error, { type: 'modal', handler: 'ticketHubStaff', customId: interaction.customId });
        }
    },
};

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
                await interaction.showModal(buildStaffModal1());
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

            if (type === 'staff') return await handleStaffModal1(interaction, client);

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
