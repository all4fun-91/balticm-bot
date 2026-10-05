import { b64url, signPayload, unb64url, verifyPayload } from "./oauth-session.js";

const enc = new TextEncoder();
const STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = {
  twitch: "/api/profile/streaming/twitch/callback",
  tiktok: "/api/profile/streaming/tiktok/callback",
  kick: "/api/profile/streaming/kick/callback"
};

export const STREAMING_OAUTH_PROVIDERS = ["twitch", "kick", "tiktok"];

function isKnownProvider(provider) {
  return STREAMING_OAUTH_PROVIDERS.includes(String(provider || "").toLowerCase());
}
export const STREAMING_OAUTH_NONCE_SQL = `CREATE TABLE IF NOT EXISTS streaming_oauth_nonce (
  nonce TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL DEFAULT '',
  return_path TEXT NOT NULL DEFAULT '/profile',
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
)`;

export const STREAMING_OAUTH_CREDENTIALS = {
  twitch: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  kick: ["KICK_CLIENT_ID", "KICK_CLIENT_SECRET"]
};

export const STREAMING_OAUTH_SCOPES = {
  twitch: [],
  tiktok: ["user.info.basic"],
  kick: ["user:read"]
};

export const STREAMING_ACCOUNT_ALTER_SQL = [
  "ALTER TABLE user_streaming_accounts ADD COLUMN verified INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE user_streaming_accounts ADD COLUMN profile_image_url TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_streaming_accounts ADD COLUMN token_enc TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_streaming_accounts ADD COLUMN refresh_enc TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_streaming_accounts ADD COLUMN token_expires_at INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE user_streaming_accounts ADD COLUMN token_scope TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE user_streaming_accounts ADD COLUMN connected_at TEXT NOT NULL DEFAULT ''"
];

export function streamingOAuthCallbackPath(provider) {
  return CALLBACK_PATH[String(provider || "").toLowerCase()] || "";
}

export function streamingOAuthCallbackUrl(origin, provider) {
  const path = streamingOAuthCallbackPath(provider);
  if (!path) return "";
  return String(origin || "").replace(/\/+$/, "") + path;
}

export function sanitizeStreamingReturnPath(raw) {
  const s = String(raw || "").trim().split("?")[0].split("#")[0];
  if (s === "/profile" || s.startsWith("/profile?")) return "/profile";
  return "/profile";
}

export function missingStreamingOAuthCredentials(provider, env = {}) {
  const keys = STREAMING_OAUTH_CREDENTIALS[String(provider || "").toLowerCase()] || [];
  return keys.filter((key) => !String(env[key] || "").trim());
}

export function streamingOAuthAvailability(provider, env = {}) {
  const p = String(provider || "").toLowerCase();
  if (!isKnownProvider(p)) return { available: false, status: "unavailable", reason: "Unknown streaming platform" };
  const missing = missingStreamingOAuthCredentials(p, env);
  if (missing.length) {
    return {
      available: false,
      status: "configuration_required",
      reason: "Connection temporarily unavailable",
      missingNames: missing
    };
  }
  return { available: true, status: "ready", reason: "", missingNames: [] };
}

export function streamingOAuthPublicStatus(provider, env = {}) {
  const raw = streamingOAuthAvailability(provider, env);
  return {
    provider: String(provider || "").toLowerCase(),
    available: raw.available,
    status: raw.status,
    message: raw.available ? "" : "Connection temporarily unavailable"
  };
}

export async function createStreamingOAuthState({ secret, discordUserId, provider, returnPath = "/profile", nonce, now = Date.now() }) {
  const p = String(provider || "").toLowerCase();
  if (!isKnownProvider(p)) return { ok: false, error: "Unknown streaming platform" };
  if (!secret) return { ok: false, error: "OAuth state signing is not configured" };
  const n = String(nonce || crypto.randomUUID());
  const token = await signPayload(
    {
      v: 2,
      k: "streaming",
      n,
      u: String(discordUserId || ""),
      p,
      r: sanitizeStreamingReturnPath(returnPath),
      exp: now + STATE_TTL_MS
    },
    secret
  );
  return { ok: true, nonce: n, token, provider: p, discordUserId: String(discordUserId || "") };
}

