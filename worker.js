const CLIENT_ID="1543137268221354035";
const COOKIE="balticm_session", STATE="balticm_oauth_state";
const enc=new TextEncoder(),dec=new TextDecoder();

function parseCookies(req){return Object.fromEntries((req.headers.get("Cookie")||"").split(";").map(x=>x.trim().split("=")).filter(x=>x[0]).map(([k,...v])=>[k,v.join("=")]))}
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function unb64(s){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function sign(p,secret){const d=b64(enc.encode(JSON.stringify(p))),k=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return d+"."+b64(new Uint8Array(await crypto.subtle.sign("HMAC",k,enc.encode(d))))}
async function verify(t,secret){try{const[d,s]=t.split("."),k=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);if(!await crypto.subtle.verify("HMAC",k,unb64(s),enc.encode(d)))return null;const p=JSON.parse(dec.decode(unb64(d)));return p.exp>Date.now()?p:null}catch{return null}}
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});


function compareSemver(a,b){
 const pa=String(a||"").replace(/^v/,"").split(".").map(x=>Number.parseInt(x,10)||0),pb=String(b||"").replace(/^v/,"").split(".").map(x=>Number.parseInt(x,10)||0);
 for(let i=0;i<3;i++){if((pa[i]||0)!==(pb[i]||0))return (pa[i]||0)-(pb[i]||0)}return 0;
}
const RELEASES_LATEST="https://github.com/all4fun-91/balticm-bot/releases/latest";
async function latestDesktopRelease(){
 const r=await fetch(RELEASES_LATEST,{redirect:"manual",headers:{"User-Agent":"BalticM-Control-Center-Updater"}});
 const location=r.headers.get("Location")||"";
 const m=location.match(/\/releases\/tag\/v?([^/?#]+)/i);
 if(!m)throw new Error("GitHub latest release redirect failed: "+r.status);
 const version=decodeURIComponent(m[1]);
 const base="https://github.com/all4fun-91/balticm-bot/releases/download/v"+version;
 const file="BalticM.Control.Center_"+version+"_x64-setup.exe";
 const url=base+"/"+file;
 const sigUrl=url+".sig";
 const sr=await fetch(sigUrl,{headers:{"User-Agent":"BalticM-Control-Center-Updater"}});
 if(!sr.ok)throw new Error("GitHub signature download failed: "+sr.status);
 const signature=(await sr.text()).trim();
 if(!signature)throw new Error("GitHub signature is empty");
 return {version,url,signature,notes:"BalticM Control Center v"+version+" is available.",pub_date:new Date().toISOString()};
}
async function desktopUpdate(target,arch,currentVersion){
 if(target!=="windows"||(arch!=="x86_64"&&arch!=="i686"&&arch!=="aarch64"))return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
 try{const r=await latestDesktopRelease();if(!r||compareSemver(r.version,currentVersion)<=0)return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});return json(r)}catch(e){return json({error:"Desktop update lookup failed",detail:String(e.message||e)},502)}
}
async function publicNotifications(env){
 let items=[];
 try{const parsed=JSON.parse(env.BALTICM_NOTIFICATIONS||"[]");if(Array.isArray(parsed))items=parsed}catch{}
 try{const r=await latestDesktopRelease();if(r)items.unshift({id:"desktop-"+r.version,type:"desktop_release",title:"BalticM Control Center v"+r.version+" available",text:r.notes,version:r.version,publishedAt:r.pub_date})}catch{}
 return items.slice(0,20);
}
async function desktopLatest(){
 try{const r=await latestDesktopRelease();return r?json({available:true,version:r.version,url:r.url,notes:r.notes,pub_date:r.pub_date}):json({available:false})}catch(e){return json({available:false,error:String(e.message||e)},502)}
}
async function health(){
 const targets=[["Main Bot","https://balticm.eu/discord-bot/"],["Reaction Roles","https://balticm.eu/reactions/"]];
 const services=await Promise.all(targets.map(async([name,url])=>{try{const r=await fetch(url,{headers:{Accept:"application/json,text/plain,*/*"}}),text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text.slice(0,250)}return{name,url,ok:r.ok,status:r.status,data}}catch(e){return{name,url,ok:false,status:0,error:String(e.message||e)}}}));
 return json({ok:services.every(x=>x.ok),checkedAt:new Date().toISOString(),services});
}
function redirectUri(req,env){return env.DISCORD_REDIRECT_URI||new URL("/api/auth/callback",new URL(req.url).origin).toString()}
async function login(req,env){
 const state=crypto.randomUUID(),u=new URL("https://discord.com/oauth2/authorize");
 u.searchParams.set("client_id",env.DISCORD_CLIENT_ID||CLIENT_ID);u.searchParams.set("response_type","code");u.searchParams.set("redirect_uri",redirectUri(req,env));u.searchParams.set("scope","identify guilds");u.searchParams.set("state",state);
 return new Response(null,{status:302,headers:{Location:u.toString(),"Set-Cookie":`${STATE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,"Cache-Control":"no-store"}});
}
async function callback(req,env){
 const u=new URL(req.url),c=parseCookies(req),code=u.searchParams.get("code"),state=u.searchParams.get("state");
 if(!code||!state||state!==c[STATE])return Response.redirect(u.origin+"/?auth=invalid",302);
 if(!env.DISCORD_CLIENT_SECRET||!env.SESSION_SECRET)return Response.redirect(u.origin+"/?auth=config",302);
 const body=new URLSearchParams({client_id:env.DISCORD_CLIENT_ID||CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:redirectUri(req,env)});
 const tr=await fetch("https://discord.com/api/v10/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});if(!tr.ok)return Response.redirect(u.origin+"/?auth=failed",302);
 const t=await tr.json(),h={Authorization:`Bearer ${t.access_token}`};
 const [mr,gr]=await Promise.all([fetch("https://discord.com/api/v10/users/@me",{headers:h}),fetch("https://discord.com/api/v10/users/@me/guilds",{headers:h})]);if(!mr.ok)return Response.redirect(u.origin+"/?auth=failed",302);
 const user=await mr.json(),gs=gr.ok?await gr.json():[];
 const guilds=gs.filter(g=>g.owner||(BigInt(g.permissions||"0")&32n)===32n).map(g=>({id:g.id,name:g.name,icon:g.icon,owner:g.owner}));
 const session=await sign({id:user.id,username:user.username,global_name:user.global_name||user.username,avatar:user.avatar,guilds,exp:Date.now()+86400000},env.SESSION_SECRET);
 return new Response(null,{status:302,headers:{Location:u.origin+"/","Set-Cookie":`${COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,"Set-Cookie-2":`${STATE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,"Cache-Control":"no-store"}});
}
async function session(req,env){const t=parseCookies(req)[COOKIE];return t&&env.SESSION_SECRET?verify(t,env.SESSION_SECRET):null}
async function discordGuild(env,id){
 if(!env.DISCORD_BOT_TOKEN)return json({error:"DISCORD_BOT_TOKEN is not configured"},503);
 if(!id)return json({error:"guildId is required"},400);
 const h={Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`};
 const [g,c,r]=await Promise.all([fetch(`https://discord.com/api/v10/guilds/${id}?with_counts=true`,{headers:h}),fetch(`https://discord.com/api/v10/guilds/${id}/channels`,{headers:h}),fetch(`https://discord.com/api/v10/guilds/${id}/roles`,{headers:h})]);
 if(!g.ok){if(g.status===404)return json({error:"Bot is not installed in this server",notInstalled:true},404);return json({error:"Discord guild request failed",status:g.status},502);}
 const gd=await g.json();return json({guild:{id:gd.id,name:gd.name,icon:gd.icon,memberCount:gd.approximate_member_count,onlineCount:gd.approximate_presence_count},channels:c.ok?await c.json():[],roles:r.ok?await r.json():[]});
}

function botHeaders(env,jsonBody=false){return{Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`,...(jsonBody?{"Content-Type":"application/json"}:{})}}
function canManageGuild(user,guildId){return(user.guilds||[]).some(g=>g.id===guildId)}
async function discordMembers(env,guildId){
 if(!env.DISCORD_BOT_TOKEN)return json({error:"DISCORD_BOT_TOKEN is not configured"},503);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`,{headers:botHeaders(env)});
 if(!r.ok)return json({error:"Discord members request failed",status:r.status},r.status===403?403:502);
 const members=await r.json();
 return json({members:members.map(m=>({id:m.user?.id,username:m.user?.username||"Unknown",globalName:m.user?.global_name||m.nick||m.user?.username||"Unknown",nick:m.nick||null,avatar:m.user?.avatar||null,roles:m.roles||[],bot:!!m.user?.bot,joinedAt:m.joined_at||null}))});
}
async function ensureDmOptOutTable(env){await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS dm_opt_outs (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, opted_out_at TEXT NOT NULL, PRIMARY KEY (guild_id,user_id))").run()}
async function dmOptOutState(env,guildId){await ensureDmOptOutTable(env);const r=await env.BALTICM_DB.prepare("SELECT user_id AS userId,opted_out_at AS optedOutAt FROM dm_opt_outs WHERE guild_id=? ORDER BY opted_out_at DESC").bind(guildId).all();return json({optedOut:r.results||[]})}
async function setDmOptOut(env,guildId,userId,optOut=true){await ensureDmOptOutTable(env);if(optOut)await env.BALTICM_DB.prepare("INSERT OR REPLACE INTO dm_opt_outs (guild_id,user_id,opted_out_at) VALUES (?,?,?)").bind(guildId,userId,new Date().toISOString()).run();else await env.BALTICM_DB.prepare("DELETE FROM dm_opt_outs WHERE guild_id=? AND user_id=?").bind(guildId,userId).run();return json({ok:true,optOut})}
async function sendDirectMessages(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const memberIds=[...new Set((Array.isArray(body.memberIds)?body.memberIds:[]).map(x=>String(x||"").trim()).filter(x=>/^\d{16,22}$/.test(x)))];
 const message=String(body.message||"").trim().slice(0,1900),embed=!!body.embed,bannerUrl=String(body.bannerUrl||"").trim().slice(0,1000);
 if(!memberIds.length)return json({error:"Select at least one member"},400);
 if(memberIds.length>100)return json({error:"Maximum 100 recipients per send"},400);
 if(!message)return json({error:"Message is required"},400);
 if(bannerUrl&&!/^https:\/\//i.test(bannerUrl))return json({error:"Banner URL must use https://"},400);
 await ensureDmOptOutTable(env);
 const oo=await env.BALTICM_DB.prepare("SELECT user_id AS userId FROM dm_opt_outs WHERE guild_id=?").bind(guildId).all(),blocked=new Set((oo.results||[]).map(x=>x.userId));
 const results=[];
 for(const memberId of memberIds){
  if(blocked.has(memberId)){results.push({memberId,ok:false,skipped:true,error:"Opted out"});continue}
  const member=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,{headers:botHeaders(env)}).then(async r=>r.ok?r.json():null).catch(()=>null);
  if(!member||member.user?.bot){results.push({memberId,ok:false,error:"Member unavailable"});continue}
  const name=member.nick||member.user?.global_name||member.user?.username||memberId;
  let ok=false;
  if(embed){
   const cr=await fetch("https://discord.com/api/v10/users/@me/channels",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify({recipient_id:memberId})});
   if(cr.ok){const ch=await cr.json(),payload={embeds:[{description:message,color:0x7457ff}],components:[{type:1,components:[{type:2,style:2,label:"Unsubscribe from news",custom_id:`dm_unsubscribe:${guildId}`}]}]};if(bannerUrl)payload.embeds[0].image={url:bannerUrl};const dr=await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});ok=dr.ok}
  }else ok=await discordDm(env,memberId,`📨 **BalticM Message**\n${message}`).catch(()=>false);
  results.push({memberId,name,ok,error:ok?null:"DM unavailable"});
  await new Promise(resolve=>setTimeout(resolve,175));
 }
 const sent=results.filter(x=>x.ok).length,skipped=results.filter(x=>x.skipped).length;
 return json({ok:true,sent,failed:results.length-sent-skipped,skipped,total:results.length,results});
}
async function createDiscordRole(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const name=String(body?.name||"").trim().slice(0,100);if(!name)return json({error:"Role name is required"},400);
 const payload={name,hoist:!!body.hoist,mentionable:!!body.mentionable};
 if(/^#[0-9a-fA-F]{6}$/.test(body.color||""))payload.color=parseInt(body.color.slice(1),16);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 const data=await r.json().catch(()=>({}));if(!r.ok)return json({error:data.message||"Role creation failed",status:r.status},r.status===403?403:502);
 return json({role:data},201);
}
async function changeMemberRole(req,env,guildId,memberId,roleId,remove=false){
 if(!memberId||!roleId)return json({error:"memberId and roleId are required"},400);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}/roles/${roleId}`,{method:remove?"DELETE":"PUT",headers:botHeaders(env)});
 if(!r.ok){const data=await r.json().catch(()=>({}));return json({error:data.message||"Role update failed",status:r.status},r.status===403?403:502)}
 return new Response(null,{status:204});
}
async function deleteDiscordRole(env,guildId,roleId){
 if(!roleId)return json({error:"roleId is required"},400);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`,{method:"DELETE",headers:botHeaders(env)});
 if(!r.ok){const data=await r.json().catch(()=>({}));return json({error:data.message||"Role deletion failed",status:r.status},r.status===403?403:502)}
 return new Response(null,{status:204});
}
async function editDiscordRole(req,env,guildId,roleId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const payload={};
 if(typeof body.name==="string"&&body.name.trim())payload.name=body.name.trim().slice(0,100);
 if(/^#[0-9a-fA-F]{6}$/.test(body.color||""))payload.color=parseInt(body.color.slice(1),16);
 if(typeof body.hoist==="boolean")payload.hoist=body.hoist;
 if(typeof body.mentionable==="boolean")payload.mentionable=body.mentionable;
 if(body.permissions!==undefined){const permissions=String(body.permissions);if(!/^\d+$/.test(permissions))return json({error:"Invalid permissions bitfield"},400);try{BigInt(permissions)}catch{return json({error:"Invalid permissions bitfield"},400)}payload.permissions=permissions;}
 if(!Object.keys(payload).length)return json({error:"No role changes supplied"},400);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 const data=await r.json().catch(()=>({}));if(!r.ok)return json({error:data.message||"Role update failed",status:r.status},r.status===403?403:502);
 return json({role:data});
}

async function cachedGuildChannels(env,guildId){
 const key=new Request("https://balticm.internal/discord-channels/"+encodeURIComponent(guildId));
 const cache=caches.default;
 const hit=await cache.match(key);
 if(hit)return hit.json();
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});
 if(!r.ok){const e=new Error("Discord channels request failed");e.status=r.status;throw e}
 const channels=await r.json();
 await cache.put(key,new Response(JSON.stringify(channels),{headers:{"Content-Type":"application/json","Cache-Control":"public, max-age=30"}}));
 return channels;
}

