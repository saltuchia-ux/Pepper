import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { missingPermissionPayload } from '../../utils/replyStyle.js';
import { getPrefixText } from '../../utils/punishmentTools.js';

// ==========================================
// .nuck  /  /nuck  -  wipes a channel, however many messages it has
//
// FAST WAY #1 (normal channels): the channel is cloned (same name, topic,
// permissions, position...) and the old one is deleted. This takes under a
// second no matter how many thousands of messages there were, and it also
// clears messages older than 14 days, which Discord's bulk delete can NEVER
// touch at all, however it is called.
//
// FAST WAY #2 (threads and chat posts, not forum posts): the same idea, but
// threads cannot be "cloned", so the old thread is DELETED and a new, empty
// one is made right after it with the same name and settings. Also instant,
// also clears messages older than 14 days.
//
// SLOW WAY (forum posts, or if the bot cannot manage channels/threads): there
// is no clone trick for these, so messages are deleted in batches of 100.
// The next batch is fetched WHILE the current one is being deleted, instead
// of one after another, which is the fastest this way can legally go: the
// DELETE itself is rate-limited by Discord's servers, not by this code, so
// even perfect code cannot make 20,000 messages disappear "per second" here.
// Only the last 14 days can be removed this way, a Discord limit as well.
//
// WITH A NUMBER:  .nuck 100   /   .nuck 1000   (same for .boom)
// Only that many of the newest messages are deleted and the channel is NOT recreated.
// (Messages older than 14 days can not be bulk-deleted by Discord, so it stops there.)
// A word or anything that is not a number is refused, it never wipes the whole channel by accident.
// ==========================================

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
const MAX_AMOUNT = 10000;
const THREAD_TYPES = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread];

export default {
    data: new SlashCommandBuilder()
        .setName('nuck')
        .setDescription('Delete all messages in this channel (fast)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption((option) => option
            .setName('amount')
            .setDescription('How many of the newest messages to delete (leave empty to wipe the whole channel)')
            .setMinValue(1)
            .setMaxValue(MAX_AMOUNT)
            .setRequired(false)),
    category: 'moderation',

    abuseProtection: {
        enabled: false,
    },

    // Slash command: /nuck
    async execute(interaction, config, client) {
        return runNuck(interaction);
    },

    // Prefix command: .nuck
    async prefixExecute(interaction, config, client) {
        return runNuck(interaction);
    },
};

export async function runNuck(interaction) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return InteractionHelper.universalReply(interaction, missingPermissionPayload(interaction.user.id, 'administrator'));
    }

    const channel = interaction.channel;

    if (!channel || !channel.isTextBased()) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ This command can only be used in a text channel.',
            ephemeral: true,
        });
    }

    // ---- how many messages? (nothing = wipe the whole channel, like always)
    const { amount, invalid, commandMessage } = await readAmount(interaction);

    if (invalid) {
        return InteractionHelper.universalReply(interaction, {
            content: `❌ Use \`.nuck\` to wipe the channel, or \`.nuck 100\` to delete the newest 100 messages (1 - ${MAX_AMOUNT}).`,
            ephemeral: true,
        });
    }

    if (amount) {
        return deleteAmount(interaction, channel, amount, commandMessage);
    }

    const me = channel.guild.members.me;
    const canManageChannels = me?.permissions?.has(PermissionFlagsBits.ManageChannels);
    const isThread = THREAD_TYPES.includes(channel.type);

    // Normal text / announcement channel: clone it
    if (!isThread && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)) {
        if (canManageChannels && channel.manageable) {
            return nukeByClone(interaction, channel);
        }
    }

    // A thread, but NOT a forum post (forum posts cannot be safely recreated:
    // the post itself, its tags and its starting message would be lost)
    const isForumPost = isThread && channel.parent?.type === ChannelType.GuildForum;

    if (isThread && !isForumPost) {
        const canManageThreads =
            canManageChannels || channel.parent?.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageThreads);

        if (canManageThreads) {
            return nukeByRecreatingThread(interaction, channel);
        }
    }

    return nukeByDeleting(interaction, channel);
}

// ----- FAST: clone the channel, delete the old one -----
async function nukeByClone(interaction, channel) {
    let fresh;

    try {
        fresh = await channel.clone({ reason: `Channel wiped by ${interaction.user.tag}` });

        // clone() does not copy the exact position, so it is put back where the old one was
        await fresh.setPosition(channel.rawPosition ?? channel.position).catch(() => {});

        await channel.delete(`Channel wiped by ${interaction.user.tag}`);
    } catch (error) {
        // Something stopped the clone (missing permission somewhere, Discord hiccup...):
        // fall back to deleting messages instead of leaving the server half set up.
        if (fresh) {
            return nukeByDeleting(interaction, fresh);
        }

        return nukeByDeleting(interaction, channel);
    }

    await fresh.send({ content: 'DONE BOSS' }).catch(() => {});
}

// ----- FAST: delete the thread, make a new empty one with the same settings -----
async function nukeByRecreatingThread(interaction, channel) {
    const parent = channel.parent;

    if (!parent?.threads?.create) {
        return nukeByDeleting(interaction, channel);
    }

    const settings = {
        name: channel.name,
        autoArchiveDuration: channel.autoArchiveDuration,
        rateLimitPerUser: channel.rateLimitPerUser || undefined,
        reason: `Channel wiped by ${interaction.user.tag}`,
        type: channel.type,
    };

    // Private threads need this extra option; public/announcement threads do not have it.
    if (channel.type === ChannelType.PrivateThread) {
        settings.invitable = channel.invitable;
    }

    let fresh;

    try {
        fresh = await parent.threads.create(settings);

        await channel.delete(`Channel wiped by ${interaction.user.tag}`);
    } catch (error) {
        // Something stopped it (missing permission, Discord hiccup...): fall back
        // to deleting messages instead of leaving two threads behind.
        if (fresh) {
            await fresh.delete().catch(() => {});
        }

        return nukeByDeleting(interaction, channel);
    }

    await fresh.send({ content: 'DONE BOSS' }).catch(() => {});
}

