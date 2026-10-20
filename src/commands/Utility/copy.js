const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'copy',
    description: 'Copies an emoji or sticker from a replied message or by ID and adds it to the server.',
    category: 'Utility',
    aliases: ['steal', 'addemoji', 'addsticker'],
    run: async (client, message, args) => {
        console.log(`[COPY COMMAND] Triggered by ${message.author.tag}`);

        // Check bot permissions
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageEmojisAndStickers)) {
            return message.reply('❌ I need the **Manage Emojis and Stickers** permission to add emojis or stickers.');
        }

        const parseTarget = async (input) => {
            if (!input) return null;

            // 1. Check custom emoji syntax: <:name:id> or <a:name:id>
            const customEmojiRegex = /<(a?):([a-zA-Z0-9_]{2,32}):([0-9]{17,20})>/;
            const match = input.match(customEmojiRegex);
            if (match) {
                return {
                    type: 'emoji',
                    name: match[2],
                    url: `https://cdn.discordapp.com/emojis/${match[3]}.${match[1] === 'a' ? 'gif' : 'png'}`
                };
            }

            // 2. Check if input is a raw ID (17-20 digits)
            const idRegex = /^([0-9]{17,20})$/;
            const idMatch = input.trim().match(idRegex);
            if (idMatch) {
                const id = idMatch[1];
                
                // Try fetching as a sticker first
                try {
                    const sticker = await client.fetchSticker(id);
                    if (sticker && sticker.url) {
                        return {
                            type: 'sticker',
                            name: sticker.name || 'copied_sticker',
                            url: sticker.url
                        };
                    }
                } catch (e) {}

                // Try GIF emoji
                const gifUrl = `https://cdn.discordapp.com/emojis/${id}.gif`;
                try {
                    const res = await fetch(gifUrl, { method: 'HEAD' });
                    if (res.ok) return { type: 'emoji', name: `emoji_${id}`, url: gifUrl };
                } catch (e) {}

                // Try PNG emoji
                const pngUrl = `https://cdn.discordapp.com/emojis/${id}.png`;
                try {
                    const res = await fetch(pngUrl, { method: 'HEAD' });
                    if (res.ok) return { type: 'emoji', name: `emoji_${id}`, url: pngUrl };
                } catch (e) {}
            }

            return null;
        };

        let target = null;

        // Check if user replied to a message
        if (message.reference && message.reference.messageId) {
            try {
                const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);

                // Check for sticker in replied message
                if (repliedMsg.stickers && repliedMsg.stickers.size > 0) {
                    const sticker = repliedMsg.stickers.first();
                    target = {
                        type: 'sticker',
                        name: sticker.name ? sticker.name.replace(/[^a-zA-Z0-9_]/g, '_') : 'copied_sticker',
                        url: sticker.url
                    };
                }

                // Check for custom emoji in replied message text
                if (!target && repliedMsg.content) {
                    target = await parseTarget(repliedMsg.content);
                }
            } catch (err) {
                console.error('Error fetching replied message:', err);
            }
        }

        // If no target from reply, check command arguments (e.g., .copy <emoji/id>)
        if (!target && args.length > 0) {
            target = await parseTarget(args[0]);
            if (target && args[1]) {
                target.name = args[1].replace(/[^a-zA-Z0-9_]/g, '_');
            }
        }

        if (!target) {
            return message.reply('❌ Please reply to a message containing an emoji/sticker or provide a valid emoji/sticker ID/markup!');
        }

        // Validate and clean up name
        let cleanName = target.name.replace(/[^a-zA-Z0-9_]/g, '_');
        if (cleanName.length < 2) cleanName = `${cleanName}_emoji`;
        if (cleanName.length > 32) cleanName = cleanName.substring(0, 32);

        const status = await message.reply(`🔄 Adding **${cleanName}** to the server...`);

        try {
            if (target.type === 'emoji') {
                const addedEmoji = await message.guild.emojis.create({
                    attachment: target.url,
                    name: cleanName,
                    reason: `Copied by ${message.author.tag}`
                });
                return status.edit(`✅ Successfully added emoji ${addedEmoji} (**:${addedEmoji.name}:**)`);
            } else if (target.type === 'sticker') {
                const addedSticker = await message.guild.stickers.create({
                    file: target.url,
                    name: cleanName,
                    tags: cleanName,
                    description: `Copied by ${message.author.tag}`,
                    reason: `Copied by ${message.author.tag}`
                });
                return status.edit(`✅ Successfully added sticker **${addedSticker.name}**`);
            }
        } catch (error) {
            console.error('Failed to create emoji/sticker:', error);
            return status.edit(`❌ Failed to upload: \`${error.message}\``);
        }
    }
};
