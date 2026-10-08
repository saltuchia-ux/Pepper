import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('grole')
        .setDescription('Give a role to a user')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Role to give')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('User to give the role to')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    category: 'Moderation',

    abuseProtection: {
        enabled: false,
    },

    async execute(interaction, config, client) {
        return giveRole(interaction);
    },

    // .grole role name here (user id or @user)
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ This command can only be used in a server.',
                ephemeral: true,
            });
        }

        const raw = getPrefixText(interaction, 'grole');
        const { roleText, userText } = splitRoleAndUser(raw);

        if (!roleText) {
            return InteractionHelper.universalReply(interaction, {
                content:
                    '❌ Usage: `.grole role name (user id or @user)`\n' +
                    'Example: `.grole cool kids @User`',
                ephemeral: true,
            });
        }

        const userId = extractUserId(userText);

        if (!userId) {
            return InteractionHelper.universalReply(interaction, {
                content:
                    '❌ User not found. Put the user **last**, as an @mention or a user ID.\n' +
                    'Example: `.grole cool kids @User`',
                ephemeral: true,
            });
        }

        const { role, error } = await findRole(guild, roleText);

        if (!role) {
            return InteractionHelper.universalReply(interaction, {
                content: error,
                ephemeral: true,
            });
        }

        const target = await guild.members.fetch(userId).catch(() => null);

        if (!target) {
            return InteractionHelper.universalReply(interaction, {
                content: '❌ I could not find that user in this server.',
                ephemeral: true,
            });
        }

        return giveRole(interaction, role, target);
    },
};

// Gets the text after ".COMMAND" from a prefix command.
function getPrefixText(interaction, commandName) {
    const realMessage =
        interaction.message ??
        interaction._responseCoordinator?.message ??
        null;

    const content = realMessage?.content?.trim();

    if (content) {
        const match = content.match(
            new RegExp(`^\\S*?${commandName}(?:\\s+|$)`, 'i')
        );

        if (match) {
            return content.slice(match[0].length).trim();
        }
    }

    const args =
        interaction.options?._hoistedOptions?.map(option =>
            String(option.value)
        ) || [];

    return args.join(' ').trim();
}

// Last word = user (mention or ID), everything before it = role name.
// Example: "🔥 cool kids 123456789012345678"
function splitRoleAndUser(raw) {
    const parts = raw.trim().split(/\s+/);

    if (parts.length < 2) {
        return { roleText: null, userText: null };
    }

    const userText = parts.pop();
    const roleText = parts.join(' ').trim();

    return { roleText, userText };
}

function extractUserId(value) {
    if (!value) return null;

    const text = String(value).trim();

    const mention = text.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];

    if (/^\d+$/.test(text)) return text;

    return null;
}

// Makes names easy to compare: lowercase, no emojis/symbols, single spaces.
function normalizeName(text) {
    return String(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// How alike two strings are, from 0 (nothing) to 1 (identical).
function similarity(a, b) {
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;

    const rows = a.length + 1;
    const cols = b.length + 1;
    const dist = Array.from({ length: rows }, (_, i) => {
        const row = new Array(cols).fill(0);
        row[0] = i;
        return row;
    });

    for (let j = 0; j < cols; j++) dist[0][j] = j;

    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dist[i][j] = Math.min(
                dist[i - 1][j] + 1,
                dist[i][j - 1] + 1,
                dist[i - 1][j - 1] + cost
            );
        }
    }

    return 1 - dist[a.length][b.length] / Math.max(a.length, b.length);
}

