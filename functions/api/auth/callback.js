function cookies(request){return Object.fromEntries((request.headers.get("Cookie")||"").split(";").map(v=>v.trim().split("=")).filter(x=>x[0]).map(([k,...v])=>[k,v.join("=")]));}
function b64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");}
async function sign(payload,secret){const data=b64url(new TextEncoder().encode(JSON.stringify(payload)));const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(data));return data+"."+b64url(new Uint8Array(sig));}
export async function onRequestGet({env,request}) {
 const u=new URL(request.url),code=u.searchParams.get("code"),state=u.searchParams.get("state"),c=cookies(request);
 if(!code||!state||state!==c.balticm_oauth_state)return Response.redirect(u.origin+"/?auth=invalid",302);
 if(!env.DISCORD_CLIENT_SECRET||!env.SESSION_SECRET)return Response.redirect(u.origin+"/?auth=config",302);
 const redirectUri=env.DISCORD_REDIRECT_URI||`${u.origin}/api/auth/callback`;
 const body=new URLSearchParams({client_id:env.DISCORD_CLIENT_ID||"1543137268221354035",client_secret:env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:redirectUri});
 const token=await fetch("https://discord.com/api/v10/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
 if(!token.ok)return Response.redirect(u.origin+"/?auth=failed",302);
 const t=await token.json();
 const [me,guilds]=await Promise.all([fetch("https://discord.com/api/v10/users/@me",{headers:{Authorization:`Bearer ${t.access_token}`}}),fetch("https://discord.com/api/v10/users/@me/guilds",{headers:{Authorization:`Bearer ${t.access_token}`}})]);
 if(!me.ok)return Response.redirect(u.origin+"/?auth=failed",302);
 const user=await me.json(),gs=guilds.ok?await guilds.json():[];
 const manageable=gs.filter(g=>(BigInt(g.permissions||"0")&32n)===32n||g.owner).map(g=>({id:g.id,name:g.name,icon:g.icon,owner:g.owner}));
 const session=await sign({id:user.id,username:user.username,global_name:user.global_name||user.username,avatar:user.avatar,guilds:manageable,exp:Date.now()+86400000},env.SESSION_SECRET);
 return new Response(null,{status:302,headers:{Location:u.origin+"/","Set-Cookie":`balticm_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,"Cache-Control":"no-store"}});
}