import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const NO_REASON = 'No reason provided';
function parseTarget(text) {
  const s = String(text ?? '').trim();
  return s.match(/^<@!?(\d+)>$/)?.[1] ?? (/^\d{17,20}$/.test(s) ? s : null);
}
function getMessage(ctx) { return ctx?.message ?? ctx; }
async function run({ guild, member: moderator, user, client, targetText, reason, reply }) {
  if (!guild) return reply('❌ Use this command in a server.');
  if (!moderator?.permissions?.has(PermissionFlagsBits.BanMembers)) return reply('❌ You need **Ban Members** permission.');
  const id = parseTarget(targetText);
  if (!id) return reply('Usage: `.ban @user/userID [reason]`');
  if (id === user?.id) return reply('❌ You cannot ban yourself.');
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) return reply('❌ I need **Ban Members** permission.');
  const targetMember = await guild.members.fetch(id).catch(() => null);
  if (targetMember && !targetMember.bannable) return reply('❌ I cannot ban that member. Move my bot role above their highest role.');
  const targetUser = targetMember?.user ?? await client.users.fetch(id).catch(() => null);
  if (!targetUser) return reply('❌ Could not find that user. Check the user ID.');
  try {
    await guild.members.ban(targetUser.id, { reason: reason || NO_REASON });
    return reply(`🔨 Banned **${targetUser.tag}**.\nReason: ${reason || NO_REASON}`);
  } catch (e) { console.error('[ban]', e); return reply('❌ Ban failed. Check my permissions and Railway logs.'); }
}
export default {
  data: new SlashCommandBuilder().setName('ban').setDescription('Ban a user').addUserOption(o => o.setName('target').setDescription('User to ban').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason')).setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
  category: 'moderation',
  async prefixExecute(ctx, config, client) {
    const msg = getMessage(ctx); const parts = msg.content.trim().split(/\s+/).slice(1);
    return run({ guild: msg.guild, member: msg.member, user: msg.author ?? ctx.user, client: client ?? msg.client, targetText: parts[0], reason: parts.slice(1).join(' '), reply: text => msg.reply(text) });
  },
  async execute(interaction) {
    return run({ guild: interaction.guild, member: interaction.member, user: interaction.user, client: interaction.client, targetText: interaction.options.getUser('target')?.id, reason: interaction.options.getString('reason') ?? '', reply: text => interaction.reply({ content: text, ephemeral: true }) });
  }
};
