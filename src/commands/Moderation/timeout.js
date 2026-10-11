import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const NO_REASON = 'No reason provided';
function parseTarget(text) {
  const s = String(text ?? '').trim();
  return s.match(/^<@!?(\d+)>$/)?.[1] ?? (/^\d{17,20}$/.test(s) ? s : null);
}
function parseDuration(text) {
  const s = String(text ?? '').toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d+)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  const unit = m[2];
  const factor = ({ s:1000, sec:1000, secs:1000, second:1000, seconds:1000, m:60000, min:60000, mins:60000, minute:60000, minutes:60000, h:3600000, hr:3600000, hrs:3600000, hour:3600000, hours:3600000, d:86400000, day:86400000, days:86400000, w:604800000, week:604800000, weeks:604800000 })[unit];
  const ms = n * factor;
  return ms <= 28 * 24 * 60 * 60 * 1000 ? { ms, label: `${n} ${unit}` } : null;
}
function getMessage(ctx) { return ctx?.message ?? ctx; }
async function run({ guild, member: moderator, user, targetText, durationText, reason, reply }) {
  if (!guild) return reply('❌ Use this command in a server.');
  if (!moderator?.permissions?.has(PermissionFlagsBits.ModerateMembers)) return reply('❌ You need **Timeout Members** (Moderate Members) permission.');
  const id = parseTarget(targetText);
  if (!id) return reply('Usage: `.timeout @user/userID 15min [reason]`');
  if (id === user?.id) return reply('❌ You cannot timeout yourself.');
  const duration = parseDuration(durationText);
  if (!duration) return reply('❌ Invalid duration. Use `5min`, `15 minutes`, `2hour`, `1day`, or `1week` (maximum 28 days).');
  const target = await guild.members.fetch(id).catch(() => null);
  if (!target) return reply('❌ That user is not in this server.');
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.ModerateMembers)) return reply('❌ I need **Moderate Members** permission.');
  if (!target.moderatable) return reply('❌ I cannot timeout that member. Move my bot role above their highest role.');
  try {
    await target.timeout(duration.ms, reason || NO_REASON);
    return reply(`⏳ Timed out **${target.user.tag}** for **${durationText}**.\nReason: ${reason || NO_REASON}`);
  } catch (e) { console.error('[timeout]', e); return reply('❌ Timeout failed. Check my permissions and Railway logs.'); }
}
export default {
  data: new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member (up to 28 days)').addUserOption(o => o.setName('target').setDescription('Member to timeout').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('Example: 15min, 2hour, 1day, 1week').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')).setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  category: 'moderation',
  async prefixExecute(ctx) {
    const msg = getMessage(ctx); const parts = msg.content.trim().split(/\s+/).slice(1);
    return run({ guild: msg.guild, member: msg.member, user: msg.author ?? ctx.user, targetText: parts[0], durationText: parts[1], reason: parts.slice(2).join(' '), reply: text => msg.reply(text) });
  },
  async execute(interaction) {
    return run({ guild: interaction.guild, member: interaction.member, user: interaction.user, targetText: interaction.options.getUser('target')?.id, durationText: interaction.options.getString('duration'), reason: interaction.options.getString('reason') ?? '', reply: text => interaction.reply({ content: text, ephemeral: true }) });
  }
};
