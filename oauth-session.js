/** Discord login OAuth state + session cookie helpers. Independent of RBAC V2 and bot-install OAuth. */

export const COOKIE_SESSION = "balticm_session";
export const COOKIE_STATE = "balticm_oauth_state";
export const COOKIE_RETURN = "balticm_oauth_return";

const enc = new TextEncoder();
const dec = new TextDecoder();
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_GUILDS = 30;

export function b64url(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u.length; i += 0x8000) {
    bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function unb64url(s) {
  let t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}

export async function signPayload(p, secret) {
  const d = b64url(enc.encode(JSON.stringify(p)));
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return d + "." + b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(d))));
}

export async function verifyPayload(t, secret) {
  try {
    const raw = String(t || "");
    const cut = raw.lastIndexOf(".");
    if (cut <= 0 || cut === raw.length - 1) return null;
    const d = raw.slice(0, cut);
    const s = raw.slice(cut + 1);
    const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", k, unb64url(s), enc.encode(d))) return null;
    const p = JSON.parse(dec.decode(unb64url(d)));
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export function parseCookieMap(cookieHeader) {
  return Object.fromEntries(
    String(cookieHeader || "")
      .split(";")
      .map((x) => x.trim().split("="))
      .filter((x) => x[0])
      .map(([k, ...v]) => [k, v.join("=")])
  );
}

export async function resolveSession(req, secret) {
  const token = parseCookieMap(req.headers.get("Cookie"))[COOKIE_SESSION];
  if (!token || !secret) return null;
  return verifyPayload(token, secret);
}

export function publicAuthUser(user) {
  return {
    id: user.id,
    username: user.username,
    global_name: user.global_name,
    avatar: user.avatar,
    guilds: (user.guilds || []).map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: !!g.owner }))
  };
}

export function cookieHeader(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookieHeader(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function compactAccessibleGuilds(guilds) {
  const out = [];
  const seen = new Set();
  for (const g of Array.isArray(guilds) ? guilds : []) {
    const id = String(g?.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(g.name || id).slice(0, 80),
      icon: g.icon || null,
      owner: !!g.owner,
      ...(g.access ? { access: g.access } : {})
    });
    if (out.length >= MAX_SESSION_GUILDS) break;
  }
  return out;
}

export function buildAuthSessionPayload(user, guilds, now = Date.now()) {
  return {
    id: String(user.id),
    username: user.username,
    global_name: user.global_name || user.username,
    avatar: user.avatar,
    guilds: compactAccessibleGuilds(guilds),
    exp: now + SESSION_TTL_MS
  };
}

export async function createSignedOAuthState(secret, now = Date.now(), nonce = crypto.randomUUID()) {
  const token = await signPayload({ n: nonce, exp: now + STATE_TTL_MS, v: 1 }, secret);
  return { nonce, token };
}

export async function validateOAuthState(queryState, cookieNonce, secret, now = Date.now()) {
  const q = String(queryState || "");
  const c = String(cookieNonce || "");
  if (!q) return { ok: false, reason: "invalid" };
  if (secret) {
    const signed = await verifyPayload(q, secret);
    if (signed && signed.n && Number(signed.exp) > now) {
      // HMAC is the CSRF check. A newer login cookie must not void an otherwise valid Discord callback.
      return { ok: true, nonce: signed.n };
    }
  }
  if (c && q === c) return { ok: true, nonce: c };
  return { ok: false, reason: "invalid" };
}

export function sanitizeOAuthReturnPath(raw) {
  const s = String(raw || "").trim();
  if (!s || s === "/") return "/";
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("://") || s.includes("\\") || s.includes("@")) return "/";
  const path = s.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (path === "/premium") return "/premium";
  return "/";
}

