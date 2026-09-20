import http from "node:http";
import { ChannelType, Client, GatewayIntentBits, PermissionFlagsBits } from "discord.js";

const TOKEN=process.env.DISCORD_TOKEN||process.env.DISCORD_BOT_TOKEN;
const CONTROL_URL=(process.env.BALTICM_CONTROL_URL||"https://bot.balticm.eu").replace(/\/$/,"");
const SERVICE_SECRET=process.env.BALTICM_VOICE_SERVICE_SECRET||"";
const PORT=Number(process.env.PORT||3000);

if(!TOKEN){console.error("DISCORD_TOKEN is missing");process.exit(1)}
if(!SERVICE_SECRET){console.error("BALTICM_VOICE_SERVICE_SECRET is missing");process.exit(1)}

const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
const temporaryRooms=new Map();
const configCache=new Map();
const CONFIG_CACHE_MS=5000;

const profilesOf=cfg=>Array.isArray(cfg?.profiles)?cfg.profiles.filter(p=>p?.categoryId&&p?.createChannelId):(cfg?.categoryId&&cfg?.createChannelId?[{...cfg,id:"legacy"}]:[]);

async function getConfig(guildId){
 const hit=configCache.get(guildId);if(hit&&Date.now()-hit.at<CONFIG_CACHE_MS)return hit.value;
 try{
  const r=await fetch(`${CONTROL_URL}/api/voice-create/service/config?guildId=${encodeURIComponent(guildId)}`,{headers:{"X-BalticM-Service-Secret":SERVICE_SECRET}});
  if(!r.ok)return null;
  const x=await r.json(),value=x.config||null;configCache.set(guildId,{at:Date.now(),value});return value;
 }catch(e){console.error("config",e);return null}
}

function permissions(guild,member,p){
 const out=[];
 if(p.privateByDefault)out.push({id:guild.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Speak,PermissionFlagsBits.UseVAD,PermissionFlagsBits.Stream],deny:[PermissionFlagsBits.Connect]});
 else out.push({id:guild.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.Speak,PermissionFlagsBits.UseVAD,PermissionFlagsBits.Stream]});
 out.push({id:member.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.Speak,PermissionFlagsBits.UseVAD,PermissionFlagsBits.Stream,PermissionFlagsBits.MoveMembers,PermissionFlagsBits.ManageChannels]});
 return out;
}

async function createRoom(member,p){
 const guild=member.guild,category=guild.channels.cache.get(String(p.categoryId));if(!category||category.type!==ChannelType.GuildCategory)return;
 const username=(member.displayName||member.user.username||"Player").slice(0,40);
 const name=String(p.nameTemplate||"{username} Room").replaceAll("{username}",username).trim().slice(0,100);
 try{
  const room=await guild.channels.create({name,type:ChannelType.GuildVoice,parent:String(p.categoryId),userLimit:Math.max(0,Math.min(99,Number(p.userLimit)||0)),permissionOverwrites:permissions(guild,member,p),reason:"BalticM Voice Create"});
  temporaryRooms.set(room.id,{guildId:guild.id,ownerId:member.id,ownerName:username,profileId:p.id||null,createdAt:Date.now()});
  await member.voice.setChannel(room,"BalticM Voice Create");
  console.log("ROOM CREATED",room.id,name);
 }catch(e){console.error("create room",guild.id,member.id,e)}
}

async function deleteIfEmpty(channel){
 if(!channel||!temporaryRooms.has(channel.id)||channel.members.size>0)return;
 try{temporaryRooms.delete(channel.id);await channel.delete("BalticM temporary voice room empty");console.log("ROOM DELETED",channel.id)}catch(e){console.error("delete room",e)}
}

client.on("voiceStateUpdate",async(oldState,newState)=>{
 try{
  if(oldState.channel&&oldState.channelId!==newState.channelId)await deleteIfEmpty(oldState.channel);
  if(!newState.channelId||oldState.channelId===newState.channelId||newState.member?.user?.bot)return;
  const cfg=await getConfig(newState.guild.id);if(!cfg||cfg.enabled===false)return;
  const p=profilesOf(cfg).find(x=>String(x.createChannelId)===String(newState.channelId));if(!p)return;
  await createRoom(newState.member,p);
 }catch(e){console.error("voiceStateUpdate",e)}
});

client.once("clientReady",()=>console.log(`BalticM Voice Create online as ${client.user.tag}`));
client.on("error",e=>console.error("discord client",e));
client.on("shardError",e=>console.error("discord shard",e));

function liveState(guildId){
 const guild=client.guilds.cache.get(String(guildId));
 const rooms=[];
 for(const [roomId,meta] of temporaryRooms){
  if(String(meta.guildId)!==String(guildId))continue;
  const channel=guild?.channels.cache.get(roomId);
  if(!channel){temporaryRooms.delete(roomId);continue}
  rooms.push({id:roomId,name:channel.name,ownerId:meta.ownerId,ownerName:meta.ownerName||null,profileId:meta.profileId||null,memberCount:channel.members?.size||0,userLimit:channel.userLimit||0,locked:channel.permissionOverwrites?.cache?.get(guild.id)?.deny?.has(PermissionFlagsBits.Connect)||false});
 }
 return {rooms,activeRooms:rooms.length,owners:new Set(rooms.map(r=>r.ownerId).filter(Boolean)).size};
}

const server=http.createServer((req,res)=>{
 res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");
 const u=new URL(req.url,"http://localhost");
 if(u.pathname==="/state"||u.pathname==="/voice/state"){
  if((req.headers["x-balticm-service-secret"]||"")!==SERVICE_SECRET){res.statusCode=401;res.end(JSON.stringify({error:"Unauthorized"}));return}
  const guildId=u.searchParams.get("guildId");if(!guildId){res.statusCode=400;res.end(JSON.stringify({error:"guildId is required"}));return}
  res.end(JSON.stringify({ok:true,service:"BalticM Voice Create",version:"1.1.3",status:client.isReady()?"online":"connecting",discord:{ready:client.isReady(),user:client.user?.tag||null,guilds:client.guilds.cache.size},...liveState(guildId)}));return;
 }
 if(["/","/health","/voice","/voice/","/voice/health"].includes(u.pathname)){
  res.end(JSON.stringify({ok:true,service:"BalticM Voice Create",version:"1.1.3",status:client.isReady()?"online":"connecting",discord:{ready:client.isReady(),user:client.user?.tag||null,guilds:client.guilds.cache.size},temporaryRooms:temporaryRooms.size}));return;
 }
 res.statusCode=404;res.end(JSON.stringify({error:"Not found"}));
});
server.listen(PORT,()=>console.log("Health server listening on",PORT));
client.login(TOKEN).catch(e=>console.error("discord login",e));