export async function validateStreamingOAuthState(token, { secret, expectedProvider, expectedUserId, now = Date.now() } = {}) {
  if (!secret) return { ok: false, reason: "invalid" };
  const payload = await verifyPayload(token, secret);
  if (!payload || payload.k !== "streaming" || payload.v !== 2) return { ok: false, reason: "invalid" };
  if (!payload.n || !payload.u || !payload.p) return { ok: false, reason: "invalid" };
  if (Number(payload.exp) <= now) return { ok: false, reason: "expired" };
  if (expectedProvider && String(expectedProvider) !== String(payload.p)) return { ok: false, reason: "provider_mismatch" };
  if (expectedUserId && String(expectedUserId) !== String(payload.u)) return { ok: false, reason: "user_mismatch" };
  return {
    ok: true,
    nonce: String(payload.n),
    discordUserId: String(payload.u),
    provider: String(payload.p),
    returnPath: sanitizeStreamingReturnPath(payload.r)
  };
}

export async function createPkcePair() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(verifierBytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  return { verifier, challenge: b64url(digest), method: "S256" };
}

async function aesKey(secret) {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode("balticm-streaming-oauth:" + String(secret || "")));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptStreamingSecret(value, secret) {
  const text = String(value || "");
  if (!text) return "";
  if (!secret) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text)));
  return b64url(iv) + "." + b64url(cipher);
}

