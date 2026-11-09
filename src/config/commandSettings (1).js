// ============================================================================
//  This is your command settings file. Edit the text below
//  (it starts and ends with a backtick mark).
//  (It is in a .js file only so it always gets copied with the bot.)
// ============================================================================

export const COMMAND_SETTINGS_TEXT = `
# ============================================================================
#  PEPPER COMMAND SETTINGS  -  the ONE file to change how commands work
#  Edit it, save, restart the bot. Lines that start with # are notes.
#
#  Every command is ONE line with 3 parts:
#
#      command name      words that run it        who can use it
#      ban               [ 'ban' 'bn' ]           default
#
#  PART 2  words (triggers)
#      [ 'ban' 'bn' ]    .ban and .bn both work
#      [ 'bn' ]          ONLY .bn works (.ban stops)  <- this is how you replace the old one
#
#  PART 3  who can use it (this REPLACES the old rule)
#      default           keep the old rule (written at the end of the line)
#      everyone          anyone
#      admin             only Administrator
#      owner             only the server owner
#      off               command is turned off
#      BanMembers        anyone with the Ban Members permission
#      [ 'BanMembers' 'KickMembers' ]     anyone with Ban OR Kick permission
#      [ 'ModerateMembers' '123456789012345678' ]
#                        Timeout permission OR that role (paste the role ID)
#      [ 'user:123456789012345678' ]      only that person (paste their user ID)
#
#  PERMISSION WORDS (copy them exactly):
#      BanMembers  KickMembers  ModerateMembers (= timeout)  ManageMessages  ManageChannels
#      ManageRoles  ManageGuild  ManageNicknames  MuteMembers  Administrator
#      (any other Discord permission name works too, like ViewAuditLog)
#
#  EXAMPLES
#      ban     [ 'ban' 'bn' ]   [ 'ModerateMembers' ]     .ban and .bn, anyone with Timeout permission
#      kick    [ 'kick' ]       everyone                  anyone can kick (careful!)
#      warn    [ 'warn' ]       off                       .warn is turned off
#
#  GOOD TO KNOW
#      - One word can only run ONE command. "b" is already used by birthday, so take it
#        out of birthday first if you want "b" for something else.
#      - The server owner can always use everything.
#      - Slash commands (/ban) keep their name, but "who can use it" works for them too.
#      - A command that is not in this file works like before.
#      - Do not type a backtick anywhere in this file.
#      - If a line is wrong, the bot console shows "[commandSettings]" and tells you which.
# ============================================================================

# ================= BIRTHDAY =================
birthday          [ 'birthday' 'bd' 'bday' 'b' ]           default       # built-in: none

# ================= COMMUNITY =================
app-admin         [ 'app-admin' ]                          default       # built-in: ManageGuild
apply             [ 'apply' ]                              default       # built-in: none

# ================= CORE =================
commands          [ 'commands' 'cmds' ]                           default       # built-in: ManageGuild
configwizard      [ 'configwizard' ]                       default       # built-in: ManageGuild
help              [ 'help' 'h' 'info' ]                    default       # built-in: none
messages          [ 'messages' ]                           default       # built-in: Administrator
ping              [ 'ping' ]                               default       # built-in: none
stats             [ 'stats' ]                              default       # built-in: none
support           [ 'support' ]                            default       # built-in: none
uptime            [ 'uptime' ]                             default       # built-in: none

# ================= ECONOMY =================
balance           [ 'balance' 'bal' 'money' 'cash' ]       default       # built-in: none
beg               [ 'beg' ]                                default       # built-in: none
buy               [ 'buy' ]                                default       # built-in: none
crime             [ 'crime' ]                              default       # built-in: none
daily             [ 'daily' ]                              default       # built-in: none
deposit           [ 'deposit' 'dep' ]                      default       # built-in: none
economy           [ 'economy' ]                            default       # built-in: ManageGuild
eleaderboard      [ 'eleaderboard' ]                       default       # built-in: none
fish              [ 'fish' ]                               default       # built-in: none
gamble            [ 'gamble' 'bet' ]                       default       # built-in: none
inventory         [ 'inventory' 'inv' 'items' ]            default       # built-in: none
mine              [ 'mine' ]                               default       # built-in: none
pay               [ 'pay' 'give' 'send' ]                  default       # built-in: none
rob               [ 'rob' ]                                default       # built-in: none
shop              [ 'shop' ]                               default       # built-in: none
shop-config       [ 'shop-config' ]                        default       # built-in: none
slut              [ 'slut' ]                               default       # built-in: none
withdraw          [ 'withdraw' 'with' ]                    default       # built-in: none
work              [ 'work' ]                               default       # built-in: none

# ================= FUN =================
count             [ 'count' ]                              default       # built-in: ManageGuild
fight             [ 'fight' ]                              default       # built-in: none
flip              [ 'flip' 'coin' 'cf' ]                        default       # built-in: none
quote             [ 'quote' ]                              default       # built-in: none
roll              [ 'roll' 'dice' ]                        default       # built-in: none

# ================= GIVEAWAY =================
gcreate           [ 'gcreate' 'gstart' ]                   default       # built-in: ManageGuild
gdelete           [ 'gdelete' ]                            default       # built-in: ManageGuild
gend              [ 'gend' 'gstop' ]                       default       # built-in: ManageGuild
greroll           [ 'greroll' 'groll' ]                    default       # built-in: ManageGuild

# ================= JOINTOCREATE =================
jointocreate      [ 'jointocreate' 'jtc' ]                 default       # built-in: ManageGuild

# ================= LEVELING =================
leaderboard       [ 'leaderboard' 'lb' 'top' ]             default       # built-in: none
level             [ 'level' ]                              default       # built-in: ManageGuild
leveladd          [ 'leveladd' ]                           default       # built-in: ManageGuild
levelremove       [ 'levelremove' ]                        default       # built-in: ManageGuild
levelset          [ 'levelset' ]                           default       # built-in: ManageGuild
rank              [ 'rank' 'lvl' 'xp' ]                    default       # built-in: none

# ================= LOGGING =================
logging           [ 'logging' ]                            default       # built-in: ManageGuild

# ================= MODERATION =================
ban               [ 'ban' ]                                default       # built-in: BanMembers
counting          [ 'counting' ]                           default       # built-in: Administrator
crole             [ 'crole' ]                              default       # built-in: KickMembers
cs                [ 'cs' ]                                 default       # built-in: ManageMessages
dhs               [ 'dhs' 'delete' 'd' ]                   default       # built-in: ModerateMembers
ehs               [ 'ehs' 'edit' 'e' ]                     default       # built-in: ModerateMembers
es                [ 'es' ]                                 default       # built-in: ManageMessages
fn                [ 'fn' ]                                 default       # built-in: BanMembers
grole             [ 'grole' ]                              default       # built-in: ManageRoles
hs                [ 'hs' ]                                 default       # built-in: ModerateMembers
jail              [ 'jail' ]                               default       # built-in: ModerateMembers
jailsetup         [ 'jailsetup' ]                          default       # built-in: Administrator
kick              [ 'kick' 'gtfo' ]                               default       # built-in: KickMembers
lock              [ 'lock' ]                               default       # built-in: BanMembers
mrole             [ 'mrole' ]                              default       # built-in: ManageRoles
ms                [ 'ms' ]                                 default       # built-in: ModerateMembers
mute              [ 'mute' 'timeout' 'stfu' ]                               default       # built-in: ModerateMembers
nick              [ 'nick' ]                               default       # built-in: ManageNicknames
nuck              [ 'nuck' ]                               default       # built-in: Administrator
role              [ 'role' ]                               default       # built-in: BanMembers
s                 [ 's' ]                                  default       # built-in: ManageMessages
setcounting       [ 'setcounting' ]                        default       # built-in: BanMembers
tempban           [ 'tempban' 'tb' ]                            default       # built-in: BanMembers
trole             [ 'trole' ]                              default       # built-in: ManageRoles
unban             [ 'unban' 'ub' ]                              default       # built-in: BanMembers
unjail            [ 'unjail' ]                             default       # built-in: ModerateMembers
unlock            [ 'unlock' ]                             default       # built-in: BanMembers
unmute            [ 'unmute' 'untimeout' ]                             default       # built-in: ModerateMembers
warn              [ 'warn' ]                               default       # built-in: ModerateMembers

# ================= MUSIC =================
fm                [ 'fm' 'lf' 'lastfm' 'wk' 'whoknows' 'wkt' 'whoknowstrack' 'wka' 'whoknowsalbum' 'ta' 'topartists' 'tt' 'toptracks' 'tal' 'topalbums' 'recent' 'artistlb' ]   default       # built-in: none
join              [ 'join' ]                               default       # built-in: none
music             [ 'music' ]                              default       # built-in: none
nowplaying        [ 'nowplaying' 'np' 'now' ]              default       # built-in: none
play              [ 'play' ]                               default       # built-in: none
queue             [ 'queue' ]                              default       # built-in: none

# ================= REACTION ROLES =================
reactroles        [ 'reactroles' 'rr' 'reactionroles' ]    default       # built-in: Administrator

# ================= SEARCH =================
search            [ 'search' ]                             default       # built-in: none

# ================= SERVERSTATS =================
serverstats       [ 'serverstats' 'ss' 'sstats' ]          default       # built-in: ManageChannels

# ================= TICKET =================
claim             [ 'claim' ]                              default       # built-in: none
close             [ 'close' ]                              default       # built-in: none
priority          [ 'priority' ]                           default       # built-in: none
ticket            [ 'ticket' 't' 'new' ]                   default       # built-in: ManageChannels

# ================= TOOLS =================
baseconvert       [ 'baseconvert' ]                        default       # built-in: none
calculate         [ 'calculate' 'calc' 'math' ]            default       # built-in: none
countdown         [ 'countdown' ]                          default       # built-in: none
embedbuilder      [ 'embedbuilder' ]                       default       # built-in: ManageMessages
generatepassword  [ 'generatepassword' ]                   default       # built-in: none
hexcolor          [ 'hexcolor' ]                           default       # built-in: none
poll              [ 'poll' ]                               default       # built-in: none
randomuser        [ 'randomuser' ]                         default       # built-in: none
shorten           [ 'shorten' ]                            default       # built-in: none
time              [ 'time' ]                               default       # built-in: none
unixtime          [ 'unixtime' ]                           default       # built-in: none

# ================= UTILITY =================
afk               [ 'afk' ]                                default       # built-in: none
avatar            [ 'avatar' 'pfp' 'icon' ]                default       # built-in: none
boosttest         [ 'boosttest' ]                          default       # built-in: Administrator
copy              [ 'copy' ]                               default       # built-in: MANAGE_EXPRESSIONS
firstmsg          [ 'firstmsg' ]                           default       # built-in: SendMessages
location          [ 'location' ]                           default       # built-in: none
remind            [ 'remind' ]                             default       # built-in: none
report            [ 'report' ]                             default       # built-in: none
roleinfo          [ 'roleinfo' 'ri' ]                      default       # built-in: none
seen              [ 'seen' ]                               default       # built-in: none
serverinfo        [ 'serverinfo' ]                         default       # built-in: none
todo              [ 'todo' ]                               default       # built-in: SendMessages
userinfo          [ 'userinfo' 'user' 'whois' 'ui' ]       default       # built-in: none
weather           [ 'weather' ]                            default       # built-in: none
wipedata          [ 'wipedata' ]                           default       # built-in: none

# ================= VERIFICATION =================
autoverify        [ 'autoverify' 'av' ]                    default       # built-in: none
verification      [ 'verification' 'vadmin' ]              default       # built-in: checks inside the command (ManageGuild)
verify            [ 'verify' 'ver' ]                       default       # built-in: none

# ================= WELCOME =================
autorole          [ 'autorole' ]                           default       # built-in: ManageGuild
goodbye           [ 'goodbye' ]                            default       # built-in: ManageGuild
greet             [ 'greet' ]                              default       # built-in: ManageGuild
welcome           [ 'welcome' ]                            default       # built-in: ManageGuild

# ================= OWNER =================
cmdset            [ 'cmdset' 'cmd' ]                       default       # built-in: server owner only (change settings from Discord)
`;
