const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'copy',
    description: 'Copies an emoji or sticker from a replied message or by ID/link and adds it to the server.',
    category: 'Utility',
    aliases: ['steal', 'addemoji', 'addsticker'],
    run: async (client, message, args) => {
        // Check bot permissions
        const botMember = message.guild.members.me;
        if (!botMember.permissions.has([PermissionFlagsBits.ManageEmojisAndStickers])) {
            return message.reply('❌ I need the **Manage Emojis and Stickers** permission to add emojis or stickers to this server.');
        }

        // Helper function to extract name, url, and type from input string
        const parseInput = async (inputStr) => {
            // Check for custom emoji syntax (<:name:id> or <a:name:id>)
            const customEmojiRegex = /<(a?):([a-zA-Z0-9_]{2,32}):([0-9]{17,20})>/;
            const emojiMatch = inputStr.match(customEmojiRegex);
            if (emojiMatch) {
                const animated = emojiMatch[1] === 'a';
                const name = emojiMatch[2];
                const id = emojiMatch[3];
                const extension = animated ? 'gif' : 'png';
                return {
                    type: 'emoji',
                    name: name,
                    url: `https://cdn.discordapp.com/emojis/${id}.${extension}`
                };
            }

            // Check if input is pure ID (emoji or sticker ID)
            const idRegex = /^([0-9]{17,20})$/;
            const idMatch = inputStr.trim().match(idRegex);
            if (idMatch) {
                const targetId = idMatch[1];
                
                // Try fetching as sticker first
                try {
                    const sticker = await client.fetchSticker(targetId);
                    if (sticker && sticker.url) {
                        return {
                            type: 'sticker',
                            name: sticker.name || 'copied_sticker',
                            url: sticker.url,
                            format: sticker.format
                        };
                    }
                } catch (e) {
                    // Not a valid sticker ID or fetch failed, proceed to try animated/static emoji links
                }

                // Check gif (animated emoji) first
                const gifUrl = `https://cdn.discordapp.com/emojis/${targetId}.gif`;
                try {
                    const res = await fetch(gifUrl, { method: 'HEAD' });
                    if (res.ok) {
                        return { type: 'emoji', name: `emoji_${targetId}`, url: gifUrl };
                    }
                } catch (e) {}

                // Try PNG (static emoji)
                const pngUrl = `https://cdn.discordapp.com/emojis/${targetId}.png`;
                try {
                    const res = await fetch(pngUrl, { method: 'HEAD' });
                    if (res.ok) {
                        return { type: 'emoji', name: `emoji_${targetId}`, url: pngUrl };
                    }
                } catch (e) {}

                return null;
            }

            return null;
        };

        let targetData = null;

        // 1. Handle replied message
        if (message.reference && message.reference.messageId) {
            try {
                const refMsg = await message.channel.messages.fetch(message.reference.messageId);

                // Priority 1: Check replied stickers
                if (refMsg.stickers && refMsg.stickers.size > 0) {
                    const sticker = refMsg.stickers.first();
                    targetData = {
                        type: 'sticker',
                        name: sticker.name ? sticker.name.replace(/[^a-zA-Z0-9_]/g, '_') : 'copied_sticker',
                        url: sticker.url,
                        format: sticker.format
                    };
                }
                
                // Priority 2: Check custom emojis in content
                if (!targetData && refMsg.content) {
                    targetData = await parseInput(refMsg.content);
                }
            } catch (err) {
                console.error('Error fetching referenced message:', err);
            }
        }

        // 2. Handle arguments if no target found from reply
        if (!targetData && args.length > 0) {
            targetData = await parseInput(args[0]);

            // Allow custom name override if user provided a second argument (e.g. .copy <id/emoji> <newName>)
            if (targetData && args[1]) {
                targetData.name = args[1].replace(/[^a-zA-Z0-9_]/g, '_');
            }
        }

        // If still no valid emoji or sticker found
        if (!targetData) {
            return message.reply(
                '❌ Could not find any custom emoji or sticker! Please reply to a message containing an emoji/sticker or provide a valid emoji/sticker ID.'
            );
        }

        // Clean up name (Discord requirements)
        let cleanName = targetData.name.replace(/[^a-zA-Z0-9_]/g, '_');
        if (cleanName.length < 2) cleanName = `${cleanName}_emoji`;
        if (cleanName.length > 32) cleanName = cleanName.substring(0, 32);

        // Process adding to the server
        const statusMsg = await message.reply(`🔄 Processing and copying **${cleanName}** to this server...`);

        try {
            if (targetData.type === 'emoji') {
                const addedEmoji = await message.guild.emojis.create({
                    attachment: targetData.url,
                    name: cleanName,
                    reason: `Copied by ${message.author.tag} (${message.author.id})`
                });

                return statusMsg.edit(`✅ Successfully added custom emoji ${addedEmoji} (**:${addedEmoji.name}:**) to the server!`);
            } else if (targetData.type === 'sticker') {
                // Discord stickers only accept PNG, APNG, or LOTTIE
                const addedSticker = await message.guild.stickers.create({
                    file: targetData.url,
                    name: cleanName,
                    tags: cleanName,
                    description: `Copied by ${message.author.tag}`,
                    reason: `Copied by ${message.author.tag} (${message.author.id})`
                });

                return statusMsg.edit(`✅ Successfully added custom sticker **${addedSticker.name}** to the server!`);
            }
        } catch (error) {
            console.error('Error copying emoji/sticker:', error);
            
            let errorText = 'An error occurred while uploading to the server.';
            if (error.code === 30008) errorText = '❌ Server has reached maximum emoji limit!';
            if (error.code === 30039) errorText = '❌ Server has reached maximum sticker limit!';
            if (error.code === 50035) errorText = '❌ Invalid file type or name format for sticker/emoji.';

            return statusMsg.edit(`${errorText}
\`${error.message}\``);
        }
    }
};
