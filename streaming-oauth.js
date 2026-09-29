import { b64url, signPayload, unb64url, verifyPayload } from "./oauth-session.js";

const enc = new TextEncoder();
const STATE_TTL_MS = 10 * 60 * 1000;
const CALLBACK_PATH = {
  twitch: "/api/profile/streaming/twitch/callback",
  youtube: "/api/profile/streaming/youtube/callback",
  tiktok: "/api/profile/streaming/tiktok/callback",
  kick: "/api/profile/streaming/kick/callback"
};

export const STREAMING_OAUTH_PROVIDERS = ["twitch", "youtube", "kick", "tiktok"];

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
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  kick: ["KICK_CLIENT_ID", "KICK_CLIENT_SECRET"]
};

export const STREAMING_OAUTH_SCOPES = {
  twitch: [],
  youtube: ["https://www.googleapis.com/auth/youtube.readonly"],
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
  } else if (p === "youtube") {
    profileUrl = /^UC[\w-]{20,}$/.test(id) ? "https://www.youtube.com/channel/" + id : profileUrl;
    watchUrl = profileUrl ? profileUrl.replace(/\/$/, "") + "/live" : "";
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

export function youtubeTokenUserMessage(body = {}) {
  const code = publicOAuthErrorCode(body.error);
  if (code === "redirect_uri_mismatch") return "YouTube is not configured with the Control Center callback URL.";
  if (code === "invalid_client") return "YouTube connection is not configured.";
  if (code === "invalid_grant" || code === "invalid_request") return "The YouTube authorization expired. Try connecting again.";
  if (code === "unauthorized_client") return "This Google OAuth client cannot complete YouTube sign-in.";
  return "The platform authorization failed.";
}

export function youtubeAccountUserMessage(body = {}, httpStatus = 0) {
  const reason = publicOAuthErrorCode(body.error?.errors?.[0]?.reason || body.error?.status || body.error);
  if (reason === "accessnotconfigured" || reason === "access_not_configured" || /youtube data api/i.test(String(body.error?.message || ""))) {
    return "YouTube Data API is not enabled for this Google project.";
  }
  if (reason === "youtubesignuprequired" || httpStatus === 404) return "This Google account has no YouTube channel";
  if (httpStatus === 401 || reason === "autherror" || reason === "unauthenticated") return "YouTube authorization expired. Try connecting again.";
  if (httpStatus === 403) return "YouTube did not allow this connection for the signed-in Google account.";
  return "This Google account has no YouTube channel";
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
  if (p === "youtube") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", STREAMING_OAUTH_SCOPES.youtube.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    if (pkce?.challenge) {
      url.searchParams.set("code_challenge", pkce.challenge);
      url.searchParams.set("code_challenge_method", pkce.method || "S256");
    }
    return { ok: true, url: url.toString(), redirectUri, scopes: STREAMING_OAUTH_SCOPES.youtube };
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
  if (p === "youtube") {
    const res = await httpFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {})
      })
    });
    const body = await readJson(res);
    if (!res.ok || !body.access_token) {
      return { ok: false, error: youtubeTokenUserMessage(body), logCode: publicOAuthErrorCode(body.error) };
    }
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
    if (!res.ok || !token) return { ok: false, error: "TikTok authorization failed" };
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
  if (p === "youtube") {
    const res = await httpFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token
      })
    });
    const body = await readJson(res);
    if (!res.ok || !body.access_token) return { ok: false, error: "YouTube token refresh failed" };
    return { ok: true, accessToken: body.access_token, refreshToken: token, expiresIn: Number(body.expires_in) || 3600 };
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
  if (p === "youtube") {
    const res = await httpFetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,id&mine=true", {
      headers: { Authorization: "Bearer " + token }
    });
    const body = await readJson(res);
    const channel = Array.isArray(body.items) ? body.items[0] : null;
    if (!res.ok || !channel?.id) {
      return { ok: false, error: youtubeAccountUserMessage(body, res.status), logCode: publicOAuthErrorCode(body.error?.errors?.[0]?.reason || body.error) };
    }
    const thumb = channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url || "";
    return normalizeOAuthAccount("youtube", {
      id: channel.id,
      login: String(channel.snippet?.customUrl || "").replace(/^@/, ""),
      displayName: channel.snippet?.title,
      profileImageUrl: thumb
    });
  }
  if (p === "tiktok") {
    const res = await httpFetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username", {
      headers: { Authorization: "Bearer " + token }
    });
    const body = await readJson(res);
    const user = body.data?.user || body.user || body.data || {};
    const id = String(user.open_id || user.union_id || openId || "").trim();
    if (!res.ok || !id) return { ok: false, error: "Could not load the TikTok account" };
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
    } else if (p === "youtube") {
      await httpFetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({ token: value })
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
    youtube: {
      env: STREAMING_OAUTH_CREDENTIALS.youtube,
      callback: "https://bot.balticm.eu" + CALLBACK_PATH.youtube,
      scopes: STREAMING_OAUTH_SCOPES.youtube,
      review: "Google Cloud OAuth consent screen; YouTube Data API v3 enabled"
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
