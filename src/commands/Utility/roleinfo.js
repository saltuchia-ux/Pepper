import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const MEMBER_TEXT_LIMIT = 900;

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
}

// Finds a role from an ID, a mention, or a name (exact, then starts with, then contains).
export async function findRole(guild, input) {
    const text = String(input ?? '').trim();
    if (!text) return null;

    const idMatch = text.match(/^<@&(\d+)>$/) || text.match(/^(\d{15,22})$/);
    if (idMatch) {
        return guild.roles.cache.get(idMatch[1]) ?? await guild.roles.fetch(idMatch[1]).catch(() => null);
    }

    await guild.roles.fetch().catch(() => null);

    const name = text.replace(/^@/, '').toLowerCase();
    const roles = [...guild.roles.cache.values()].filter((role) => role.id !== guild.id);

    return roles.find((role) => role.name.toLowerCase() === name)
        ?? roles.find((role) => role.name.toLowerCase().startsWith(name))
        ?? roles.find((role) => role.name.toLowerCase().includes(name))
        ?? null;
}

async function getRoleMembers(guild, role) {
    if (guild.members.cache.size < guild.memberCount && guild.memberCount <= 5000) {
        await withTimeout(guild.members.fetch().catch(() => null), 5000);
    }
    return role.members;
}

function memberListText(members) {
    if (members.size === 0) return 'None';

    const names = [...members.values()].map((m) => m.user.username).sort((a, b) => a.localeCompare(b));

    let text = '';
    let shown = 0;

    for (const name of names) {
        const next = text ? `${text}, ${name}` : name;
        if (next.length > MEMBER_TEXT_LIMIT) break;
        text = next;
        shown += 1;
    }

    if (shown < names.length) text += ` +${names.length - shown} more`;

    return text;
}

export default {
    data: new SlashCommandBuilder()
        .setName('roleinfo')
        .setDescription('Get info about a role (use its ID, name or mention)')
        .addStringOption((option) =>
            option
                .setName('role')
                .setDescription('Role ID, name or mention')
                .setRequired(true),
        ),

    async execute(interaction) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) return;

        // In prefix mode every word is its own argument, so join them for names like "Server Booster".
        const input = interaction._isPrefixCommand
            ? (interaction.options._hoistedOptions ?? []).map((o) => String(o.value)).join(' ')
            : interaction.options.getString('role');

        const guild = interaction.guild;
        const role = await findRole(guild, input);

        if (!role) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: 'Role not found',
                    description: "I couldn't find that role. Try its ID, name or a mention.",
                    color: 'error',
                })],
            });
            return;
        }

        const members = await getRoleMembers(guild, role);
        const createdTs = Math.floor(role.createdTimestamp / 1000);
        const invoker = interaction.member?.displayName ?? interaction.user.username;

        const embed = createEmbed({
            author: { name: invoker, iconURL: interaction.user.displayAvatarURL({ size: 64 }) },
            title: role.name,
            thumbnail: role.iconURL({ size: 256 }) ?? guild.iconURL({ size: 256 }) ?? undefined,
            fields: [
                { name: 'Role ID', value: `\`${role.id}\``, inline: false },
                { name: 'Guild', value: `${guild.name} (\`${guild.id}\`)`, inline: false },
                {
                    name: 'Color',
                    value: `\`${role.color ? role.hexColor.toUpperCase() : '#000000 (default)'}\``,
                    inline: false,
                },
                { name: 'Creation Date', value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`, inline: false },
                { name: `${members.size} Member(s)`, value: memberListText(members), inline: false },
            ],
        });

        if (role.color) embed.setColor(role.color);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            allowedMentions: { parse: [] },
        });

        logger.info('RoleInfo command executed', {
            userId: interaction.user.id,
            roleId: role.id,
            guildId: interaction.guildId,
        });
    },
};
