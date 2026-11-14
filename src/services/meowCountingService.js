import fs from 'fs';
import path from 'path';

// ============================================================================
// MEOW COUNTING
// A channel like counting, but everyone meows instead of counting numbers.
//   - Every message must look like meowing: meow, meoow, meeeooow, mrrow, mew, miau ...
//     (several in one message is fine: "meow meoow meoow")
//   - You can't meow twice in a row
//   - Not a meow, or meowing twice in a row, breaks the chain (back to 0)
//   - The rules box is sent again after every message
// ============================================================================

const DATA_DIR = process.env.COUNTING_DATA_DIR || path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'meow-counting.json');

const DEFAULT_CONFIG = {
  enabled: false,
  channelId: null,
  streak: 0,        // messages in a row, right now
  lastUserId: null,
  highScore: 0,     // longest chain ever
  totalMeows: 0,    // every meow ever (each word counts)
  rulesMessageId: null
};

let database = {};

function loadDatabase() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      database = {};
      return;
    }
    database = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {};
  } catch (error) {
    console.error('[MEOW] Failed to load database:', error);
    database = {};
  }
}

function saveDatabase() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
  } catch (error) {
    console.error('[MEOW] Failed to save database:', error);
  }
}

loadDatabase();

export async function getMeowConfig(guildId) {
  if (!database[guildId]) return null;
  return { ...DEFAULT_CONFIG, ...database[guildId] };
}

export async function saveMeowConfig(guildId, config) {
  database[guildId] = { ...DEFAULT_CONFIG, ...(config || {}) };
  saveDatabase();
  return database[guildId];
}

// ----------------------------------------------------------------------------
// Does it look like meowing?
// ----------------------------------------------------------------------------

//        meow / meoow / mmeeooww     mrow / mrrow     mew / meww     miau / miaow
const MEOW_UNIT = '(?:m+r*[ea]+o+w+|m+r+o+w+|m+e+w+|m+i+a+o*u+w*|m+i+a+o+w+)';
const MEOW_WORD = new RegExp(`^${MEOW_UNIT}+$`, 'i');

/** How many meows are in this text, or null when it is not (only) meowing. Capitals, ~ ! . , emojis and :3 are fine. */
export function parseMeows(content) {
  let text = String(content ?? '').normalize('NFKC').toLowerCase();

  text = text
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|️|‍/gu, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ');

  const words = text.split(/\s+/).filter((word) => word && !/^\d+$/.test(word));

  if (!words.length || words.length > 50) return null;

  return words.every((word) => MEOW_WORD.test(word)) ? words.length : null;
}

// ----------------------------------------------------------------------------
// Chain
// ----------------------------------------------------------------------------

async function recordMeow(guildId, userId, meows) {
  const config = database[guildId];
  if (!config) return null;

  config.streak = (config.streak || 0) + 1;
  config.lastUserId = userId;
  config.totalMeows = (config.totalMeows || 0) + meows;
  if (config.streak > (config.highScore || 0)) config.highScore = config.streak;

  saveDatabase();
  return { ...DEFAULT_CONFIG, ...config };
}

/** Breaks the chain. Returns how long it was. */
async function breakChain(guildId) {
  const config = database[guildId];
  if (!config) return 0;

  const was = config.streak || 0;
  config.streak = 0;
  config.lastUserId = null;

  saveDatabase();
  return was;
}

export async function resetMeowChain(guildId) {
  const was = await breakChain(guildId);
  return { was, config: await getMeowConfig(guildId) };
}

// ----------------------------------------------------------------------------
// The game
// ----------------------------------------------------------------------------

