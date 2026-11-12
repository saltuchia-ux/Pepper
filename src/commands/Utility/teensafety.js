import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// ==========================================
// .teensafety            -> posts the Discord teen safety rules in the #teen-safety channel
// .teensafety #channel   -> posts them in a different channel
//
// The bot finds the channel by name: any text channel with "teen-safety" in its name
// (also with emojis, like "🛡・teen-safety").
// Run it again later and the bot EDITS its old post instead of sending a new one.
// Needs the Manage Server permission.
// ==========================================

const CHANNEL_NAME = 'teen-safety';
const TITLE = '🛡️ Teen Safety on Discord';

// ---- The text that gets posted (change anything you like) ----
function buildEmbed() {
    return createEmbed({
        title: TITLE,
        description:
            'Discord is built for ages **13+**, and it has safety tools made for teens. ' +
            'Here is what they do, and how to stay safe in this server.',
        fields: [
            {
                name: '🔒 Built-in protections (Teen Safety Assist)',
                value: [
                    '・ **Safety alerts** when someone you don\'t know messages you for the first time.',
                    '・ **Sensitive image filters** blur or block graphic content.',
                    '・ **Crisis support** links, like Crisis Text Line and Find a Helpline.',
                ].join('\n'),
            },
            {
                name: '⚙️ Teen-by-default settings',
                value:
                    'Teen-appropriate settings are on by default: stricter content filters and tighter limits ' +
                    'on age-restricted spaces and who can message you. Only age-verified adults can unblur ' +
                    'sensitive content or turn these off.',
            },
            {
                name: '👨‍👩‍👧 Family Center (optional)',
                value:
                    'You and a parent or guardian can link accounts in **User Settings → Family Center**. ' +
                    'They can see things like which servers you joined, but **not your messages**.',
            },
            {
                name: '✅ Stay safe',
                value: [
                    '・ Never share your address, school, phone number, passwords or private photos.',
                    '・ Be careful with links and files from people you don\'t know.',
                    '・ Block or ignore anyone who makes you uncomfortable.',
                    '・ Red flag: someone asking for secrecy, photos, or to move to private chat or video.',
                ].join('\n'),
            },
            {
                name: '🆘 Need help?',
                value: [
                    '・ Tell a staff member. Reporting something is always okay.',
                    '・ You can also report messages or users straight to Discord (**Report** in the message menu).',
                    '・ In danger or a crisis? Contact your local emergency services or a crisis line.',
                    '・ More info: https://discord.com/safety',
                ].join('\n'),
            },
        ],
        footer: 'Discord changes its features over time. Check discord.com/safety for the latest.',
    });
}

// "🛡・teen-safety" -> "-teen-safety",  "Teen Safety" -> "teen-safety"
const simpleName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function findTeenSafetyChannel(guild) {
    await guild.channels.fetch().catch(() => null);

    return (
        guild.channels.cache.find(
            (channel) =>
                [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) &&
                simpleName(channel.name).includes(CHANNEL_NAME),
        ) ?? null
    );
}

const reply = (interaction, content, ephemeral = false) =>
    InteractionHelper.universalReply(interaction, {
        content,
        ephemeral,
        allowedMentions: { parse: [] },
    });

async function run(interaction, chosenChannel) {
    const guild = interaction.guild;

    if (!guild) return reply(interaction, '❌ This command can only be used in a server.', true);

    const channel = chosenChannel ?? (await findTeenSafetyChannel(guild));

    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return reply(
            interaction,
            `❌ I couldn't find a text channel called **${CHANNEL_NAME}**.\n` +
            'Make one, or tell me where to post it: `.teensafety #channel`',
            true,
        );
    }

    const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
    const allowed = me && channel.permissionsFor(me)?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
    ]);

    if (!allowed) {
        return reply(
            interaction,
            `❌ I need **View Channel**, **Send Messages** and **Embed Links** in ${channel}.`,
            true,
        );
    }

    const embed = buildEmbed();

    try {
        // if the bot already posted this in the channel, edit that post instead of sending a copy
        const recent = await channel.messages.fetch({ limit: 30 }).catch(() => null);
        const old = recent?.find(
            (message) => message.author.id === guild.client.user.id && message.embeds[0]?.title === TITLE,
        );

        if (old) {
            await old.edit({ embeds: [embed] });

            return reply(interaction, `✅ Updated the teen safety rules in ${channel}.`);
        }

        await channel.send({ embeds: [embed] });

        return reply(interaction, `✅ Posted the teen safety rules in ${channel}.`);
    } catch (error) {
        console.error('TEEN SAFETY ERROR:', error);

        return reply(interaction, `❌ I couldn't post in ${channel}.\nError: ${error.message}`, true);
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('teensafety')
        .setDescription('Post the Discord teen safety rules in the teen-safety channel')
        .addChannelOption((option) =>
            option
                .setName('channel')
                .setDescription('Channel to post in (default: the teen-safety channel)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    category: 'Utility',

    async execute(interaction) {
        return run(interaction, await interaction.options.getChannel('channel'));
    },

    async prefixExecute(interaction) {
        return run(interaction, await interaction.options.getChannel('channel'));
    },
};
