import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logModerationAction } from '../../utils/moderation.js';
import { takeUserFromWords } from '../../utils/userResolver.js';
import { findRole } from '../../utils/roleResolver.js';
import {
    getPrefixText,
    plainReply,
    syntaxReply,
    userNotFoundReply,
    missingPermission,
} from '../../utils/punishmentTools.js';
import { infoPayload } from '../../utils/replyStyle.js';

// ==========================================
// .crole (user) (old role), (new role)
//
// Swaps one role for another in one go:
//   the FIRST role is removed, the SECOND role is added.
//
//   .crole John Member, Verified      (use a comma when a role name has spaces)
//   .crole John Member Verified       (works when both roles are one word)
//   .crole John old role > new role   (">" also works as a separator)
//   .crole @John 123456789012345678 987654321098765432   (IDs / mentions work too)
// ==========================================

export default {
    data: new SlashCommandBuilder()
        .setName('crole')
        .setDescription('Change a role: removes the first role and adds the second one')
        .addUserOption((option) =>
            option.setName('target').setDescription('The user').setRequired(true),
        )
        .addRoleOption((option) =>
            option.setName('remove').setDescription('Role to take away').setRequired(true),
        )
        .addRoleOption((option) =>
            option.setName('add').setDescription('Role to give instead').setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    category: 'moderation',

    abuseProtection: {
        enabled: false,
    },

    // Slash command: /crole target:@user remove:@Old add:@New
    async execute(interaction, config, client) {
        const user = interaction.options.getUser('target');
        const member =
            interaction.options.getMember('target') ||
            await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) return userNotFoundReply(interaction);

        return changeRole(
            interaction,
            member,
            interaction.options.getRole('remove'),
            interaction.options.getRole('add'),
        );
    },

    // Prefix command: .crole John old role, new role
    async prefixExecute(interaction, config, client) {
        const guild = interaction.guild;

        if (!guild) {
            return plainReply(interaction, 'This command can only be used in a server.');
        }

        const words = getPrefixText(interaction, 'crole').split(/\s+/).filter(Boolean);

        if (words.length < 3) return syntaxReply(interaction, 'crole');

        const target = await takeUserFromWords(guild, words);

        if (!target?.member) return userNotFoundReply(interaction);

        const roleWords = words.slice(target.used);
        const [removeText, addText] = splitRoles(roleWords);

        if (!removeText || !addText) return syntaxReply(interaction, 'crole');

        const removeResult = await findRole(guild, removeText);
        if (!removeResult.role) return plainReply(interaction, removeResult.error);

        const addResult = await findRole(guild, addText);
        if (!addResult.role) return plainReply(interaction, addResult.error);

        return changeRole(interaction, target.member, removeResult.role, addResult.role);
    },
};

// Splits "old role, new role" / "old > new" / "old new" into two texts.
function splitRoles(words) {
    const text = words.join(' ');

    for (const separator of [',', '->', '>', '|']) {
        if (text.includes(separator)) {
            const parts = text.split(separator).map((p) => p.trim()).filter(Boolean);

            return parts.length === 2 ? parts : [null, null];
        }
    }

    // No separator: only safe when there are exactly two words (one per role)
    return words.length === 2 ? [words[0], words[1]] : [null, null];
}

async function changeRole(interaction, member, removeRole, addRole) {
    // Only people with the Kick Members permission can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        throw missingPermission('kick_members');
    }

    const guild = interaction.guild;

    if (removeRole.id === addRole.id) {
        return plainReply(interaction, 'Those are the same role. Pick two different roles.');
    }

    for (const role of [removeRole, addRole]) {
        if (role.id === guild.id) {
            return plainReply(interaction, 'You cannot use @everyone here.');
        }

        if (role.managed) {
            return plainReply(interaction, `**${role.name}** is managed by Discord or an integration and cannot be changed.`);
        }
    }

    const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);

    if (!me) return plainReply(interaction, 'I could not find my bot member.');

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return plainReply(interaction, 'I need the **Manage Roles** permission.');
    }

    const isOwner = guild.ownerId === interaction.user.id;
    const moderatorTop = interaction.member.roles.highest.position;

    for (const role of [removeRole, addRole]) {
        if (role.position >= me.roles.highest.position) {
            return plainReply(interaction, `**${role.name}** is above my highest role, so I cannot manage it.`);
        }

        // Stops someone from handing out / taking a role that is above their own
        if (!isOwner && role.position >= moderatorTop) {
            return plainReply(interaction, `**${role.name}** is above your highest role, so you cannot manage it.`);
        }
    }

    const hadOld = member.roles.cache.has(removeRole.id);
    const hadNew = member.roles.cache.has(addRole.id);

    const finalIds = new Set(member.roles.cache.keys());
    finalIds.delete(removeRole.id);
    finalIds.add(addRole.id);

    try {
        await member.roles.set([...finalIds], `Role changed by ${interaction.user.tag}`);
    } catch (error) {
        return plainReply(
            interaction,
            'I could not change the roles. Check my **Manage Roles** permission and that my role is above theirs.',
        );
    }

    await logModerationAction({
        client: guild.client,
        guild,
        event: {
            action: 'Role Changed',
            target: `${member.user.tag} (${member.id})`,
            executor: `${interaction.user.tag} (${interaction.user.id})`,
            reason: `- ${removeRole.name}, + ${addRole.name}`,
            metadata: { userId: member.id, moderatorId: interaction.user.id },
        },
    }).catch(() => {});

    const notes = [];
    if (!hadOld) notes.push(`They did not have **${removeRole.name}**, so nothing was removed.`);
    if (hadNew) notes.push(`They already had **${addRole.name}**.`);

    // Same look as the bleed reply:  "+ New, - Old"
    await InteractionHelper.universalReply(
        interaction,
        infoPayload(
            `${interaction.user}: Changed roles for ${member}: + **${addRole.name}**, - **${removeRole.name}**` +
            (notes.length ? `\n\n${notes.join('\n')}` : ''),
        ),
    );
}
