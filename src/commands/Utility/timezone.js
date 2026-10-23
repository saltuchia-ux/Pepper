import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getFromDb, setInDb, deleteFromDb } from '../../utils/database.js';
import { plainReply, extractUserId } from '../../utils/punishmentTools.js';
import { boxPayload, successPayload } from '../../utils/replyStyle.js';
import { logger } from '../../utils/logger.js';
import { commandAliases } from '../../config/commands/commandAliases.js';

// ==========================================
// .tz  /  .timezone   (same command, two names)
//
//   .tz                       shows YOUR current time
//   .tz @someone              shows THEIR current time
//   .tz set Los Angeles       saves your timezone
//   .tz set                   shows how to use it
//   .tz remove                forgets your timezone
//
// Everyone can use it. No extra libraries needed.
// ==========================================

const BOX_COLOR = 0x2b2d31;

const key = (userId) => `user_timezone_${userId}`;

// ------------------------------------------
// TURN WHAT THE PERSON TYPED INTO A TIMEZONE
// ------------------------------------------

function isValidZone(zone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

// first name in the list that works on this computer
function firstValid(...zones) {
    return zones.find(isValidZone) ?? null;
}

// Short names people type:  pst  est  ist  ...
const ABBREVIATIONS = {
    utc: 'UTC', gmt: 'UTC', z: 'UTC',
    est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York',
    cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago',
    mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver',
    pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles',
    akst: 'America/Anchorage', akdt: 'America/Anchorage', hst: 'Pacific/Honolulu',
    ist: 'Asia/Kolkata', pkt: 'Asia/Karachi', npt: 'Asia/Kathmandu',
    bst: 'Europe/London', wet: 'Europe/Lisbon', cet: 'Europe/Paris', cest: 'Europe/Paris',
    eet: 'Europe/Athens', eest: 'Europe/Athens', msk: 'Europe/Moscow',
    gst: 'Asia/Dubai', sgt: 'Asia/Singapore', hkt: 'Asia/Hong_Kong', pht: 'Asia/Manila',
    wib: 'Asia/Jakarta', jst: 'Asia/Tokyo', kst: 'Asia/Seoul',
    aest: 'Australia/Sydney', aedt: 'Australia/Sydney', acst: 'Australia/Adelaide',
    awst: 'Australia/Perth', nzst: 'Pacific/Auckland', nzdt: 'Pacific/Auckland',
    wat: 'Africa/Lagos', eat: 'Africa/Nairobi', sast: 'Africa/Johannesburg',
    brt: 'America/Sao_Paulo',
};

// Places that are not a "city name" in the official list
const PLACES = {
    // India and nearby
    india: 'Asia/Kolkata', delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', mumbai: 'Asia/Kolkata',
    jaipur: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', bengaluru: 'Asia/Kolkata', hyderabad: 'Asia/Kolkata',
    chennai: 'Asia/Kolkata', pune: 'Asia/Kolkata', ahmedabad: 'Asia/Kolkata', lucknow: 'Asia/Kolkata',
    kolkata: 'Asia/Kolkata', rajasthan: 'Asia/Kolkata',
    pakistan: 'Asia/Karachi', lahore: 'Asia/Karachi', islamabad: 'Asia/Karachi',
    bangladesh: 'Asia/Dhaka', nepal: 'Asia/Kathmandu', 'sri lanka': 'Asia/Colombo',
    // USA
    usa: 'America/New_York', us: 'America/New_York', america: 'America/New_York',
    'united states': 'America/New_York', nyc: 'America/New_York', ny: 'America/New_York',
    boston: 'America/New_York', miami: 'America/New_York', atlanta: 'America/New_York',
    philadelphia: 'America/New_York', orlando: 'America/New_York', washington: 'America/Los_Angeles',
    'washington dc': 'America/New_York', dc: 'America/New_York', florida: 'America/New_York',
    georgia: 'America/New_York', ohio: 'America/New_York', pennsylvania: 'America/New_York',
    michigan: 'America/New_York', virginia: 'America/New_York', massachusetts: 'America/New_York',
    'north carolina': 'America/New_York', detroit: 'America/Detroit',
    texas: 'America/Chicago', houston: 'America/Chicago', dallas: 'America/Chicago',
    austin: 'America/Chicago', 'san antonio': 'America/Chicago', illinois: 'America/Chicago',
    minnesota: 'America/Chicago', 'new orleans': 'America/Chicago',
    colorado: 'America/Denver', utah: 'America/Denver', 'salt lake city': 'America/Denver',
    arizona: 'America/Phoenix',
    california: 'America/Los_Angeles', la: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles',
    sf: 'America/Los_Angeles', 'san diego': 'America/Los_Angeles', 'las vegas': 'America/Los_Angeles',
    seattle: 'America/Los_Angeles', portland: 'America/Los_Angeles', oregon: 'America/Los_Angeles',
    nevada: 'America/Los_Angeles', hawaii: 'Pacific/Honolulu', alaska: 'America/Anchorage',
    // Canada, Latin America
    canada: 'America/Toronto', montreal: 'America/Toronto', ottawa: 'America/Toronto',
    calgary: 'America/Edmonton', mexico: 'America/Mexico_City', brazil: 'America/Sao_Paulo',
    argentina: 'America/Argentina/Buenos_Aires', chile: 'America/Santiago', colombia: 'America/Bogota',
    peru: 'America/Lima',
    // Europe
    uk: 'Europe/London', england: 'Europe/London', britain: 'Europe/London', 'great britain': 'Europe/London',
    scotland: 'Europe/London', wales: 'Europe/London', ireland: 'Europe/Dublin',
    germany: 'Europe/Berlin', france: 'Europe/Paris', italy: 'Europe/Rome', spain: 'Europe/Madrid',
    portugal: 'Europe/Lisbon', netherlands: 'Europe/Amsterdam', holland: 'Europe/Amsterdam',
    belgium: 'Europe/Brussels', switzerland: 'Europe/Zurich', austria: 'Europe/Vienna',
    sweden: 'Europe/Stockholm', norway: 'Europe/Oslo', denmark: 'Europe/Copenhagen',
    finland: 'Europe/Helsinki', poland: 'Europe/Warsaw', czechia: 'Europe/Prague',
    'czech republic': 'Europe/Prague', hungary: 'Europe/Budapest', romania: 'Europe/Bucharest',
    greece: 'Europe/Athens', turkey: 'Europe/Istanbul', russia: 'Europe/Moscow',
    // Middle East, Africa
    uae: 'Asia/Dubai', 'abu dhabi': 'Asia/Dubai', saudi: 'Asia/Riyadh', 'saudi arabia': 'Asia/Riyadh',
    israel: 'Asia/Jerusalem', iran: 'Asia/Tehran', iraq: 'Asia/Baghdad', egypt: 'Africa/Cairo',
    nigeria: 'Africa/Lagos', kenya: 'Africa/Nairobi', 'south africa': 'Africa/Johannesburg',
    // Asia, Oceania
    china: 'Asia/Shanghai', beijing: 'Asia/Shanghai', japan: 'Asia/Tokyo', korea: 'Asia/Seoul',
    'south korea': 'Asia/Seoul', malaysia: 'Asia/Kuala_Lumpur', thailand: 'Asia/Bangkok',
    vietnam: 'Asia/Ho_Chi_Minh', hanoi: 'Asia/Ho_Chi_Minh', philippines: 'Asia/Manila',
    indonesia: 'Asia/Jakarta', australia: 'Australia/Sydney', 'new zealand': 'Pacific/Auckland',
};

// Names the computer may call by an older spelling
const SPECIAL = {
    ukraine: ['Europe/Kyiv', 'Europe/Kiev'], kyiv: ['Europe/Kyiv', 'Europe/Kiev'], kiev: ['Europe/Kyiv', 'Europe/Kiev'],
    kolkata: ['Asia/Kolkata', 'Asia/Calcutta'], yangon: ['Asia/Yangon', 'Asia/Rangoon'],
};

// "UTC+5:30" style
const HALF_HOUR_ZONES = {
    '3:30': 'Asia/Tehran', '4:30': 'Asia/Kabul', '5:30': 'Asia/Kolkata', '5:45': 'Asia/Kathmandu',
    '6:30': 'Asia/Yangon', '9:30': 'Australia/Adelaide',
};

let cityIndex = null;

// "Los_Angeles" -> "los angeles"  (built once from the computer's list)
function getCityIndex() {
    if (cityIndex) return cityIndex;

    cityIndex = new Map();

    let zones = [];
    try {
        zones = Intl.supportedValuesOf('timeZone');
    } catch {
        zones = [];
    }

    for (const zone of zones) {
        const city = zone.split('/').pop().replace(/_/g, ' ').toLowerCase();
        if (!cityIndex.has(city)) cityIndex.set(city, zone);
        cityIndex.set(zone.toLowerCase(), zone);
    }

    return cityIndex;
}

// Returns a timezone name like "America/Los_Angeles", or null if we can't find it
export function resolveTimezone(input) {
    const text = String(input || '')
        .toLowerCase()
        .replace(/time\s*zone/g, '')
        .replace(/[,.]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!text || text.length > 60) return null;

    // 1) exact official name:  America/New_York
    const official = getCityIndex().get(text.replace(/ /g, '_')) ?? getCityIndex().get(text);
    if (official && text.includes('/')) return official;

    // 2) short names:  pst, est, ist
    if (ABBREVIATIONS[text]) return firstValid(ABBREVIATIONS[text]);

    // 3) offsets:  UTC+5:30, gmt-8, +2
    const offset = text.replace(/\s/g, '').match(/^(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (offset) {
        const sign = offset[1];
        const hours = Number(offset[2]);
        const minutes = offset[3] ?? '00';

        if (minutes === '00') {
            if (hours > 14) return null;
            if (hours === 0) return 'UTC';
            // Etc/GMT signs are backwards on purpose (Etc/GMT-5 is UTC+5)
            return firstValid(`Etc/GMT${sign === '+' ? '-' : '+'}${hours}`);
        }

        return firstValid(HALF_HOUR_ZONES[`${hours}:${minutes}`] ?? '');
    }

    // 4) countries, states and big cities
    if (SPECIAL[text]) return firstValid(...SPECIAL[text]);
    if (PLACES[text]) return firstValid(PLACES[text]);

    // 5) any city in the official list:  "los angeles", "tokyo", "sao paulo"
    const city = getCityIndex().get(text);
    if (city) return city;

    return null;
}

// "October 23, 01:08 AM"
export function formatTime(zone, date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }).formatToParts(date);

    const get = (type) => parts.find((part) => part.type === type)?.value ?? '';

    return `${get('month')} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')}`;
}

// ------------------------------------------
// MESSAGES
// ------------------------------------------

function sendBox(interaction, text) {
    return InteractionHelper.universalReply(interaction, boxPayload(BOX_COLOR, text));
}

function helpEmbed(interaction, name) {
    const client = interaction.client ?? interaction._responseCoordinator?.message?.client;
    const botName = client?.user?.username ?? 'Bot';

    const embed = new EmbedBuilder()
        .setColor(BOX_COLOR)
        .setAuthor({ name: `${botName} help` })
        .setTitle('Command: timezone set')
        .setDescription(
            'Set your timezone\n' +
            `\`\`\`Syntax: .${name} set (location)\nExample: .${name} set Los Angeles\`\`\``,
        );

    return InteractionHelper.universalReply(interaction, { embeds: [embed] });
}

// Plain text that pings ONLY the person who used the command (never the person being looked up)
function pingSender(interaction, text) {
    return InteractionHelper.universalReply(interaction, {
        content: text,
        allowedMentions: { users: [interaction.user.id] },
    });
}

async function showTime(interaction, targetId) {
    const you = targetId === interaction.user.id;
    const zone = await getFromDb(key(targetId), null);

    if (!zone || !isValidZone(zone)) {
        return pingSender(
            interaction,
            you
                ? `⚠️ <@${interaction.user.id}>: You haven't set your timezone. Use \`.tz set (location)\``
                : `⚠️ <@${interaction.user.id}>: <@${targetId}> hasn't set their timezone`,
        );
    }

    const time = formatTime(zone);

    return pingSender(
        interaction,
        `⏰ <@${interaction.user.id}>: ${you ? 'Your' : `<@${targetId}>'s`} current time is **${time}**`,
    );
}

async function saveZone(interaction, location) {
    const zone = resolveTimezone(location);

    if (!zone) {
        return plainReply(
            interaction,
            `⚠️ <@${interaction.user.id}>: I couldn't find that place. Try a city like \`Los Angeles\` or a zone like \`America/New_York\``,
        );
    }

    await setInDb(key(interaction.user.id), zone);

    logger.info('Timezone set', { userId: interaction.user.id, zone });

    return InteractionHelper.universalReply(
        interaction,
        successPayload(
            `<@${interaction.user.id}>: Your timezone is now **${zone.replace(/_/g, ' ')}** (it is ${formatTime(zone)})`,
        ),
    );
}

async function removeZone(interaction) {
    await deleteFromDb(key(interaction.user.id));

    return InteractionHelper.universalReply(
        interaction,
        successPayload(`<@${interaction.user.id}>: Your timezone was removed`),
    );
}

// ------------------------------------------
// THE COMMAND  (called "timezone", short name "tz")
// ------------------------------------------

export function buildTimezoneCommand(name) {
    return {
        data: new SlashCommandBuilder()
            .setName(name)
            .setDescription('Show your time or set your timezone')
            .addStringOption((option) =>
                option
                    .setName('location')
                    .setDescription('A city or country to save as your timezone (e.g. Los Angeles)')
                    .setRequired(false),
            )
            .addUserOption((option) =>
                option
                    .setName('user')
                    .setDescription("Show someone else's current time")
                    .setRequired(false),
            ),
        category: 'Utility',

        // /tz location:Los Angeles      /tz user:@someone      /tz
        async execute(interaction) {
            const location = interaction.options.getString('location');
            const user = interaction.options.getUser('user');

            if (location) return saveZone(interaction, location);

            return showTime(interaction, user?.id ?? interaction.user.id);
        },

        // .tz    .tz @someone    .tz set Los Angeles    .tz set    .tz remove
        async prefixExecute(interaction) {
            const message = interaction._responseCoordinator?.message ?? interaction.message;

            const text = (message?.content ?? '')
                .replace(/^\S*?(?:timezone|tz)(?:\s+|$)/i, '')
                .trim();

            if (!text) return showTime(interaction, interaction.user.id);

            const [first, ...rest] = text.split(/\s+/);
            const word = first.toLowerCase();

            if (word === 'set') {
                const location = rest.join(' ').trim();
                return location ? saveZone(interaction, location) : helpEmbed(interaction, name);
            }

            if (['remove', 'reset', 'clear', 'delete', 'unset'].includes(word)) {
                return removeZone(interaction);
            }

            const userId = extractUserId(first) ?? message?.mentions?.users?.first()?.id;

            if (userId) return showTime(interaction, userId);

            return helpEmbed(interaction, name);
        },
    };
}

// ".tz" is the short name for ".timezone" (the bot looks short names up in this list)
commandAliases.tz = 'timezone';

export default buildTimezoneCommand('timezone');