async function jsonOrEmpty(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Complete Discord login callback. Session is created for any valid Discord user.
 * Guild discovery is best-effort and must not block Set-Cookie.
 */
export async function runOAuthCallback(req, env, hooks = {}) {
  const url = new URL(req.url);
  const cookies = parseCookieMap(req.headers.get("Cookie"));
  const origin = String(hooks.publicOrigin || "").replace(/\/$/, "") || new URL(req.url).origin;
  const redirect = (query) => new Response(null, {
    status: 302,
    headers: { Location: origin + "/" + (query || ""), "Cache-Control": "no-store" }
  });

  const stateCheck = await validateOAuthState(url.searchParams.get("state"), cookies[COOKIE_STATE], env.SESSION_SECRET);
  if (!stateCheck.ok) return redirect("?auth=invalid");
  const code = url.searchParams.get("code");
  if (!code) return redirect("?auth=invalid");
  if (!env.DISCORD_CLIENT_SECRET || !env.SESSION_SECRET) return redirect("?auth=config");

  const fetchFn = hooks.fetchFn || fetch;
  const redirectUri = hooks.redirectUri;
  const clientId = hooks.clientId;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });
  let tr;
  try {
    tr = await fetchFn("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
  } catch {
    return redirect("?auth=failed");
  }
  if (!tr.ok) return redirect("?auth=failed");
  const tokenBody = await jsonOrEmpty(tr);
  const access = tokenBody?.access_token;
  if (!access) return redirect("?auth=failed");
  const h = { Authorization: `Bearer ${access}` };

  let mr;
  try {
    mr = await fetchFn("https://discord.com/api/v10/users/@me", { headers: h });
  } catch {
    return redirect("?auth=failed");
  }
  if (!mr.ok) return redirect("?auth=failed");
  const user = await jsonOrEmpty(mr);
  if (!user?.id) return redirect("?auth=failed");

  let oauthGuilds = [];
  try {
    const gr = await fetchFn("https://discord.com/api/v10/users/@me/guilds", { headers: h });
    if (gr.ok) {
      const gs = await jsonOrEmpty(gr);
      if (Array.isArray(gs)) oauthGuilds = gs;
    }
  } catch {}

  let guilds = [];
  try {
    if (typeof hooks.discoverAccessibleGuilds === "function") {
      const discovered = await Promise.race([
        hooks.discoverAccessibleGuilds(user.id, oauthGuilds),
        new Promise((_, reject) => setTimeout(() => reject(new Error("guild-discovery-timeout")), hooks.discoveryTimeoutMs || 250))
      ]);
      guilds = compactAccessibleGuilds(discovered);
    } else if (typeof hooks.filterOAuthGuilds === "function") {
      guilds = compactAccessibleGuilds(hooks.filterOAuthGuilds(oauthGuilds) || []);
    }
  } catch {
    guilds = [];
  }

  const payload = buildAuthSessionPayload(user, guilds);
  let session;
  try {
    session = await signPayload(payload, env.SESSION_SECRET);
  } catch {
    session = await signPayload(buildAuthSessionPayload(user, []), env.SESSION_SECRET);
  }

  const returnRaw = cookies[COOKIE_RETURN] ? decodeURIComponent(cookies[COOKIE_RETURN]) : "/";
  const returnPath = sanitizeOAuthReturnPath(returnRaw);
  // Single Set-Cookie on a 302, matching Cloudflare's OAuth+assets example. Relative Location
  // stays on the host that just set the cookie (no PUBLIC_APP_URL host swap).
  return new Response(null, {
    status: 302,
    headers: {
      Location: returnPath,
      "Cache-Control": "no-store",
      "Set-Cookie": cookieHeader(COOKIE_SESSION, session, 86400)
    }
  });
}

export async function handleAuthMe(req, env, hooks = {}) {
  const user = await resolveSession(req, env.SESSION_SECRET);
  if (!user) {
    return Response.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  let guilds = Array.isArray(user.guilds) ? user.guilds : [];
  if (typeof hooks.refreshGuilds === "function") {
    try {
      guilds = await hooks.refreshGuilds(user);
    } catch {}
  }
  const next = { ...user, guilds, exp: Date.now() + SESSION_TTL_MS };
  const headers = new Headers({ "Cache-Control": "no-store" });
  await attachRefreshedSessionCookie(headers, next, env.SESSION_SECRET, signPayload);
  return Response.json({ authenticated: true, user: publicAuthUser(next) }, { headers });
}

export async function attachRefreshedSessionCookie(headers, payload, secret, signSession) {
  try {
    const token = await (signSession || signPayload)(payload, secret);
    headers.append("Set-Cookie", cookieHeader(COOKIE_SESSION, token, 86400));
    return true;
  } catch {
    return false;
  }
}
