import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getPrefixText } from '../../utils/punishmentTools.js';
import {
    getJailConfig,
    setupJail,
    getPingRoles,
    setPingRoles,
    detectPingRoles,
    panelChannelIdOf,
} from '../../services/jailService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('jailsetup')
        .setDescription('Set up the jail system (role, categories, ticket channel, log channel)')
        .addStringOption((option) =>
            option
                .setName('action')
                .setDescription('What to do')
                .setRequired(false)
                .addChoices(
                    { name: 'setup (create or repair everything)', value: 'setup' },
                    { name: 'status (show what is set up)', value: 'status' },
                    { name: 'ping (choose the roles that are pinged for new tickets)', value: 'ping' },
                    { name: 'ping reset (find the Manager / Mod roles by name again)', value: 'pingreset' },
                ),
        )
        .addRoleOption((option) => option.setName('role1').setDescription('A role to ping (for the ping action)').setRequired(false))
        .addRoleOption((option) => option.setName('role2').setDescription('A role to ping').setRequired(false))
        .addRoleOption((option) => option.setName('role3').setDescription('A role to ping').setRequired(false))
        .addRoleOption((option) => option.setName('role4').setDescription('A role to ping').setRequired(false))
        .addRoleOption((option) => option.setName('role5').setDescription('A role to ping').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'moderation',

    // Slash command: /jailsetup action:setup
    async execute(interaction, config, client) {
        const action = interaction.options.getString('action') || 'setup';
        const roles = ['role1', 'role2', 'role3', 'role4', 'role5']
            .map((name) => interaction.options.getRole(name))
            .filter(Boolean);

        return run(interaction, action, { roles, words: [] }, true);
    },

    // Prefix command:
    //   .jailsetup                       builds / repairs everything
    //   .jailsetup status                shows what is set up
    //   .jailsetup ping @Manager @Mod    chooses the roles that are pinged for new tickets
    //   .jailsetup ping reset            finds the Manager / Mod roles by name again
    async prefixExecute(interaction, config, client) {
        const text = getPrefixText(interaction, 'jailsetup');
        const words = text.match(/"[^"]*"|\S+/g) || [];
        const first = words[0]?.toLowerCase();

        if (first === 'status') return run(interaction, 'status', { roles: [], words: [] }, false);

        if (first === 'ping') {
            const rest = words.slice(1);

            if (rest[0]?.toLowerCase() === 'reset') {
                return run(interaction, 'pingreset', { roles: [], words: [] }, false);
            }

            return run(interaction, 'ping', { roles: [], words: rest }, false);
        }

        return run(interaction, 'setup', { roles: [], words: [] }, false);
    },
};

