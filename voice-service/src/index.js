import http from "node:http";
import { ChannelType, Client, GatewayIntentBits, PermissionFlagsBits } from "discord.js";

const TOKEN=process.env.DISCORD_BOT_TOKEN;
const CONTROL_URL=(process.env.BALTICM_CONTROL_URL||"https://bot.balticm.eu").replace(/\/$/,"");
const SERVICE_SECRET=process.env.BALTICM_VOICE_SERVICE_SECRET||"";
const PORT=Number(process.env.PORT||3000);
if(!TOKEN){console.error("DISCORD_BOT_TOKEN is required");process.exit(1)}

const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
const cache=new Map();
async function config(guildId){
 const hit=cache.get(guildId);if(hit&&Date.now()-hit.at<15000)return hit.value;
 try{const r=await fetch(`${CONTROL_URL}/api/voice-create/service/config?guildId=${encodeURIComponent(guildId)}`,{headers:{"X-BalticM-Service-Secret":SERVICE_SECRET}});if(!r.ok)return null;const x=await r.json(),v=x.config||null;cache.set(guildId,{at:Date.now(),value:v});return v}catch(e){console.error("config",e);return null}
}
const managed=c=>c?.type===ChannelType.GuildVoice&&String(c.topic||"").startsWith("balticm-voice:");
async function deleteIfEmpty(channel){if(managed(channel)&&channel.members.size===0){try{await channel.delete("BalticM Voice Create: empty temporary room")}catch(e){console.error("delete room",e)}}}
async function createRoom(member,cfg){
 const guild=member.guild,category=guild.channels.cache.get(cfg.categoryId);if(!category||category.type!==ChannelType.GuildCategory)return;
 const username=(member.displayName||member.user.username).slice(0,40);
 const name=String(cfg.nameTemplate||"{username}'s Room").replaceAll("{username}",username).slice(0,100);
 const overwrites=[];
 if(cfg.privateByDefault)overwrites.push({id:guild.id,deny:[PermissionFlagsBits.Connect]});
 overwrites.push({id:member.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.Speak,PermissionFlagsBits.Stream,PermissionFlagsBits.MoveMembers,PermissionFlagsBits.ManageChannels]});
 try{
  const room=await guild.channels.create({name,type:ChannelType.GuildVoice,parent:cfg.categoryId,userLimit:Math.max(0,Math.min(99,Number(cfg.userLimit)||0)),topic:`balticm-voice:${member.id}:${username}`,permissionOverwrites:overwrites,reason:"BalticM Voice Create"});
  await member.voice.setChannel(room,"BalticM Voice Create");
 }catch(e){console.error("create room",guild.id,member.id,e)}
}
client.on("voiceStateUpdate",async(oldState,newState)=>{
 try{
  if(oldState.channelId&&oldState.channelId!==newState.channelId)await deleteIfEmpty(oldState.channel);
  if(!newState.channelId||oldState.channelId===newState.channelId)return;
  const cfg=await config(newState.guild.id);if(!cfg?.enabled||newState.channelId!==cfg.createChannelId)return;
  if(newState.member?.user?.bot)return;
  await createRoom(newState.member,cfg);
 }catch(e){console.error("voiceStateUpdate",e)}
});
client.once("ready",()=>console.log(`BalticM Voice Create online as ${client.user.tag}`));
const server=http.createServer((req,res)=>{res.setHeader("content-type","application/json");if(req.url==="/health"||req.url==="/"){res.end(JSON.stringify({ok:true,service:"BalticM Voice Create",status:client.isReady()?"online":"connecting",version:"1.0.0"}));return}res.statusCode=404;res.end(JSON.stringify({error:"Not found"}))});
server.listen(PORT,()=>console.log("Health server listening on",PORT));
client.login(TOKEN);
