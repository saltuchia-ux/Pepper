import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { logModerationAction } from '../../utils/moderation.js';
import { takeUserFromWords, takeUserFromEnd, extractUserId } from '../../utils/userResolver.js';
import { findRole } from '../../utils/roleResolver.js';
import { getRoleBackup, deleteRoleBackup, backupMinutesLeft } from '../../services/roleBackupService.js';
import {
    getJailConfig,
    writeJailLog,
    closeJailTicket,
    clearJailRecord,
} from '../../services/jailService.js';
import {
    getPrefixText,
    errorBox,
    syntaxReply,
    userNotFoundReply,
    missingPermission,
} from '../../utils/punishmentTools.js';
import { infoPayload } from '../../utils/replyStyle.js';

// ==========================================
// .role  -  all the role tools in one command
//
//   .role c (name) (#color)              make a role          (.role create)
//   .role g (role) (user)                give a role          (.role give)
//   .role r (user) (role)                take a role away     (.role remove)
//   .role r (user) (new role), (old role)   swap: FIRST role is added,
//                                           SECOND role is taken away (.role replace)
//   .role restore (user)                 give saved roles back
//
//   One role after .role r  ->  it is only removed.
//   Two roles after .role r ->  the first is added, the second is removed.
//   Use a comma between two roles that have spaces in their names:
//       .role r @John Verified, Cool Kids
//   The user can be at the start or the end, and can be an @mention, an ID or a name.
// ==========================================

// the words after ".role" that pick what to do
const ACTIONS = {
    c: 'create',
    create: 'create',
    g: 'give',
    give: 'give',
    r: 'change',
    remove: 'change',
    replace: 'change',
    restore: 'restore',
};

