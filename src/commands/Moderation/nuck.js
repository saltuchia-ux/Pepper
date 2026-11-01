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
// ==========================================

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
const THREAD_TYPES = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread];

export default {
    data: new SlashCommandBuilder()
        .setName('nuck')
        .setDescription('Delete all messages in this channel (fast)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
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

async function runNuck(interaction) {
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
