import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideProfileStreamingMutation } from "../streamers.js";
import {
  STREAMING_OAUTH_SCOPES,
  buildAuthorizationUrl,
  createPkcePair,
  createStreamingOAuthState,
  exchangeAuthorizationCode,
  getAuthenticatedAccount,
  providerErrorCode,
  publicStreamingAccount,
  streamingAccountHasSecrets,
  streamingOAuthCallbackUrl,
  streamingOAuthSetupReport,
  validateStreamingOAuthState
} from "../streaming-oauth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const uiSrc = readFileSync(join(root, "src/Streamers.jsx"), "utf8");

const ORIGIN = "https://bot.balticm.eu";
const SECRET = "tiktok-oauth-test-secret";
const USER_A = "555555555555555555";
const USER_B = "666666666666666666";
const REDIRECT_URI = "https://bot.balticm.eu/api/profile/streaming/tiktok/callback";
const env = { TIKTOK_CLIENT_KEY: "prod-key-123", TIKTOK_CLIENT_SECRET: "prod-secret-value", SESSION_SECRET: SECRET };

async function stateFor(user = USER_A) {
  return createStreamingOAuthState({ secret: SECRET, discordUserId: user, provider: "tiktok" });
}

// ---------------------------------------------------------------------------
// 1 + 2. Authorization URL, production configuration, redirect URI, state
// ---------------------------------------------------------------------------

test("TikTok authorization URL uses production configuration and the exact redirect URI", async () => {
  const created = await stateFor();
  const pkce = await createPkcePair();
  const auth = buildAuthorizationUrl("tiktok", { origin: ORIGIN, env, state: created.token, pkce });
  assert.equal(auth.ok, true);
  const url = new URL(auth.url);
  assert.equal(url.origin + url.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(url.searchParams.get("client_key"), env.TIKTOK_CLIENT_KEY);
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI, "no trailing slash, https, production host");
  assert.equal(auth.redirectUri, REDIRECT_URI);
  assert.equal(streamingOAuthCallbackUrl(ORIGIN, "tiktok"), REDIRECT_URI);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "user.info.basic");
  assert.equal(url.searchParams.get("state"), created.token);
  assert.ok(url.searchParams.get("code_challenge"), "PKCE challenge is sent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  // Only scopes the production app is approved for are requested:
  assert.deepEqual(STREAMING_OAUTH_SCOPES.tiktok, ["user.info.basic"]);
  assert.equal(streamingOAuthSetupReport().tiktok.callback, REDIRECT_URI);
  assert.deepEqual(streamingOAuthSetupReport().tiktok.env, ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
});

test("TikTok state is generated, validated and rejected when missing, invalid, expired or for another user", async () => {
  const created = await stateFor();
  const ok = await validateStreamingOAuthState(created.token, { secret: SECRET, expectedProvider: "tiktok", expectedUserId: USER_A });
  assert.equal(ok.ok, true);
  assert.equal(ok.discordUserId, USER_A);
  assert.equal(ok.provider, "tiktok");
  // missing state
  assert.equal((await validateStreamingOAuthState(undefined, { secret: SECRET })).ok, false);
  assert.equal((await validateStreamingOAuthState("", { secret: SECRET })).ok, false);
  // invalid / tampered state
  assert.equal((await validateStreamingOAuthState("not-a-token", { secret: SECRET })).ok, false);
  // expired state
  const expired = await validateStreamingOAuthState(created.token, { secret: SECRET, expectedProvider: "tiktok", now: Date.now() + 20 * 60 * 1000 });
  assert.equal(expired.ok, false);
  assert.equal(expired.reason, "expired");
  // provider + user mismatch (one Discord user cannot link TikTok to another)
  assert.equal((await validateStreamingOAuthState(created.token, { secret: SECRET, expectedProvider: "twitch" })).reason, "provider_mismatch");
  assert.equal((await validateStreamingOAuthState(created.token, { secret: SECRET, expectedProvider: "tiktok", expectedUserId: USER_B })).reason, "user_mismatch");
});

// ---------------------------------------------------------------------------
// 5. Token exchange
// ---------------------------------------------------------------------------

test("TikTok token exchange posts production fields to the official endpoint", async () => {
  let captured = "";
  let seenUrl = "";
  const tokens = await exchangeAuthorizationCode("tiktok", {
    origin: ORIGIN,
    env,
    code: "auth-code",
    codeVerifier: "pkce-verifier",
    httpFetch: async (url, init) => {
      seenUrl = url;
      assert.equal(init.method, "POST");
      assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
      captured = String(init.body || "");
      return { ok: true, status: 200, json: async () => ({ access_token: "at-tik", refresh_token: "rt-tik", expires_in: 86400, scope: "user.info.basic", open_id: "open-1" }) };
    }
  });
  assert.equal(seenUrl, "https://open.tiktokapis.com/v2/oauth/token/");
  const params = new URLSearchParams(captured);
  assert.equal(params.get("client_key"), env.TIKTOK_CLIENT_KEY);
  assert.equal(params.get("client_secret"), env.TIKTOK_CLIENT_SECRET);
  assert.equal(params.get("code"), "auth-code");
  assert.equal(params.get("grant_type"), "authorization_code");
  assert.equal(params.get("redirect_uri"), REDIRECT_URI, "exchange redirect_uri must match the authorize one");
  assert.equal(params.get("code_verifier"), "pkce-verifier");
  assert.equal(tokens.ok, true);
  assert.equal(tokens.accessToken, "at-tik");
  assert.equal(tokens.openId, "open-1");
  assert.equal(tokens.scope, "user.info.basic");
});

test("TikTok token exchange failure is handled safely with a loggable provider code", async () => {
  const failed = await exchangeAuthorizationCode("tiktok", {
    origin: ORIGIN,
    env,
    code: "bad-code",
    httpFetch: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: "invalid_grant", message: "Code is invalid or expired" } }) })
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "TikTok authorization failed");
  assert.equal(failed.logCode, "invalid_grant", "the safe provider code is what gets logged");
  const dump = JSON.stringify(failed);
  assert.equal(dump.includes(env.TIKTOK_CLIENT_SECRET), false, "no client secret in the result");
  assert.equal(dump.includes("at-"), false, "no token material in the result");
  // Malformed/empty responses never throw and never leak:
  const empty = await exchangeAuthorizationCode("tiktok", { origin: ORIGIN, env, code: "x", httpFetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, "TikTok authorization failed");
});

