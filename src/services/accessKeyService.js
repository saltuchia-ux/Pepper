// accessKeyService.js
// Pepper only works in a server after someone with "Manage Server" enters the access key.
//   - Every server starts LOCKED (including servers Pepper is already in).
//   - When Pepper is added, it posts a message with an "Enter Key" button.
//   - If Pepper is removed and added again, the server is locked again.
// Change the key with PEPPER_ACCESS_KEY in .env (default below).

import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { logger } from '../utils/logger.js';

const DEFAULT_ACCESS_KEY = 'I Love Kiwi';

export const KEY_BUTTON_ID = 'pepper_key_open';
export const KEY_MODAL_ID = 'pepper_key_modal';
const KEY_INPUT_ID = 'pepper_key_input';

const UNLOCK_PREFIX = 'pepper_access:';
const PROMPTED_PREFIX = 'pepper_access_prompted:';

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

// Events that must still run in a locked server (or that have no server).
const EXEMPT_EVENTS = new Set(['guildCreate', 'guildDelete', 'clientReady', 'ready', 'interactionCreate']);

const unlocked = new Set();
let loaded = false;
let loading = null;
const attempts = new Map(); // userId -> [timestamps]

function getAccessKey() {
  return (process.env.PEPPER_ACCESS_KEY || DEFAULT_ACCESS_KEY).trim();
}

function normalize(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function digest(text) {
  return crypto.createHash('sha256').update(normalize(text)).digest();
}

export function isKeyCorrect(input) {
  return crypto.timingSafeEqual(digest(input), digest(getAccessKey()));
}

function keysFromList(result, prefix) {
  if (Array.isArray(result)) return result.filter((k) => typeof k === 'string' && k.startsWith(prefix));
  if (result && typeof result === 'object') return Object.keys(result).filter((k) => k.startsWith(prefix));
  return [];
}

async function ensureLoaded(client) {
  if (loaded) return;
  if (!loading) {
    loading = (async () => {
      try {
        const keys = keysFromList(await client.db.list(UNLOCK_PREFIX), UNLOCK_PREFIX);
        for (const key of keys) unlocked.add(key.slice(UNLOCK_PREFIX.length));
        loaded = true;
      } catch (error) {
        loading = null;
        throw error;
      }
    })();
  }
  await loading;
}

export async function isGuildUnlocked(client, guildId) {
  if (!guildId) return true;
  try {
    await ensureLoaded(client);
  } catch (error) {
    // If the database cannot be read we stay locked (safer than opening every server).
    logger.error('Access key: could not load unlocked servers:', error);
    return false;
  }
  return unlocked.has(String(guildId));
}

export async function unlockGuild(client, guildId, userId) {
  await ensureLoaded(client);
  await client.db.set(`${UNLOCK_PREFIX}${guildId}`, { unlockedBy: userId, unlockedAt: Date.now() });
  unlocked.add(String(guildId));
  logger.info('Access key accepted', { event: 'access.unlocked', guildId, userId });
}

// Called when Pepper leaves a server, so the next add asks for the key again.
export async function lockGuild(client, guildId) {
  try {
    await ensureLoaded(client);
  } catch {
    // keep going and still try to delete
  }
  unlocked.delete(String(guildId));
  await client.db.delete(`${UNLOCK_PREFIX}${guildId}`).catch(() => {});
  await client.db.delete(`${PROMPTED_PREFIX}${guildId}`).catch(() => {});
}

// Pepper may have been removed while it was offline: forget servers it is no longer in.
export async function purgeStaleGuilds(client) {
  if (client.guilds.cache.some((g) => g.available === false)) return; // outage, cache not trustworthy
  await ensureLoaded(client);
  const stored = new Set([
    ...unlocked,
    ...keysFromList(await client.db.list(PROMPTED_PREFIX), PROMPTED_PREFIX).map((k) => k.slice(PROMPTED_PREFIX.length)),
  ]);
  for (const guildId of stored) {
    if (!client.guilds.cache.has(guildId)) {
      await lockGuild(client, guildId);
      logger.info('Access key: cleared record for a server Pepper is no longer in', { guildId });
    }
  }
}

// Works out which server an event belongs to from its arguments.
export function guildIdFromEventArgs(args) {
  for (const arg of args) {
    const id = arg?.guildId ?? arg?.guild?.id ?? (arg?.constructor?.name === 'Guild' ? arg.id : null);
    if (id) return String(id);
  }
  return null;
}

// Used by the event loader: should this event be skipped?
export async function shouldBlockEvent(client, eventName, args) {
  if (EXEMPT_EVENTS.has(eventName)) return false;
  const guildId = guildIdFromEventArgs(args);
  if (!guildId) return false;
  return !(await isGuildUnlocked(client, guildId));
}

function canEnterKey(member) {
  return Boolean(
    member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) ||
      member?.permissions?.has?.(PermissionFlagsBits.Administrator) ||
      member?.guild?.ownerId === member?.id
  );
}

