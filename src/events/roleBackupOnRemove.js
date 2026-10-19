import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { saveRoleBackup } from '../services/roleBackupService.js';
import { getJailConfig, backupableRoleIds } from '../services/jailService.js';

// Saves a person's roles for 2 hours when they leave, get kicked or get banned,
// so a moderator can give them back with .restore
export default {
    name: Events.GuildMemberRemove,
    once: false,

    async execute(member) {
        try {
            if (!member?.guild || member.user?.bot) return;

            const config = await getJailConfig(member.guild.id);

            // Someone who is in jail only has the Jailed role now.
            // Their real roles were already saved when they were jailed.
            if (config?.roleId && member.roles?.cache?.has(config.roleId)) return;

            const roleIds = backupableRoleIds(member, config?.roleId);

            if (!roleIds.length) return;

            await saveRoleBackup({
                guildId: member.guild.id,
                userId: member.id,
                roleIds,
                reason: 'left, kicked or banned',
            });
        } catch (error) {
            logger.debug(`Role backup on remove failed: ${error.message}`);
        }
    },
};
