import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const ROLE_TEXT_LIMIT = 600;

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
}

// Which number member joined the server (1 = first). Returns null when we can't know for sure.
async function getJoinPosition(guild, member) {
    if (!member?.joinedTimestamp) return null;

    let members = guild.members.cache;

    if (members.size < guild.memberCount && guild.memberCount <= 10000) {
        const fetched = await withTimeout(guild.members.fetch().catch(() => null), 5000);
        if (fetched) members = fetched;
    }

    // If we don't have almost everyone, the number would be wrong, so don't show it.
    if (members.size < guild.memberCount * 0.95) return null;

    const earlier = members.filter(
        (m) => m.joinedTimestamp && m.joinedTimestamp < member.joinedTimestamp,
    ).size;

    return earlier + 1;
}

function buildRoleList(member, guild) {
    const roles = member.roles.cache
        .filter((role) => role.id !== guild.id)
        .sort((a, b) => b.position - a.position);

    if (roles.size === 0) return { count: 0, text: 'None' };

    let text = '';
    let shown = 0;

    for (const role of roles.values()) {
        const piece = `<@&${role.id}>`;
        const next = text ? `${text}, ${piece}` : piece;
        if (next.length > ROLE_TEXT_LIMIT) break;
        text = next;
        shown += 1;
    }

    if (shown < roles.size) text += '...';

    return { count: roles.size, text };
}

export default {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Get info about a user (use their ID, name, display name or mention)')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('The user to look up (defaults to you)'),
        ),

    async execute(interaction) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('UserInfo interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'userinfo',
            });
            return;
        }

        const client = interaction.client ?? interaction.guild.client;
        const requested = interaction.options.getUser('target');
        let user = requested || interaction.user;

        // In prefix mode a plain ID can come back as a placeholder, so fetch the real user.
        if (requested && (user.username === 'Unknown' || !user.createdAt)) {
            user = await client.users.fetch(user.id).catch(() => null);
        }

        if (!user) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: 'User not found',
                    description: "I couldn't find that user. Try their ID, username, display name or a mention.",
                    color: 'error',
                })],
            });
            return;
        }

        const guild = interaction.guild;
        const member = guild.members.cache.get(user.id)
            ?? await guild.members.fetch(user.id).catch(() => null);

        const createdTs = Math.floor(user.createdAt.getTime() / 1000);
        const lines = [
            '**Dates**',
            `**Created**: <t:${createdTs}:f> (<t:${createdTs}:R>)`,
        ];

        if (member?.joinedTimestamp) {
            const joinedTs = Math.floor(member.joinedTimestamp / 1000);
            lines.push(`**Joined**: <t:${joinedTs}:f> (<t:${joinedTs}:R>)`);

            const roles = buildRoleList(member, guild);
            lines.push(`**Roles (${roles.count})**`, roles.text);
        } else {
            lines.push('**Joined**: not in this server');
        }

        const small = [];

        if (member?.joinedTimestamp) {
            const position = await getJoinPosition(guild, member);
            if (position) small.push(`Join position: ${position}`);
        }

        const mutual = client.guilds.cache.filter((g) => g.members.cache.has(user.id)).size;
        if (mutual > 0) small.push(`${mutual} mutual server${mutual === 1 ? '' : 's'}`);

        if (small.length) lines.push('', `-# ${small.join(' • ')}`);

        const embed = createEmbed({
            author: `${user.username} (${user.id})`,
            description: lines.join('\n'),
            thumbnail: user.displayAvatarURL({ size: 256 }),
        });

        const accent = member?.displayColor;
        if (accent) embed.setColor(accent);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            allowedMentions: { parse: [] },
        });

        logger.info('UserInfo command executed', {
            userId: interaction.user.id,
            targetUserId: user.id,
            guildId: interaction.guildId,
        });
    },
};