function tooManyAttempts(userId) {
  const now = Date.now();
  const recent = (attempts.get(userId) || []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  attempts.set(userId, recent);
  return recent.length >= MAX_ATTEMPTS;
}

function recordFailedAttempt(userId) {
  attempts.set(userId, [...(attempts.get(userId) || []), Date.now()]);
}

function keyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(KEY_BUTTON_ID).setLabel('Enter Key').setEmoji('🔑').setStyle(ButtonStyle.Primary)
  );
}

function lockedEmbed() {
  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🔒 Pepper needs a key')
    .setDescription(
      'Pepper is locked in this server until the access key is entered.\n\n' +
        'Someone with **Manage Server** permission can press **Enter Key** below.'
    );
}

export function buildKeyPrompt() {
  return { embeds: [lockedEmbed()], components: [keyRow()] };
}

async function findPromptChannel(guild) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) return null;

  const usable = (channel) =>
    channel &&
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) &&
    channel.permissionsFor(me)?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ]);

  if (usable(guild.systemChannel)) return guild.systemChannel;
  return guild.channels.cache.find((c) => usable(c)) ?? null;
}

// Posts the "Enter Key" message. Falls back to a DM to the server owner.
export async function sendKeyPrompt(client, guild) {
  try {
    const channel = await findPromptChannel(guild);
    if (channel) {
      await channel.send(buildKeyPrompt());
    } else {
      const owner = await guild.fetchOwner();
      await owner.send({
        content: `Pepper was added to **${guild.name}**, but I can't post there.`,
        ...buildKeyPrompt(),
      });
    }
    await client.db.set(`${PROMPTED_PREFIX}${guild.id}`, Date.now());
    return true;
  } catch (error) {
    logger.warn(`Access key: could not post the key prompt in ${guild.id}: ${error.message}`);
    return false;
  }
}

// On startup: ask every locked server that has not been asked yet.
export async function promptLockedGuilds(client) {
  await ensureLoaded(client);
  for (const guild of client.guilds.cache.values()) {
    if (unlocked.has(guild.id)) continue;
    const prompted = await client.db.get(`${PROMPTED_PREFIX}${guild.id}`, null);
    if (prompted) continue;
    await sendKeyPrompt(client, guild);
  }
}

// Called first in interactionCreate. Returns true when the interaction was handled here.
export async function handleAccessInteraction(interaction, client) {
  const isKeyButton = interaction.isButton() && interaction.customId === KEY_BUTTON_ID;
  const isKeyModal = interaction.isModalSubmit() && interaction.customId === KEY_MODAL_ID;

  if (!interaction.guildId) {
    return isKeyButton || isKeyModal; // the key only makes sense inside a server
  }

  const open = await isGuildUnlocked(client, interaction.guildId);

  if (isKeyButton) {
    if (open) {
      await interaction.reply({ content: '✅ Pepper is already unlocked in this server.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!canEnterKey(interaction.member)) {
      await interaction.reply({
        content: 'Only someone with **Manage Server** permission can enter the key.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const modal = new ModalBuilder()
      .setCustomId(KEY_MODAL_ID)
      .setTitle('Pepper access key')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(KEY_INPUT_ID)
            .setLabel('Key')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  if (isKeyModal) {
    if (open) {
      await interaction.reply({ content: '✅ Pepper is already unlocked in this server.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!canEnterKey(interaction.member)) {
      await interaction.reply({
        content: 'Only someone with **Manage Server** permission can enter the key.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    if (tooManyAttempts(interaction.user.id)) {
      await interaction.reply({
        content: 'Too many wrong keys. Please wait a few minutes and try again.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const entered = interaction.fields.getTextInputValue(KEY_INPUT_ID);
    if (!isKeyCorrect(entered)) {
      recordFailedAttempt(interaction.user.id);
      logger.warn('Access key rejected', { event: 'access.rejected', guildId: interaction.guildId, userId: interaction.user.id });
      await interaction.reply({ content: '❌ That key is not right. Try again.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await unlockGuild(client, interaction.guildId, interaction.user.id);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('🔓 Pepper unlocked')
          .setDescription(`Key accepted (by ${interaction.user}). Pepper is now active in this server.`),
      ],
    });
    return true;
  }

  if (open) return false;

  // Locked server: nothing else works yet.
  if (interaction.isAutocomplete()) {
    await interaction.respond([]).catch(() => {});
    return true;
  }
  if (interaction.isRepliable()) {
    await interaction
      .reply({ ...buildKeyPrompt(), flags: MessageFlags.Ephemeral })
      .catch((error) => logger.debug('Access key: could not send locked notice:', error));
  }
  return true;
}
