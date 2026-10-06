import { enforceAbuseProtection } from './abuseProtection.js';

const SLASH_ONLY_COMMANDS = new Set();

/**
 * Check whether a command can be used with a prefix.
 */
export function supportsPrefixExecution(command) {
    if (!command) return false;

    if (command.prefixOnly === false) {
        return false;
    }

    if (command.slashOnly === true) {
        return false;
    }

    if (SLASH_ONLY_COMMANDS.has(command.data?.name)) {
        return false;
    }

    return Boolean(
        command.prefixExecute ||
        command.execute
    );
}

/**
 * Execute a command from a prefix message.
 */
export async function executePrefixCommand(
    command,
    message,
    args = [],
    client,
    prefix,
    guildConfig
) {
    try {
        if (!command) return;

        if (!supportsPrefixExecution(command)) {
            return;
        }

        const interaction = createMockInteraction(
            message,
            command.data,
            args
        );

        interaction.client = client;
        interaction.guild = message.guild;
        interaction.channel = message.channel;
        interaction.member = message.member;
        interaction.user = message.author;
        interaction.message = message;

        interaction.guildId = message.guild?.id;
        interaction.channelId = message.channel?.id;
        interaction.commandName =
            command.data?.name || '';

        // Permission check
        const permissionResult =
            await enforceDefaultCommandPermissions(
                command,
                interaction
            );

        if (permissionResult === false) {
            return;
        }

        // Abuse protection / cooldown
        const abuseResult =
            await enforceAbuseProtection(
                command,
                interaction
            );

        if (abuseResult === false) {
            return;
        }

        // Required option validation
        if (
            interaction.options &&
            typeof interaction.options.validateRequired === 'function'
        ) {
            const validation =
                interaction.options.validateRequired();

            if (!validation.valid) {
                return interaction.reply({
                    content:
                        validation.message ||
                        `❌ Usage: \`${prefix}${command.data.name}\``,
                    ephemeral: true
                });
            }
        }

        // Use prefixExecute if the command has it
        if (typeof command.prefixExecute === 'function') {
            return await command.prefixExecute(
                interaction,
                guildConfig,
                client
            );
        }

        // Otherwise use the normal execute function
        if (typeof command.execute === 'function') {
            return await command.execute(
                interaction,
                guildConfig,
                client
            );
        }

    } catch (error) {
        console.error(
            `PREFIX EXECUTION ERROR [${command?.data?.name || 'unknown'}]:`,
            error
        );

        try {
            await message.reply(
                '❌ An error occurred while running that command.'
            );
        } catch {}
    }
}

/**
 * Create a mock interaction for prefix commands.
 */
