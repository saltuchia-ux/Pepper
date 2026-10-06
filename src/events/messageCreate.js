import { PermissionFlagsBits } from 'discord.js';

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
 * Execute a command using a prefix.
 */
export async function executePrefixCommand(
    command,
    message,
    args,
    client,
    prefix,
    guildConfig
) {
    try {
        if (!command) {
            return;
        }

        if (!supportsPrefixExecution(command)) {
            return;
        }

        const interaction = createMockInteraction(
            message,
            command.data,
            args,
            prefix
        );

        // Check command permissions
        const permissionResult =
            enforceDefaultCommandPermissions(
                command,
                interaction
            );

        if (!permissionResult) {
            return;
        }

        // Check required arguments
        if (
            interaction.options &&
            typeof interaction.options.validateRequired === 'function'
        ) {
            const valid =
                interaction.options.validateRequired();

            if (!valid) {
                const usage =
                    buildUsage(
                        prefix,
                        command.data,
                        args
                    );

                await interaction.reply({
                    content:
                        `❌ Missing required argument.\n` +
                        `Usage: \`${usage}\``,
                    ephemeral: true
                });

                return;
            }
        }

        // Use prefixExecute when available
        if (
            typeof command.prefixExecute ===
            'function'
        ) {
            return await command.prefixExecute(
                interaction,
                guildConfig,
                client
            );
        }

        // Otherwise use normal execute
        if (
            typeof command.execute ===
            'function'
        ) {
            return await command.execute(
                interaction,
                guildConfig,
                client
            );
        }

    } catch (error) {
        console.error(
            'PREFIX COMMAND ERROR:',
            error
        );

        try {
            if (!interactionReplied(message)) {
                await message.reply(
                    `❌ An error occurred while running that command.`
                );
            }
        } catch {}
    }
}

/**
 * Create a fake interaction so existing
 * slash-command code can also work with prefixes.
 */
function createMockInteraction(
    message,
    commandData,
    args,
    prefix
) {
    const mappedOptions =
        mapArgumentsToOptions(
            args,
            commandData
        );

    let replied = false;
    let deferred = false;

    const interaction = {
        id: `prefix-${Date.now()}`,

        applicationId:
            message.client?.application?.id ||
            null,

        type: 2,

        commandName:
            commandData?.name || null,

        user: message.author,

        member: message.member,

        guild: message.guild,

        guildId: message.guild?.id,

        channel: message.channel,

        channelId: message.channel?.id,

        client: message.client,

        message,

        createdTimestamp:
            Date.now(),

        replied: false,

        deferred: false,

        isChatInputCommand() {
            return true;
        },

        isCommand() {
            return true;
        },

        isButton() {
            return false;
        },

        isStringSelectMenu() {
            return false;
        },

        isModalSubmit() {
            return false;
        },

        options: createOptionsResolver(
            mappedOptions,
            commandData
        ),

        async reply(payload) {
            if (
                typeof payload ===
                'string'
            ) {
                payload = {
                    content: payload
                };
            }

            replied = true;
            this.replied = true;

            return await message.reply(
                payload
            );
        },

        async followUp(payload) {
            if (
                typeof payload ===
                'string'
            ) {
                payload = {
                    content: payload
                };
            }

            return await message.channel.send(
                payload
            );
        },

        async editReply(payload) {
            if (
                typeof payload ===
                'string'
            ) {
                payload = {
                    content: payload
                };
            }

            if (this._replyMessage) {
                return await this._replyMessage.edit(
                    payload
                );
            }

            return await message.reply(
                payload
            );
        },

        async deleteReply() {
            if (this._replyMessage) {
                await this._replyMessage
                    .delete()
                    .catch(() => {});
            }
        },

        async deferReply() {
            deferred = true;
            this.deferred = true;
        },

        async showModal() {
            throw new Error(
                'Modals are not supported for prefix commands.'
            );
        },

        async respond(payload) {
            return this.reply(payload);
        },

        prefix,

        repliedMessage: null,

        _replyMessage: null
    };

    return interaction;
}

