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
 try{const r=await latestDesktopRelease();return r?json({available:true,version:r.version,notes:r.notes,pub_date:r.pub_date}):json({available:false})}catch(e){return json({available:false,error:String(e.message||e)},502)}
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
async function discordGuild(env){
 if(!env.DISCORD_BOT_TOKEN)return json({error:"DISCORD_BOT_TOKEN is not configured"},503);
 const h={Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`},id="884027552174317569";
 const [g,c,r]=await Promise.all([fetch(`https://discord.com/api/v10/guilds/${id}?with_counts=true`,{headers:h}),fetch(`https://discord.com/api/v10/guilds/${id}/channels`,{headers:h}),fetch(`https://discord.com/api/v10/guilds/${id}/roles`,{headers:h})]);
 if(!g.ok)return json({error:"Discord guild request failed",status:g.status},502);
 const gd=await g.json();return json({guild:{id:gd.id,name:gd.name,icon:gd.icon,memberCount:gd.approximate_member_count,onlineCount:gd.approximate_presence_count},channels:c.ok?await c.json():[],roles:r.ok?await r.json():[]});
}
export default{async fetch(req,env){
 const u=new URL(req.url),p=u.pathname;
 if(p==="/api/health")return health();
 if(p==="/api/desktop/latest")return desktopLatest();
 const um=p.match(/^\/api\/desktop\/update\/([^/]+)\/([^/]+)\/([^/]+)$/);if(um)return desktopUpdate(decodeURIComponent(um[1]),decodeURIComponent(um[2]),decodeURIComponent(um[3]));
 if(p==="/api/auth/login")return login(req,env);
 if(p==="/api/auth/callback")return callback(req,env);
 if(p==="/api/auth/logout")return new Response(null,{status:302,headers:{Location:u.origin+"/","Set-Cookie":`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`}});
 if(p==="/api/auth/me"){const user=await session(req,env);return user?json({authenticated:true,user}):json({authenticated:false},401)}
 if(p.startsWith("/api/")){const user=await session(req,env);if(!user)return json({error:"Unauthorized"},401);if(p==="/api/notifications")return json({notifications:await publicNotifications(env)});if(p==="/api/status")return json({ok:true,user:{id:user.id,username:user.username},configured:{discordClientSecret:!!env.DISCORD_CLIENT_SECRET,sessionSecret:!!env.SESSION_SECRET,discordBotToken:!!env.DISCORD_BOT_TOKEN}});if(p==="/api/discord/guild")return discordGuild(env);return json({error:"Not found"},404)}
 return env.ASSETS.fetch(req);
}};