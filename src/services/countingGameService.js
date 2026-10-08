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
// COUNTING RULES
// ==========================================

export async function refreshCountingRules(
  channel,
  config
) {
  if (!channel || !config) {
    return;
  }

  const guildId =
    channel.guild.id;

  const oldRulesMessageId =
    config.rulesMessageId;

  // ==========================================
  // DELETE SAVED OLD RULES MESSAGE
  // ==========================================

  if (oldRulesMessageId) {
    try {
      const oldMessage =
        await channel.messages.fetch(
          oldRulesMessageId
        );

      await oldMessage.delete();

      console.log(
        '[COUNTING] Deleted saved old rules message.'
      );

    } catch (error) {
      if (error?.code !== 10008) {
        console.log(
          '[COUNTING] Saved rules message was not found.'
        );
      }
    }
  }

  // ==========================================
  // FIND AND DELETE OLD COUNTING RULES
  // ==========================================

  try {
    const messages =
      await channel.messages.fetch({
        limit: 100
      });

    for (const message of messages.values()) {
      if (message.author.bot !== true) {
        continue;
      }

      if (
        message.id ===
        oldRulesMessageId
      ) {
        continue;
      }

      const embed =
        message.embeds?.[0];

      if (!embed) {
        continue;
      }

      const description =
        embed.description || '';

      const isCountingRules =
        description.includes(
          '**COUNTING**'
        ) &&
        description.includes(
          'Channel Rules'
        ) &&
        description.includes(
          'Wrong number = ❌ Reset'
        ) &&
        description.includes(
          'Counting related only'
        ) &&
        description.includes(
          'No side conversations'
        );

      if (!isCountingRules) {
        continue;
      }

      try {
        await message.delete();

        console.log(
          '[COUNTING] Deleted old duplicate rules message:',
          message.id
        );

      } catch (error) {
        console.error(
          '[COUNTING] Could not delete old rules message:',
          error
        );
      }
    }

  } catch (error) {
    console.error(
      '[COUNTING] Could not check old rules messages:',
      error
    );
  }

  // ==========================================
  // SEND NEW RULES MESSAGE
  // ==========================================

  let rulesMessage;

  try {
    rulesMessage =
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

  } catch (error) {
    console.error(
      '[COUNTING] Could not send rules message:',
      error
    );

    return;
  }

  // ==========================================
  // SAVE NEW RULES MESSAGE ID
  // ==========================================

  database[guildId] = {
    ...DEFAULT_CONFIG,
    ...database[guildId],
    ...config,
    rulesMessageId:
      rulesMessage.id
  };

  saveDatabase();

  console.log(
    '[COUNTING] New rules message:',
    rulesMessage.id
  );
}