export async function decryptStreamingSecret(blob, secret) {
  const raw = String(blob || "");
  if (!raw || !secret) return "";
  try {
    const cut = raw.indexOf(".");
    if (cut <= 0) return "";
    const iv = unb64url(raw.slice(0, cut));
    const data = unb64url(raw.slice(cut + 1));
    const key = await aesKey(secret);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

export function publicStreamingAccount(row) {
  if (!row) return null;
  const verified = Number(row.verified) === 1 || row.verified === true;
  const login = String(row.provider_login || row.providerLogin || "");
  return {
    id: row.id,
    discordUserId: row.discord_user_id || row.discordUserId,
    provider: row.provider,
    providerUserId: row.provider_user_id || row.providerUserId,
    providerLogin: login,
    displayName: row.display_name || row.displayName || login,
    profileUrl: row.profile_url || row.profileUrl || "",
    watchUrl: row.watch_url || row.watchUrl || "",
    profileImageUrl: row.profile_image_url || row.profileImageUrl || "",
    verified,
    verification: verified ? "oauth" : "legacy",
    connectedAt: row.connected_at || row.connectedAt || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

const SECRET_FIELD_KEYS = new Set(["access_token", "refresh_token", "token_enc", "refresh_enc", "client_secret", "client_key"]);

export function streamingAccountHasSecrets(payload) {
  const items = [];
  if (payload == null) return false;
  if (Array.isArray(payload)) items.push(...payload);
  else if (typeof payload === "object") {
    if (Array.isArray(payload.accounts)) items.push(...payload.accounts);
    else items.push(payload);
  }
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    for (const key of Object.keys(item)) {
      if (SECRET_FIELD_KEYS.has(String(key).toLowerCase())) return true;
    }
  }
  return false;
}

export function normalizeOAuthAccount(provider, raw = {}) {
  const p = String(provider || "").toLowerCase();
  const id = String(raw.providerUserId || raw.id || "").trim();
  if (!id) return { ok: false, error: "Provider did not return a stable account id" };
  const login = String(raw.login || raw.username || raw.handle || "").replace(/^@/, "");
  const displayName = String(raw.displayName || raw.title || login || id);
  const profileImageUrl = String(raw.profileImageUrl || raw.avatar || "");
  let profileUrl = String(raw.profileUrl || "");
  let watchUrl = String(raw.watchUrl || "");
  if (p === "twitch") {
    const handle = (login || id).toLowerCase();
    profileUrl = "https://www.twitch.tv/" + handle;
    watchUrl = profileUrl;
  } else if (p === "kick") {
    const slug = (login || id).toLowerCase();
    profileUrl = "https://kick.com/" + slug;
    watchUrl = profileUrl;
  } else if (p === "tiktok") {
    if (login) {
      profileUrl = "https://www.tiktok.com/@" + login;
      watchUrl = profileUrl + "/live";
    } else {
      profileUrl = "";
      watchUrl = "";
    }
  }
  return {
    ok: true,
    value: {
      provider: p,
      providerUserId: id,
      providerLogin: login || id,
      displayName,
      profileUrl,
      watchUrl,
      profileImageUrl
    }
  };
}

function formBody(params) {
  return new URLSearchParams(params).toString();
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export function publicOAuthErrorCode(raw) {
  const value = typeof raw === "object" && raw ? raw.error || raw.reason || raw.status || raw.code : raw;
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, "")
    .slice(0, 80);
}

/**
 * Safe, loggable error token for a provider response: TikTok answers errors as
 * HTTP 200/4xx with `{error:{code,message}}`. Never returns tokens, codes or
 * secrets — only a short sanitized provider error code (or the HTTP status).
 */
export function providerErrorCode(body, status) {
  const err = body && typeof body === "object" ? body.error : null;
  const raw =
    typeof err === "string"
      ? err
      : (err && (err.code || err.message)) ||
        (body && (body.code || body.error_description)) ||
        `http_${Number(status) || 0}`;
  return publicOAuthErrorCode(raw);
}

export async function readStreamingOAuthCallbackFields(req) {
  const url = new URL(req.url);
  const fields = {
    error: String(url.searchParams.get("error") || "").trim(),
    errorDescription: String(url.searchParams.get("error_description") || "").trim(),
    code: String(url.searchParams.get("code") || "").trim(),
    state: String(url.searchParams.get("state") || "").trim()
  };
  if (String(req.method || "GET").toUpperCase() === "POST") {
    try {
      const ct = String(req.headers.get("content-type") || "");
      if (ct.includes("application/x-www-form-urlencoded")) {
        const body = new URLSearchParams(await req.text());
        if (!fields.error) fields.error = String(body.get("error") || "").trim();
        if (!fields.errorDescription) fields.errorDescription = String(body.get("error_description") || "").trim();
        if (!fields.code) fields.code = String(body.get("code") || "").trim();
        if (!fields.state) fields.state = String(body.get("state") || "").trim();
      }
    } catch {}
  }
  return fields;
}

export function streamingProfileNoticeFromSearch(search) {
  const q = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const error = String(q.get("streaming_error") || "").trim();
  const success = String(q.get("streaming_success") || "").trim();
  const connected = q.get("streaming") === "connected";
  let notice = "";
  if (error) notice = error;
  else if (success) notice = success;
  else if (connected) notice = "Account connected.";
  const shouldClean = !!(error || success || q.get("streaming") || q.get("platform"));
  return { notice, shouldClean };
}

export function strippedStreamingOAuthSearch(search) {
  const q = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  q.delete("streaming_error");
  q.delete("streaming_success");
  q.delete("streaming");
  q.delete("platform");
  return q.toString();
}

export function logStreamingOAuthDiagnostic(stage, detail = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(detail)) {
    if (value == null || value === "") continue;
    const k = String(key);
    if (/secret|token|code$|verifier|authorization/i.test(k) && k !== "logCode" && k !== "error") continue;
    safe[k] = typeof value === "string" ? value.slice(0, 120) : value;
  }
  try {
    console.error("[balticm-streaming-oauth]", stage, JSON.stringify(safe));
  } catch {}
}

export function buildAuthorizationUrl(provider, { origin, env, state, pkce } = {}) {
  const p = String(provider || "").toLowerCase();
  const redirectUri = streamingOAuthCallbackUrl(origin, p);
  const availability = streamingOAuthAvailability(p, env);
  if (!availability.available) return { ok: false, error: availability.reason, missingNames: availability.missingNames };
  if (!state) return { ok: false, error: "Missing OAuth state" };
  if (p === "twitch") {
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.set("client_id", env.TWITCH_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("force_verify", "true");
    url.searchParams.set("state", state);
    return { ok: true, url: url.toString(), redirectUri, scopes: STREAMING_OAUTH_SCOPES.twitch };
  }
  if (p === "tiktok") {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", env.TIKTOK_CLIENT_KEY);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", STREAMING_OAUTH_SCOPES.tiktok.join(","));
    url.searchParams.set("state", state);
    if (pkce?.challenge) {
      url.searchParams.set("code_challenge", pkce.challenge);
      url.searchParams.set("code_challenge_method", pkce.method || "S256");
    }
    return { ok: true, url: url.toString(), redirectUri, scopes: STREAMING_OAUTH_SCOPES.tiktok };
  }
  if (p === "kick") {
    if (!pkce?.challenge) return { ok: false, error: "Kick OAuth requires PKCE" };
    const url = new URL("https://id.kick.com/oauth/authorize");
    url.searchParams.set("client_id", env.KICK_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", STREAMING_OAUTH_SCOPES.kick.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", pkce.method || "S256");
    return { ok: true, url: url.toString(), redirectUri, scopes: STREAMING_OAUTH_SCOPES.kick };
  }
  return { ok: false, error: "Unknown streaming platform" };
}

export async function exchangeAuthorizationCode(provider, { origin, env, code, codeVerifier, httpFetch = fetch } = {}) {
  const p = String(provider || "").toLowerCase();
  const redirectUri = streamingOAuthCallbackUrl(origin, p);
  const availability = streamingOAuthAvailability(p, env);
  if (!availability.available) return { ok: false, error: availability.reason };
  if (!String(code || "").trim()) return { ok: false, error: "Missing authorization code" };
  if (p === "twitch") {
    const res = await httpFetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_id: env.TWITCH_CLIENT_ID,
        client_secret: env.TWITCH_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    });
    const body = await readJson(res);
    if (!res.ok || !body.access_token) return { ok: false, error: "Twitch authorization failed" };
    return { ok: true, accessToken: body.access_token, refreshToken: body.refresh_token || "", expiresIn: Number(body.expires_in) || 3600, scope: body.scope };
  }
  if (p === "tiktok") {
    const res = await httpFetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: codeVerifier || ""
      })
    });
    const body = await readJson(res);
    const token = body.access_token || body.data?.access_token;
    if (!res.ok || !token) return { ok: false, error: "TikTok authorization failed", logCode: providerErrorCode(body, res.status) };
    return {
      ok: true,
      accessToken: token,
      refreshToken: body.refresh_token || body.data?.refresh_token || "",
      expiresIn: Number(body.expires_in || body.data?.expires_in) || 86400,
      scope: body.scope || body.data?.scope,
      openId: body.open_id || body.data?.open_id || ""
    };
  }
  if (p === "kick") {
    if (!codeVerifier) return { ok: false, error: "Kick OAuth requires PKCE" };
    const res = await httpFetch("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        grant_type: "authorization_code",
        client_id: env.KICK_CLIENT_ID,
        client_secret: env.KICK_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        code
      })
    });
    const body = await readJson(res);
    if (!res.ok || !body.access_token) return { ok: false, error: "Kick authorization failed" };
    return { ok: true, accessToken: body.access_token, refreshToken: body.refresh_token || "", expiresIn: Number(body.expires_in) || 3600, scope: body.scope };
  }
  return { ok: false, error: "Unknown streaming platform" };
}