/**
 * Convert prefix arguments into slash-command-like options.
 */
function mapArgumentsToOptions(
    args,
    commandData
) {
    const options = [];

    const commandOptions =
        commandData?.options || [];

    let argumentIndex = 0;

    for (const option of commandOptions) {

        // Subcommands are handled separately
        if (
            option.type === 1 ||
            option.type === 2
        ) {
            continue;
        }

        if (
            argumentIndex >=
            args.length
        ) {
            break;
        }

        options.push({
            name: option.name,

            description:
                option.description || '',

            type: option.type,

            value:
                args[argumentIndex],

            optionData: option
        });

        argumentIndex++;
    }

    // Keep extra arguments
    while (
        argumentIndex <
        args.length
    ) {
        options.push({
            name:
                `arg${argumentIndex}`,

            description: '',

            type: 3,

            value:
                args[argumentIndex],

            optionData: {
                type: 3
            }
        });

        argumentIndex++;
    }

    return options;
}

/**
 * Create a Discord-style option resolver.
 */
function createOptionsResolver(
    options,
    commandData
) {
    function getOption(
        name
    ) {
        return options.find(
            option =>
                option.name === name
        );
    }

    function getValue(
        name
    ) {
        return getOption(name)?.value;
    }

    const resolver = {

        _hoistedOptions:
            options,

        data: options,

        get(name) {
            return getOption(name);
        },

        getString(
            name,
            required = false
        ) {
            const value =
                getValue(name);

            if (
                value === undefined ||
                value === null
            ) {
                if (required) {
                    return null;
                }

                return null;
            }

            return String(value);
        },

        getInteger(
            name,
            required = false
        ) {
            const value =
                getValue(name);

            if (
                value === undefined ||
                value === null
            ) {
                return null;
            }

            const number =
                Number(value);

            return Number.isInteger(
                number
            )
                ? number
                : null;
        },

        getNumber(
            name,
            required = false
        ) {
            const value =
                getValue(name);

            if (
                value === undefined ||
                value === null
            ) {
                return null;
            }

            const number =
                Number(value);

            return Number.isNaN(number)
                ? null
                : number;
        },

        getBoolean(
            name,
            required = false
        ) {
            const value =
                getValue(name);

            if (
                value === undefined ||
                value === null
            ) {
                return null;
            }

            if (
                String(value).toLowerCase() ===
                'true'
            ) {
                return true;
            }

            if (
                String(value).toLowerCase() ===
                'false'
            ) {
                return false;
            }

            return null;
        },

        getUser(
            name,
            required = false
        ) {
            const id =
                extractUserId(
                    getValue(name)
                );

            if (!id) {
                return null;
            }

            return (
                messageMemberFetch(
                    this._interaction,
                    id
                )
            );
        },

        getMember(
            name,
            required = false
        ) {
            const value =
                getValue(name);

            const id =
                extractUserId(value);

            if (!id) {
                return null;
            }

            return (
                this._interaction
                    ?.guild
                    ?.members
                    ?.cache
                    ?.get(id) || null
            );
        },

        getRole(
            name,
            required = false
        ) {
            const id =
                extractRoleId(
                    getValue(name)
                );

            if (!id) {
                return null;
            }

            return (
                this._interaction
                    ?.guild
                    ?.roles
                    ?.cache
                    ?.get(id) || null
            );
        },

        getChannel(
            name,
            required = false
        ) {
            const id =
                extractChannelId(
                    getValue(name)
                );

            if (!id) {
                return null;
            }

            return (
                this._interaction
                    ?.guild
                    ?.channels
                    ?.cache
                    ?.get(id) || null
            );
        },

        getSubcommand(
            required = false
        ) {
            const option =
                commandData?.options?.find(
                    option =>
                        option.type === 1
                );

            return option?.name ||
                null;
        },

        getSubcommandGroup(
            required = false
        ) {
            const option =
                commandData?.options?.find(
                    option =>
                        option.type === 2
                );

            return option?.name ||
                null;
        },

        validateRequired() {
            const requiredOptions =
                (
                    commandData?.options ||
                    []
                ).filter(
                    option =>
                        option.required === true &&
                        option.type !== 1 &&
                        option.type !== 2
                );

            for (
                const option
                of requiredOptions
            ) {
                const supplied =
                    getValue(
                        option.name
                    );

                if (
                    supplied ===
                    undefined ||
                    supplied ===
                    null ||
                    String(
                        supplied
                    ).trim() === ''
                ) {
                    return false;
                }
            }

            return true;
        }
    };

    return resolver;
}