/** Called for every message. Returns true when the message was in the meow channel (and handled). */
export async function handleMeowGame(message) {
  try {
    const config = await getMeowConfig(message.guild.id);

    if (!config?.enabled || !config.channelId || message.channel.id !== config.channelId) {
      return false;
    }

    const content = message.content.trim();

    // Commands still work (the rules box still goes back to the bottom)
    if (content.startsWith('.')) {
      await refreshMeowRules(message.channel, config);
      return false;
    }

    // Pictures / stickers with no text: ignored
    if (!content) {
      await refreshMeowRules(message.channel, config);
      return true;
    }

    const meows = parseMeows(content);

    // ----- not a meow -----
    if (meows === null) {
      const was = await breakChain(message.guild.id);
      await message.react('❌').catch(() => {});
      await message.channel.send({
        embeds: [{
          color: 0xED4245,
          title: '💥 That was not a meow! Chain broken',
          description: was
            ? `You were at **${was}** meow${was === 1 ? '' : 's'} in a row. Start again with a **meow**.`
            : 'Start again with a **meow**.'
        }]
      }).catch(() => {});
      await refreshMeowRules(message.channel, await getMeowConfig(message.guild.id));
      return true;
    }

    // ----- same person twice -----
    if (config.lastUserId === message.author.id) {
      const was = await breakChain(message.guild.id);
      await message.react('❌').catch(() => {});
      await message.channel.send({
        embeds: [{
          color: 0xED4245,
          description:
            '💥 **You can\'t meow twice in a row!**\n' +
            `The chain was **${was}** meow${was === 1 ? '' : 's'} long. Start again with a **meow**.`
        }]
      }).catch(() => {});
      await refreshMeowRules(message.channel, await getMeowConfig(message.guild.id));
      return true;
    }

    // ----- good meow -----
    const updated = await recordMeow(message.guild.id, message.author.id, meows);
    await message.react('🐱').catch(() => {});
    await refreshMeowRules(message.channel, updated);
    return true;

  } catch (error) {
    console.error('[MEOW] Error handling meow game:', error);
    return false;
  }
}

// ----------------------------------------------------------------------------
// Rules box (sent again after every message, old one deleted)
// ----------------------------------------------------------------------------

// One refresh at a time per channel; messages that arrive meanwhile cause one more run afterwards.
const refreshRunning = new Map(); // channelId -> { again, config }

export async function refreshMeowRules(channel, config) {
  if (!channel || !config) return;

  const running = refreshRunning.get(channel.id);
  if (running) {
    running.again = true;
    running.config = config;
    return;
  }

  const state = { again: false, config };
  refreshRunning.set(channel.id, state);

  try {
    await doRefreshMeowRules(channel, config);
    while (state.again) {
      state.again = false;
      await doRefreshMeowRules(channel, state.config);
    }
  } finally {
    refreshRunning.delete(channel.id);
  }
}

function isMeowRulesText(description) {
  return description.includes('**MEOW COUNTING**') && description.includes('Channel Rules');
}

export function isMeowRulesBox(message) {
  return isMeowRulesText(message.embeds?.[0]?.description ?? '');
}

async function doRefreshMeowRules(channel, config) {
  const guildId = channel.guild.id;

  // always the newest saved numbers and message id (the config passed in can be a little old)
  const current = { ...DEFAULT_CONFIG, ...config, ...(database[guildId] || {}) };
  const oldRulesMessageId = current.rulesMessageId;

  // delete the saved old rules box
  if (oldRulesMessageId) {
    const old = await channel.messages.fetch(oldRulesMessageId).catch(() => null);
    await old?.delete().catch(() => {});
  }

  // delete any other copy
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  for (const message of recent?.values() ?? []) {
    if (!message.author.bot || message.id === oldRulesMessageId) continue;
    if (isMeowRulesBox(message)) await message.delete().catch(() => {});
  }

  // send the new one
  let rulesMessage;
  try {
    rulesMessage = await channel.send({
      embeds: [{
        color: 0x5865F2,
        description:
          '**MEOW COUNTING**\n\n' +
          '### **Channel Rules**\n\n' +
          '• Only meows (meow, meoow, mrrow, mew...)\n' +
          '• Not a meow = ❌ Reset\n' +
          '• No meowing twice in a row\n' +
          '• No side conversations\n' +
          '**Violation of these rules WILL HAVE consequences and punishment.**\n\n' +
          `🐱 Meows in a row: **${current.streak || 0}** • Record: **${current.highScore || 0}**`
      }]
    });
  } catch (error) {
    console.error('[MEOW] Could not send rules message:', error);
    return;
  }

  // only the rules message id is saved here (the chain itself is saved elsewhere)
  database[guildId] = { ...DEFAULT_CONFIG, ...config, ...(database[guildId] || {}), rulesMessageId: rulesMessage.id };
  saveDatabase();
}
