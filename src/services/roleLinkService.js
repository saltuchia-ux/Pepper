import { ROLE_LINKS } from '../config/roleLinks.js';
import { logger } from '../utils/logger.js';

const warned = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(message);
}

const compact = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function triggerNames(link) {
    return (link.whenHasNames ?? []).map(compact).filter(Boolean);
}

// Does this member have a trigger role (by ID or by name)?
function hasTrigger(member, link) {
    if (link.whenHas && member.roles.cache.has(link.whenHas)) return true;

    const names = triggerNames(link);
    return names.length > 0 && member.roles.cache.some((role) => names.includes(compact(role.name)));
}

// Every role in the server that counts as a trigger for this link
function getTriggerRoles(guild, link) {
    const names = triggerNames(link);

    return [...guild.roles.cache.values()].filter(
        (role) => role.id !== guild.id && (role.id === link.whenHas || names.includes(compact(role.name))),
    );
}

/** Gives the linked role(s) to one member if they have the trigger role. Returns how many roles were added. */
export async function applyRoleLinks(member) {
    if (!member?.guild || member.user?.bot) return 0;

    const guild = member.guild;
    let added = 0;

    for (const link of ROLE_LINKS) {
        if (!hasTrigger(member, link) || member.roles.cache.has(link.alsoGive)) continue;

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

/**
 * When someone LOSES their trigger role(s), takes the linked role away too (only for links with removeWhenLost).
 * It only reacts to a role being lost right now, so it never strips people who were given the role by hand.
 */
export async function removeRoleLinksIfLost(oldMember, newMember) {
    if (!newMember?.guild || newMember.user?.bot) return 0;
    if (!oldMember || oldMember.partial || !oldMember.roles?.cache) return 0; // can't tell what they had before

    const guild = newMember.guild;
    let removed = 0;

    for (const link of ROLE_LINKS) {
        if (!link.removeWhenLost) continue;
        if (!newMember.roles.cache.has(link.alsoGive)) continue;
        if (!hasTrigger(oldMember, link) || hasTrigger(newMember, link)) continue; // had none, or still has one

        const target = guild.roles.cache.get(link.alsoGive);
        if (!target) continue;

        const me = guild.members.me;
        if (!me?.permissions.has('ManageRoles')) {
            warnOnce(`perm:${guild.id}`, `Role links: I need the Manage Roles permission in "${guild.name}"`);
            continue;
        }
        if (me.roles.highest.position <= target.position) {
            warnOnce(`pos:${guild.id}:${target.id}`, `Role links: move my bot role above "${target.name}" in "${guild.name}" so I can remove it`);
            continue;
        }

        try {
            await newMember.roles.remove(target, 'Role link: lost the trigger role');
            removed += 1;
        } catch (error) {
            logger.error(`Role links: could not remove ${target.name} from ${newMember.user.tag}:`, error);
        }
    }

    return removed;
}

/** On startup: give the linked role to everyone who already has the trigger role. */
export async function syncAllRoleLinks(client) {
    let total = 0;

    for (const guild of client.guilds.cache.values()) {
        const relevant = ROLE_LINKS.filter((l) => guild.roles.cache.has(l.alsoGive) && getTriggerRoles(guild, l).length > 0);
        if (!relevant.length) continue;

        try {
            await guild.members.fetch();
        } catch (error) {
            logger.error(`Role links: could not load members of "${guild.name}":`, error);
            continue;
        }

        for (const link of relevant) {
            const holders = new Map();
            for (const triggerRole of getTriggerRoles(guild, link)) {
                for (const member of triggerRole.members.values()) {
                    if (!member.user.bot && !member.roles.cache.has(link.alsoGive)) holders.set(member.id, member);
                }
            }

            for (const member of holders.values()) {
                total += await applyRoleLinks(member);
                await sleep(400); // stay well under Discord's rate limits
            }
        }
    }

    logger.info(`Role links: startup sync done, gave ${total} role(s)`);
    return total;
}