test("provider error codes stay short, sanitized and secret-free", () => {
  assert.equal(providerErrorCode({ error: { code: "scope_not_authorized" } }, 401), "scope_not_authorized");
  assert.equal(providerErrorCode({}, 500), "http_500");
  assert.equal(providerErrorCode({ error: "access_denied" }, 403), "access_denied");
  assert.match(providerErrorCode({ error: { code: "Weird Code <script>" } }, 400), /^[a-z0-9_.:-]+$/);
});

// ---------------------------------------------------------------------------
// 6 + 7. User info: fields must stay inside the granted scope
// ---------------------------------------------------------------------------

test("TikTok user info falls back to granted-scope fields instead of aborting the connection", async () => {
  const urls = [];
  const basicBody = {
    data: { user: { open_id: "open-9", union_id: "union-9", display_name: "Aivis", avatar_url: "https://cdn.example/a.png" } },
    error: { code: "ok", message: "" }
  };
  const info = await getAuthenticatedAccount("tiktok", {
    env,
    accessToken: "at-tik",
    httpFetch: async (url) => {
      urls.push(String(url));
      // username sits behind the user.info.profile scope → TikTok 401s the whole request
      if (String(url).includes("username")) {
        return { ok: false, status: 401, json: async () => ({ error: { code: "scope_not_authorized", message: "Scope not authorized" } }) };
      }
      return { ok: true, status: 200, json: async () => basicBody };
    }
  });
  assert.equal(info.ok, true, "the connection must not fail on an unapproved field");
  assert.equal(info.value.provider, "tiktok");
  assert.equal(info.value.providerUserId, "open-9", "stable TikTok open_id is persisted");
  assert.equal(info.value.displayName, "Aivis");
  assert.equal(urls.length, 2);
  assert.equal(urls[0].includes("username"), false, "granted-scope fields are requested first");
  assert.equal(urls[1].includes("username"), true, "username enrichment is only best effort");
  assert.match(urls[0], /^https:\/\/open\.tiktokapis\.com\/v2\/user\/info\/\?fields=/);
  assert.match(urls[1], /fields=open_id,union_id,avatar_url,display_name,username$/);
});

