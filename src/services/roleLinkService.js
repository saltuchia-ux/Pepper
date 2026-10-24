import { ROLE_LINKS } from '../config/roleLinks.js';
import { logger } from '../utils/logger.js';

const warned = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(message);
}

/** Gives the linked role(s) to one member if they have the trigger role. Returns how many roles were added. */
export async function applyRoleLinks(member) {
    if (!member?.guild || member.user?.bot) return 0;

    const guild = member.guild;
    let added = 0;

    for (const link of ROLE_LINKS) {
        if (!member.roles.cache.has(link.whenHas) || member.roles.cache.has(link.alsoGive)) continue;

        const target = guild.roles.cache.get(link.alsoGive);
        if (!target) continue; // role doesn't exist in this server

        const me = guild.members.me;
        if (!me?.permissions.has('ManageRoles')) {
            warnOnce(`perm:${guild.id}`, `Role links: I need the Manage Roles permission in "${guild.name}"`);
            continue;
        }
        if (me.roles.highest.position <= target.position) {
            warnOnce(`pos:${guild.id}:${target.id}`, `Role links: move my bot role above "${target.name}" in "${guild.name}" so I can give it`);
            continue;
        }

        try {
            await member.roles.add(target, `Role link: has ${link.whenHas}`);
            added += 1;
        } catch (error) {
            logger.error(`Role links: could not give ${target.name} to ${member.user.tag}:`, error);
        }
    }

    return added;
}

/** On startup: give the linked role to everyone who already has the trigger role. */
export async function syncAllRoleLinks(client) {
    let total = 0;

    for (const guild of client.guilds.cache.values()) {
        const relevant = ROLE_LINKS.filter((l) => guild.roles.cache.has(l.whenHas) && guild.roles.cache.has(l.alsoGive));
        if (!relevant.length) continue;

        try {
            await guild.members.fetch();
        } catch (error) {
            logger.error(`Role links: could not load members of "${guild.name}":`, error);
            continue;
        }

        for (const link of relevant) {
            const holders = guild.roles.cache.get(link.whenHas).members
                .filter((m) => !m.user.bot && !m.roles.cache.has(link.alsoGive));

            for (const member of holders.values()) {
                total += await applyRoleLinks(member);
                await sleep(400); // stay well under Discord's rate limits
            }
        }
    }

    logger.info(`Role links: startup sync done, gave ${total} role(s)`);
    return total;
}