export async function refreshAccessToken(provider, { env, refreshToken, httpFetch = fetch } = {}) {
  const p = String(provider || "").toLowerCase();
  const token = String(refreshToken || "");
  if (!token) return { ok: false, error: "Missing refresh token" };
  if (p === "twitch") {
    const res = await httpFetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_id: env.TWITCH_CLIENT_ID,
        client_secret: env.TWITCH_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token
      })
    });
    const body = await readJson(res);
    if (!res.ok || !body.access_token) return { ok: false, error: "Twitch token refresh failed" };
    return { ok: true, accessToken: body.access_token, refreshToken: body.refresh_token || token, expiresIn: Number(body.expires_in) || 3600 };
  }
  if (p === "tiktok") {
    const res = await httpFetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token
      })
    });
    const body = await readJson(res);
    const access = body.access_token || body.data?.access_token;
    if (!res.ok || !access) return { ok: false, error: "TikTok token refresh failed" };
    return { ok: true, accessToken: access, refreshToken: body.refresh_token || body.data?.refresh_token || token, expiresIn: Number(body.expires_in || body.data?.expires_in) || 86400 };
  }
  if (p === "kick") {
    const res = await httpFetch("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        grant_type: "refresh_token",
        client_id: env.KICK_CLIENT_ID,
        client_secret: env.KICK_CLIENT_SECRET,
        refresh_token: token
      })
    });
    const body = await readJson(res);
    if (!res.ok || !body.access_token) return { ok: false, error: "Kick token refresh failed" };
    return { ok: true, accessToken: body.access_token, refreshToken: body.refresh_token || token, expiresIn: Number(body.expires_in) || 3600 };
  }
  return { ok: false, error: "Unknown streaming platform" };
}

