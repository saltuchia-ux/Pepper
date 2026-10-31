import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { missingPermissionPayload } from '../../utils/replyStyle.js';
import { getPrefixText } from '../../utils/punishmentTools.js';

// ==========================================
// .nuck  /  /nuck  -  wipes a channel
//
// FAST WAY (used whenever possible): the channel is cloned (same name, topic,
// permissions, position...) and the old one is deleted. This is near-instant and
// clears EVERYTHING, including messages older than 14 days, which Discord's bulk
// delete cannot touch at all.
//
// SLOW WAY (threads, forum posts, or if the bot cannot manage channels): the old
// batch-delete loop, but with the next 100 messages fetched WHILE the current
// batch is being deleted, instead of one after another. Only the last 14 days
// can be removed this way; that is a Discord limit, not something a bot can fix.
// ==========================================

const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

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

    const canClone = channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
    const me = channel.guild.members.me;
    const canManageChannels = me?.permissions?.has(PermissionFlagsBits.ManageChannels) && channel.manageable;

    if (canClone && canManageChannels) {
        return nukeByClone(interaction, channel);
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

    await fresh
        .send({ content: `🧹 ${interaction.user} wiped this channel.` })
        .catch(() => {});
}

// ----- SLOW: delete messages in batches of 100 -----
// The NEXT batch is fetched by message ID (fetch ...,"before": oldest ID so far), so it can be
// requested WHILE the current batch is being deleted, without fetching the same messages twice.
async function nukeByDeleting(interaction, channel) {
    try {
        let totalDeleted = 0;
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

                totalDeleted += deleted.size;

                if (deleted.size < recent.size) break;   // Discord refused to delete older messages: stop here
            }

            if (recent.size < messages.size) break;   // the rest of the channel is older than 2 weeks
        }

        await InteractionHelper.universalReply(interaction, {
            content: `🧹 Deleted **${totalDeleted}** messages.`,
        });
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
