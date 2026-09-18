export async function onRequestGet({env,request}) {
  const clientId = env.DISCORD_CLIENT_ID || "1543137268221354035";
  const origin = new URL(request.url).origin;
  const redirectUri = env.DISCORD_REDIRECT_URI || `${origin}/api/auth/callback`;
  const state = crypto.randomUUID();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  return new Response(null,{status:302,headers:{
    Location:url.toString(),
    "Set-Cookie":`balticm_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    "Cache-Control":"no-store"
  }});
}