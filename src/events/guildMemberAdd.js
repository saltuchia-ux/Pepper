import { Events, EmbedBuilder, PermissionFlagsBits, ChannelType, resolveColor, AttachmentBuilder } from 'discord.js';
import { WELCOME_DEFAULTS } from '../config/welcomeDefaults.js';
import { getColor, botConfig } from '../config/bot.js';
import { getGuildConfig } from '../services/config/guildConfig.js';
import { getWelcomeConfig } from '../utils/database.js';
import {
  formatWelcomeMessage,
  isStockWelcomeMessage,
  RICH_WELCOME_TEMPLATE,
  RICH_WELCOME_COLOR,
  RICH_WELCOME_TITLE,
} from '../utils/welcome.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { getServerCounters, updateCounter } from '../services/serverstatsService.js';
import { setBirthday as dbSetBirthday } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { enforceForcedNick } from '../utils/forcedNick.js';

export default {
  name: Events.GuildMemberAdd,
  once: false,
  
  async execute(member) {
    try {
        const { guild, user } = member;

        await enforceForcedNick(member);
        
        const config = await getGuildConfig(member.client, guild.id);
        
        const welcomeConfig = await getWelcomeConfig(member.client, guild.id);
        
        let welcomeChannelId = welcomeConfig?.channelId;
        let welcomeEnabled = welcomeConfig?.enabled;

        // Never set up in this server -> use the built-in default channel (see welcomeDefaults.js).
        if (!welcomeChannelId && WELCOME_DEFAULTS.enabled) {
            const wanted = WELCOME_DEFAULTS.channelName.toLowerCase();
            const fallback = guild.channels.cache.find((c) =>
                c.type === ChannelType.GuildText
                && c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === wanted
            );
            if (fallback) {
                welcomeChannelId = fallback.id;
                welcomeEnabled = true;
            }
        }

        if (welcomeEnabled && welcomeChannelId) {
            const channel = guild.channels.cache.get(welcomeChannelId);
            const me = guild.members.me;
            const permissions = channel?.isTextBased?.() && me ? channel.permissionsFor(me) : null;
            // Skip only the welcome message if permissions are missing; the rest of the
            // join pipeline (auto-role, verification, logging, counters) must still run.
            if (permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                const formatData = { user, guild, member };

                const rawTemplate = welcomeConfig.welcomeMessage
                    || welcomeConfig.welcomeEmbed?.description
                    || botConfig.welcome?.defaultWelcomeMessage;

                // No custom message saved -> use the full welcome (boost info, rules, join position).
                const useRich = isStockWelcomeMessage(rawTemplate);

                const welcomeMessage = formatWelcomeMessage(
                    useRich ? RICH_WELCOME_TEMPLATE : rawTemplate,
                    formatData
                );

                // The mention must be in the message text (not the embed) for the user to get a ping.
                const mention = user.toString();
                const messageContent = mention;
                const allowedMentions = { parse: [], users: [user.id] };

                const embedTitle = formatWelcomeMessage(
                    useRich ? RICH_WELCOME_TITLE : (welcomeConfig.welcomeEmbed?.title || '🎉 Welcome!'),
                    formatData
                );
                const embedFooter = welcomeConfig.welcomeEmbed?.footer
                    ? formatWelcomeMessage(welcomeConfig.welcomeEmbed.footer, formatData)
                    : `Welcome to ${guild.name}!`;

                const canEmbed = permissions.has(PermissionFlagsBits.EmbedLinks);

                if (!canEmbed) {
                    await channel.send({
                        content: welcomeMessage.includes(mention) ? welcomeMessage : `${mention} ${welcomeMessage}`,
                        allowedMentions
                    });
                } else {
                    const joinedTs = Math.floor((member.joinedTimestamp ?? Date.now()) / 1000);

                    // Plain embed object (not EmbedBuilder) so emojis are kept; the bot's
                    // normal embeds strip them.
                    const embed = {
                        // Raw embed objects need a number, so convert hex strings like '#57F287'.
                        color: resolveColor(useRich
                            ? RICH_WELCOME_COLOR
                            : (welcomeConfig.welcomeEmbed?.color || getColor('success'))),
                        title: embedTitle,
                        description: welcomeMessage,
                        thumbnail: { url: user.displayAvatarURL() },
                    };

                    if (useRich) {
                        // Footer shows: "Server position #N • Today at 8:32 PM". Discord turns the timestamp
                        // into "Today at ..." -> "Yesterday at ..." -> "10/15/2026 ..." by itself.
                        embed.footer = { text: `👥 Server position #${guild.memberCount}` };
                        embed.timestamp = new Date(member.joinedTimestamp ?? Date.now()).toISOString();
                    } else {
                        // Custom messages keep the extra fields and footer.
                        embed.fields = [
                            { name: '📅 Joined', value: `<t:${joinedTs}:D>`, inline: true },
                            { name: '👥 Join Position', value: `#${guild.memberCount}`, inline: true },
                        ];
                        embed.footer = { text: embedFooter };
                    }

                    if (welcomeConfig.welcomeImage) {
                        embed.image = { url: welcomeConfig.welcomeImage };
                    } else if (welcomeConfig.welcomeEmbed?.image?.url) {
                        embed.image = { url: welcomeConfig.welcomeEmbed.image.url };
                    }

                    await channel.send({ 
                        content: messageContent,
                        embeds: [embed],
                        allowedMentions
                    });
                }

                // Welcome voice message (set with /welcome setvm): sent as its own
                // message right after, so it never blocks the text welcome above.
                if (welcomeConfig.welcomeVoiceMessage?.url && permissions.has(PermissionFlagsBits.AttachFiles)) {
                    try {
                        const attachment = new AttachmentBuilder(
                            welcomeConfig.welcomeVoiceMessage.url,
                            { name: welcomeConfig.welcomeVoiceMessage.name || 'welcome-voice-message.mp3' }
                        );
                        await channel.send({ files: [attachment] });
                    } catch (voiceMessageError) {
                        logger.warn(`Could not send the welcome voice message in guild ${guild.id}:`, voiceMessageError);
                    }
                }
            }
        }
        
        if (welcomeConfig?.roleIds && welcomeConfig.roleIds.length > 0) {
            const delay = welcomeConfig.autoRoleDelay || 0;
            const singleRoleId = welcomeConfig.roleIds[0];
            
            if (delay > 0) {
                const timeout = setTimeout(async () => {
                    const role = guild.roles.cache.get(singleRoleId);
                    if (role) {
                        await assignRoleSafely(member, role);
                    }
                }, delay * 1000);
                if (typeof timeout.unref === 'function') {
                    timeout.unref();
                }
            } else {
                const role = guild.roles.cache.get(singleRoleId);
                if (role) {
                    await assignRoleSafely(member, role);
                }
            }
        }
        
        if (config?.verification?.enabled || config?.verification?.autoVerify?.enabled) {
            await handleVerification(member, guild, config.verification, member.client);
        }

        try {
            await logEvent({
                client: member.client,
                guildId: guild.id,
                eventType: EVENT_TYPES.MEMBER_JOIN,
                data: {
                    title: 'User joined',
                    lines: [
                        `**User:** ${user.toString()} (${user.displayName !== user.username ? `@${user.displayName}` : user.tag})`,
                        `**ID:** \`${user.id}\``,
                        `**Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
                        `**Members:** ${guild.memberCount}`,
                    ],
                    quoted: false,
                    thumbnail: user.displayAvatarURL({ dynamic: true }),
                    userId: user.id,
                }
            });
        } catch (error) {
            logger.debug('Error logging member join:', error);
        }

        try {
            const counters = await getServerCounters(member.client, guild.id);
            for (const counter of counters) {
                if (counter && counter.type && counter.channelId && counter.enabled !== false) {
                    await updateCounter(member.client, guild, counter);
                }
            }
        } catch (error) {
            logger.debug('Error updating counters on member join:', error);
        }

        try {
            const backupKey = `guild:${guild.id}:birthdays:left`;
            const backup = (await member.client.db.get(backupKey)) || {};
            if (backup[user.id]) {
                const { month, day } = backup[user.id];
                await dbSetBirthday(member.client, guild.id, user.id, month, day);
                delete backup[user.id];
                await member.client.db.set(backupKey, backup);
                logger.debug(`Birthday restored for user ${user.id} in guild ${guild.id}`);
            }
        } catch (error) {
            logger.debug('Error restoring birthday on member join:', error);
        }
        
    } catch (error) {
        logger.error('Error in guildMemberAdd event:', error);
    }
  }
};

async function handleVerification(member, guild, verificationConfig, client) {
    const { autoVerifyOnJoin } = await import('../services/verificationService.js');
    
    try {
        const result = await autoVerifyOnJoin(client, guild, member, verificationConfig);
        
        if (result.autoVerified) {
            logger.info('User auto-verified on join', {
                guildId: guild.id,
                userId: member.id,
                userTag: member.user.tag,
                roleName: result.roleName,
                criteria: result.criteria
            });
        } else {
            logger.debug('User not auto-verified on join', {
                guildId: guild.id,
                userId: member.id,
                reason: result.reason
            });
        }

    } catch (error) {
        logger.error('Error in auto-verification for member', {
            guildId: guild.id,
            userId: member.id,
            userTag: member.user.tag,
            error: error.message
        });
    }
}

async function assignRoleSafely(member, role) {
    try {
        await member.roles.add(role);
    } catch (error) {
        logger.warn(`Failed to assign role ${role.id} to member ${member.id}:`, error);
    }
}