function compact(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Turns "@Manager 123456789012345678 "Trial Mod" head" into roles
function findRoles(guild, words) {
    const found = new Map();
    const notFound = [];

    for (const raw of words) {
        const word = raw.replace(/^"|"$/g, '');
        const id = word.match(/^<@&(\d+)>$/)?.[1] ?? (/^\d{15,25}$/.test(word) ? word : null);

        let role = id ? guild.roles.cache.get(id) : null;

        if (!role) {
            const query = compact(word);

            role =
                [...guild.roles.cache.values()].find((r) => r.id !== guild.id && compact(r.name) === query) ||
                [...guild.roles.cache.values()].find((r) => r.id !== guild.id && query && compact(r.name).startsWith(query));
        }

        if (role && role.id !== guild.id) found.set(role.id, role);
        else notFound.push(word);
    }

    return { roles: [...found.values()], notFound };
}

const listRoles = (roles) => (roles.length ? roles.map((r) => r.toString()).join(' ') : 'none');

async function run(interaction, action, input, isSlash) {
    // Only administrators can use this
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        throw new TitanBotError(
            'Missing Administrator permission',
            ErrorTypes.PERMISSION,
            'You need the **Administrator** permission to use this command.',
        );
    }

    const guild = interaction.guild;

    if (action === 'status') {
        const config = await getJailConfig(guild.id);

        if (!config) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    createEmbed({
                        title: 'Jail is not set up',
                        description: 'Run `.jailsetup` to create everything.',
                        color: 'warning',
                    }),
                ],
            });
        }

        const mention = (id, type) => (id ? (type === 'role' ? `<@&${id}>` : `<#${id}>`) : 'missing');

        return InteractionHelper.universalReply(interaction, {
            embeds: [
                createEmbed({
                    title: 'Jail setup',
                    description:
                        `**Role:** ${mention(config.roleId, 'role')}\n` +
                        `**Jail category:** ${mention(config.categoryId)}\n` +
                        `**Ticket channel:** ${mention(panelChannelIdOf(config))}\n` +
                        `**Staff log:** ${mention(config.logChannelId)}\n` +
                        `**Tickets category:** ${config.ticketCategoryId ? mention(config.ticketCategoryId) : 'missing (run `.jailsetup` again)'}\n` +
                        `**Pinged for new tickets:** ${listRoles(getPingRoles(guild, config))}` +
                        `${config.pingCustom ? ' (chosen by you)' : ' (found by name)'}\n\n` +
                        'Run `.jailsetup` again to repair it. Use `.jailsetup ping @role @role` to change the pinged roles.',
                    color: 'primary',
                }),
            ],
        });
    }

    if (action === 'ping' || action === 'pingreset') {
        const config = await getJailConfig(guild.id);

        if (!config) {
            throw new TitanBotError(
                'Jail is not set up',
                ErrorTypes.VALIDATION,
                'Jail is not set up yet. Run `.jailsetup` first.',
            );
        }

        if (action === 'pingreset') {
            const roles = detectPingRoles(guild, guild.roles.cache.get(config.roleId));

            await setPingRoles(guild, roles.map((r) => r.id), { custom: false });

            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    createEmbed({
                        title: 'Ping roles reset',
                        description:
                            `New tickets ping: ${listRoles(roles)}\n` +
                            (roles.length ? '' : '\nNo roles named Manager, Mod, Trial Mod or Head Mod were found.'),
                        color: 'success',
                    }),
                ],
            });
        }

        // nothing typed: show the current roles
        if (!input.roles.length && !input.words.length) {
            return InteractionHelper.universalReply(interaction, {
                embeds: [
                    createEmbed({
                        title: 'Ping roles',
                        description:
                            `New tickets ping: ${listRoles(getPingRoles(guild, config))}\n\n` +
                            'Change them with `.jailsetup ping @Manager @Mod "Trial Mod" "Head Mod"`.\n' +
                            'Use `.jailsetup ping reset` to find them by name again.',
                        color: 'primary',
                    }),
                ],
            });
        }

        const { roles: typedRoles, notFound } = findRoles(guild, input.words);
        const roles = [...new Map([...input.roles, ...typedRoles].map((r) => [r.id, r])).values()];

        if (!roles.length) {
            throw new TitanBotError(
                'No roles found',
                ErrorTypes.USER_INPUT,
                'I could not find any of those roles. Mention them, like `.jailsetup ping @Manager @Mod`.',
            );
        }

        await setPingRoles(guild, roles.map((r) => r.id), { custom: true });

        return InteractionHelper.universalReply(interaction, {
            embeds: [
                createEmbed({
                    title: 'Ping roles saved',
                    description:
                        `New tickets now ping: ${listRoles(roles)}\n` +
                        (notFound.length ? `\nNot found: ${notFound.join(', ')}` : '') +
                        '\n\nThese roles get access to new tickets. Run `.jailsetup` again if they should also see the jail logs.',
                    color: 'success',
                }),
            ],
        });
    }

    // ----- setup -----
    // Setup can take a little while because every channel has to be hidden from the Jailed role
    let progress = null;

    if (isSlash) {
        await InteractionHelper.safeDefer(interaction);
    } else {
        progress = await InteractionHelper.universalReply(interaction, {
            content: 'Setting up jail. This can take a minute...',
        });
    }

    const { role, category, ticketCategory, panel, logs, staffRoles, pingRoles, result } = await setupJail(guild, {
        setupBy: interaction.user.id,
    });

    const state = (created) => (created ? '(created)' : '(already existed)');

    const lines = [
        `**Role:** ${role} ${state(result.createdRole)}`,
        `**Jail category:** ${category} ${state(result.createdCategory)}`,
        `**Ticket channel:** ${panel} ${result.createdPanel ? '(created)' : result.convertedOldChat ? '(your old jail chat was turned into the ticket channel)' : '(already existed)'}`,
        `**Staff log:** ${logs} ${state(result.createdLogs)}`,
        `**Tickets category:** ${ticketCategory} ${state(result.createdTicketCategory)}`,
        `**Hidden from jailed people:** ${result.locked + result.alreadyLocked} channels and voice channels` +
            (result.failed ? ` (${result.failed} could not be changed, check my permissions there)` : ''),
        `**Pinged for new tickets:** ${pingRoles.length ? listRoles(pingRoles) : 'nobody. No roles named Manager, Mod, Trial Mod or Head Mod were found. Use `.jailsetup ping @role`'}`,
        `**Staff who can see the jail:** ${staffRoles.length ? staffRoles.map((r) => r.toString()).join(' ') : 'only administrators'}`,
        '',
        'Jailed people press **Open Ticket** in the ticket channel. Each ticket is made in the Jail Tickets category.',
        'Now use `.jail @user reason`, `.unjail @user` and `.role restore @user`.',
    ];

    const embed = createEmbed({
        title: 'Jail is ready',
        description: lines.join('\n'),
        color: 'success',
    });

    if (progress?.edit) {
        return progress.edit({ content: null, embeds: [embed] }).catch(() =>
            InteractionHelper.universalReply(interaction, { embeds: [embed] }),
        );
    }

    return InteractionHelper.universalReply(interaction, { embeds: [embed] });
}
