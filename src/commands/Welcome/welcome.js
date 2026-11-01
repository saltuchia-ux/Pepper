import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../../utils/database.js';
import { formatWelcomeMessage, truncateForEmbedField } from '../../utils/welcome.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import { getPrefixText, errorBox } from '../../utils/punishmentTools.js';


const VM_AUDIO_EXTENSIONS = /\.(mp3|ogg|wav|m4a|webm|flac|aac)$/i;
const VM_MAX_SIZE = 8 * 1024 * 1024; // 8 MB, safe for every server's upload limit

// Checks an attachment is a usable audio file. Returns { ok: true } or { ok: false, message }.
function checkVoiceMessageAttachment(attachment) {
    if (!attachment) {
        return { ok: false, message: 'Attach an audio file (mp3, ogg, wav, m4a, webm) to set a welcome voice message.' };
    }

    const isAudio = attachment.contentType?.startsWith('audio/') || VM_AUDIO_EXTENSIONS.test(attachment.name || '');

    if (!isAudio) {
        return { ok: false, message: 'That file does not look like an audio file. Upload an mp3, ogg, wav, m4a or webm file.' };
    }

    if (attachment.size > VM_MAX_SIZE) {
        return { ok: false, message: `That file is too big (${(attachment.size / 1024 / 1024).toFixed(1)} MB). Keep it under 8 MB.` };
    }

    return { ok: true };
}

function buildVoiceMessageSetEmbed(name) {
    return new EmbedBuilder()
        .setColor(getColor('success'))
        .setTitle('Welcome Voice Message Set')
        .setDescription(`\`${name}\` will now be sent as an attachment with every welcome message.`)
        .setFooter({ text: 'It is sent as a normal audio attachment, not the purple "voice message" bubble.' });
}

function buildVoiceMessageRemovedEmbed() {
    return new EmbedBuilder().setColor(getColor('success')).setTitle('Welcome Voice Message Removed');
}

