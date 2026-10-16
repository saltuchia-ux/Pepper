import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import * as moderation from '../../utils/moderation.js';
import { getPrefixText, errorBox } from '../../utils/punishmentTools.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// The rows shown, in this order
const ROWS = [
    ['warn', 'Warned'],
    ['kick', 'Kicked'],
    ['ban', 'Banned'],
    ['unban', 'Unbanned'],
    ['timeout', 'Timed Out'],
    ['jail', 'Jailed'],
];

// Works out what kind of action a saved case is (so .ms works on its own)
function categoryOf(action) {
    const text = String(action || '').toLowerCase();

    if (text.includes('unban')) return 'unban';

    // Things that undo or just look at something are not counted
    if (/un(mute|timeout|timedout|timed[\s_-]?out|jail|warn|kick)|free|release|remov|clear|delet|view|list|check|config|purge|lock|dm sent|case/.test(text)) {
        return null;
    }

    if (text.includes('warn')) return 'warn';
    if (text.includes('kick')) return 'kick';
    if (text.includes('ban')) return 'ban';
    if (/time[\s_-]?out|timed[\s_-]?out|mute/.test(text)) return 'timeout';
    if (text.includes('jail')) return 'jail';

    return null;
}

export default {
    data: new SlashCommandBuilder()
        .setName('ms')
        .setDescription("Show a moderator's statistics (leave empty for your own)")
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The moderator to check (leave empty for yourself)')
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',

    // Slash command: /ms user:@moderator
    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) return;

        const user = interaction.options.getUser('user') ?? interaction.user;

        return showStats(interaction, user);
    },

    // Prefix command: .ms   (your own)   or   .ms @user / userID / username
    async prefixExecute(interaction, config, client) {
        if (!interaction.guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const parts = getPrefixText(interaction, 'ms')
            .split(/\s+/)
            .filter(Boolean);

        // Just ".ms" shows YOUR OWN stats
        if (!parts.length) {
            return showStats(interaction, interaction.user);
        }

        const target = await takeUserFromWords(interaction.guild, parts);

        if (!target) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'User not found',
                        'Use `.ms` for your own stats, or `.ms @user`, `.ms userID` or `.ms username` for someone else.\n' +
                        'Names with spaces go in quotes: `.ms "John Smith"`.'
                    ),
                ],
                ephemeral: true,
            });
        }

        // Works even if the moderator already left (use their ID)
        const discordClient = client ?? interaction.client;
        const user =
            target.member?.user ??
            await discordClient.users.fetch(target.id).catch(() => null);

        if (!user) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('User not found', 'I could not find a Discord user with that ID.')],
                ephemeral: true,
            });
        }

        return showStats(interaction, user);
    },
};

// Joins the moderator's saved actions with the old server-wide case list,
// removes duplicates, and returns [{ type, time }].
async function loadActions(guildId, moderatorId) {
    // The moderator's own saved actions (only exists after moderation.js is updated)
    // plus the server-wide case list.
    const [saved, legacy] = await Promise.all([
        moderation.getModeratorActions
            ? moderation.getModeratorActions(guildId, moderatorId)
            : [],
        moderation.getModerationCases(guildId, { moderatorId, limit: 1000 }),
    ]);

    const seen = new Set();
    const actions = [];

    const add = (caseId, type, createdAt, fallbackKey) => {
        if (!type) return;

        const key =
            caseId !== undefined && caseId !== null
                ? `case-${caseId}`
                : fallbackKey;

        if (seen.has(key)) return;
        seen.add(key);

        actions.push({ type, time: new Date(createdAt).getTime() || 0 });
    };

    for (const entry of saved) {
        add(entry.caseId, entry.type, entry.createdAt, `saved-${entry.createdAt}-${entry.type}`);
    }

    for (const entry of legacy) {
        add(entry.caseId, categoryOf(entry.action), entry.createdAt, `old-${entry.createdAt}-${entry.action}`);
    }

    return actions;
}

function countBlock(actions, sinceTime) {
    const counts = {};

    for (const [type] of ROWS) counts[type] = 0;

    for (const action of actions) {
        if (sinceTime !== null && action.time < sinceTime) continue;
        if (counts[action.type] !== undefined) counts[action.type]++;
    }

    return ROWS.map(([type, label]) => `> **${label}**: ${counts[type]}`).join('\n');
}

async function showStats(interaction, user) {
    let actions;

    try {
        actions = await loadActions(interaction.guild.id, user.id);
    } catch (error) {
        logger.error('ms command could not load stats:', error);
        actions = [];
    }

    const now = Date.now();
    const name = user.username ?? user.tag ?? user.id;

    const description =
        `### 7 days\n${countBlock(actions, now - 7 * DAY_MS)}\n\n` +
        `### 14 days\n${countBlock(actions, now - 14 * DAY_MS)}\n\n` +
        `### All time\n${countBlock(actions, null)}`;

    const asker = interaction.user;

    return InteractionHelper.universalReply(interaction, {
        embeds: [
            createEmbed({
                title: `Moderation Statistics for ${name}`,
                description,
                color: 'primary',
                author: {
                    name: asker.username ?? asker.tag ?? 'Moderator',
                    iconURL: asker.displayAvatarURL?.({ size: 128 }),
                },
            }),
        ],
    });
}
