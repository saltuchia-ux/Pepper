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
//   .role e (role) #ff0000               change a role's color  (.role edit)
//   .role e (role) (new name)            rename a role
//   .role e (role) (one emoji)           set the role icon  (needs Boost Level 2)
//   .role e (role) #ff0000 New Name 🔥   ...or all of them in one command
//   .role d (role)  /  (role 1), (role 2)   delete roles  (.role delete)
//   .role restore (user)                 give saved roles back
//
//   Two-word triggers work too. Add them in commandSettings.js on the role line, e.g.
//   role   [ 'role' 'give role' 'replace role' 'remove role' 'create role' 'edit role' 'delete role' ]
//   then  .give role cool kids John   is the same as   .role g cool kids John
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
    make: 'create',
    mrole: 'create',
    g: 'give',
    give: 'give',
    add: 'give',
    grole: 'give',
    r: 'change',
    remove: 'change',
    replace: 'change',
    change: 'change',
    crole: 'change',
    trole: 'change',
    e: 'edit',
    edit: 'edit',
    d: 'delete',
    del: 'delete',
    delete: 'delete',
    restore: 'restore',
};

export default {
    data: new SlashCommandBuilder()
        .setName('role')
        .setDescription('Role tools: create, give, remove, replace, edit, delete, restore')
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
                .setName('edit')
                .setDescription('Change a role\'s color, name or emoji icon')
                .addRoleOption((option) =>
                    option.setName('role').setDescription('Role to edit').setRequired(true),
                )
                .addStringOption((option) =>
                    option.setName('name').setDescription('New name for the role').setRequired(false),
                )
                .addStringOption((option) =>
                    option.setName('color').setDescription('New color, e.g. #ff0000').setRequired(false),
                )
                .addStringOption((option) =>
                    option.setName('emoji').setDescription('One emoji for the role icon (server needs Boost Level 2)').setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('delete')
                .setDescription('Delete a role')
                .addRoleOption((option) =>
                    option.setName('role').setDescription('Role to delete').setRequired(true),
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

        if (subcommand === 'edit') {
            const changes = {
                name: interaction.options.getString('name')?.trim() || null,
                color: interaction.options.getString('color')?.trim() || null,
                emoji: interaction.options.getString('emoji')?.trim() || null,
            };

            if (!changes.name && !changes.color && !changes.emoji) {
                return fail(interaction, 'Give me something to change: a **name**, a **color** or an **emoji**.');
            }

            return editRole(interaction, interaction.options.getRole('role'), changes);
        }

        if (subcommand === 'delete') {
            return deleteRoles(interaction, [interaction.options.getRole('role')]);
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

        // the text after the trigger (".role g cool kids John" -> "g cool kids John")
        let restText = getPrefixText(interaction, 'role');

        // 1) the trigger itself can say what to do:  ".give role ..."  ".replace role ..."  ".role c ..."
        const message = interaction.message ?? interaction._responseCoordinator?.message ?? null;
        const triggerWords = String(message?.prefixTrigger ?? '').split(' ').filter(Boolean);
        let action = null;

        for (const word of triggerWords) {
            if (ACTIONS[word]) {
                action = ACTIONS[word];
                break;
            }
        }

        // 2) otherwise it is the first word after .role
        if (!action) {
            const [firstWord = ''] = restText.split(/\s+/);

            action = ACTIONS[firstWord.toLowerCase()];

            if (action) restText = restText.slice(firstWord.length).trim();
        }

        if (!action) return syntaxReply(interaction, 'role');

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

        // .role e (role) #color   |   .role e (role) (new name)   |   .role e (role) (emoji)
        if (action === 'edit') {
            if (words.length < 2) return syntaxReply(interaction, 'role edit');

            const parsed = await splitEditText(guild, words);

            if (!parsed) return syntaxReply(interaction, 'role edit');

            const { role, error } = await findRole(guild, parsed.roleText);

            if (!role) return fail(interaction, error);

            // color, name and emoji can all be given at once
            const changes = parseEditValue(parsed.value);

            if (!changes.name && !changes.color && !changes.emoji) return syntaxReply(interaction, 'role edit');

            return editRole(interaction, role, changes);
        }

        // .role d (role)   or   .role d (role 1), (role 2)
        if (action === 'delete') {
            if (!words.length) return syntaxReply(interaction, 'role delete');

            const roles = [];
            const missing = [];

            for (const roleText of await splitDeleteTexts(guild, words)) {
                // delete only finds EXACT names / IDs / mentions, so a typo can never delete the wrong role
                const role = await findExactRole(guild, roleText);

                if (role) roles.push(role);
                else missing.push(roleText);
            }

            return deleteRoles(interaction, roles, missing);
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

// Finds a role by EXACT name, ID or @mention (no guessing). Returns the role or null.
// strict = true: the name must match letter for letter (ignoring capitals); emoji and symbols count
async function findExactRole(guild, text, strict = false) {
    await guild.roles.fetch().catch(() => null);

    const wanted = String(text).trim();
    const id = wanted.match(/^<@&(\d+)>$/)?.[1] ?? (/^\d{15,25}$/.test(wanted) ? wanted : null);

    if (id) return guild.roles.cache.get(id) ?? null;

    const lower = wanted.toLowerCase();
    const clean = plainName(wanted);

    return (
        guild.roles.cache.find(
            (role) =>
                role.id !== guild.id &&
                (role.name.toLowerCase() === lower || (!strict && clean && plainName(role.name) === clean)),
        ) ?? null
    );
}

// True when the whole text is exactly one role
async function hasExactRole(guild, text, strict = false) {
    return Boolean(await findExactRole(guild, text, strict));
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

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

// exactly ONE emoji: 🔥  👍🏽  🏳️‍🌈  🇳🇱  or a server emoji <:name:id> / <a:name:id>
const EMOJI_ONLY =
    /^(?:<a?:\w+:\d+>|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}\uFE0F?\p{Emoji_Modifier}?)*)$/u;

// ".role e" text  ->  { roleText, value }
//   "cool kids #ff0000"      ->  role "cool kids", value "#ff0000"
//   "cool kids, New Name"    ->  role "cool kids", value "New Name"   (a , > -> or | splits them)
//   "cool kids New"          ->  the longest start that is exactly a role's name is the role
//   "cool kids 🔥"           ->  role "cool kids", value "🔥"
async function splitEditText(guild, words) {
    const text = words.join(' ').trim();

    // finds the first separator (, > -> |) with something on both sides
    const splitAtSeparator = () => {
        for (const separator of ROLE_SEPARATORS) {
            const at = text.indexOf(separator);

            if (at > 0) {
                const roleText = text.slice(0, at).trim();
                const value = text.slice(at + separator.length).trim();

                if (roleText && value) return { roleText, value };
            }
        }

        return null;
    };

    // 1) a separator right after a role that exists:  "cool kids, New Name"
    const separated = splitAtSeparator();

    if (separated && await hasExactRole(guild, separated.roleText)) return separated;

    if (words.length < 2) return null;

    // 2) the longest start of the text that is exactly a role:  "cool kids #ff0000 New Name 🔥"
    //    (first letter for letter, then ignoring emoji, so "cool kids 🔥 Chill" does not eat the 🔥)
    for (const strict of [true, false]) {
        for (let count = words.length - 1; count >= 1; count--) {
            const roleText = words.slice(0, count).join(' ');

            if (await hasExactRole(guild, roleText, strict)) {
                return { roleText, value: words.slice(count).join(' ') };
            }
        }
    }

    // 3) no exact role name (a typo, so it is guessed later): a #color at the end
    const last = words[words.length - 1];

    if (HEX_COLOR.test(last)) return { roleText: words.slice(0, -1).join(' '), value: last };

    // 4) split at the separator, or take the first word as the role
    return separated ?? { roleText: words[0], value: words.slice(1).join(' ') };
}

// What to change, from the text after the role. Color, name and emoji can all be in ONE command:
//   "#827272 Chill Crew 🔥"   ->  { color: "#827272", name: "Chill Crew", emoji: "🔥" }
//   • a #hex word anywhere     = the color
//   • ONE emoji as the LAST word = the icon   (an emoji at the front stays in the name: "🔥 Chill Crew")
//   • everything else          = the new name
function parseEditValue(value) {
    let words = value.split(/\s+/).filter(Boolean);
    let color = null;
    let emoji = null;

    const colorAt = words.findIndex((word) => HEX_COLOR.test(word));

    if (colorAt !== -1) {
        color = words[colorAt];
        words = words.filter((word, index) => index !== colorAt);
    }

    if (words.length && EMOJI_ONLY.test(words[words.length - 1])) {
        emoji = words.pop();
    }

    return { name: words.join(' ') || null, color, emoji };
}

// ".role d" text  ->  the role texts to delete
//   "Old, Older"       ->  ["Old", "Older"]
//   "cool kids"        ->  ["cool kids"]      (one role with a space in its name)
//   "Old Older"        ->  ["Old", "Older"]   (when each word is a role)
async function splitDeleteTexts(guild, words) {
    const text = words.join(' ').trim();

    if (/[,|]/.test(text)) {
        return text.split(/[,|]/).map((part) => part.trim()).filter(Boolean);
    }

    if (words.length === 1 || await hasExactRole(guild, text)) return [text];

    for (const word of words) {
        if (!(await hasExactRole(guild, word))) return [text];
    }

    return words;
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
// .role e   (edit a role: color, name or emoji icon)
// ------------------------------------------

async function editRole(interaction, role, { name = null, color = null, emoji = null }) {
    const problem = await roleProblem(interaction, [role]);

    if (problem) return fail(interaction, problem);

    const guild = interaction.guild;
    const reason = `Edited by ${interaction.user.tag}`;

    // check everything first, so nothing is half changed
    if (name !== null) {
        name = name.trim();

        if (!name) return fail(interaction, 'The new name cannot be empty.');
        if (name.length > 100) return fail(interaction, 'Role names can be at most 100 characters long.');

        if (/<a?:\w+:\d+>/.test(name)) {
            return fail(interaction, 'Server emojis cannot be used in a role name. Use a normal emoji like 🔥 instead.');
        }
    }

    if (color !== null) {
        if (!/^#?[0-9A-Fa-f]{6}$/.test(color)) {
            return fail(interaction, 'Invalid color. Use a hex color like #ff7527.');
        }

        color = color.startsWith('#') ? color : `#${color}`;
    }

    let iconUrl = null;
    let skipIcon = false;

    if (emoji !== null) {
        if (!EMOJI_ONLY.test(emoji)) return fail(interaction, 'Send exactly **one** emoji for the icon.');

        // role icons are a Boost Level 2 perk
        if (!guild.features.includes('ROLE_ICONS')) {
            if (name === null && color === null) {
                return fail(
                    interaction,
                    'Role icons need this server to have **Boost Level 2**, and it does not have it yet.',
                );
            }

            // the rest of the changes still go through
            skipIcon = true;
        } else {
            const custom = emoji.match(/^<a?:\w+:(\d+)>$/);

            // server emojis (also animated ones) become a still picture, Discord has no moving role icons
            if (custom) iconUrl = `https://cdn.discordapp.com/emojis/${custom[1]}.png?size=128`;
        }
    }

    const before = role.name;
    const changes = [];

    try {
        let updated = role;

        if (name !== null || color !== null) {
            updated = await role.edit({
                ...(name !== null && { name }),
                ...(color !== null && { color }),
                reason,
            });

            if (name !== null) changes.push(`name: **${before}** → **${updated.name}**`);
            if (color !== null) changes.push(`color: **${color}**`);
        }

        if (emoji !== null && !skipIcon) {
            if (iconUrl) await updated.setIcon(iconUrl, reason);
            else await updated.setUnicodeEmoji(emoji, reason);

            changes.push(`icon: ${emoji}`);
        }

        return InteractionHelper.universalReply(interaction, {
            content:
                `✅ Updated **${updated.name}**\n${changes.join('\n')}` +
                (skipIcon ? '\n⚠️ Icon skipped: role icons need **Boost Level 2** on this server.' : ''),
            allowedMentions: { parse: [] },
        });
    } catch (error) {
        console.error('ROLE EDIT ERROR:', error);

        const partly = changes.length ? `\n(Already changed: ${changes.join(', ')})` : '';

        return fail(interaction, `Discord rejected the change.\nError: ${error.message}${partly}`);
    }
}

// ------------------------------------------
// .role d   (delete one or more roles)
// ------------------------------------------

async function deleteRoles(interaction, roles, missing = []) {
    const unique = [...new Map(roles.map((role) => [role.id, role])).values()];
    const deleted = [];
    const failed = missing.map((text) => `**${text}**: no role with exactly that name, ID or mention`);

    for (const role of unique) {
        const problem = await roleProblem(interaction, [role]);

        if (problem) {
            failed.push(`**${role.name}**: ${problem}`);
            continue;
        }

        try {
            const name = role.name;

            await role.delete(`Deleted by ${interaction.user.tag}`);
            deleted.push(name);
        } catch (error) {
            console.error('ROLE DELETE ERROR:', error);

            failed.push(`**${role.name}**: Discord rejected it (${error.message})`);
        }
    }

    if (!deleted.length) return fail(interaction, failed.join('\n') || 'No roles to delete.');

    let response = `🗑️ Deleted ${deleted.map((name) => `**${name}**`).join(', ')}.`;

    if (failed.length) response += `\n\n❌ Could not delete:\n${failed.join('\n')}`;

    return InteractionHelper.universalReply(interaction, {
        content: response,
        allowedMentions: { parse: [] },
    });
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