const voiceConfigKey=guildId=>"voice-create:"+guildId;
const normalizeVoiceProfiles=config=>{
 if(!config)return[];
 if(Array.isArray(config.profiles))return config.profiles.filter(Boolean);
 if(config.categoryId&&config.createChannelId)return[{id:"legacy",categoryId:config.categoryId,createChannelId:config.createChannelId,nameTemplate:config.nameTemplate||"{username} Room",userLimit:Number(config.userLimit)||0,privateByDefault:!!config.privateByDefault}];
 return[];
};
async function getVoiceConfig(env,guildId){if(!env.BALTICM_DB)return null;const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key = ?").bind(voiceConfigKey(guildId)).first();if(!row?.value)return null;try{return JSON.parse(row.value)}catch{return null}}
async function setVoiceConfig(env,guildId,config){if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(voiceConfigKey(guildId),JSON.stringify(config),new Date().toISOString()).run()}
const musicConfigKey=guildId=>"music:"+guildId;
async function getMusicConfig(env,guildId){if(!env.BALTICM_DB)return null;const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key = ?").bind(musicConfigKey(guildId)).first();if(!row?.value)return null;try{return JSON.parse(row.value)}catch{return null}}
async function saveMusicConfig(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const commandChannelId=String(body.commandChannelId||"");if(!commandChannelId)return json({error:"Select a Music command channel"},400);
 const cr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});if(!cr.ok)return json({error:"Discord channels request failed"},502);
 const channels=await cr.json(),ch=channels.find(c=>c.id===commandChannelId&&(c.type===0||c.type===5));if(!ch)return json({error:"Selected text channel was not found"},400);
 const config={commandChannelId,commandChannelName:ch.name,updatedAt:new Date().toISOString()};await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(musicConfigKey(guildId),JSON.stringify(config),config.updatedAt).run();return json({config});
}
async function musicConfigState(env,guildId){
 try{const [config,allChannels]=await Promise.all([getMusicConfig(env,guildId),cachedGuildChannels(env,guildId)]);const textChannels=allChannels.filter(c=>c.type===0||c.type===5).map(c=>({id:c.id,name:c.name,parentId:c.parent_id||null}));return json({config,textChannels})}catch(e){return json({error:e.message||"Discord channels request failed",status:e.status||null},502)}
}
async function musicProxy(req,env,guildId,action){
 if(!env.BALTICM_MUSIC_SERVICE_SECRET)return json({error:"Music service secret is not configured"},503);
 let channels;try{channels=(await cachedGuildChannels(env,guildId)).filter(c=>c.type===2||c.type===13).map(c=>({id:c.id,name:c.name,type:c.type,parentId:c.parent_id||null}))}catch(e){return json({error:e.message||"Discord channels request failed",status:e.status||null},502)}
 const path=action==="state"?"state":action;
 const init={method:action==="state"?"GET":"POST",headers:{"X-BalticM-Service-Secret":env.BALTICM_MUSIC_SERVICE_SECRET,"Accept":"application/json"}};
 if(action!=="state"){let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)};if(action==="connect"&&!channels.some(c=>c.id===String(body.channelId||"")))return json({error:"Select a valid voice channel"},400);init.headers["Content-Type"]="application/json";init.body=JSON.stringify({guildId,...body});}
 const target=`https://balticm.eu/music/${path}${action==="state"?`?guildId=${encodeURIComponent(guildId)}`:""}`;
 try{const r=await fetch(target,{...init,cf:{cacheTtl:0}}),data=await r.json().catch(()=>({}));if(!r.ok)return json({error:data.error||"Music service request failed",status:r.status},r.status===400?400:502);return json(action==="state"?{...data,channels}:{...data,channels});}catch{return json({error:"Music service is unavailable"},502)}
}
async function voiceCreateState(env,guildId){
 const stored=await getVoiceConfig(env,guildId),profiles=normalizeVoiceProfiles(stored);if(!profiles.length)return json({config:{enabled:false,profiles:[]},rooms:[],live:{activeRooms:0,owners:0}});
 let channels;try{channels=await cachedGuildChannels(env,guildId)}catch(e){return json({error:e.message||"Discord channels request failed",status:e.status||null},502)}
 const hydrated=profiles.map(p=>({...p,createChannelName:channels.find(c=>c.id===p.createChannelId)?.name||"Create Voice",categoryName:channels.find(c=>c.id===p.categoryId)?.name||"Category"}));
 let rooms=[],live={activeRooms:0,owners:0,status:"offline"};
 try{
  const vr=await fetch(`https://balticm.eu/voice/state?guildId=${encodeURIComponent(guildId)}`,{headers:{"X-BalticM-Service-Secret":env.BALTICM_VOICE_SERVICE_SECRET||"","Accept":"application/json"},cf:{cacheTtl:0}});
  if(vr.ok){const v=await vr.json();rooms=Array.isArray(v.rooms)?v.rooms:[];live={activeRooms:Number(v.activeRooms)||rooms.length,owners:Number(v.owners)||0,status:v.status||"online"}}
 }catch{}
 return json({config:{enabled:stored?.enabled!==false,profiles:hydrated},rooms,live});
}
async function saveVoiceCreate(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const input=Array.isArray(body.profiles)?body.profiles:[];if(!input.length)return json({error:"Add at least one Voice Create configuration"},400);
 const cr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});if(!cr.ok)return json({error:"Discord channels request failed"},502);const channels=await cr.json(),seen=new Set(),profiles=[];
 for(const raw of input){const categoryId=String(raw.categoryId||""),createChannelId=String(raw.createChannelId||"");if(!categoryId||!createChannelId)return json({error:"Every setup needs a Category and Create Voice channel"},400);if(seen.has(createChannelId))return json({error:"The same Create Voice channel cannot be used twice"},400);seen.add(createChannelId);const cat=channels.find(c=>c.id===categoryId&&c.type===4),vc=channels.find(c=>c.id===createChannelId&&c.type===2);if(!cat||!vc)return json({error:"Selected category or voice channel was not found"},400);profiles.push({id:String(raw.id||crypto.randomUUID()),categoryId,createChannelId,nameTemplate:String(raw.nameTemplate||"{username} Room").slice(0,80),userLimit:Math.max(0,Math.min(99,Number(raw.userLimit)||0)),privateByDefault:!!raw.privateByDefault})}
 const config={enabled:body.enabled!==false,profiles,updatedAt:new Date().toISOString()};try{await setVoiceConfig(env,guildId,config)}catch(e){return json({error:String(e.message||e)},503)}
 return json({config:{...config,profiles:profiles.map(p=>({...p,createChannelName:channels.find(c=>c.id===p.createChannelId)?.name||"Create Voice",categoryName:channels.find(c=>c.id===p.categoryId)?.name||"Category"}))}});
}
async function voiceRoomAction(req,env,guildId,roomId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}const stored=await getVoiceConfig(env,guildId),profiles=normalizeVoiceProfiles(stored);if(!profiles.length)return json({error:"Voice Create is not configured"},404);
 const r=await fetch(`https://discord.com/api/v10/channels/${roomId}`,{headers:botHeaders(env)});if(!r.ok)return json({error:"Room not found"},404);const room=await r.json(),managedCats=new Set(profiles.map(p=>p.categoryId)),createIds=new Set(profiles.map(p=>p.createChannelId));if(room.guild_id!==guildId||!managedCats.has(room.parent_id)||createIds.has(room.id)||!String(room.topic||"").startsWith("balticm-voice:"))return json({error:"This is not a managed temporary room"},403);
 const action=String(body.action||"");if(action==="delete"){const d=await fetch(`https://discord.com/api/v10/channels/${roomId}`,{method:"DELETE",headers:botHeaders(env)});return d.ok?json({ok:true}):json({error:"Room deletion failed"},502)}
 const patch={};if(action==="rename"){const name=String(body.name||"").trim().slice(0,100);if(!name)return json({error:"Room name is required"},400);patch.name=name}else if(action==="limit")patch.user_limit=Math.max(0,Math.min(99,Number(body.limit)||0));else if(action==="transfer"){const ownerId=String(body.ownerId||"").trim();if(!/^\\d{16,22}$/.test(ownerId))return json({error:"Invalid Discord user ID"},400);const old=String(room.topic||"").split(":");patch.topic="balticm-voice:"+ownerId+":"+(old.slice(2).join(":")||"")}else if(action==="lock"||action==="unlock"){const everyone=guildId,overwrites=Array.isArray(room.permission_overwrites)?room.permission_overwrites.filter(x=>x.id!==everyone):[];overwrites.push({id:everyone,type:0,allow:action==="unlock"?"1048576":"0",deny:action==="lock"?"1048576":"0"});patch.permission_overwrites=overwrites}else return json({error:"Unknown room action"},400);
 const pr=await fetch(`https://discord.com/api/v10/channels/${roomId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify(patch)});const data=await pr.json().catch(()=>({}));return pr.ok?json({ok:true,room:data}):json({error:data.message||"Room update failed",status:pr.status},502);
}


const ticketTablesSql=[
`CREATE TABLE IF NOT EXISTS tickets (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 channel_id TEXT NOT NULL,
 opener_id TEXT NOT NULL,
 opener_name TEXT NOT NULL,
 subject TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 assigned_id TEXT,
 assigned_name TEXT,
 created_at TEXT NOT NULL,
 closed_at TEXT,
 closed_by_id TEXT,
 closed_by_name TEXT
)`,
`CREATE TABLE IF NOT EXISTS ticket_messages (
 id TEXT PRIMARY KEY,
 ticket_id TEXT NOT NULL,
 guild_id TEXT NOT NULL,
 author_id TEXT NOT NULL,
 author_name TEXT NOT NULL,
 content TEXT NOT NULL,
 created_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS ticket_config (
 guild_id TEXT PRIMARY KEY,
 category_id TEXT,
 staff_role_id TEXT,
 panel_channel_id TEXT,
 panel_message_id TEXT,
 updated_at TEXT NOT NULL
)`
,
`CREATE TABLE IF NOT EXISTS ticket_types (
 guild_id TEXT NOT NULL,
 type_key TEXT NOT NULL,
 category_id TEXT,
 staff_role_id TEXT,
 panel_channel_id TEXT,
 panel_message_id TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (guild_id,type_key)
)`];
async function ensureTicketTables(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 for(const sql of ticketTablesSql)await env.BALTICM_DB.prepare(sql).run();
}
async function ticketTypeConfig(env,guildId,typeKey){
 await ensureTicketTables(env);
 const row=await env.BALTICM_DB.prepare("SELECT category_id AS categoryId,staff_role_id AS staffRoleId,panel_channel_id AS panelChannelId,panel_message_id AS panelMessageId FROM ticket_types WHERE guild_id=? AND type_key=?").bind(guildId,typeKey).first();
 if(row)return row;
 if(typeKey==="support"){
  const legacy=await env.BALTICM_DB.prepare("SELECT category_id AS categoryId,staff_role_id AS staffRoleId,panel_channel_id AS panelChannelId,panel_message_id AS panelMessageId FROM ticket_config WHERE guild_id=?").bind(guildId).first();
  if(legacy)return legacy;
 }
 return {categoryId:"",staffRoleId:"",panelChannelId:"",panelMessageId:""};
}
async function ticketTypesState(env,guildId){
 return json({support:await ticketTypeConfig(env,guildId,"support"),report:await ticketTypeConfig(env,guildId,"report")});
}
async function saveTicketType(req,env,guildId,typeKey){
 if(!["support","report"].includes(typeKey))return json({error:"Invalid ticket type"},400);
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const categoryId=String(body.categoryId||"").trim(),staffRoleId=String(body.staffRoleId||"").trim(),panelChannelId=String(body.panelChannelId||"").trim();
 for(const [label,id] of [["category",categoryId],["staff role",staffRoleId],["panel channel",panelChannelId]])if(id&&!/^\d{16,22}$/.test(id))return json({error:`Invalid ${label}`},400);
 await ensureTicketTables(env);
 await env.BALTICM_DB.prepare("INSERT INTO ticket_types (guild_id,type_key,category_id,staff_role_id,panel_channel_id,panel_message_id,updated_at) VALUES (?,?,?,?,?,NULL,?) ON CONFLICT(guild_id,type_key) DO UPDATE SET category_id=excluded.category_id,staff_role_id=excluded.staff_role_id,panel_channel_id=excluded.panel_channel_id,updated_at=excluded.updated_at").bind(guildId,typeKey,categoryId||null,staffRoleId||null,panelChannelId||null,new Date().toISOString()).run();
 return json({ok:true,config:await ticketTypeConfig(env,guildId,typeKey)});
}
async function publishTicketTypePanel(env,guildId,typeKey){
 if(!["support","report"].includes(typeKey))return json({error:"Invalid ticket type"},400);
 const cfg=await ticketTypeConfig(env,guildId,typeKey);
 if(!cfg?.panelChannelId)return json({error:"Select a panel channel first"},400);
 const gr=await fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)}),guild=gr.ok?await gr.json():null;
 const isReport=typeKey==="report";
 const embed=isReport?{author:{name:guild?.name||"Report Center",icon_url:guild?.icon?`https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png`:undefined},title:"🚨 Report a Player",description:"Report a player privately to the server staff.\n\n**Please include**\n> 👤 Player name / ID\n> 📋 What happened and when\n> 🖼️ Screenshots, video or other evidence\n> 🎮 Relevant server / game information\n\n*Reports are private and only visible to you and the staff team.*",color:0xe34d59,footer:{text:"Powered by BalticM.eu • PLAY TOGETHER"}}:{author:{name:guild?.name||"Support Center",icon_url:guild?.icon?`https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png`:undefined},title:"Support Center",description:"Need assistance? Create a **private ticket** and our staff will help you.\n\n**Before opening a ticket**\n> 📝 Explain your issue clearly\n> 🔁 Please do not create duplicate tickets\n> 🕐 A staff member will respond as soon as possible\n\n*Your ticket will only be visible to you and the support team.*",color:0x7457ff,footer:{text:"Powered by BalticM.eu • PLAY TOGETHER"}};
 const payload={embeds:[embed],components:[{type:1,components:[{type:2,style:isReport?4:1,label:isReport?"Report a Player":"Open a Ticket",emoji:{name:isReport?"🚨":"🎫"},custom_id:`ticket_create:${guildId}:${typeKey}`}]}]};
 const pr=await fetch(`https://discord.com/api/v10/channels/${cfg.panelChannelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)}),data=await pr.json().catch(()=>({}));
 if(!pr.ok)return json({error:data.message||"Could not publish ticket panel",status:pr.status},502);
 await env.BALTICM_DB.prepare("UPDATE ticket_types SET panel_message_id=?,updated_at=? WHERE guild_id=? AND type_key=?").bind(data.id,new Date().toISOString(),guildId,typeKey).run();
 return json({ok:true,messageId:data.id,type:typeKey});
}
async function ticketConfigState(env,guildId){
 await ensureTicketTables(env);
 const config=await env.BALTICM_DB.prepare("SELECT category_id AS categoryId,staff_role_id AS staffRoleId,panel_channel_id AS panelChannelId,panel_message_id AS panelMessageId,updated_at AS updatedAt FROM ticket_config WHERE guild_id=?").bind(guildId).first();
 return json({config:config||{categoryId:"",staffRoleId:"",panelChannelId:"",panelMessageId:""}});
}
async function saveTicketConfig(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const categoryId=String(body.categoryId||"").trim(),staffRoleId=String(body.staffRoleId||"").trim(),panelChannelId=String(body.panelChannelId||"").trim();
 for(const [label,id] of [["category",categoryId],["staff role",staffRoleId],["panel channel",panelChannelId]])if(id&&!/^\d{16,22}$/.test(id))return json({error:`Invalid ${label}`},400);
 await ensureTicketTables(env);
 await env.BALTICM_DB.prepare("INSERT INTO ticket_config (guild_id,category_id,staff_role_id,panel_channel_id,panel_message_id,updated_at) VALUES (?,?,?,?,NULL,?) ON CONFLICT(guild_id) DO UPDATE SET category_id=excluded.category_id,staff_role_id=excluded.staff_role_id,panel_channel_id=excluded.panel_channel_id,updated_at=excluded.updated_at").bind(guildId,categoryId||null,staffRoleId||null,panelChannelId||null,new Date().toISOString()).run();
 return ticketConfigState(env,guildId);
}
async function publishTicketPanel(env,guildId){
 await ensureTicketTables(env);
 const cfg=await env.BALTICM_DB.prepare("SELECT panel_channel_id AS panelChannelId FROM ticket_config WHERE guild_id=?").bind(guildId).first();
 if(!cfg?.panelChannelId)return json({error:"Select a panel channel first"},400);
 const gr=await fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)}),guild=gr.ok?await gr.json():null;
 const payload={embeds:[{author:{name:guild?.name||"Support Center",icon_url:guild?.icon?`https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png`:undefined},title:"Support Center",description:"Need assistance? Create a **private ticket** and our staff will help you.\n\n**Before opening a ticket**\n> 📝 Explain your issue clearly\n> 🔁 Please do not create duplicate tickets\n> 🕐 A staff member will respond as soon as possible\n\n*Your ticket will only be visible to you and the support team.*",color:0x7457ff,footer:{text:"Powered by BalticM.eu • PLAY TOGETHER"}}],components:[{type:1,components:[{type:2,style:1,label:"Open a Ticket",emoji:{name:"🎫"},custom_id:`ticket_create:${guildId}`}]}]};
 const pr=await fetch(`https://discord.com/api/v10/channels/${cfg.panelChannelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 const data=await pr.json().catch(()=>({}));if(!pr.ok)return json({error:data.message||"Could not publish ticket panel",status:pr.status},502);
 await env.BALTICM_DB.prepare("UPDATE ticket_config SET panel_message_id=?,updated_at=? WHERE guild_id=?").bind(data.id,new Date().toISOString(),guildId).run();
 return json({ok:true,messageId:data.id,guildName:guild?.name||guildId});
}
async function createTicketFromInteraction(env,interaction,guildId,typeKey="support"){
 await ensureTicketTables(env);
 const user=interaction?.member?.user||interaction?.user,userId=String(user?.id||""),username=String(interaction?.member?.nick||user?.global_name||user?.username||"member");
 if(!userId)return json({type:4,data:{content:"Could not identify your Discord account.",flags:64}});
 const subject=typeKey==="report"?"Player report":"Support ticket";
 const existing=await env.BALTICM_DB.prepare("SELECT channel_id AS channelId FROM tickets WHERE guild_id=? AND opener_id=? AND subject=? AND status='open' ORDER BY created_at DESC LIMIT 1").bind(guildId,userId,subject).first();
 if(existing?.channelId)return json({type:4,data:{content:`You already have an open ticket: <#${existing.channelId}>`,flags:64}});
 const cfg=await ticketTypeConfig(env,guildId,typeKey);
 const safe=username.toLowerCase().replace(/[^a-z0-9]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,55)||"member";
 const overwrites=[{id:guildId,type:0,deny:"1024",allow:"0"},{id:userId,type:1,allow:"68608",deny:"0"}];
 if(cfg?.staffRoleId)overwrites.push({id:cfg.staffRoleId,type:0,allow:"68608",deny:"0"});
 const payload={name:`${typeKey==="report"?"report":"ticket"}-${safe}`,type:0,permission_overwrites:overwrites};
 if(cfg?.categoryId)payload.parent_id=cfg.categoryId;
 const cr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 const ch=await cr.json().catch(()=>({}));if(!cr.ok)return json({type:4,data:{content:"I could not create the ticket channel. Check my channel permissions.",flags:64}});
 const id=crypto.randomUUID(),createdAt=new Date().toISOString();
 await env.BALTICM_DB.prepare("INSERT INTO tickets (id,guild_id,channel_id,opener_id,opener_name,subject,status,created_at) VALUES (?,?,?,?,?,?,'open',?)").bind(id,guildId,ch.id,userId,username,subject,createdAt).run();
 const welcome=typeKey==="report"?{content:`<@${userId}>`,embeds:[{title:"🚨 Player report opened",description:"Thanks. Your report is private and has been sent to the staff team.\n\n**Please provide the following**\n> 👤 Player name / ID\n> 🎮 Server or game\n> 📝 What happened and when\n> 🖼️ Screenshots, clips or other evidence\n\n*Do not contact or provoke the reported player while staff reviews the report.*",color:0xe34d59,footer:{text:"Player report • Private conversation"}}],components:[{type:1,components:[{type:2,style:4,label:"Close Report",emoji:{name:"🔒"},custom_id:`ticket_close:${id}`}]}],allowed_mentions:{users:[userId]}}:{content:`<@${userId}>`,embeds:[{title:"🎫 Support request opened",description:"Thanks for contacting our support team.\n\n**Tell us what you need help with**\n> 📝 Describe the issue in as much detail as possible\n> 🖼️ Add screenshots or other useful information if needed\n> 🕐 A staff member will reply as soon as possible\n\n*Please keep this channel open until your issue has been resolved.*",color:0x7457ff,footer:{text:"Support ticket • Private conversation"}}],components:[{type:1,components:[{type:2,style:4,label:"Close Ticket",emoji:{name:"🔒"},custom_id:`ticket_close:${id}`}]}],allowed_mentions:{users:[userId]}};
 await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(welcome)}).catch(()=>null);
 return json({type:4,data:{content:`✅ Your ticket has been created: <#${ch.id}>`,flags:64}});
}
async function closeTicketFromInteraction(env,interaction,ticketId){
 await ensureTicketTables(env);
 const guildId=String(interaction?.guild_id||"");
 const row=await env.BALTICM_DB.prepare("SELECT channel_id AS channelId,opener_id AS openerId,opener_name AS openerName,status FROM tickets WHERE id=? AND guild_id=?").bind(ticketId,guildId).first();
 if(!row)return json({type:4,data:{content:"Ticket not found.",flags:64}});
 if(row.status==="closed")return json({type:4,data:{content:"This ticket is already closed.",flags:64}});
 const user=interaction?.member?.user||interaction?.user,name=interaction?.member?.nick||user?.global_name||user?.username||user?.id||"Discord user",now=new Date().toISOString();
 if(row.channelId)await archiveTicketMessages(env,guildId,ticketId,row.channelId).catch(()=>0);
 await env.BALTICM_DB.prepare("UPDATE tickets SET status='closed',closed_at=?,closed_by_id=?,closed_by_name=? WHERE id=? AND guild_id=?").bind(now,String(user?.id||""),String(name),ticketId,guildId).run();
 if(row.channelId){
  const safe=(`closed-${row.openerName||"ticket"}`).toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").slice(0,90);
  await fetch(`https://discord.com/api/v10/channels/${row.channelId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify({name:safe,permission_overwrites:[{id:guildId,type:0,deny:"1024",allow:"0"},{id:row.openerId,type:1,deny:"2048",allow:"66560"}]})}).catch(()=>null);
  await postTicketTranscript(env,guildId,ticketId,row.channelId).catch(()=>false);
 }
 return json({type:7,data:{content:`🔒 Ticket closed by <@${user?.id}>. Transcript saved and attached below.\nStaff can reopen or delete the channel from the Control Center.`,components:[],allowed_mentions:{parse:[]} }});
}
async function ticketsState(env,guildId){
 try{
  await ensureTicketTables(env);
  const rows=await env.BALTICM_DB.prepare("SELECT id,channel_id AS channelId,opener_id AS openerId,opener_name AS openerName,subject,status,assigned_id AS assignedId,assigned_name AS assignedName,created_at AS createdAt,closed_at AS closedAt,closed_by_id AS closedById,closed_by_name AS closedByName FROM tickets WHERE guild_id=? ORDER BY created_at DESC LIMIT 200").bind(guildId).all();
  const tickets=rows.results||[],stats={open:0,waiting:0,assigned:0,closed:0};
  for(const t of tickets){if(t.status==="closed")stats.closed++;else{stats.open++;if(t.assignedId)stats.assigned++;else stats.waiting++;}}
  return json({tickets,stats});
 }catch(e){return json({error:String(e.message||e)},503)}
}
async function fetchTicketChannelMessages(env,channelId){
 const all=[];let before="";
 for(let page=0;page<10;page++){
  const url=new URL(`https://discord.com/api/v10/channels/${channelId}/messages`);url.searchParams.set("limit","100");if(before)url.searchParams.set("before",before);
  const r=await fetch(url,{headers:botHeaders(env)});if(!r.ok)break;
  const batch=await r.json();if(!Array.isArray(batch)||!batch.length)break;
  all.push(...batch);before=batch[batch.length-1].id;if(batch.length<100)break;
 }
 return all.reverse();
}
async function archiveTicketMessages(env,guildId,ticketId,channelId){
 const messages=await fetchTicketChannelMessages(env,channelId);
 await env.BALTICM_DB.prepare("DELETE FROM ticket_messages WHERE ticket_id=? AND guild_id=?").bind(ticketId,guildId).run();
 for(const m of messages){
  const content=[String(m.content||""),...(m.attachments||[]).map(a=>a.url),...(m.embeds||[]).map(e=>e.title||e.description||"").filter(Boolean)].filter(Boolean).join("\n").slice(0,8000);
  if(!content)continue;
  const authorName=m.member?.nick||m.author?.global_name||m.author?.username||m.author?.id||"Unknown";
  await env.BALTICM_DB.prepare("INSERT OR REPLACE INTO ticket_messages (id,ticket_id,guild_id,author_id,author_name,content,created_at) VALUES (?,?,?,?,?,?,?)").bind(String(m.id),ticketId,guildId,String(m.author?.id||""),String(authorName),content,String(m.timestamp||new Date().toISOString())).run();
 }
 return messages.length;
}
async function postTicketTranscript(env,guildId,ticketId,channelId){
 const rows=await env.BALTICM_DB.prepare("SELECT author_name AS authorName,content,created_at AS createdAt FROM ticket_messages WHERE ticket_id=? AND guild_id=? ORDER BY created_at ASC").bind(ticketId,guildId).all();
 const lines=[`Ticket transcript • ${ticketId}`,"",...(rows.results||[]).flatMap(m=>[`[${new Date(m.createdAt).toISOString()}] ${m.authorName}:`,String(m.content||"").replace(/\\n/g,"\n"),""])];
 const text=lines.join("\n"),form=new FormData();
 form.append("payload_json",JSON.stringify({content:"📄 **Ticket transcript**\nA copy of this conversation is attached below."}));
 form.append("files[0]",new Blob([text],{type:"text/plain;charset=utf-8"}),`ticket-${ticketId}.txt`);
 const r=await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`,{method:"POST",headers:{Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`},body:form});
 return r.ok;
}
async function ticketAction(req,env,user,guildId,ticketId){
 let body={};try{body=await req.json()}catch{}
 const action=String(body.action||"").toLowerCase();
 await ensureTicketTables(env);
 const row=await env.BALTICM_DB.prepare("SELECT id,channel_id AS channelId,opener_id AS openerId,opener_name AS openerName,subject,status,assigned_id AS assignedId,assigned_name AS assignedName,created_at AS createdAt,closed_at AS closedAt FROM tickets WHERE id=? AND guild_id=?").bind(ticketId,guildId).first();
 if(!row)return json({error:"Ticket not found"},404);
 const now=new Date().toISOString(),staffName=user.global_name||user.username||user.id;
 if(action==="assign"){
  await env.BALTICM_DB.prepare("UPDATE tickets SET assigned_id=?,assigned_name=? WHERE id=? AND guild_id=?").bind(user.id,staffName,ticketId,guildId).run();
  if(row.channelId){
   const assigned={embeds:[{title:"👤 Ticket assigned",description:`**${staffName}** has taken this support ticket.\n\n**Status:** 🟣 Assigned\nA staff member is now handling your request.`,color:0x7457ff,footer:{text:"Support ticket • Assigned"}}]};
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(assigned)}).catch(()=>null);
  }
  return json({ok:true,action,assignedId:user.id,assignedName:staffName});
 }
 if(action==="unassign"){
  await env.BALTICM_DB.prepare("UPDATE tickets SET assigned_id=NULL,assigned_name=NULL WHERE id=? AND guild_id=?").bind(ticketId,guildId).run();
  if(row.channelId){
   const unassigned={embeds:[{title:"↩️ Ticket unassigned",description:`**${staffName}** released this support ticket.\n\n**Status:** 🟡 Waiting\nThe ticket is available for another staff member.`,color:0xe2ad42,footer:{text:"Support ticket • Waiting"}}]};
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(unassigned)}).catch(()=>null);
  }
  return json({ok:true,action});
 }
 if(action==="close"){
  let archived=0;if(row.channelId)archived=await archiveTicketMessages(env,guildId,ticketId,row.channelId).catch(()=>0);
  await env.BALTICM_DB.prepare("UPDATE tickets SET status='closed',closed_at=?,closed_by_id=?,closed_by_name=? WHERE id=? AND guild_id=?").bind(now,user.id,staffName,ticketId,guildId).run();
  if(row.channelId){
   const safe=(`closed-${row.openerName||"ticket"}`).toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").slice(0,90);
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify({name:safe,permission_overwrites:[{id:guildId,type:0,deny:"1024",allow:"0"},{id:row.openerId,type:1,deny:"2048",allow:"66560"}]})}).catch(()=>null);
   const closed={embeds:[{title:"🔒 Ticket closed",description:`Closed by **${staffName}**\n\n**Status:** 🔴 Closed\n📄 Transcript saved\n\n*Staff can reopen this ticket if further assistance is needed.*`,color:0xe34d59,footer:{text:"Support ticket • Closed"}}]};
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(closed)}).catch(()=>null);
   await postTicketTranscript(env,guildId,ticketId,row.channelId).catch(()=>false);
  }
  return json({ok:true,action,archived});
 }
 if(action==="reopen"){
  const cfg=await env.BALTICM_DB.prepare("SELECT staff_role_id AS staffRoleId FROM ticket_config WHERE guild_id=?").bind(guildId).first();
  await env.BALTICM_DB.prepare("UPDATE tickets SET status='open',closed_at=NULL,closed_by_id=NULL,closed_by_name=NULL WHERE id=? AND guild_id=?").bind(ticketId,guildId).run();
  if(row.channelId){
   const safe=(`ticket-${row.openerName||"member"}`).toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").slice(0,90),overwrites=[{id:guildId,type:0,deny:"1024",allow:"0"},{id:row.openerId,type:1,allow:"68608",deny:"0"}];
   if(cfg?.staffRoleId)overwrites.push({id:cfg.staffRoleId,type:0,allow:"68608",deny:"0"});
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify({name:safe,permission_overwrites:overwrites})}).catch(()=>null);
   const reopened={embeds:[{title:"🔓 Ticket reopened",description:`Reopened by **${staffName}**\n\n**Status:** 🟢 Open\nYou can continue the conversation below.`,color:0x57d39b,footer:{text:"Support ticket • Reopened"}}],components:[{type:1,components:[{type:2,style:4,label:"Close Ticket",emoji:{name:"🔒"},custom_id:`ticket_close:${ticketId}`}]}]};
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(reopened)}).catch(()=>null);
  }
  return json({ok:true,action});
 }
 if(action==="transcript"){
  if(row.status!=="closed"&&row.channelId)await archiveTicketMessages(env,guildId,ticketId,row.channelId).catch(()=>0);
  const messages=await env.BALTICM_DB.prepare("SELECT author_name AS authorName,content,created_at AS createdAt FROM ticket_messages WHERE ticket_id=? AND guild_id=? ORDER BY created_at ASC").bind(ticketId,guildId).all();
  return json({ticket:row,messages:messages.results||[]});
 }
 if(action==="delete"){
  if(row.status!=="closed")return json({error:"Close the ticket before deleting it"},400);
  if(row.channelId){
   const dr=await fetch(`https://discord.com/api/v10/channels/${row.channelId}`,{method:"DELETE",headers:botHeaders(env)});
   if(!dr.ok&&dr.status!==404)return json({error:"Could not delete Discord ticket channel"},502);
  }
  await env.BALTICM_DB.prepare("DELETE FROM ticket_messages WHERE ticket_id=? AND guild_id=?").bind(ticketId,guildId).run();
  await env.BALTICM_DB.prepare("DELETE FROM tickets WHERE id=? AND guild_id=?").bind(ticketId,guildId).run();
  return json({ok:true,action,purged:true});
 }
 return json({error:"Unknown ticket action"},400);
}


