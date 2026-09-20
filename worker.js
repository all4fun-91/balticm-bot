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

const voiceConfigKey=guildId=>"voice-create:"+guildId;
async function getVoiceConfig(env,guildId){if(!env.BALTICM_DB)return null;const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key = ?").bind(voiceConfigKey(guildId)).first();if(!row?.value)return null;try{return JSON.parse(row.value)}catch{return null}}
async function setVoiceConfig(env,guildId,config){if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(voiceConfigKey(guildId),JSON.stringify(config),new Date().toISOString()).run()}
async function voiceCreateState(env,guildId){
 const config=await getVoiceConfig(env,guildId);if(!config)return json({config:null,rooms:[]});
 const cr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});if(!cr.ok)return json({error:"Discord channels request failed",status:cr.status},502);const channels=await cr.json();
 const create=channels.find(c=>c.id===config.createChannelId),rooms=channels.filter(c=>c.type===2&&c.parent_id===config.categoryId&&c.id!==config.createChannelId&&String(c.topic||"").startsWith("balticm-voice:"));
 return json({config:{...config,enabled:!!create,createChannelName:create?.name||"Create Voice"},rooms:rooms.map(c=>{const m=String(c.topic||"").match(/^balticm-voice:([^:]+):?(.*)$/);return{id:c.id,name:c.name,ownerId:m?.[1]||null,ownerName:m?.[2]||null,memberCount:0,locked:false,userLimit:c.user_limit||0}})});
}
async function saveVoiceCreate(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}const categoryId=String(body.categoryId||""),createChannelId=String(body.createChannelId||"");if(!categoryId||!createChannelId)return json({error:"Category and Create Voice channel are required"},400);
 const cr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});if(!cr.ok)return json({error:"Discord channels request failed"},502);const channels=await cr.json(),cat=channels.find(c=>c.id===categoryId&&c.type===4),vc=channels.find(c=>c.id===createChannelId&&c.type===2);if(!cat||!vc)return json({error:"Selected category or voice channel was not found"},400);
 const config={enabled:true,categoryId,createChannelId,nameTemplate:String(body.nameTemplate||"{username}'s Room").slice(0,80),userLimit:Math.max(0,Math.min(99,Number(body.userLimit)||0)),privateByDefault:!!body.privateByDefault,updatedAt:new Date().toISOString()};try{await setVoiceConfig(env,guildId,config)}catch(e){return json({error:String(e.message||e)},503)}return json({config:{...config,createChannelName:vc.name}});
}
async function voiceRoomAction(req,env,guildId,roomId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}const config=await getVoiceConfig(env,guildId);if(!config)return json({error:"Voice Create is not configured"},404);
 const r=await fetch(`https://discord.com/api/v10/channels/${roomId}`,{headers:botHeaders(env)});if(!r.ok)return json({error:"Room not found"},404);const room=await r.json();if(room.guild_id!==guildId||room.parent_id!==config.categoryId||room.id===config.createChannelId||!String(room.topic||"").startsWith("balticm-voice:"))return json({error:"This is not a managed temporary room"},403);
 const action=String(body.action||"");if(action==="delete"){const d=await fetch(`https://discord.com/api/v10/channels/${roomId}`,{method:"DELETE",headers:botHeaders(env)});return d.ok?json({ok:true}):json({error:"Room deletion failed"},502)}
 const patch={};if(action==="rename"){const name=String(body.name||"").trim().slice(0,100);if(!name)return json({error:"Room name is required"},400);patch.name=name}else if(action==="limit")patch.user_limit=Math.max(0,Math.min(99,Number(body.limit)||0));else if(action==="transfer"){const ownerId=String(body.ownerId||"").trim();if(!/^\\d{16,22}$/.test(ownerId))return json({error:"Invalid Discord user ID"},400);const old=String(room.topic||"").split(":");patch.topic="balticm-voice:"+ownerId+":"+(old.slice(2).join(":")||"")}else if(action==="lock"||action==="unlock"){const everyone=guildId,overwrites=Array.isArray(room.permission_overwrites)?room.permission_overwrites.filter(x=>x.id!==everyone):[];overwrites.push({id:everyone,type:0,allow:action==="unlock"?"1048576":"0",deny:action==="lock"?"1048576":"0"});patch.permission_overwrites=overwrites}else return json({error:"Unknown room action"},400);
 const pr=await fetch(`https://discord.com/api/v10/channels/${roomId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify(patch)});const data=await pr.json().catch(()=>({}));return pr.ok?json({ok:true,room:data}):json({error:data.message||"Room update failed",status:pr.status},502);
}

export default{async fetch(req,env){
 const u=new URL(req.url),p=u.pathname;
 if(p==="/api/health")return health();
 if(p==="/api/desktop/latest")return desktopLatest();
 const um=p.match(/^\/api\/desktop\/update\/([^/]+)\/([^/]+)\/([^/]+)$/);if(um)return desktopUpdate(decodeURIComponent(um[1]),decodeURIComponent(um[2]),decodeURIComponent(um[3]));
 if(p==="/api/voice-create/service/config"){const guildId=u.searchParams.get("guildId"),secret=req.headers.get("X-BalticM-Service-Secret")||"";if(!env.BALTICM_VOICE_SERVICE_SECRET||secret!==env.BALTICM_VOICE_SERVICE_SECRET)return json({error:"Unauthorized"},401);if(!guildId)return json({error:"guildId is required"},400);const config=await getVoiceConfig(env,guildId);return json({config});}
 if(p==="/api/auth/login")return login(req,env);
 if(p==="/api/auth/callback")return callback(req,env);
 if(p==="/api/auth/logout")return new Response(null,{status:302,headers:{Location:u.origin+"/","Set-Cookie":`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`}});
 if(p==="/api/auth/me"){const user=await session(req,env);return user?json({authenticated:true,user}):json({authenticated:false},401)}
 if(p.startsWith("/api/")){const user=await session(req,env);if(!user)return json({error:"Unauthorized"},401);if(p==="/api/notifications")return json({notifications:await publicNotifications(env)});if(p==="/api/status")return json({ok:true,user:{id:user.id,username:user.username},configured:{discordClientSecret:!!env.DISCORD_CLIENT_SECRET,sessionSecret:!!env.SESSION_SECRET,discordBotToken:!!env.DISCORD_BOT_TOKEN}});if(p==="/api/discord/guild"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return discordGuild(env,guildId);}
if(p==="/api/voice-create"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveVoiceCreate(req,env,guildId):voiceCreateState(env,guildId);}\nconst vr=p.match(/^\\/api\\/voice-create\\/rooms\\/([^/]+)$/);if(vr&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return voiceRoomAction(req,env,guildId,decodeURIComponent(vr[1]));}\nif(p==="/api/discord/members"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return discordMembers(env,guildId);}
if(p==="/api/discord/roles"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return createDiscordRole(req,env,guildId);}const er=p.match(/^\/api\/discord\/roles\/([^/]+)$/);if(er&&(req.method==="PATCH"||req.method==="DELETE")){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="DELETE"?deleteDiscordRole(env,guildId,decodeURIComponent(er[1])):editDiscordRole(req,env,guildId,decodeURIComponent(er[1]));}
const rm=p.match(/^\/api\/discord\/members\/([^/]+)\/roles\/([^/]+)$/);if(rm&&(req.method==="PUT"||req.method==="DELETE")){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return changeMemberRole(req,env,guildId,decodeURIComponent(rm[1]),decodeURIComponent(rm[2]),req.method==="DELETE");}
return json({error:"Not found"},404)}
 return env.ASSETS.fetch(req);
}};