export default {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Role tools: create, give, remove, replace, restore')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('create')
                .setDescription('Create a custom role')
                .addStringOption((option) =>
                    option.setName('name').setDescription('Name of the role').setRequired(true),
                )
                .addStringOption((option) =>
                    option.setName('emoji').setDescription('Optional emoji to put in front of the name').setRequired(false),
                )
                .addStringOption((option) =>
                    option.setName('color').setDescription('Role color, e.g. #ff0000').setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('give')
                .setDescription('Give a role to a user')
                .addRoleOption((option) =>
                    option.setName('role').setDescription('Role to give').setRequired(true),
                )
                .addUserOption((option) =>
                    option.setName('user').setDescription('User to give the role to').setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('remove')
                .setDescription('Take a role away from a user')
                .addRoleOption((option) =>
                    option.setName('role').setDescription('Role to remove').setRequired(true),
                )
                .addUserOption((option) =>
                    option.setName('user').setDescription('User to remove the role from').setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('replace')
                .setDescription('Give one role and take another away in one go')
                .addUserOption((option) =>
                    option.setName('user').setDescription('The user').setRequired(true),
                )
                .addRoleOption((option) =>
                    option.setName('add').setDescription('Role to give').setRequired(true),
                )
                .addRoleOption((option) =>
                    option.setName('remove').setDescription('Role to take away').setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('restore')
                .setDescription('Give a person their roles back (saved for 2 hours after a jail, kick or ban)')
                .addUserOption((option) =>
                    option
                        .setName('target')
                        .setDescription('The user to give their roles back to')
                        .setRequired(true),
                ),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    category: 'moderation',

    abuseProtection: {
        enabled: false,
    },

    // .role c / g / r / restore need their own checks (they are not slash-style subcommands)
    customPrefixValidation: true,

    // Slash command: /role create | give | remove | replace | restore
    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            let name = interaction.options.getString('name')?.trim();
            const emoji = interaction.options.getString('emoji')?.trim();

            if (emoji) name = `${emoji} ${name}`;

            return createRole(interaction, name, interaction.options.getString('color')?.trim() || null);
        }

        if (subcommand === 'restore') {
            const user = interaction.options.getUser('target');
            const member =
                interaction.options.getMember('target') ||
                await interaction.guild.members.fetch(user.id).catch(() => null);

            return restoreRoles(interaction, user.id, member);
        }

        const user = interaction.options.getUser('user');
        const member =
            interaction.options.getMember('user') ||
            await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) return userNotFoundReply(interaction);

        if (subcommand === 'give') {
            return giveRole(interaction, member, interaction.options.getRole('role'));
        }

        if (subcommand === 'remove') {
            return changeRoles(interaction, member, { remove: interaction.options.getRole('role') });
        }

        return changeRoles(interaction, member, {
            add: interaction.options.getRole('add'),
            remove: interaction.options.getRole('remove'),
        });
    },

    // Prefix command: .role c ...   .role g ...   .role r ...   .role restore ...
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [errorBox('Server only', 'This command can only be used in a server.')],
                ephemeral: true,
            });
        }

        const text = getPrefixText(interaction, 'role');
        const [firstWord = ''] = text.split(/\s+/);
        const action = ACTIONS[firstWord.toLowerCase()];

        if (!action) return syntaxReply(interaction, 'role');

        const restText = text.slice(firstWord.length).trim();
        const words = restText.split(/\s+/).filter(Boolean);

        // .role c (name) (#color)
        if (action === 'create') {
            if (!restText) return syntaxReply(interaction, 'role create');

            const { name, color } = splitNameAndColor(restText);

            return createRole(interaction, name, color);
        }

        // .role restore (user)
        if (action === 'restore') {
            const target = await takeUserFromWords(guild, words);

            if (!target) {
                return words.length ? userNotFoundReply(interaction) : syntaxReply(interaction, 'role restore');
            }

            return restoreRoles(interaction, target.id, target.member);
        }

        // .role g (role) (user)
        if (action === 'give') {
            if (words.length < 2) return syntaxReply(interaction, 'role give');

            const found = await findUser(guild, words, false);

            if (!found?.member) return userNotFoundReply(interaction);

            const roleText = found.rest.join(' ').trim();

            if (!roleText) return syntaxReply(interaction, 'role give');

            const { role, error } = await findRole(guild, roleText);

            if (!role) return fail(interaction, error);

            return giveRole(interaction, found.member, role);
        }

        // .role r (user) (role)   or   .role r (user) (new role), (old role)
        if (words.length < 2) return syntaxReply(interaction, 'role remove');

        const hasSeparator = ROLE_SEPARATORS.some((separator) => restText.includes(separator));
        const found = await findUser(guild, words, hasSeparator);

        if (!found?.member) return userNotFoundReply(interaction);

        const roleTexts = await splitRoleTexts(guild, found.rest);

        if (!roleTexts) return syntaxReply(interaction, 'role remove');

        const roles = [];

        for (const roleText of roleTexts) {
            const { role, error } = await findRole(guild, roleText);

            if (!role) return fail(interaction, error);

            roles.push(role);
        }

        // one role = only remove it.  two roles = first is added, second is removed.
        if (roles.length === 1) {
            return changeRoles(interaction, found.member, { remove: roles[0] });
        }

        return changeRoles(interaction, found.member, { add: roles[0], remove: roles[1] });
    },
};

// ------------------------------------------
// READING THE TYPED TEXT
// ------------------------------------------

const ROLE_SEPARATORS = [',', '->', '>', '|'];

function fail(interaction, text) {
    return InteractionHelper.universalReply(interaction, {
        content: `❌ ${text}`,
        ephemeral: true,
        allowedMentions: { parse: [] },
    });
}