// Finds a role by mention, ID, or name (no @ needed).
// The closest match wins, so the name does not have to be exact.
// Returns { role } or { error }.
async function findRole(guild, text) {
    const query = String(text).trim();

    // @Role mention or role ID
    const idMatch = query.match(/^<@&(\d+)>$/) || query.match(/^(\d{15,25})$/);
    if (idMatch) {
        const byId = await guild.roles.fetch(idMatch[1]).catch(() => null);
        if (byId) return { role: byId };
    }

    await guild.roles.fetch().catch(() => null);

    const roles = [...guild.roles.cache.values()]
        .filter(r => r.id !== guild.id) // skip @everyone
        .map(r => ({ role: r, clean: normalizeName(r.name) }));

    const lowered = query.toLowerCase();
    const normalized = normalizeName(query);

    // Best pick from a list: shortest name first (closest in size),
    // then the higher role if still tied.
    const closest = (list) =>
        [...list].sort(
            (a, b) =>
                a.clean.length - b.clean.length ||
                b.role.position - a.role.position
        )[0].role;

    // 1) exact name
    const exact = roles.filter(r => r.role.name.toLowerCase() === lowered);
    if (exact.length) return { role: closest(exact) };

    if (normalized) {
        // 2) same name ignoring emojis / symbols / capitals
        const same = roles.filter(r => r.clean === normalized);
        if (same.length) return { role: closest(same) };

        // 3) role name starts with what you typed
        const starts = roles.filter(r => r.clean.startsWith(normalized));
        if (starts.length) return { role: closest(starts) };

        // 4) role name contains what you typed
        const contains = roles.filter(r => r.clean.includes(normalized));
        if (contains.length) return { role: closest(contains) };

        // 5) spelling mistakes: pick the most similar name
        let best = null;
        let bestScore = 0;

        for (const r of roles) {
            if (!r.clean) continue;

            const score = Math.max(
                similarity(normalized, r.clean),
                similarity(normalized, r.clean.slice(0, normalized.length))
            );

            if (score > bestScore) {
                best = r;
                bestScore = score;
            }
        }

        if (best && bestScore >= 0.5) {
            return { role: best.role };
        }
    }

    return { error: `❌ I could not find a role close to **${query}**.` };
}

async function giveRole(interaction, suppliedRole = null, suppliedTarget = null) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You need **Ban Members** permission to use `.grole`.',
            ephemeral: true,
        });
    }

    const guild = interaction.guild;

    const role =
        suppliedRole || interaction.options.getRole('role');

    const target =
        suppliedTarget || interaction.options.getMember('user');

    if (!role) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ Role not found.',
            ephemeral: true,
        });
    }

    if (!target) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ User not found.',
            ephemeral: true,
        });
    }

    const botMember =
        guild.members.me ||
        await guild.members.fetchMe().catch(() => null);

    if (!botMember) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I could not find my bot member.',
            ephemeral: true,
        });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ I need **Manage Roles** permission.',
            ephemeral: true,
        });
    }

    if (role.managed) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ That role is managed by Discord and cannot be assigned.',
            ephemeral: true,
        });
    }

    if (botMember.roles.highest.position <= role.position) {
        return InteractionHelper.universalReply(interaction, {
            content:
                `❌ I cannot manage ${role}.\n` +
                `My highest role: **${botMember.roles.highest.name}**\n` +
                `My position: **${botMember.roles.highest.position}**\n` +
                `Target position: **${role.position}**`,
            ephemeral: true,
        });
    }

    if (role.position >= interaction.member.roles.highest.position) {
        return InteractionHelper.universalReply(interaction, {
            content: '❌ You cannot give a role equal to or higher than your highest role.',
            ephemeral: true,
        });
    }

    if (target.roles.cache.has(role.id)) {
        return InteractionHelper.universalReply(interaction, {
            content: `❌ ${target} already has ${role}.`,
            ephemeral: true,
        });
    }

    try {
        await target.roles.add(
            role,
            `Given by ${interaction.user.tag}`
        );

        return InteractionHelper.universalReply(interaction, {
            content: `✅ Gave ${role} to ${target}.`,
        });
    } catch (error) {
        console.error('GROLE ERROR:', error);

        return InteractionHelper.universalReply(interaction, {
            content:
                `❌ Discord rejected the role change.\n` +
                `Error: \`${error.message}\``,
            ephemeral: true,
        });
    }
}
