import { PermissionFlagsBits } from 'discord.js';
import { getFromDb, setInDb, deleteFromDb, getWarningsKey } from '../utils/database.js';
import { Mutex } from '../utils/mutex.js';
import { classifyPunishment } from '../utils/moderation.js';
import { missingPermission, plainReply } from '../utils/punishmentTools.js';
import { logger } from '../utils/logger.js';

// ==========================================
// .ehs (case number) (new reason)   -> edit a punishment in .hs
// .dhs (case number)                -> delete a punishment from .hs
//
// Also works as:  .edit hs 5 new reason   .e hs 5 new reason
//                 .delete hs 5            .d hs 5
// Needs the Timeout Members permission.
//
// A punishment is saved in a few places (the case, the server list, the person's .hs history,
// the moderator's .ms stats, and for warns the warning list). These changes keep them all the same.
// Deleting only removes the RECORD. It does not unban / un-timeout anyone.
// ==========================================

const MAX_REASON_LENGTH = 500;

const caseKey = (guildId, caseId) => `moderation_case_${guildId}_${caseId}`;
const listKey = (guildId) => `moderation_cases_list_${guildId}`;
const historyKey = (guildId, userId) => `moderation_history_${guildId}_${userId}`;
const actionsKey = (guildId, moderatorId) => `moderation_actions_${guildId}_${moderatorId}`;

// Changes a saved list safely (one change at a time per list)
async function changeList(key, change) {
    await Mutex.runExclusive(key, async () => {
        const list = await getFromDb(key, []);

        if (!Array.isArray(list)) return;

        await setInDb(key, change(list));
    });
}

const sameCase = (entry, caseId) => Number(entry?.caseId) === caseId;

// Finds the case. Returns { record, type, userId } or null
async function findCase(guildId, caseId) {
    let record = await getFromDb(caseKey(guildId, caseId), null);

    if (!record) {
        const list = await getFromDb(listKey(guildId), []);
        record = Array.isArray(list) ? list.find((entry) => sameCase(entry, caseId)) ?? null : null;
    }

    if (!record) return null;

    return {
        record,
        type: classifyPunishment(record.action),
        userId: record.targetUserId ?? record.metadata?.userId ?? null,
    };
}

async function editWarning(guildId, found, change) {
    const warningId = found.record.metadata?.warningId;

    if (found.type !== 'warn' || !found.userId || !warningId) return;

    const key = getWarningsKey(guildId, found.userId);

    await Mutex.runExclusive(key, async () => {
        const warnings = await getFromDb(key, []);

        if (!Array.isArray(warnings)) return;

        const warning = warnings.find((entry) => entry?.id === warningId);

        if (!warning) return;

        change(warning);
        await setInDb(key, warnings);
    });
}

async function editCase(guildId, caseId, found, newReason, editorId) {
    const updated = { ...found.record, reason: newReason, editedBy: editorId, editedAt: new Date().toISOString() };

    await setInDb(caseKey(guildId, caseId), updated);

    await changeList(listKey(guildId), (list) =>
        list.map((entry) => (sameCase(entry, caseId) ? { ...entry, reason: newReason } : entry)),
    );

    if (found.userId) {
        await changeList(historyKey(guildId, found.userId), (list) =>
            list.map((entry) => (sameCase(entry, caseId) ? { ...entry, reason: newReason } : entry)),
        );
    }

    await editWarning(guildId, found, (warning) => {
        warning.reason = newReason;
    });
}

async function deleteCase(guildId, caseId, found) {
    await deleteFromDb(caseKey(guildId, caseId)).catch(() => {});

    await changeList(listKey(guildId), (list) => list.filter((entry) => !sameCase(entry, caseId)));

    if (found.userId) {
        await changeList(historyKey(guildId, found.userId), (list) =>
            list.filter((entry) => !sameCase(entry, caseId)),
        );
    }

    // so the moderator's .ms numbers go down too
    const moderatorId = found.record.moderatorId ?? found.record.metadata?.moderatorId;

    if (moderatorId) {
        await changeList(actionsKey(guildId, moderatorId), (list) =>
            list.filter((entry) => !sameCase(entry, caseId)),
        );
    }

    // a deleted warn stops counting as a warning
    await editWarning(guildId, found, (warning) => {
        warning.status = 'deleted';
    });
}

// Gets the text after the command word.
// ".ehs 5 reason" / ".edit hs 5 reason" / ".e hs 5 reason"  ->  "5 reason"
function readPrefixText(interaction) {
    const message = interaction.message ?? interaction._responseCoordinator?.message ?? null;

    let text = message?.content?.trim() ?? '';

    text = text.replace(/^<@!?\d+>\s*/, ''); // if the bot mention is the prefix
    text = text.replace(/^\S+\s*/, '');      // the command word
    text = text.replace(/^hs(?:\s+|$)/i, ''); // the "hs" in ".edit hs"

    return text.trim();
}

// "5 new reason" / "#5 new reason"  ->  { caseId: 5, reason: 'new reason' }
export function parseCaseText(text) {
    const match = /^#?(\d{1,10})(?:\s+([\s\S]+))?$/.exec(String(text ?? '').trim());

    if (!match) return null;

    return { caseId: Number(match[1]), reason: (match[2] ?? '').replace(/\s+/g, ' ').trim() };
}

// Shared by .ehs (mode 'edit') and .dhs (mode 'delete')
export async function runCaseCommand(interaction, mode) {
    if (!interaction.guild) return;

    if (!interaction.member?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
        throw missingPermission('moderate_members');
    }

    const usage = mode === 'edit'
        ? 'Use: `.ehs (case number) (new reason)`'
        : 'Use: `.dhs (case number)`';

    let caseId;
    let reason = '';

    if (interaction._isPrefixCommand) {
        const parsed = parseCaseText(readPrefixText(interaction));

        if (!parsed) return plainReply(interaction, `⚠️ ${usage}`);

        ({ caseId, reason } = parsed);
    } else {
        caseId = interaction.options.getInteger('case');
        reason = (interaction.options.getString('reason') ?? '').trim();
    }

    if (mode === 'edit' && !reason) return plainReply(interaction, `⚠️ ${usage}`);

    if (reason.length > MAX_REASON_LENGTH) {
        return plainReply(interaction, `⚠️ The reason must be ${MAX_REASON_LENGTH} characters or less`);
    }

    const guildId = interaction.guild.id;
    const found = await findCase(guildId, caseId);

    if (!found) return plainReply(interaction, `⚠️ Case **#${caseId}** was not found`);

    if (!found.type) {
        return plainReply(interaction, `⚠️ Case **#${caseId}** is not a warn, timeout, kick, jail or ban`);
    }

    try {
        if (mode === 'edit') {
            await editCase(guildId, caseId, found, reason, interaction.user.id);
        } else {
            await deleteCase(guildId, caseId, found);
        }
    } catch (error) {
        logger.error(`Could not ${mode} case ${caseId}:`, error);
        return plainReply(interaction, `⚠️ I could not ${mode} case **#${caseId}**, try again`);
    }

    const who = found.userId ? ` for <@${found.userId}>` : '';

    return plainReply(
        interaction,
        mode === 'edit'
            ? `✏️ Edited **${found.type}** case **#${caseId}**${who}`
            : `🗑️ Deleted **${found.type}** case **#${caseId}**${who}`,
    );
}
