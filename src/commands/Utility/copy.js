const { PermissionFlagsBits, AttachmentBuilder } = require('discord.js');

module.exports = {
    name: 'copy',
    description: 'Copies custom emojis or stickers from a replied message or ID and adds them to the server.',
    category: 'Utility',
    aliases: ['steal', 'addemoji', 'addsticker'],
    run: async (client, message, args) => {
        try {
            console.log(`[COPY COMMAND] Executed by ${message.author.tag}`);

            // Check bot permissions
            if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageEmojisAndStickers)) {
                return message.reply('❌ I need the **Manage Emojis and Stickers** permission to add emojis or stickers to this server.');
            }

            let targets = [];

            // Helper function to extract all custom emojis from text
            const extractEmojis = (text) => {
                if (!text) return [];
                const regex = /<(a?):([a-zA-Z0-9_]{2,32}):([0-9]{17,20})>/g;
                const matches = [...text.matchAll(regex)];
                return matches.map(m => ({
                    type: 'emoji',
                    name: m[2],
                    url: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] === 'a' ? 'gif' : 'png'}`
                }));
            };

            // 1. Check if user replied to a message
            if (message.reference && message.reference.messageId) {
                try {
                    const refMsg = await message.channel.messages.fetch(message.reference.messageId);
                    
                    // Check for stickers in replied message
                    if (refMsg.stickers && refMsg.stickers.size > 0) {
                        const sticker = refMsg.stickers.first();
                        targets.push({
                            type: 'sticker',
                            name: sticker.name ? sticker.name.replace(/[^a-zA-Z0-9_]/g, '_') : 'sticker',
                            url: sticker.url
                        });
                    }

                    // Check for custom emojis in replied message content
                    const refEmojis = extractEmojis(refMsg.content);
                    if (refEmojis.length > 0) {
                        targets.push(...refEmojis);
                    }
                } catch (err) {
                    console.error('Failed to fetch referenced message:', err);
                }
            }

            // 2. Check command arguments if no targets found from reply
            if (targets.length === 0 && args.length > 0) {
                const argEmojis = extractEmojis(args[0]);
                if (argEmojis.length > 0) {
                    targets.push(...argEmojis);
                } else {
                    // Check if argument is a raw ID (17-20 digits)
                    const idMatch = args[0].trim().match(/^([0-9]{17,20})$/);
                    if (idMatch) {
                        const id = idMatch[1];
                        const customName = args[1] ? args[1].replace(/[^a-zA-Z0-9_]/g, '_') : `emoji_${id}`;
                        
                        // Try fetching as sticker first
                        let isSticker = false;
                        try {
                            const sticker = await client.fetchSticker(id);
                            if (sticker && sticker.url) {
                                targets.push({
                                    type: 'sticker',
                                    name: sticker.name ? sticker.name.replace(/[^a-zA-Z0-9_]/g, '_') : customName,
                                    url: sticker.url
                                });
                                isSticker = true;
                            }
                        } catch (e) {}

                        // If not a sticker, default to emoji URL
                        if (!isSticker) {
                            targets.push({
                                type: 'emoji',
                                name: customName,
                                url: `https://cdn.discordapp.com/emojis/${id}.png`
                            });
                        }
                    }
                }
            }

            if (targets.length === 0) {
                return message.reply('❌ Please reply to a message containing custom emojis/stickers or provide a valid emoji/sticker ID.');
            }

            const statusMsg = await message.reply(`🔄 Processing and copying ${targets.length} item(s) to the server...`);

            let successCount = 0;
            let failCount = 0;

            for (const target of targets) {
                let cleanName = target.name.replace(/[^a-zA-Z0-9_]/g, '_');
                if (cleanName.length < 2) cleanName = `${cleanName}_emoji`;
                if (cleanName.length > 32) cleanName = cleanName.substring(0, 32);

                try {
                    // Download asset buffer securely to avoid URL parsing issues
                    const res = await fetch(target.url);
                    if (!res.ok) throw new Error(`Failed to fetch asset from CDN (Status: ${res.status})`);
                    const buffer = Buffer.from(await res.arrayBuffer());
                    const attachment = new AttachmentBuilder(buffer, { name: `${cleanName}.${target.type === 'emoji' ? 'png' : 'png'}` });

                    if (target.type === 'emoji') {
                        await message.guild.emojis.create({
                            attachment: buffer,
                            name: cleanName,
                            reason: `Copied by ${message.author.tag}`
                        });
                        successCount++;
                    } else if (target.type === 'sticker') {
                        await message.guild.stickers.create({
                            file: buffer,
                            name: cleanName,
                            tags: cleanName,
                            description: `Copied by ${message.author.tag}`,
                            reason: `Copied by ${message.author.tag}`
                        });
                        successCount++;
                    }
                } catch (error) {
                    console.error(`Failed to upload ${cleanName}:`, error);
                    failCount++;
                }
            }

            return statusMsg.edit(`✅ Successfully added **${successCount}** item(s) to the server! ${failCount > 0 ? `(Failed: ${failCount})` : ''}`);

        } catch (error) {
            console.error('Critical error in copy command:', error);
            return message.reply(`❌ An error occurred while executing the command: \`${error.message}\``);
        }
    }
};
