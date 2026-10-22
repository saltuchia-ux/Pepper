import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import {
    getModerationCases,
    getMemberHistory,
    classifyPunishment,
} from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { syntaxReply, userNotFoundReply } from '../../utils/punishmentTools.js';

const DEFAULT_REASON = 'No reason provided';
const ENTRIES_PER_PAGE = 5;
const MAX_REASON_SHOWN = 200;
const BUTTON_TIME_MS = 5 * 60 * 1000;

// How each kind of punishment looks
const TYPES = {
    warn:    { icon: '⚠️', label: 'Warn' },
    timeout: { icon: '⏳', label: 'Timeout' },
    kick:    { icon: '👢', label: 'Kick' },
    jail:    { icon: '🔒', label: 'Jail' },
    ban:     { icon: '🔨', label: 'Ban' },
};

export default {
    data: new SlashCommandBuilder()
        .setName('hs')
        .setDescription("Show a member's punishment history (warn, timeout, kick, jail, ban)")
        .addUserOption((o) =>
            o
                .setName('user')
                .setDescription('The member to check (leave empty for your own history)')
                .setRequired(false),
        )
        .addIntegerOption((o) =>
            o
                .setName('page')
                .setDescription('Page number to open')
                .setMinValue(1)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'Moderation',

    // Slash command: /hs user:@user page:2
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) return;

        const user = interaction.options.getUser('user') ?? interaction.user;
        const page = interaction.options.getInteger('page') || 1;

        return showHistory(interaction, user, page);
    },

    // Prefix command: .hs @user   or   .hs userID   or   .hs userID 3 (page 3)
    async prefixExecute(interaction, config, client) {
        if (!interaction.guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'hs')
            .split(/\s+/)
            .filter(Boolean);

        // Just ".hs" (or ".hs 2" for page 2) shows YOUR OWN history
        if (!parts.length || /^\d{1,6}$/.test(parts[0])) {
            const ownPage = parts.length ? parseInt(parts[0], 10) : 1;

            return showHistory(interaction, interaction.user, ownPage);
        }

        const target = await takeUserFromWords(interaction.guild, parts);

        if (!target) {
            return parts.length ? userNotFoundReply(interaction) : syntaxReply(interaction, 'hs');
        }

        // Works even if the person already left or was banned (use their ID)
        const discordClient = client ?? interaction.client;
        const user =
            target.member?.user ??
            await discordClient.users.fetch(target.id).catch(() => null);

        if (!user) {
            return userNotFoundReply(interaction);
        }

        const pageWord = parts[target.used] || '';
        const page = /^\d+$/.test(pageWord) ? parseInt(pageWord, 10) : 1;

        return showHistory(interaction, user, page);
    },
};

// Gets the text after ".COMMAND" from a prefix command.
function getPrefixText(interaction, commandName) {
    const realMessage =
        interaction.message ??
        interaction._responseCoordinator?.message ??
        null;

    const content = realMessage?.content?.trim();

    if (content) {
        const match = content.match(
            new RegExp(`^\\S*?${commandName}(?:\\s+|$)`, 'i')
        );

        if (match) {
            return content.slice(match[0].length).trim();
        }
    }

    const args =
        interaction.options?._hoistedOptions?.map(option =>
            String(option.value)
        ) || [];

    return args.join(' ').trim();
}

// Accepts <@123>, <@!123> or a plain user ID.
function extractUserId(value) {
    if (!value) return null;

    const text = String(value).trim();

    const mention = text.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];

    if (/^\d+$/.test(text)) return text;

    return null;
}

function errorBox(title, description) {
    return createEmbed({
        title: `❌ ${title}`,
        description,
        color: 'error',
    });
}