const moderationTableSql=`CREATE TABLE IF NOT EXISTS moderation_actions (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 member_id TEXT NOT NULL,
 member_name TEXT NOT NULL,
 moderator_id TEXT NOT NULL,
 moderator_name TEXT NOT NULL,
 action TEXT NOT NULL,
 reason TEXT NOT NULL,
 duration_minutes INTEGER,
 created_at TEXT NOT NULL
)`;
async function ensureModerationTable(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare(moderationTableSql).run();
}
async function moderationState(env,guildId){
 try{
  await ensureModerationTable(env);
  const rows=await env.BALTICM_DB.prepare("SELECT id,member_id AS memberId,member_name AS memberName,moderator_id AS moderatorId,moderator_name AS moderatorName,action,reason,duration_minutes AS durationMinutes,created_at AS createdAt FROM moderation_actions WHERE guild_id = ? ORDER BY created_at DESC LIMIT 100").bind(guildId).all();
  const actions=(rows.results||[]).filter(a=>a.action!=="removed");
  const stats={warnings:0,timeouts:0,kicks:0,bans:0};
  for(const a of actions){if(a.action==="warn")stats.warnings++;else if(a.action==="timeout")stats.timeouts++;else if(a.action==="kick")stats.kicks++;else if(a.action==="ban")stats.bans++;}
  return json({actions,stats});
 }catch(e){return json({error:String(e.message||e)},503)}
}
const moderationSettingsSql=`CREATE TABLE IF NOT EXISTS moderation_settings (
 guild_id TEXT PRIMARY KEY,
 mod_log_channel_id TEXT NOT NULL DEFAULT ''
)`;
async function ensureModerationSettingsTable(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare(moderationSettingsSql).run();
}
async function moderationSettingsState(env,guildId){
 try{
  await ensureModerationSettingsTable(env);
  const row=await env.BALTICM_DB.prepare("SELECT mod_log_channel_id AS modLogChannelId FROM moderation_settings WHERE guild_id=?").bind(guildId).first();
  return json({config:{modLogChannelId:row?.modLogChannelId||""}});
 }catch(e){return json({error:String(e.message||e)},503)}
}
async function saveModerationSettings(req,env,guildId){
 try{
  const body=await req.json().catch(()=>({})),modLogChannelId=String(body.modLogChannelId||"").trim();
  if(modLogChannelId&&!/^\d{16,22}$/.test(modLogChannelId))return json({error:"Invalid mod log channel"},400);
  if(modLogChannelId){
   const r=await fetch(`https://discord.com/api/v10/channels/${modLogChannelId}`,{headers:botHeaders(env)});
   if(!r.ok)return json({error:"Could not access selected channel"},400);
   const ch=await r.json();
   if(String(ch.guild_id||"")!==String(guildId)||ch.type!==0)return json({error:"Select a text channel from this Discord server"},400);
  }
  await ensureModerationSettingsTable(env);
  await env.BALTICM_DB.prepare("INSERT INTO moderation_settings (guild_id,mod_log_channel_id) VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET mod_log_channel_id=excluded.mod_log_channel_id").bind(guildId,modLogChannelId).run();
  return json({ok:true,config:{modLogChannelId}});
 }catch(e){return json({error:String(e.message||e)},503)}
}
async function discordDm(env,userId,content){
 const cr=await fetch("https://discord.com/api/v10/users/@me/channels",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify({recipient_id:userId})});
 if(!cr.ok)return false;
 const ch=await cr.json();
 const mr=await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify({content})});
 return mr.ok;
}
async function findModLogChannel(env,guildId){
 await ensureModerationSettingsTable(env);
 const cfg=await env.BALTICM_DB.prepare("SELECT mod_log_channel_id AS modLogChannelId FROM moderation_settings WHERE guild_id=?").bind(guildId).first();
 if(cfg?.modLogChannelId)return {id:cfg.modLogChannelId};
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});
 if(!r.ok)return null;
 const channels=await r.json();
 const names=["mod-logs","moderation-logs","mod-log","logs"];
 return channels.find(c=>c.type===0&&names.includes(String(c.name||"").toLowerCase()))||null;
}
async function sendModLog(env,guildId,entry){
 const ch=await findModLogChannel(env,guildId);if(!ch)return false;
 const meta={
  warn:{title:"⚠️ Member warned",color:0xf1c40f,status:"Warning issued"},
  timeout:{title:"⏳ Member timed out",color:0xf39c12,status:"Timeout active"},
  kick:{title:"👢 Member kicked",color:0xe67e22,status:"Removed from server"},
  ban:{title:"🔨 Member banned",color:0xe74c3c,status:"Banned from server"},
  removed:{title:"✅ Moderation action removed",color:0x2ecc71,status:"Action cleared"}
 }[entry.action]||{title:"🛡️ Moderation action",color:0x7457ff,status:String(entry.action||"Updated")};
 const description=[
  `🟣 **Member**\n<@${entry.memberId}>`,
  `🔵 **Moderator**\n<@${entry.moderatorId}>`,
  `🟢 **Status**\n${meta.status}`,
  entry.durationMinutes?`🟠 **Duration**\n${entry.durationMinutes} minutes`:null,
  `🟡 **Reason**\n${String(entry.reason||"No reason provided").slice(0,1000)}`
 ].filter(Boolean).join("\n\n");
 const payload={embeds:[{
  title:meta.title,
  description,
  color:meta.color,
  footer:{text:"Moderation log • Control Center"},
  timestamp:entry.createdAt||new Date().toISOString()
 }],allowed_mentions:{parse:[]}};
 const r=await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 return r.ok;
}
async function removeModerationAction(env,user,guildId,id){
 await ensureModerationTable(env);
 const row=await env.BALTICM_DB.prepare("SELECT id,member_id AS memberId,member_name AS memberName,action,reason,duration_minutes AS durationMinutes FROM moderation_actions WHERE id=? AND guild_id=?").bind(id,guildId).first();
 if(!row)return json({error:"Moderation action not found"},404);
 if(row.action==="timeout"){
  const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${row.memberId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify({communication_disabled_until:null})});
  if(!r.ok&&r.status!==404)return json({error:"Could not remove Discord timeout"},502);
 }else if(row.action==="ban"){
  const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/bans/${row.memberId}`,{method:"DELETE",headers:{...botHeaders(env),"X-Audit-Log-Reason":encodeURIComponent("Removed from BalticM Control Center")}});
  if(!r.ok&&r.status!==404)return json({error:"Could not remove Discord ban"},502);
 }
 await env.BALTICM_DB.prepare("DELETE FROM moderation_actions WHERE id=? AND guild_id=?").bind(id,guildId).run();
 const moderatorName=user.global_name||user.username||user.id,createdAt=new Date().toISOString();
 await discordDm(env,row.memberId,`✅ **BalticM Moderation**\nYour **${row.action}** in **Baltic | Mayhem** has been removed.\n**Removed by:** ${moderatorName}`).catch(()=>false);
 await sendModLog(env,guildId,{action:"removed",memberId:row.memberId,memberName:row.memberName,moderatorId:user.id,moderatorName,reason:`Removed previous ${row.action}: ${row.reason}`,createdAt}).catch(()=>false);
 return json({ok:true,removedId:id,removedAction:row.action});
}
async function moderateMember(req,env,user,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const memberId=String(body.memberId||"").trim(),action=String(body.action||"").toLowerCase(),reason=String(body.reason||"").trim().slice(0,500);
 if(!/^\d{16,22}$/.test(memberId))return json({error:"Select a valid Discord member"},400);
 if(!["warn","timeout","kick","ban"].includes(action))return json({error:"Unknown moderation action"},400);
 if(!reason)return json({error:"A reason is required"},400);
 let durationMinutes=null;if(action==="timeout")durationMinutes=Math.max(1,Math.min(40320,Number(body.durationMinutes)||10));
 const h=botHeaders(env,true);
 const mr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,{headers:botHeaders(env)});
 if(!mr.ok)return json({error:"Discord member was not found",status:mr.status},mr.status===404?404:502);
 const member=await mr.json(),memberName=member.nick||member.user?.global_name||member.user?.username||memberId;
 const moderatorName=user.global_name||user.username||user.id;
 const guildName=(await fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)}).then(x=>x.ok?x.json():null).catch(()=>null))?.name||"Baltic | Mayhem";
 const actionText=action==="warn"?"a warning":action==="timeout"?`a timeout for ${durationMinutes} minutes`:action==="kick"?"a kick":"a ban";
 const dmText=`⚠️ **BalticM Moderation**\nYou received **${actionText}** in **${guildName}**.\n**Reason:** ${reason}\n**Moderator:** ${moderatorName}`;
 // Kick/ban remove the shared guild relationship, so notify before the destructive action.
 let dm=false;
 if(action==="kick"||action==="ban")dm=await discordDm(env,memberId,dmText).catch(()=>false);
 let r=null;
 if(action==="timeout"){const until=new Date(Date.now()+durationMinutes*60000).toISOString();r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,{method:"PATCH",headers:h,body:JSON.stringify({communication_disabled_until:until})});}
 else if(action==="kick")r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,{method:"DELETE",headers:{...botHeaders(env),"X-Audit-Log-Reason":encodeURIComponent(reason)}});
 else if(action==="ban")r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/bans/${memberId}`,{method:"PUT",headers:{...h,"X-Audit-Log-Reason":encodeURIComponent(reason)},body:JSON.stringify({delete_message_seconds:0})});
 if(r&&!r.ok){const data=await r.json().catch(()=>({}));return json({error:data.message||("Discord "+action+" failed"),status:r.status},r.status===403?403:502)}
 if(action==="warn"||action==="timeout")dm=await discordDm(env,memberId,dmText).catch(()=>false);
 try{
  await ensureModerationTable(env);
  const id=crypto.randomUUID(),createdAt=new Date().toISOString();
  const entry={id,memberId,memberName,moderatorId:user.id,moderatorName,action,reason,durationMinutes,createdAt};
  await env.BALTICM_DB.prepare("INSERT INTO moderation_actions (id,guild_id,member_id,member_name,moderator_id,moderator_name,action,reason,duration_minutes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,guildId,memberId,memberName,user.id,moderatorName,action,reason,durationMinutes,createdAt).run();
  const modLog=await sendModLog(env,guildId,entry).catch(()=>false);
  return json({ok:true,entry,dmSent:dm,modLogSent:modLog});
 }catch(e){return json({error:"Discord action succeeded, but audit log could not be saved",detail:String(e.message||e)},500)}
}