export async function getAuthenticatedAccount(provider, { env, accessToken, openId = "", httpFetch = fetch } = {}) {
  const p = String(provider || "").toLowerCase();
  const token = String(accessToken || "");
  if (!token) return { ok: false, error: "Missing access token" };
  if (p === "twitch") {
    const res = await httpFetch("https://api.twitch.tv/helix/users", {
      headers: { "Client-ID": String(env.TWITCH_CLIENT_ID || ""), Authorization: "Bearer " + token }
    });
    const body = await readJson(res);
    const user = Array.isArray(body.data) ? body.data[0] : null;
    if (!res.ok || !user?.id) return { ok: false, error: "Could not load the Twitch account" };
    return normalizeOAuthAccount("twitch", {
      id: user.id,
      login: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url
    });
  }
  if (p === "tiktok") {
    // TikTok moved `username` (and profile links) to the `user.info.profile`
    // scope. Requesting a field outside the granted scope makes TikTok reject
    // the WHOLE user-info request with 401 `scope_not_authorized`, which used to
    // abort the connection immediately before persistence — the OAuth flow then
    // "completed" on TikTok's side while BalticM stored nothing.
    // So: ask for the fields `user.info.basic` always returns first, and only
    // then try to enrich with `username` (used as soon as the app is approved
    // for the extra scope); enrichment failure never blocks the connection.
    const BASIC_TIKTOK_FIELDS = "open_id,union_id,avatar_url,display_name";
    const pickUser = (body) => body?.data?.user || body?.user || null;
    const load = (fields) =>
      httpFetch("https://open.tiktokapis.com/v2/user/info/?fields=" + fields, {
        headers: { Authorization: "Bearer " + token }
      });
    const basicRes = await load(BASIC_TIKTOK_FIELDS);
    let body = await readJson(basicRes);
    let user = pickUser(body);
    let logCode = user ? "" : providerErrorCode(body, basicRes.status);
    if (basicRes.ok && user && !user.username) {
      try {
        const extra = await readJson(await load(BASIC_TIKTOK_FIELDS + ",username"));
        if (pickUser(extra)?.username) {
          body = extra;
          user = pickUser(extra);
        }
      } catch {}
    }
    const id = String(user?.open_id || user?.union_id || openId || "").trim();
    if (!basicRes.ok || !user || !id) return { ok: false, error: "Could not load the TikTok account", logCode: logCode || providerErrorCode(body, basicRes.status) };
    return normalizeOAuthAccount("tiktok", {
      id,
      login: user.username,
      displayName: user.display_name,
      profileImageUrl: user.avatar_url
    });
  }
  if (p === "kick") {
    const res = await httpFetch("https://api.kick.com/public/v1/users", {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" }
    });
    const body = await readJson(res);
    const user = Array.isArray(body.data) ? body.data[0] : body.data || body.user || body;
    const id = String(user?.user_id || user?.id || "").trim();
    if (!res.ok || !id) return { ok: false, error: "Could not load the Kick account" };
    return normalizeOAuthAccount("kick", {
      id,
      login: user.name || user.username || user.slug,
      displayName: user.name || user.username,
      profileImageUrl: user.profile_picture || user.profilePicture
    });
  }
  return { ok: false, error: "Unknown streaming platform" };
}

export async function revokeStreamingToken(provider, { env, token, httpFetch = fetch } = {}) {
  const p = String(provider || "").toLowerCase();
  const value = String(token || "");
  if (!value) return { ok: true, skipped: true };
  try {
    if (p === "twitch") {
      await httpFetch("https://id.twitch.tv/oauth2/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ client_id: env.TWITCH_CLIENT_ID, token: value })
      });
    } else if (p === "tiktok") {
      await httpFetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({
          client_key: env.TIKTOK_CLIENT_KEY,
          client_secret: env.TIKTOK_CLIENT_SECRET,
          token: value
        })
      });
    } else if (p === "kick") {
      await httpFetch("https://id.kick.com/oauth/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({
          token: value,
          client_id: env.KICK_CLIENT_ID,
          client_secret: env.KICK_CLIENT_SECRET,
          token_type_hint: "access_token"
        })
      });
    }
  } catch {}
  return { ok: true };
}

export function streamingOAuthSetupReport() {
  return {
    twitch: {
      env: STREAMING_OAUTH_CREDENTIALS.twitch,
      callback: "https://bot.balticm.eu" + CALLBACK_PATH.twitch,
      scopes: STREAMING_OAUTH_SCOPES.twitch,
      review: false
    },
    tiktok: {
      env: STREAMING_OAUTH_CREDENTIALS.tiktok,
      callback: "https://bot.balticm.eu" + CALLBACK_PATH.tiktok,
      scopes: STREAMING_OAUTH_SCOPES.tiktok,
      review: "TikTok Login Kit app review required for production; username/LIVE fields may need extra approved scopes"
    },
    kick: {
      env: STREAMING_OAUTH_CREDENTIALS.kick,
      callback: "https://bot.balticm.eu" + CALLBACK_PATH.kick,
      scopes: STREAMING_OAUTH_SCOPES.kick,
      review: false
    }
  };
}