function shorten(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Slash commands are already deferred, prefix commands reply for the first time
async function sendReply(interaction, payload) {
    if (interaction._isPrefixCommand) {
        return InteractionHelper.universalReply(interaction, payload);
    }

    return interaction.editReply(payload);
}

// Joins the person's own history with the old server-wide case list,
// removes duplicates, and sorts newest first.
async function loadEntries(guildId, userId) {
    const [history, legacy] = await Promise.all([
        getMemberHistory(guildId, userId),
        getModerationCases(guildId, { userId, limit: 1000 }),
    ]);

    const seen = new Set();
    const entries = [];

    for (const entry of [...history, ...legacy]) {
        const type = classifyPunishment(entry.action);
        if (!type) continue;

        const key =
            entry.caseId !== undefined && entry.caseId !== null
                ? `case-${entry.caseId}`
                : `${entry.action}|${entry.createdAt}`;

        if (seen.has(key)) continue;
        seen.add(key);

        entries.push({ ...entry, type });
    }

    const time = (entry) => new Date(entry.createdAt).getTime() || 0;
    entries.sort((a, b) => time(b) - time(a));

    return entries;
}

function formatEntry(entry) {
    const info = TYPES[entry.type];

    const time = new Date(entry.createdAt).getTime();
    const date = Number.isNaN(time)
        ? 'Unknown date'
        : `<t:${Math.floor(time / 1000)}:f> (<t:${Math.floor(time / 1000)}:R>)`;

    const reason = shorten(String(entry.reason || '').trim() || DEFAULT_REASON, MAX_REASON_SHOWN);
    const moderator = entry.moderatorId ? `<@${entry.moderatorId}>` : (entry.executor || 'Unknown');
    const duration = entry.duration ? ` (${entry.duration})` : '';
    const caseText = entry.caseId ? ` · Case #${entry.caseId}` : '';

    return (
        `${info.icon} **${info.label}**${duration} · ${date}\n` +
        `> 📝 ${reason}\n` +
        `> 🛡️ ${moderator}${caseText}`
    );
}

function buildButtons(page, totalPages, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('hs_first')
            .setLabel('⏮')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page === 1),
        new ButtonBuilder()
            .setCustomId('hs_prev')
            .setLabel('◀')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled || page === 1),
        new ButtonBuilder()
            .setCustomId('hs_info')
            .setLabel(`Page ${page}/${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId('hs_next')
            .setLabel('▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled || page === totalPages),
        new ButtonBuilder()
            .setCustomId('hs_last')
            .setLabel('⏭')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || page === totalPages),
    );
}

async function showHistory(interaction, user, requestedPage = 1) {
    let entries;

    try {
        entries = await loadEntries(interaction.guild.id, user.id);
    } catch (error) {
        logger.error('hs command could not load history:', error);
        entries = [];
    }

    const avatar = user.displayAvatarURL?.({ size: 256 });
    const header = `**${user.tag ?? user.username}** (\`${user.id}\`)`;
    const isSelf = user.id === interaction.user.id;
    const title = isSelf ? '📋 Your Moderation History' : '📋 Moderation History';

    if (!entries.length) {
        return sendReply(interaction, {
            embeds: [
                createEmbed({
                    title,
                    description: `${header}\n\n${isSelf ? '✅ You have no punishments on record. Your history is clean.' : '✅ No punishments on record. This member has a clean history.'}`,
                    color: 'success',
                    thumbnail: avatar || null,
                    timestamp: true,
                }),
            ],
        });
    }

    const counts = { warn: 0, timeout: 0, kick: 0, jail: 0, ban: 0 };
    for (const entry of entries) counts[entry.type]++;

    const summary =
        `⚠️ Warns **${counts.warn}** · ⏳ Timeouts **${counts.timeout}** · ` +
        `👢 Kicks **${counts.kick}** · 🔒 Jails **${counts.jail}** · 🔨 Bans **${counts.ban}**`;

    const totalPages = Math.ceil(entries.length / ENTRIES_PER_PAGE);
    let page = Math.min(Math.max(requestedPage, 1), totalPages);

    const buildEmbed = (pageNumber) => {
        const start = (pageNumber - 1) * ENTRIES_PER_PAGE;
        const pageEntries = entries.slice(start, start + ENTRIES_PER_PAGE);

        return createEmbed({
            title,
            description:
                `${header}\n${summary}\n\n` +
                pageEntries.map(formatEntry).join('\n\n'),
            color: 'warning',
            thumbnail: avatar || null,
            footer: `Page ${pageNumber}/${totalPages} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} total`,
            timestamp: true,
        });
    };

    const payload = { embeds: [buildEmbed(page)] };

    if (totalPages > 1) {
        payload.components = [buildButtons(page, totalPages)];
    }

    const message = await sendReply(interaction, payload);

    if (totalPages <= 1 || !message?.createMessageComponentCollector) return;

    // Page buttons (only the person who ran the command can use them)
    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: BUTTON_TIME_MS,
    });

    collector.on('collect', async (button) => {
        if (button.user.id !== interaction.user.id) {
            await button
                .reply({
                    content: 'Only the person who ran this command can use these buttons. Run `.hs` yourself.',
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
            return;
        }

        if (button.customId === 'hs_first') page = 1;
        else if (button.customId === 'hs_prev') page = Math.max(1, page - 1);
        else if (button.customId === 'hs_next') page = Math.min(totalPages, page + 1);
        else if (button.customId === 'hs_last') page = totalPages;

        await button
            .update({
                embeds: [buildEmbed(page)],
                components: [buildButtons(page, totalPages)],
            })
            .catch((error) => logger.debug(`hs button update failed: ${error.message}`));
    });

    collector.on('end', async () => {
        await message
            .edit({ components: [buildButtons(page, totalPages, true)] })
            .catch(() => {});
    });
}
