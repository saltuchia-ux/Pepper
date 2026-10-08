import fs from 'fs';
import path from 'path';

const DATA_DIR =
    process.env.COUNTING_DATA_DIR ||
    path.join(process.cwd(), 'data');

const DATA_FILE = path.join(
    DATA_DIR,
    'counting.json'
);

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

        const raw = fs.readFileSync(
            DATA_FILE,
            'utf8'
        );

        database = JSON.parse(raw) || {};
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
        fs.mkdirSync(DATA_DIR, {
            recursive: true
        });

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 2)
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

export function isValidCountingMessage(content) {
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
    const config = database[guildId];

    if (!config) {
        return null;
    }

    const count = Number(number);

    config.nextNumber = count + 1;
    config.lastUserId = userId;

    if (count > (config.highScore || 0)) {
        config.highScore = count;
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
    const config = database[guildId];

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

export async function refreshCountingRules(
    channel,
    config
) {
    if (!channel || !config) {
        return;
    }

    if (config.rulesMessageId) {
        try {
            const oldMessage =
                await channel.messages.fetch(
                    config.rulesMessageId
                );

            await oldMessage.delete();
        } catch {
            // Old rules message may already be deleted.
        }
    }

    const currentCount = Math.max(
        0,
        (config.nextNumber || 1) - 1
    );

    const rulesMessage = await channel.send({
        embeds: [
            {
                color: 0x5865F2,

                title: '🔢 Counting Rules',

                description:
                    '**Keep the chain alive!**\n\n' +
                    '• Send only the next number\n' +
                    '• Wait for another person before counting again\n' +
                    '• Keep normal conversations outside this channel\n' +
                    '• A wrong number breaks the chain\n\n' +
                    '🏆 Keep counting and try to beat the high score!',

                fields: [
                    {
                        name: 'Current Count',
                        value: `**${currentCount}**`,
                        inline: true
                    },
                    {
                        name: 'High Score',
                        value: `**${config.highScore || 0}**`,
                        inline: true
                    }
                ],

                footer: {
                    text: 'Counting • Keep the streak going!'
                }
            }
        ]
    });

    config.rulesMessageId =
        rulesMessage.id;

    saveDatabase();
}