test("TikTok user info keeps the open_id stable and builds profile links when a username exists", async () => {
  const withName = await getAuthenticatedAccount("tiktok", {
    env,
    accessToken: "at-tik",
    httpFetch: async () => ({ ok: true, status: 200, json: async () => ({ data: { user: { open_id: "open-1", display_name: "Aivis", username: "aivisberzins", avatar_url: "" } } }) })
  });
  assert.equal(withName.ok, true);
  assert.equal(withName.value.providerUserId, "open-1");
  assert.equal(withName.value.providerLogin, "aivisberzins");
  assert.equal(withName.value.profileUrl, "https://www.tiktok.com/@aivisberzins");
  assert.equal(withName.value.watchUrl, "https://www.tiktok.com/@aivisberzins/live");
  const noName = await getAuthenticatedAccount("tiktok", {
    env,
    accessToken: "at-tik",
    httpFetch: async () => ({ ok: true, status: 200, json: async () => ({ data: { user: { open_id: "open-2", display_name: "No Handle" } } }) })
  });
  assert.equal(noName.ok, true, "a missing username never blocks the connection");
  assert.equal(noName.value.providerUserId, "open-2");
  assert.equal(noName.value.displayName, "No Handle");
  assert.equal(noName.value.profileUrl, "");
});

test("TikTok user info failure reports a safe reason and never leaks the access token", async () => {
  const denied = await getAuthenticatedAccount("tiktok", {
    env,
    accessToken: "super-secret-access-token",
    httpFetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { code: "scope_not_authorized", message: "Scope not authorized" } }) })
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "Could not load the TikTok account");
  assert.equal(denied.logCode, "scope_not_authorized");
  const dump = JSON.stringify(denied);
  assert.equal(dump.includes("super-secret-access-token"), false);
  assert.equal(dump.includes(env.TIKTOK_CLIENT_SECRET), false);
});

// ---------------------------------------------------------------------------
// 8 + 9. Persistence, refresh, disconnect, isolation, secrets
// ---------------------------------------------------------------------------

test("a persisted TikTok connection still reads as CONNECTED and carries no secrets", () => {
  const row = {
    id: "row-1",
    discord_user_id: USER_A,
    provider: "tiktok",
    provider_user_id: "open-9",
    provider_login: "open-9",
    display_name: "Aivis",
    profile_url: "",
    watch_url: "",
    profile_image_url: "https://cdn.example/a.png",
    verified: 1,
    token_enc: "encrypted-access",
    refresh_enc: "encrypted-refresh",
    token_expires_at: 1,
    token_scope: "user.info.basic",
    connected_at: "2026-10-05T00:00:00.000Z",
    created_at: "",
    updated_at: ""
  };
  const account = publicStreamingAccount(row);
  assert.equal(account.verified, true, "F5/refresh still shows CONNECTED");
  assert.equal(account.verification, "oauth");
  assert.equal(account.providerUserId, "open-9");
  assert.equal(account.displayName, "Aivis");
  assert.equal("token_enc" in account, false);
  assert.equal("refresh_enc" in account, false);
  assert.equal(streamingAccountHasSecrets({ accounts: [account] }), false);
});

