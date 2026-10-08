import fs from 'fs';
import path from 'path';

const DATA_DIR =
  process.env.COUNTING_DATA_DIR ||
  path.join(process.cwd(), 'data');

const DATA_FILE =
  path.join(DATA_DIR, 'counting.json');

const DEFAULT_CONFIG = {
  enabled: false,
  channelId: null,
  nextNumber: 1,
  lastUserId: null,
  highScore: 0,
  rulesMessageId: null
};

let database = {};

function loadDatabase() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      database = {};
      return;
    }

    const raw =
      fs.readFileSync(
        DATA_FILE,
        'utf8'
      );

    database =
      JSON.parse(raw) || {};

  } catch (error) {
    console.error(
      '[COUNTING] Failed to load database:',
      error
    );

    database = {};
  }
}

function saveDatabase() {
  try {
    fs.mkdirSync(
      DATA_DIR,
      {
        recursive: true
      }
    );

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        database,
        null,
        2
      )
    );

  } catch (error) {
    console.error(
      '[COUNTING] Failed to save database:',
      error
    );
  }
}

loadDatabase();

export async function getCountingGameConfig(
  client,
  guildId
) {
  if (!database[guildId]) {
    return null;
  }

  return {
    ...DEFAULT_CONFIG,
    ...database[guildId]
  };
}

export async function saveCountingGameConfig(
  client,
  guildId,
  config
) {
  database[guildId] = {
    ...DEFAULT_CONFIG,
    ...(config || {})
  };

  saveDatabase();

  return database[guildId];
}

export function isValidCountingMessage(
  content
) {
  if (!content) {
    return false;
  }

  return /^[0-9]+$/.test(
    String(content).trim()
  );
}

export async function recordCorrectCount(
  client,
  guildId,
  userId,
  number
) {
  const config =
    database[guildId];

  if (!config) {
    return null;
  }

  const count =
    Number(number);

  config.nextNumber =
    count + 1;

  config.lastUserId =
    userId;

  if (
    count >
    (config.highScore || 0)
  ) {
    config.highScore =
      count;
  }

  saveDatabase();

  return {
    ...DEFAULT_CONFIG,
    ...config
  };
}

export async function resetCounting(
  client,
  guildId
) {
  const config =
    database[guildId];

  if (!config) {
    return null;
  }

  config.nextNumber = 1;
  config.lastUserId = null;

  saveDatabase();

  return {
    ...DEFAULT_CONFIG,
    ...config
  };
}


// ==========================================
// COUNTING RULES MESSAGE
// ==========================================

export async function refreshCountingRules(
  channel,
  config
) {
  if (!channel || !config) {
    return;
  }

  const oldRulesMessageId =
    config.rulesMessageId;

  // ==========================================
  // DELETE OLD RULES MESSAGE FIRST
  // ==========================================

  if (oldRulesMessageId) {
    try {
      const oldMessage =
        await channel.messages.fetch(
          oldRulesMessageId
        );

      await oldMessage.delete();

      console.log(
        '[COUNTING] Old rules message deleted.'
      );

    } catch (error) {
      console.log(
        '[COUNTING] Could not delete old rules message:',
        error.message
      );
    }
  }

  // ==========================================
  // SEND NEW RULES MESSAGE
  // ==========================================

  try {
    const rulesMessage =
      await channel.send({
        embeds: [
          {
            color: 0x5865F2,

            description:
              `**COUNTING**\n\n` +
              `### **Channel Rules**\n\n` +
              `• Wrong number = ❌ Reset\n` +
              `• Counting related only\n` +
              `• No side conversations\n` +
              `**Violation of these rules WILL HAVE consequences and punishment.**`
          }
        ]
      });

    // ==========================================
    // SAVE NEW RULES MESSAGE ID
    // ==========================================

    config.rulesMessageId =
      rulesMessage.id;

    saveDatabase();

    console.log(
      '[COUNTING] New rules message created:',
      rulesMessage.id
    );

  } catch (error) {
    console.error(
      '[COUNTING] Failed to send rules message:',
      error
    );
  }
}