export default {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Configure the welcome system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set up the welcome message')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The channel to send welcome messages to')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Welcome message. Variables: {user}, {username}, {server}, {memberCount}')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('image')
                        .setDescription('URL of the image to include in the welcome message')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ping')
                        .setDescription('Whether to ping the user in the welcome message')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('setvm')
                .setDescription('Set a voice message that plays for every new member')
                .addAttachmentOption(option =>
                    option.setName('audio')
                        .setDescription('An audio file (mp3, ogg, wav, m4a, webm)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('removevm')
                .setDescription('Remove the welcome voice message')),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);
            if (!deferSuccess) {
                logger.warn(`Welcome interaction defer failed`, {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'welcome'
                });
                return;
            }
        } catch (deferError) {
            logger.error(`Welcome defer error`, { error: deferError.message });
            return;
        }

        const { options, guild, client } = interaction;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'You need the **Manage Server** permission to use `/welcome`.' });
        }

        const subcommand = options.getSubcommand();

        if (subcommand === 'setvm') {
            const attachment = options.getAttachment('audio');
            const check = checkVoiceMessageAttachment(attachment);

            if (!check.ok) {
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: check.message });
            }

            await updateWelcomeConfig(client, guild.id, {
                welcomeVoiceMessage: { url: attachment.url, name: attachment.name },
            });

            logger.info(`[Welcome] Voice message set by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

            return await InteractionHelper.safeEditReply(interaction, { embeds: [buildVoiceMessageSetEmbed(attachment.name)] });
        }

        if (subcommand === 'removevm') {
            const existingConfig = await getWelcomeConfig(client, guild.id);

            if (!existingConfig?.welcomeVoiceMessage) {
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'There is no welcome voice message set.' });
            }

            await updateWelcomeConfig(client, guild.id, { welcomeVoiceMessage: null });

            logger.info(`[Welcome] Voice message removed by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

            return await InteractionHelper.safeEditReply(interaction, { embeds: [buildVoiceMessageRemovedEmbed()] });
        }

        if (subcommand === 'setup') {
            const channel = options.getChannel('channel');
            const message = options.getString('message');
            const image = options.getString('image');
            const ping = options.getBoolean('ping') ?? false;

            const existingConfig = await getWelcomeConfig(client, guild.id);
            if (existingConfig?.channelId) {
                logger.info(`[Welcome] Setup blocked because config already exists in channel ${existingConfig.channelId} for guild ${guild.id}`);
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Welcome is already configured for <#${existingConfig.channelId}>. Use **/greet dashboard** to customize channel, message, ping, or image.` });
            }
            
            if (!message || message.trim().length === 0) {
                logger.warn(`[Welcome] Empty message provided by ${interaction.user.tag} in ${guild.name}`);
                return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Welcome message cannot be empty' });
            }

            if (image) {
                try {
                    new URL(image);
                } catch (e) {
                    logger.warn(`[Welcome] Invalid image URL provided by ${interaction.user.tag}: ${image}`);
                    return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'Please provide a valid image URL (must start with http:// or https://' });
                }
            }

            try {
                await updateWelcomeConfig(client, guild.id, {
                    enabled: true,
                    channelId: channel.id,
                    welcomeMessage: message,
                    welcomeImage: image || undefined,
                    welcomePing: ping
                });

                logger.info(`[Welcome] Setup configured by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

                const previewMessage = formatWelcomeMessage(message, {
                    user: interaction.user,
                    guild
                });

                const embed = new EmbedBuilder()
                    .setColor(getColor('success'))
                    .setTitle('Welcome System Configured')
                    .setDescription(`Welcome messages will now be sent to ${channel}`)
                    .addFields(
                        { name: 'Message Preview', value: truncateForEmbedField(previewMessage) },
                        { name: 'Ping User', value: ping ? 'Yes' : 'No' },
                        { name: 'Status', value: 'Enabled' }
                    )
                    .setFooter({ text: 'Tip: Use /greet dashboard to customize welcome settings' });

                if (image) {
                    embed.setImage(image);
                }

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } catch (error) {
                logger.error(`[Welcome] Failed to setup welcome system for guild ${guild.id}:`, error);
                await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'An error occurred while configuring the welcome system. Please try again.' });
            }
        }
    },

    // Prefix command:
    //   .welcome setvm       (with an audio file attached to the SAME message)
    //   .welcome removevm
    // Only setvm/removevm work as a prefix command. The full /welcome setup (channel,
    // message, ping, image) stays slash-only and needs Manage Server, same as before.
    // setvm/removevm here only need Ban Members, so staff without Manage Server can
    // still set the voice message.
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    errorBox(
                        'Missing permission',
                        'You need the **Ban Members** permission to use `.welcome setvm` or `.welcome removevm`.'
                    ),
                ],
                ephemeral: true,
            });
        }

        const action = getPrefixText(interaction, 'welcome').split(/\s+/)[0]?.toLowerCase();

        if (action === 'removevm') {
            const existingConfig = await getWelcomeConfig(client ?? interaction.client, guild.id);

            if (!existingConfig?.welcomeVoiceMessage) {
                return InteractionHelper.universalReply(interaction, {
                    embeds: [errorBox('Nothing to remove', 'There is no welcome voice message set.')],
                    ephemeral: true,
                });
            }

            await updateWelcomeConfig(client ?? interaction.client, guild.id, { welcomeVoiceMessage: null });

            logger.info(`[Welcome] Voice message removed by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

            return InteractionHelper.universalReply(interaction, { embeds: [buildVoiceMessageRemovedEmbed()] });
        }

        if (action === 'setvm') {
            // Prefix commands read the real Discord message directly, the same way the
            // text after ".welcome" is read, since there is no slash-style attachment option.
            const realMessage = interaction.message ?? interaction._responseCoordinator?.message ?? null;
            const attachment = realMessage?.attachments?.first?.() ?? null;

            const check = checkVoiceMessageAttachment(attachment);

            if (!check.ok) {
                return InteractionHelper.universalReply(interaction, {
                    embeds: [errorBox('No usable file', `${check.message}\nAttach it to the same message: \`.welcome setvm\` with the file attached.`)],
                    ephemeral: true,
                });
            }

            await updateWelcomeConfig(client ?? interaction.client, guild.id, {
                welcomeVoiceMessage: { url: attachment.url, name: attachment.name },
            });

            logger.info(`[Welcome] Voice message set by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

            return InteractionHelper.universalReply(interaction, { embeds: [buildVoiceMessageSetEmbed(attachment.name)] });
        }

        return InteractionHelper.universalReply(interaction, {
            embeds: [
                errorBox(
                    'What should I do?',
                    'Use `.welcome setvm` with an audio file attached, or `.welcome removevm`.\n' +
                    'For the full setup (channel, message, image) use `/welcome setup` - that one still needs Manage Server.'
                ),
            ],
            ephemeral: true,
        });
    },
};