test("the callback stores the account for the Discord user who started the flow", () => {
  const start = workerSrc.indexOf("async function streamingOAuthCallback");
  assert.ok(start >= 0, "callback present");
  const cb = workerSrc.slice(start, start + 2600);
  assert.ok(cb.includes("validateStreamingOAuthState(stateToken,{secret:env.SESSION_SECRET,expectedProvider:p})"), "state is validated");
  assert.ok(cb.includes("String(sessionUser.id)!==String(state.discordUserId)"), "a signed-in user cannot complete another user's flow");
  assert.ok(cb.includes("streaming_oauth_nonce SET used=1"), "state/nonce is single use");
  assert.ok(cb.includes("await persistVerifiedStreamingAccount(env,state.discordUserId,identity.value,tokens)"), "persisted against the state's Discord user");
  assert.ok(cb.includes('stage:"token"'), "token failures are logged");
  assert.ok(cb.includes("identity.logCode||"), "provider error code reaches the diagnostic log");
  const persist = workerSrc.slice(workerSrc.indexOf("async function persistVerifiedStreamingAccount"), workerSrc.indexOf("async function persistVerifiedStreamingAccount") + 1600);
  assert.ok(persist.includes("verified=1"), "row is verified");
  assert.ok(persist.includes("WHERE discord_user_id=? AND provider=?"), "upsert is scoped to the Discord user + provider");
});

test("disconnect removes only the caller's TikTok row and cross-user changes are denied", async () => {
  const del = workerSrc.slice(workerSrc.indexOf("async function deleteStreamingAccount"), workerSrc.indexOf("async function deleteStreamingAccount") + 1400);
  assert.ok(del.includes("loadProfileAccount(env,user.id,p)"), "looks up the caller's own row");
  assert.ok(del.includes("DELETE FROM user_streaming_accounts WHERE discord_user_id=? AND provider=?"), "row removed for that user + provider only");
  assert.ok(del.includes("bind(user.id,p)"), "the Discord id comes from the session, never the request body");
  assert.equal(decideProfileStreamingMutation({ actorId: USER_A, targetUserId: USER_A }).ok, true);
  const cross = decideProfileStreamingMutation({ actorId: USER_A, targetUserId: USER_B });
  assert.equal(cross.ok, false);
  assert.equal(cross.status, 403);
  // The profile state route never accepts a user id from the client:
  const state = workerSrc.slice(workerSrc.indexOf("async function streamingAccountsState"), workerSrc.indexOf("async function streamingAccountsState") + 900);
  assert.ok(state.includes("WHERE discord_user_id=?"), "reads by session user id");
});

test("the Profile row shows the connected account without exposing raw ids as handles", () => {
  assert.ok(uiSrc.includes("[\"twitch\",\"tiktok\",\"kick\"].map"), "all three providers rendered");
  assert.ok(uiSrc.includes("StreamingStatusBadge on>CONNECTED"), "CONNECTED badge");
  assert.ok(uiSrc.includes(">Disconnect<"), "Disconnect action");
  assert.ok(uiSrc.includes("View Channel"), "View Channel action when a profile URL exists");
  assert.ok(
    uiSrc.includes("row.providerLogin&&row.providerLogin!==row.providerUserId"),
    "a TikTok open_id is never displayed as an @handle"
  );
});

// ---------------------------------------------------------------------------
// 13. Twitch and Kick stay untouched
// ---------------------------------------------------------------------------

test("Twitch account lookup is unchanged", async () => {
  const ok = await getAuthenticatedAccount("twitch", {
    env: { TWITCH_CLIENT_ID: "tid" },
    accessToken: "access",
    httpFetch: async (url) => {
      assert.equal(url, "https://api.twitch.tv/helix/users");
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "99", login: "demo", display_name: "Demo", profile_image_url: "" }] }) };
    }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.provider, "twitch");
  assert.equal(ok.value.providerLogin, "demo");
  assert.equal(ok.value.profileUrl, "https://www.twitch.tv/demo");
  assert.equal("logCode" in ok, false, "Twitch path untouched");
});

test("Kick account lookup is unchanged", async () => {
  const ok = await getAuthenticatedAccount("kick", {
    env: { KICK_CLIENT_ID: "kid" },
    accessToken: "access",
    httpFetch: async (url) => {
      assert.equal(url, "https://api.kick.com/public/v1/users");
      return { ok: true, status: 200, json: async () => ({ data: [{ user_id: 7, name: "kickuser", profile_picture: "" }] }) };
    }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.provider, "kick");
  assert.equal(ok.value.providerUserId, "7");
  assert.equal(ok.value.profileUrl, "https://kick.com/kickuser");
});
