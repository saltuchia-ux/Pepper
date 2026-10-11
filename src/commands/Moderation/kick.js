import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const NO_REASON = 'No reason provided';
function parseTarget(text) {
  const s = String(text ?? '').trim();
  return s.match(/^<@!?(\d+)>$/)?.[1] ?? (/^\d{17,20}$/.test(s) ? s : null);
}
function getMessage(ctx) { return ctx?.message ?? ctx; }
async function run({ guild, member: moderator, user, targetText, reason, reply }) {
  if (!guild) return reply('❌ Use this command in a server.');
  if (!moderator?.permissions?.has(PermissionFlagsBits.KickMembers)) return reply('❌ You need **Kick Members** permission.');
  const id = parseTarget(targetText);
  if (!id) return reply('Usage: `.kick @user/userID [reason]`');
  if (id === user?.id) return reply('❌ You cannot kick yourself.');
  const target = await guild.members.fetch(id).catch(() => null);
  if (!target) return reply('❌ That user is not in this server.');
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.KickMembers)) return reply('❌ I need **Kick Members** permission.');
  if (!target.kickable) return reply('❌ I cannot kick that member. Move my bot role above their highest role.');
  try {
    await target.kick(reason || NO_REASON);
    return reply(`👢 Kicked **${target.user.tag}**.\nReason: ${reason || NO_REASON}`);
  } catch (e) { console.error('[kick]', e); return reply('❌ Kick failed. Check my permissions and Railway logs.'); }
}
export default {
  data: new SlashCommandBuilder().setName('kick').setDescription('Kick a member').addUserOption(o => o.setName('target').setDescription('Member to kick').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')).setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  category: 'moderation',
  async prefixExecute(ctx) {
    const msg = getMessage(ctx); const parts = msg.content.trim().split(/\s+/).slice(1);
    return run({ guild: msg.guild, member: msg.member, user: msg.author ?? ctx.user, targetText: parts[0], reason: parts.slice(1).join(' '), reply: text => msg.reply(text) });
  },
  async execute(interaction) {
    return run({ guild: interaction.guild, member: interaction.member, user: interaction.user, targetText: interaction.options.getUser('target')?.id, reason: interaction.options.getString('reason') ?? '', reply: text => interaction.reply({ content: text, ephemeral: true }) });
  }
};