function createMockInteraction(
    message,
    commandData,
    args
) {
    const data =
        commandData?.toJSON
            ? commandData.toJSON()
            : commandData || {};

    const mappedOptions =
        mapArgumentsToOptions(
            args,
            data
        );

    const interaction = {
        id: message.id,

        type: 2,

        commandName:
            data.name || '',

        user: message.author,

        member: message.member,

        guild: message.guild,

        guildId: message.guild?.id,

        channel: message.channel,

        channelId: message.channel?.id,

        client: message.client,

        message,

        replied: false,

        deferred: false,

        options: {
            _hoistedOptions: mappedOptions,

            getString(name) {
                const option =
                    mappedOptions.find(
                        option => option.name === name
                    );

                if (!option) return null;

                return String(option.value);
            },

            getInteger(name) {
                const option =
                    mappedOptions.find(
                        option => option.name === name
                    );

                if (!option) return null;

                const value =
                    Number(option.value);

                return Number.isNaN(value)
                    ? null
                    : value;
            },

            getNumber(name) {
                const option =
                    mappedOptions.find(
                        option => option.name === name
                    );

                if (!option) return null;

                const value =
                    Number(option.value);

                return Number.isNaN(value)
                    ? null
                    : value;
            },

            getBoolean(name) {
                const option =
                    mappedOptions.find(
                        option => option.name === name
                    );

                if (!option) return null;

                return (
                    option.value === true ||
                    option.value === 'true'
                );
            },

            getUser(name) {
                const option =
                    mappedOptions.find(
                        option => option.name === name
                    );

                if (!option) return null;

                const id =
                    extractUserId(option.value);

                if (!id) return null;

                const member =
                    message.guild.members.cache.get(id);

                return member?.user || null;
            },

            getMember(name) {
                const option =
                    mappedOptions.find(
                        option => option.name === name
                    );

                if (!option) return null;

                const id =
                    extractUserId(option.value);

                if (!id) return null;

                return (
                    message.guild.members.cache.get(id) ||
                    null
                );
            },

            getRole(name) {
                const option =
                    mappedOptions.find(
                        option => option.name === name
                    );

                if (!option) return null;

                const id =
                    extractRoleId(option.value);

                if (!id) return null;

                return (
                    message.guild.roles.cache.get(id) ||
                    null
                );
            },

            getChannel(name) {
                const option =
                    mappedOptions.find(
                        option => option.name === name
                    );

                if (!option) return null;

                const id =
                    extractChannelId(option.value);

                if (!id) return null;

                return (
                    message.guild.channels.cache.get(id) ||
                    null
                );
            },

            getSubcommand() {
                return null;
            },

            getSubcommandGroup() {
                return null;
            },

            validateRequired() {
                const options =
                    data.options || [];

                for (const option of options) {
                    // Subcommands are handled by the command itself.
                    if (
                        option.type === 1 ||
                        option.type === 2
                    ) {
                        continue;
                    }

                    if (!option.required) {
                        continue;
                    }

                    const supplied =
                        mappedOptions.find(
                            item =>
                                item.name === option.name
                        );

                    if (
                        !supplied ||
                        supplied.value === undefined ||
                        supplied.value === null ||
                        String(supplied.value).trim() === ''
                    ) {
                        return {
                            valid: false,
                            message:
                                `❌ Missing required option: **${option.name}**`
                        };
                    }
                }

                return {
                    valid: true
                };
            }
        },

        reply: async function(content) {
            this.replied = true;

            if (typeof content === 'string') {
                return message.reply(content);
            }

            return message.reply(content);
        },

        followUp: async function(content) {
            return message.channel.send(content);
        },

        editReply: async function(content) {
            return message.channel.send(content);
        },

        deferReply: async function() {
            this.deferred = true;
        },

        deleteReply: async function() {
            return;
        },

        isChatInputCommand() {
            return true;
        },

        isCommand() {
            return true;
        }
    };

    return interaction;
}

/**
 * Convert prefix arguments into command options.
 */
function mapArgumentsToOptions(
    args,
    commandData
) {
    const options =
        commandData?.options || [];

    const results = [];

    let argIndex = 0;

    for (const option of options) {
        // Ignore subcommands and subcommand groups.
        if (
            option.type === 1 ||
            option.type === 2
        ) {
            continue;
        }

        if (argIndex >= args.length) {
            break;
        }

        results.push({
            name: option.name,
            value: args[argIndex],
            type: option.type
        });

        argIndex++;
    }

    // Keep any remaining arguments.
    while (argIndex < args.length) {
        results.push({
            name: `arg${argIndex}`,
            value: args[argIndex],
            type: 3
        });

        argIndex++;
    }

    return results;
}

/**
 * Check command permissions.
 */
async function enforceDefaultCommandPermissions(
    command,
    interaction
) {
    try {
        const permissions =
            command.data?.default_member_permissions;

        if (!permissions) {
            return true;
        }

        const required =
            BigInt(permissions);

        const memberPermissions =
            interaction.member?.permissions?.bitfield;

        if (memberPermissions === undefined) {
            return true;
        }

        const current =
            BigInt(memberPermissions);

        if (
            (current & required) !== required
        ) {
            await interaction.reply(
                '❌ You do not have permission to use this command.'
            );

            return false;
        }

        return true;

    } catch (error) {
        console.error(
            'PERMISSION CHECK ERROR:',
            error
        );

        return true;
    }
}

/**
 * Extract a user ID.
 */
function extractUserId(value) {
    if (!value) return null;

    const text =
        String(value).trim();

    const mention =
        text.match(/^<@!?(\d+)>$/);

    if (mention) {
        return mention[1];
    }

    if (/^\d+$/.test(text)) {
        return text;
    }

    return null;
}

/**
 * Extract a role ID.
 */
function extractRoleId(value) {
    if (!value) return null;

    const text =
        String(value).trim();

    const mention =
        text.match(/^<@&(\d+)>$/);

    if (mention) {
        return mention[1];
    }

    if (/^\d+$/.test(text)) {
        return text;
    }

    return null;
}

/**
 * Extract a channel ID.
 */
function extractChannelId(value) {
    if (!value) return null;

    const text =
        String(value).trim();

    const mention =
        text.match(/^<#(\d+)>$/);

    if (mention) {
        return mention[1];
    }

    if (/^\d+$/.test(text)) {
        return text;
    }

    return null;
}