/**
 * Check Discord default member permissions.
 */
function enforceDefaultCommandPermissions(
    command,
    interaction
) {
    const permissionValue =
        command?.data
            ?.default_member_permissions;

    if (
        !permissionValue
    ) {
        return true;
    }

    const requiredPermissions =
        BigInt(
            permissionValue
        );

    const memberPermissions =
        interaction.member
            ?.permissions;

    if (
        !memberPermissions
    ) {
        return false;
    }

    const userPermissions =
        memberPermissions.bitfield;

    if (
        (userPermissions &
            requiredPermissions) !==
        requiredPermissions
    ) {
        interaction.reply({
            content:
                '❌ You do not have permission to use this command.',
            ephemeral: true
        }).catch(() => {});

        return false;
    }

    return true;
}

/**
 * Build command usage.
 */
function buildUsage(
    prefix,
    commandData,
    args
) {
    const name =
        commandData?.name ||
        'command';

    const options =
        commandData?.options || [];

    const usageParts = [
        `${prefix}${name}`
    ];

    for (
        const option
        of options
    ) {
        if (
            option.type === 1 ||
            option.type === 2
        ) {
            continue;
        }

        if (option.required) {
            usageParts.push(
                `<${option.name}>`
            );
        } else {
            usageParts.push(
                `[${option.name}]`
            );
        }
    }

    return usageParts.join(' ');
}

/**
 * Extract a user ID from:
 * @User
 * <@UserID>
 * <@!UserID>
 * UserID
 */
function extractUserId(
    value
) {
    if (!value) {
        return null;
    }

    const text =
        String(value).trim();

    const mention =
        text.match(
            /^<@!?(\d+)>$/
        );

    if (mention) {
        return mention[1];
    }

    if (
        /^\d+$/.test(text)
    ) {
        return text;
    }

    return null;
}

/**
 * Extract a role ID from:
 * @Role
 * <@&RoleID>
 * RoleID
 */
function extractRoleId(
    value
) {
    if (!value) {
        return null;
    }

    const text =
        String(value).trim();

    const mention =
        text.match(
            /^<@&(\d+)>$/
        );

    if (mention) {
        return mention[1];
    }

    if (
        /^\d+$/.test(text)
    ) {
        return text;
    }

    return null;
}

/**
 * Extract a channel ID.
 */
function extractChannelId(
    value
) {
    if (!value) {
        return null;
    }

    const text =
        String(value).trim();

    const mention =
        text.match(
            /^<#(\d+)>$/
        );

    if (mention) {
        return mention[1];
    }

    if (
        /^\d+$/.test(text)
    ) {
        return text;
    }

    return null;
}

async function messageMemberFetch(
    interaction,
    id
) {
    if (
        !interaction?.guild
    ) {
        return null;
    }

    return await interaction.guild
        .members
        .fetch(id)
        .catch(() => null);
}

function interactionReplied(
    message
) {
    return false;
}

/**
 * Compatibility export.
 */
export function resolvePrefixAccessKey(
    command
) {
    if (!command) {
        return null;
    }

    return (
        command.prefixAccessKey ||
        command.accessKey ||
        command.data?.name ||
        null
    );
}