// ----- SLOW: delete messages in batches of 100 -----
// The NEXT batch is fetched by message ID (fetch ...,"before": oldest ID so far), so it can be
// requested WHILE the current batch is being deleted, without fetching the same messages twice.
async function nukeByDeleting(interaction, channel) {
    try {
        let cursor;   // the oldest message ID seen so far
        let nextBatch = fetchBatch(channel);

        while (true) {
            const messages = await nextBatch;

            if (!messages || messages.size === 0) break;

            const oldestId = [...messages.keys()].at(-1);

            // start fetching the batch AFTER this one right away, instead of waiting for the delete to finish
            nextBatch = messages.size === BATCH_SIZE ? fetchBatch(channel, oldestId) : Promise.resolve(null);

            const recent = messages.filter((message) => Date.now() - message.createdTimestamp < TWO_WEEKS_MS);

            if (recent.size > 0) {
                const deleted = await channel.bulkDelete(recent, true).catch(() => null);

                if (!deleted) break;


                if (deleted.size < recent.size) break;   // Discord refused to delete older messages: stop here
            }

            if (recent.size < messages.size) break;   // the rest of the channel is older than 2 weeks
        }

        await InteractionHelper.universalReply(interaction, { content: 'DONE BOSS' });
    } catch (error) {
        await InteractionHelper.universalReply(interaction, {
            content: '❌ I could not delete the messages. Make sure the bot has **Manage Messages** permission.',
            ephemeral: true,
        });
    }
}

function fetchBatch(channel, beforeId) {
    const options = { limit: BATCH_SIZE };

    if (beforeId) options.before = beforeId;

    return channel.messages.fetch(options).catch(() => null);
}

// ----- the number after the command -----
// Prefix:  the text after ".nuck"  (before anything is sent, fetchReply() is the message the person typed)
// Slash:   the "amount" option
async function readAmount(interaction) {
    let raw = '';
    let commandMessage = null;

    if (interaction._isPrefixCommand) {
        commandMessage = await interaction.fetchReply().catch(() => null);
        raw = commandMessage?.content
            ? commandMessage.content.replace(/^\s*\S+\s*/, '').trim()
            : (interaction.options?._hoistedOptions ?? []).map((option) => String(option.value)).join(' ').trim();
    } else {
        const value = interaction.options?.getInteger?.('amount');
        raw = value === null || value === undefined ? '' : String(value);
    }

    if (!raw) return { amount: 0, invalid: false, commandMessage };

    const firstWord = raw.split(/\s+/)[0].replace(/[,_]/g, '');

    if (!/^\d+$/.test(firstWord)) return { amount: 0, invalid: true, commandMessage };

    const amount = Number(firstWord);

    if (amount < 1 || amount > MAX_AMOUNT) return { amount: 0, invalid: true, commandMessage };

    return { amount, invalid: false, commandMessage };
}

// ----- delete only the newest N messages -----
async function deleteAmount(interaction, channel, amount, commandMessage) {
    const isPrefix = Boolean(interaction._isPrefixCommand);
    const me = channel.guild?.members?.me;

    if (!channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageMessages)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I need the **Manage Messages** permission in this channel.',
            ephemeral: true,
        });
    }

    if (!isPrefix) await interaction.deferReply({ ephemeral: true }).catch(() => {});

    // the ".nuck 100" message itself goes first, so the 100 that follow are the real ones
    if (commandMessage?.deletable) await commandMessage.delete().catch(() => {});

    let left = amount;
    let deleted = 0;
    let before = commandMessage?.id;
    let hitOldMessages = false;
    let failed = false;

    while (left > 0) {
        const options = { limit: Math.min(BATCH_SIZE, left) };
        if (before) options.before = before;

        const batch = await channel.messages.fetch(options).catch(() => null);

        if (!batch || batch.size === 0) break;

        before = batch.last().id; // the oldest message of this batch

        const recent = batch.filter((message) => Date.now() - message.createdTimestamp < TWO_WEEKS_MS - 60 * 1000);

        if (recent.size > 0) {
            const removed = await channel.bulkDelete(recent, true).catch(() => null);

            if (!removed) {
                failed = true;
                break;
            }

            deleted += removed.size;
        }

        left -= batch.size;

        if (recent.size < batch.size) {
            hitOldMessages = true; // Discord can not bulk-delete messages older than 14 days
            break;
        }
    }

    let text;

    if (failed && deleted === 0) {
        text = '❌ I could not delete the messages. Make sure the bot has **Manage Messages** permission.';
    } else {
        text = `DONE BOSS (${deleted} deleted)`;
        if (hitOldMessages) text += '\nThe rest is older than 14 days and Discord does not allow deleting those in bulk.';
        if (failed) text += '\nI stopped early because Discord refused a delete.';
    }

    if (isPrefix) {
        const note = await channel.send({ content: text }).catch(() => null);
        if (note) setTimeout(() => note.delete().catch(() => {}), 6000);
        return;
    }

    return interaction.editReply({ content: text }).catch(() => {});
}