// "🔥 meow meow #ff0000"  ->  { name: "🔥 meow meow", color: "#ff0000" }
function splitNameAndColor(raw) {
    let name = raw.trim();
    let color = null;

    const colorMatch = name.match(/(?:^|\s)(#[0-9A-Fa-f]{6})\s*$/);

    if (colorMatch) {
        color = colorMatch[1];
        name = name.slice(0, colorMatch.index).trim();
    }

    return { name, color };
}

function plainName(text) {
    return String(text)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// True when the whole text is exactly one role's name
async function hasExactRole(guild, text) {
    await guild.roles.fetch().catch(() => null);

    const wanted = text.toLowerCase();
    const clean = plainName(text);

    return guild.roles.cache.some(
        (role) =>
            role.id !== guild.id &&
            (role.name.toLowerCase() === wanted || (clean && plainName(role.name) === clean)),
    );
}

// Turns the role words into 1 or 2 role texts.
//   "Member, Verified"  ->  ["Member", "Verified"]     (comma, >, -> or | between them)
//   "cool kids"         ->  ["cool kids"]               (it is one role's exact name)
//   "Member Verified"   ->  ["Member", "Verified"]      (two single words)
//   "Member"            ->  ["Member"]
async function splitRoleTexts(guild, words) {
    const text = words.join(' ').trim();

    if (!text) return null;

    for (const separator of ROLE_SEPARATORS) {
        if (text.includes(separator)) {
            const parts = text.split(separator).map((part) => part.trim()).filter(Boolean);

            return parts.length === 1 || parts.length === 2 ? parts : null;
        }
    }

    if (await hasExactRole(guild, text)) return [text];
    if (words.length === 2) return [words[0], words[1]];

    return [text];
}

const looksLikeUserAtStart = (word) => /^["']/.test(word) || Boolean(extractUserId(word));
const looksLikeUserAtEnd = (word) => /["']$/.test(word) || Boolean(extractUserId(word));

// Finds the user at the start OR the end of the words.
// Returns { id, member, used, rest } (rest = the words left over) or null.
async function findUser(guild, words, preferStart) {
    const fromStart = async () => {
        const found = await takeUserFromWords(guild, words);
        return found ? { ...found, rest: words.slice(found.used) } : null;
    };

    const fromEnd = async () => {
        const found = await takeUserFromEnd(guild, words);
        return found ? { ...found, rest: words.slice(0, words.length - found.used) } : null;
    };

    const attempts = preferStart
        ? [[looksLikeUserAtStart(words[0]), fromStart], [looksLikeUserAtEnd(words[words.length - 1]), fromEnd]]
        : [[looksLikeUserAtEnd(words[words.length - 1]), fromEnd], [looksLikeUserAtStart(words[0]), fromStart]];

    // 1) a mention / ID / quoted name is a sure thing
    for (const [sure, attempt] of attempts) {
        if (!sure) continue;

        const found = await attempt();

        if (found?.member) return found;
    }

    // 2) otherwise try a plain name at either side
    for (const [, attempt] of attempts) {
        const found = await attempt();

        if (found?.member) return found;
    }

    return null;
}

// ------------------------------------------
// CHECKS SHARED BY GIVE / REMOVE / REPLACE
// ------------------------------------------

// Returns a sentence saying why these roles cannot be managed, or null if all is fine
async function roleProblem(interaction, roles) {
    // Only people with the Manage Roles permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw missingPermission('manage_roles');
    }

    const guild = interaction.guild;
    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me) return 'I could not find my bot member.';

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return 'I need the **Manage Roles** permission.';
    }

    const isOwner = guild.ownerId === interaction.user.id;
    const moderatorTop = interaction.member.roles.highest.position;

    for (const role of roles) {
        if (role.id === guild.id) return 'You cannot use @everyone here.';

        if (role.managed) {
            return `**${role.name}** is managed by Discord or an integration and cannot be changed.`;
        }

        if (role.position >= me.roles.highest.position) {
            return `**${role.name}** is above my highest role, so I cannot manage it.`;
        }

        // Stops someone from handing out / taking a role that is above their own
        if (!isOwner && role.position >= moderatorTop) {
            return `**${role.name}** is above your highest role, so you cannot manage it.`;
        }
    }

    return null;
}

// ------------------------------------------
// .role c   (make a role)
// ------------------------------------------

async function createRole(interaction, name, color) {
    if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw missingPermission('manage_roles');
    }

    const guild = interaction.guild;

    if (!guild) return fail(interaction, 'This command can only be used in a server.');

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me) return fail(interaction, 'I could not find my bot member.');

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return fail(interaction, 'I need the **Manage Roles** permission.');
    }

    if (!name) return fail(interaction, 'You need to provide a role name.');

    if (/<a?:\w+:\d+>/.test(name)) {
        return fail(interaction, 'Custom server emojis cannot be used in role names. Use a normal emoji like 🔥 instead.');
    }

    if (name.length > 100) return fail(interaction, 'Role names can be at most 100 characters long.');

    let roleColor;

    if (color) {
        if (!/^#?[0-9A-Fa-f]{6}$/.test(color)) {
            return fail(interaction, 'Invalid color. Use a hex color like #ff7527.');
        }

        roleColor = color.startsWith('#') ? color : `#${color}`;
    }

    try {
        const role = await guild.roles.create({
            name,
            color: roleColor || undefined,
            permissions: [],
            reason: `Created by ${interaction.user.tag}`,
        });

        let response = `✅ Created **${role.name}** successfully!\n🎨 **Name:** ${role.name}`;

        if (roleColor) response += `\n🌈 **Color:** ${roleColor}`;

        return InteractionHelper.universalReply(interaction, {
            content: response,
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        console.error('ROLE CREATE ERROR:', error);

        return fail(interaction, `I could not create the role.\nError: ${error.message}`);
    }
}

// ------------------------------------------
// .role g   (give a role)
// ------------------------------------------

async function giveRole(interaction, member, role) {
    const problem = await roleProblem(interaction, [role]);

    if (problem) return fail(interaction, problem);

    if (member.roles.cache.has(role.id)) {
        return fail(interaction, `${member} already has **${role.name}**.`);
    }

    try {
        await member.roles.add(role, `Given by ${interaction.user.tag}`);

        return InteractionHelper.universalReply(interaction, {
            content: `✅ Gave **${role.name}** to ${member}.`,
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        console.error('ROLE GIVE ERROR:', error);

        return fail(interaction, `Discord rejected the role change.\nError: ${error.message}`);
    }
}

// ------------------------------------------
// .role r   (remove a role, or swap two)
//   { remove }        -> only takes the role away
//   { add, remove }   -> gives "add" and takes "remove" away, in one go
// ------------------------------------------

async function changeRoles(interaction, member, { add = null, remove = null }) {
    const roles = [add, remove].filter(Boolean);
    const problem = await roleProblem(interaction, roles);

    if (problem) return fail(interaction, problem);

    // Only remove
    if (!add) {
        if (!member.roles.cache.has(remove.id)) {
            return fail(interaction, `${member} does not have **${remove.name}**.`);
        }

        try {
            await member.roles.remove(remove, `Removed by ${interaction.user.tag}`);

            return InteractionHelper.universalReply(interaction, {
                content: `✅ Removed **${remove.name}** from ${member}.`,
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            console.error('ROLE REMOVE ERROR:', error);

            return fail(interaction, `Discord rejected the role change.\nError: ${error.message}`);
        }
    }

    // Swap
    if (add.id === remove.id) {
        return fail(interaction, 'Those are the same role. Pick two different roles.');
    }

    const hadOld = member.roles.cache.has(remove.id);
    const hadNew = member.roles.cache.has(add.id);

    const finalIds = new Set(member.roles.cache.keys());
    finalIds.delete(remove.id);
    finalIds.add(add.id);

    try {
        await member.roles.set([...finalIds], `Role changed by ${interaction.user.tag}`);
    } catch (error) {
        return fail(
            interaction,
            'I could not change the roles. Check my **Manage Roles** permission and that my role is above theirs.',
        );
    }

    await logModerationAction({
        client: interaction.guild.client,
        guild: interaction.guild,
        event: {
            action: 'Role Changed',
            target: `${member.user.tag} (${member.id})`,
            executor: `${interaction.user.tag} (${interaction.user.id})`,
            reason: `+ ${add.name}, - ${remove.name}`,
            metadata: { userId: member.id, moderatorId: interaction.user.id },
        },
    }).catch(() => {});

    const notes = [];
    if (!hadOld) notes.push(`They did not have **${remove.name}**, so nothing was removed.`);
    if (hadNew) notes.push(`They already had **${add.name}**.`);

    await InteractionHelper.universalReply(
        interaction,
        infoPayload(
            `${interaction.user}: Changed roles for ${member}: + **${add.name}**, - **${remove.name}**` +
            (notes.length ? `\n\n${notes.join('\n')}` : ''),
        ),
    );
}

// ------------------------------------------
// .role restore   (give saved roles back)
// ------------------------------------------

async function restoreRoles(interaction, userId, member) {
    // Only people with the Ban Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw missingPermission('ban_members');
    }

    const guild = interaction.guild;
    const backup = await getRoleBackup(guild.id, userId);

    if (!backup) {
        throw new TitanBotError(
            'No saved roles',
            ErrorTypes.VALIDATION,
            'No roles to restore. Roles are only saved for 2 hours.',
            { plain: true },
        );
    }

    if (!member) {
        const banned = await guild.bans.fetch(userId).catch(() => null);

        throw new TitanBotError(
            'Not in the server',
            ErrorTypes.USER_INPUT,
            banned
                ? 'That person is banned. Unban them first, then use .role restore.'
                : 'That person is not in the server. Use .role restore again once they rejoin.',
            { plain: true },
        );
    }

    const me = guild.members.me ?? await guild.members.fetchMe();
    const botTop = me.roles.highest.position;
    const moderatorTop = interaction.member.roles.highest.position;
    const isOwner = guild.ownerId === interaction.user.id;

    const config = await getJailConfig(guild.id);

    const give = [];
    const skipped = { missing: 0, tooHighForBot: 0, tooHighForYou: 0 };

    for (const roleId of backup.roleIds) {
        const role = guild.roles.cache.get(roleId);

        if (!role) {
            skipped.missing++;
        } else if (role.managed || role.id === guild.id || role.id === config?.roleId) {
            // never given back
        } else if (role.position >= botTop) {
            skipped.tooHighForBot++;
        } else if (!isOwner && role.position >= moderatorTop) {
            // Stops someone from handing out a role that is above their own
            skipped.tooHighForYou++;
        } else {
            give.push(role);
        }
    }

    // The new role list = what they have now (without the Jailed role) + the saved roles
    const finalIds = new Set(
        [...member.roles.cache.keys()].filter((id) => id !== config?.roleId),
    );

    for (const role of give) finalIds.add(role.id);

    const wasJailed = Boolean(config?.roleId && member.roles.cache.has(config.roleId));

    try {
        await member.roles.set([...finalIds], `Roles restored by ${interaction.user.tag}`);
    } catch (error) {
        throw new TitanBotError(
            'Could not restore',
            ErrorTypes.PERMISSION,
            'I could not give the roles back. Check my **Manage Roles** permission and that my role is above theirs.',
        );
    }

    await deleteRoleBackup(guild.id, userId);

    if (wasJailed) {
        await closeJailTicket(guild, member.id, {
            closedBy: `${interaction.user}`,
            reason: 'Roles were restored and the person was let out of jail',
        });
        await clearJailRecord(guild.id, member.id);
    }

    await logModerationAction({
        client: guild.client,
        guild,
        event: {
            action: 'Roles Restored',
            target: `${member.user.tag} (${member.id})`,
            executor: `${interaction.user.tag} (${interaction.user.id})`,
            reason: `Gave back ${give.length} role(s)`,
            metadata: { userId: member.id, moderatorId: interaction.user.id },
        },
    }).catch(() => {});

    if (config) {
        await writeJailLog(guild, config, {
            title: 'Roles restored',
            description:
                `**User:** ${member} (${member.id})\n` +
                `**By:** ${interaction.user}\n` +
                `**Roles given back:** ${give.length}` +
                (wasJailed ? '\nThey were also let out of jail.' : ''),
            color: 'success',
        });
    }

    const skippedTotal = skipped.missing + skipped.tooHighForBot + skipped.tooHighForYou;
    const notes = [];

    if (wasJailed) notes.push('They were also let out of jail.');
    if (skipped.tooHighForYou) notes.push(`${skipped.tooHighForYou} role(s) are above your own role, so they were not given.`);
    if (skipped.tooHighForBot) notes.push(`${skipped.tooHighForBot} role(s) are above my role, so I cannot give them.`);
    if (skipped.missing) notes.push(`${skipped.missing} role(s) no longer exist.`);

    const roleList = give.length ? give.map((r) => `**${r.name}**`).join(', ') : '**none**';

    await InteractionHelper.universalReply(
        interaction,
        infoPayload(
            `${interaction.user}: Added roles to ${member}: ${roleList}` +
            (notes.length ? `\n\n${notes.join('\n')}` : ''),
        ),
    );
}