let discordInteractionVerifyKey=null;
let discordInteractionVerifyKeyAt=0;
async function getDiscordInteractionVerifyKey(env){
 if(discordInteractionVerifyKey&&Date.now()-discordInteractionVerifyKeyAt<3600000)return discordInteractionVerifyKey;
 const token=env.DISCORD_BOT_TOKEN;
 if(!token)throw new Error("DISCORD_BOT_TOKEN missing");
 const r=await fetch("https://discord.com/api/v10/oauth2/applications/@me",{headers:{Authorization:"Bot "+token,"User-Agent":"BalticM.eu Interaction Gateway"}});
 if(!r.ok)throw new Error("Discord application lookup failed: "+r.status);
 const app=await r.json(),hex=String(app.verify_key||"");
 if(!/^[0-9a-f]{64}$/i.test(hex))throw new Error("Discord verify_key missing");
 const raw=new Uint8Array(hex.match(/../g).map(x=>parseInt(x,16)));
 discordInteractionVerifyKey=await crypto.subtle.importKey("raw",raw,{name:"Ed25519"},false,["verify"]);
 discordInteractionVerifyKeyAt=Date.now();
 return discordInteractionVerifyKey;
}
async function verifyDiscordInteraction(req,raw,env){
 const sig=req.headers.get("x-signature-ed25519")||"",ts=req.headers.get("x-signature-timestamp")||"";
 if(!/^[0-9a-f]{128}$/i.test(sig)||!/^\d{10,12}$/.test(ts))return false;
 const key=await getDiscordInteractionVerifyKey(env);
 const signature=new Uint8Array(sig.match(/../g).map(x=>parseInt(x,16)));
 const message=new Uint8Array(enc.encode(ts).length+raw.length);
 message.set(enc.encode(ts),0);message.set(raw,enc.encode(ts).length);
 return crypto.subtle.verify("Ed25519",key,signature,message);
}
async function discordInteractionGateway(req,env,ctx){
 if(req.method!=="POST")return json({ok:true,service:"BalticM Discord Interaction Gateway",version:"1.0.0"});
 const raw=new Uint8Array(await req.arrayBuffer());
 let valid=false;try{valid=await verifyDiscordInteraction(req,raw,env)}catch(e){return json({error:"Verification unavailable"},503)}
 if(!valid)return json({error:"Invalid request signature"},401);
 let interaction;try{interaction=JSON.parse(dec.decode(raw))}catch{return json({error:"Invalid JSON"},400)}
 if(interaction?.type===1)return json({type:1});
 const customId=String(interaction?.data?.custom_id||"");
 if(interaction?.type===3&&customId.startsWith("ticket_create:")){
 const parts=customId.slice("ticket_create:".length).split(":"),guildId=parts[0],typeKey=parts[1]||"support";
 if(!guildId||guildId!==String(interaction?.guild_id||"")||!["support","report"].includes(typeKey))return json({type:4,data:{content:"Invalid ticket server.",flags:64}});
 try{return await createTicketFromInteraction(env,interaction,guildId,typeKey)}catch(e){return json({type:4,data:{content:"Could not create your ticket. Please contact server staff.",flags:64}})}
}
if(interaction?.type===3&&customId.startsWith("ticket_close:")){
 const ticketId=customId.slice("ticket_close:".length);
 try{return await closeTicketFromInteraction(env,interaction,ticketId)}catch(e){return json({type:4,data:{content:"Could not close this ticket.",flags:64}})}
}
if(interaction?.type===3&&customId.startsWith("dm_unsubscribe:")){
  const guildId=customId.slice("dm_unsubscribe:".length),userId=String(interaction?.user?.id||interaction?.member?.user?.id||"");
  if(guildId&&userId){
   try{await ensureDmOptOutTable(env);await env.BALTICM_DB.prepare("INSERT OR REPLACE INTO dm_opt_outs (guild_id,user_id,opted_out_at) VALUES (?,?,?)").bind(guildId,userId,new Date().toISOString()).run()}catch(e){return json({type:4,data:{content:"Could not update your BalticM news preference. Please try again.",flags:64}})}
   return json({type:7,data:{content:"✅ You are unsubscribed from BalticM news messages. Moderation and essential service messages may still be sent.",components:[]}});
  }
 }
 const headers=new Headers(req.headers);headers.set("content-type","application/json");headers.delete("host");
 ctx.waitUntil(fetch("https://balticm.eu/discord-bot",{method:"POST",headers,body:raw}).catch(()=>{}));
 if(interaction?.type===3)return json({type:6});
 if(interaction?.type===2&&interaction?.data?.name==="play")return json({type:5,data:{flags:64}});
 return json({type:4,data:{content:"BalticM.eu interaction server is online.",flags:64}});
}

