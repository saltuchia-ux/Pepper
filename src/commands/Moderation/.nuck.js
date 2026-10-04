export default {
    name: 'nuck',
    description: 'Delete all messages in the current channel',

    async execute(message) {
        if (!message.member.permissions.has('Administrator')) {
            return message.reply('❌ You need Administrator permission to use `.nuck`.');
        }

        try {
            let total = 0;

            while (true) {
                const messages = await message.channel.messages.fetch({ limit: 100 });

                if (messages.size === 0) break;

                await message.channel.bulkDelete(messages, true);
                total += messages.size;

                if (messages.size < 100) break;
            }

            await message.channel.send(`💥 Channel nuked! Deleted ${total} messages.`);
        } catch (error) {
            console.error(error);
            await message.reply('❌ I could not delete the messages.');
        }
    }
};