export default{async fetch(req,env,ctx){
 const u=new URL(req.url),p=u.pathname;
 if(p==="/api/health")return health();
 if(p==="/api/discord-interactions")return discordInteractionGateway(req,env,ctx);
 if(p==="/api/desktop/latest")return desktopLatest();
 const um=p.match(/^\/api\/desktop\/update\/([^/]+)\/([^/]+)\/([^/]+)$/);if(um)return desktopUpdate(decodeURIComponent(um[1]),decodeURIComponent(um[2]),decodeURIComponent(um[3]));
 if(p==="/api/music/service/config"){const guildId=u.searchParams.get("guildId"),secret=req.headers.get("X-BalticM-Service-Secret")||"";if(!env.BALTICM_MUSIC_SERVICE_SECRET||secret!==env.BALTICM_MUSIC_SERVICE_SECRET)return json({error:"Unauthorized"},401);if(!guildId)return json({error:"guildId is required"},400);const config=await getMusicConfig(env,guildId);return json({config});}
 if(p==="/api/voice-create/service/config"){const guildId=u.searchParams.get("guildId"),secret=req.headers.get("X-BalticM-Service-Secret")||"";if(!env.BALTICM_VOICE_SERVICE_SECRET||secret!==env.BALTICM_VOICE_SERVICE_SECRET)return json({error:"Unauthorized"},401);if(!guildId)return json({error:"guildId is required"},400);const config=await getVoiceConfig(env,guildId);return json({config});}
 if(p==="/api/auth/login")return login(req,env);
 if(p==="/api/auth/callback")return callback(req,env);
 if(p==="/api/auth/logout")return new Response(null,{status:302,headers:{Location:u.origin+"/","Set-Cookie":`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`}});
 if(p==="/api/auth/me"){const user=await session(req,env);return user?json({authenticated:true,user}):json({authenticated:false},401)}
 if(p.startsWith("/api/")){const user=await session(req,env);if(!user)return json({error:"Unauthorized"},401);if(p==="/api/notifications")return json({notifications:await publicNotifications(env)});if(p==="/api/status")return json({ok:true,user:{id:user.id,username:user.username},configured:{discordClientSecret:!!env.DISCORD_CLIENT_SECRET,sessionSecret:!!env.SESSION_SECRET,discordBotToken:!!env.DISCORD_BOT_TOKEN}});if(p==="/api/discord/guild"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return discordGuild(env,guildId);}
if(p==="/api/music/config"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveMusicConfig(req,env,guildId):musicConfigState(env,guildId);}
if(p==="/api/music"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(req.method!=="GET")return json({error:"Method not allowed"},405);return musicProxy(req,env,guildId,"state");}
if(p==="/api/music/connect"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return musicProxy(req,env,guildId,"connect");}
if(p==="/api/music/disconnect"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return musicProxy(req,env,guildId,"disconnect");}
if(p==="/api/voice-create"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveVoiceCreate(req,env,guildId):voiceCreateState(env,guildId);}
const vr=p.match(/^\/api\/voice-create\/rooms\/([^/]+)$/);if(vr&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return voiceRoomAction(req,env,guildId,decodeURIComponent(vr[1]));}
if(p==="/api/tickets"&&req.method==="GET"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return ticketsState(env,guildId);}
if(p==="/api/tickets/types"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return ticketTypesState(env,guildId);}
const ttc=p.match(/^\/api\/tickets\/types\/(support|report)$/);if(ttc&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return saveTicketType(req,env,guildId,ttc[1]);}
const ttp=p.match(/^\/api\/tickets\/types\/(support|report)\/publish$/);if(ttp&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return publishTicketTypePanel(env,guildId,ttp[1]);}
if(p==="/api/tickets/config"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveTicketConfig(req,env,guildId):ticketConfigState(env,guildId);}
if(p==="/api/tickets/publish"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return publishTicketPanel(env,guildId);}
const ta=p.match(/^\/api\/tickets\/([^/]+)$/);if(ta&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return ticketAction(req,env,user,guildId,decodeURIComponent(ta[1]));}
if(p==="/api/moderation/settings"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveModerationSettings(req,env,guildId):moderationSettingsState(env,guildId);}
if(p==="/api/moderation"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?moderateMember(req,env,user,guildId):moderationState(env,guildId);}const ma=p.match(/^\/api\/moderation\/([^/]+)$/);if(ma&&req.method==="DELETE"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return removeModerationAction(env,user,guildId,decodeURIComponent(ma[1]));}
if(p==="/api/direct-messages/opt-outs"&&req.method==="GET"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return dmOptOutState(env,guildId);}
if(p==="/api/direct-messages"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return sendDirectMessages(req,env,guildId);}
if(p==="/api/discord/members"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return discordMembers(env,guildId);}
if(p==="/api/discord/roles"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return createDiscordRole(req,env,guildId);}const er=p.match(/^\/api\/discord\/roles\/([^/]+)$/);if(er&&(req.method==="PATCH"||req.method==="DELETE")){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="DELETE"?deleteDiscordRole(env,guildId,decodeURIComponent(er[1])):editDiscordRole(req,env,guildId,decodeURIComponent(er[1]));}
const rm=p.match(/^\/api\/discord\/members\/([^/]+)\/roles\/([^/]+)$/);if(rm&&(req.method==="PUT"||req.method==="DELETE")){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return changeMemberRole(req,env,guildId,decodeURIComponent(rm[1]),decodeURIComponent(rm[2]),req.method==="DELETE");}
return json({error:"Not found"},404)}
 return env.ASSETS.fetch(req);
}};