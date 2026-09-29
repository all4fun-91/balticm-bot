import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { routeAccessKey } from "../access-control.js";
import { autoStreamerRowsForGuilds, mapProfileAccountRow, providerCapabilities, shouldAnnounceLive, shouldDeleteLiveAnnouncement } from "../streamers.js";
import {
  buildAuthorizationUrl,
  createPkcePair,
  createStreamingOAuthState,
  decryptStreamingSecret,
  encryptStreamingSecret,
  exchangeAuthorizationCode,
  getAuthenticatedAccount,
  normalizeOAuthAccount,
  publicStreamingAccount,
  readStreamingOAuthCallbackFields,
  streamingAccountHasSecrets,
  streamingOAuthAvailability,
  streamingOAuthCallbackUrl,
  streamingOAuthPublicStatus,
  streamingProfileNoticeFromSearch,
  strippedStreamingOAuthSearch,
  validateStreamingOAuthState,
  youtubeAccountUserMessage,
  youtubeTokenUserMessage
} from "../streaming-oauth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const SECRET = "streaming-oauth-test-secret";
const USER_A = "333333333333333333";
const USER_B = "444444444444444444";

async function stateFor(provider, user = USER_A) {
  return createStreamingOAuthState({ secret: SECRET, discordUserId: user, provider });
}

test("Twitch YouTube TikTok Kick OAuth state generation and validation", async () => {
  for (const provider of ["twitch", "youtube", "tiktok", "kick"]) {
    const created = await stateFor(provider);
    assert.equal(created.ok, true);
    const ok = await validateStreamingOAuthState(created.token, { secret: SECRET, expectedProvider: provider, expectedUserId: USER_A });
    assert.equal(ok.ok, true);
    assert.equal(ok.discordUserId, USER_A);
    assert.equal(ok.provider, provider);
    assert.equal(ok.nonce, created.nonce);
  }
});

test("callback cannot link account to another Discord user", async () => {
  const created = await stateFor("twitch", USER_A);
  const mismatch = await validateStreamingOAuthState(created.token, { secret: SECRET, expectedProvider: "twitch", expectedUserId: USER_B });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "user_mismatch");
});

test("invalid expired and provider mismatch state are rejected", async () => {
  assert.equal((await validateStreamingOAuthState("not-a-token", { secret: SECRET })).ok, false);
  const created = await stateFor("twitch");
  const expired = await validateStreamingOAuthState(created.token, { secret: SECRET, expectedProvider: "twitch", now: Date.now() + 20 * 60 * 1000 });
  assert.equal(expired.ok, false);
  const mismatch = await validateStreamingOAuthState(created.token, { secret: SECRET, expectedProvider: "youtube" });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "provider_mismatch");
});

test("one verified account per provider and all four platforms for the same user", () => {
  const accounts = [
    normalizeOAuthAccount("twitch", { id: "1", login: "a", displayName: "A" }).value,
    normalizeOAuthAccount("youtube", { id: "UCabcdefghijklmnopqrstuv", login: "yt", displayName: "YT" }).value,
    normalizeOAuthAccount("tiktok", { id: "open1", login: "clip", displayName: "Clip" }).value,
    normalizeOAuthAccount("kick", { id: "9", login: "kickuser", displayName: "Kick" }).value
  ];
  const keys = accounts.map((a) => USER_A + ":" + a.provider);
  assert.equal(new Set(keys).size, 4);
  assert.equal(accounts.every((a) => a.ok !== false && a.providerUserId), true);
});

test("reconnect replaces the same Discord user + provider identity", () => {
  const first = normalizeOAuthAccount("twitch", { id: "11", login: "old", displayName: "Old" }).value;
  const next = normalizeOAuthAccount("twitch", { id: "11", login: "newlogin", displayName: "New" }).value;
  assert.equal(first.provider, next.provider);
  assert.equal(first.providerUserId, next.providerUserId);
  assert.notEqual(first.providerLogin, next.providerLogin);
});

test("tokens never appear in Profile or Streamers public payloads", () => {
  const row = {
    id: "1",
    discord_user_id: USER_A,
    provider: "twitch",
    provider_user_id: "99",
    provider_login: "demo",
    display_name: "Demo",
    profile_url: "https://www.twitch.tv/demo",
    watch_url: "https://www.twitch.tv/demo",
    profile_image_url: "https://static-cdn.jtvnw.net/x.png",
    verified: 1,
    token_enc: "secret-access",
    refresh_enc: "secret-refresh",
    token_expires_at: 1,
    connected_at: "",
    created_at: "",
    updated_at: ""
  };
  const profile = publicStreamingAccount(row);
  const studio = mapProfileAccountRow(row);
  assert.equal(profile.verified, true);
  assert.equal(profile.verification, "oauth");
  assert.equal(streamingAccountHasSecrets(profile), false);
  assert.equal(streamingAccountHasSecrets(studio), false);
  assert.equal("token_enc" in profile, false);
  assert.equal("access_token" in profile, false);
});

test("missing provider credentials are reported safely", () => {
  const twitch = streamingOAuthPublicStatus("twitch", {});
  assert.equal(twitch.available, false);
  assert.equal(twitch.message, "Connection temporarily unavailable");
  assert.equal(JSON.stringify(twitch).includes("TWITCH_CLIENT_SECRET"), false);
  const names = streamingOAuthAvailability("twitch", {}).missingNames;
  assert.ok(names.includes("TWITCH_CLIENT_ID"));
});

test("Profile streaming accounts payload stays JSON when no accounts exist", () => {
  const payload = {
    accounts: [],
    oauth: {
      twitch: streamingOAuthPublicStatus("twitch", {}),
      youtube: streamingOAuthPublicStatus("youtube", {}),
      tiktok: streamingOAuthPublicStatus("tiktok", {}),
      kick: streamingOAuthPublicStatus("kick", {})
    },
    providers: providerCapabilities({})
  };
  assert.equal(streamingAccountHasSecrets(payload), false);
  assert.equal(streamingAccountHasSecrets(payload.accounts), false);
  assert.match(JSON.stringify(payload.providers), /TWITCH_CLIENT_SECRET/);
  assert.match(workerSrc, /credentialKeys,\.\.\.rest/);
  assert.match(workerSrc, /return json\(\{accounts:\[\],oauth,providers:\[\]\}\)/);
});

test("legacy manual URL is not verified until OAuth upgrades it", () => {
  const legacy = publicStreamingAccount({
    discord_user_id: USER_A,
    provider: "twitch",
    provider_user_id: "demo",
    provider_login: "demo",
    display_name: "demo",
    verified: 0
  });
  assert.equal(legacy.verified, false);
  assert.equal(legacy.verification, "legacy");
  const upgraded = publicStreamingAccount({ ...legacy, verified: 1, provider_user_id: "12345", providerUserId: "12345" });
  assert.equal(upgraded.verified, true);
  assert.equal(upgraded.verification, "oauth");
});

test("Premium guilds use verified Profile connections only", () => {
  const accounts = [
    { discordUserId: USER_A, provider: "twitch", verified: true },
    { discordUserId: USER_A, provider: "youtube", verified: false }
  ];
  const rows = autoStreamerRowsForGuilds({
    accounts,
    guilds: [
      { id: "100000000000000001", premium: true, memberIds: [USER_A] },
      { id: "200000000000000002", premium: false, memberIds: [USER_A] }
    ]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "twitch");
  assert.equal(rows[0].guildId, "100000000000000001");
});

test("authorization URLs and PKCE stay provider-specific", async () => {
  const origin = "https://bot.balticm.eu";
  const env = {
    TWITCH_CLIENT_ID: "tid",
    TWITCH_CLIENT_SECRET: "tsec",
    GOOGLE_CLIENT_ID: "gid",
    GOOGLE_CLIENT_SECRET: "gsec",
    TIKTOK_CLIENT_KEY: "tik",
    TIKTOK_CLIENT_SECRET: "tis",
    KICK_CLIENT_ID: "kid",
    KICK_CLIENT_SECRET: "ksec"
  };
  const created = await stateFor("twitch");
  const twitch = buildAuthorizationUrl("twitch", { origin, env, state: created.token });
  assert.equal(twitch.ok, true);
  assert.match(twitch.url, /id\.twitch\.tv/);
  assert.equal(streamingOAuthCallbackUrl(origin, "twitch"), "https://bot.balticm.eu/api/profile/streaming/twitch/callback");
  const ytState = await stateFor("youtube");
  const ytPkce = await createPkcePair();
  const yt = buildAuthorizationUrl("youtube", { origin, env, state: ytState.token, pkce: ytPkce });
  assert.match(yt.url, /accounts\.google\.com/);
  assert.match(yt.url, /youtube\.readonly/);
  assert.equal(yt.redirectUri, "https://bot.balticm.eu/api/profile/streaming/youtube/callback");
  assert.match(yt.url, /code_challenge/);
  assert.equal(twitch.url.includes("code_challenge"), false);
  const pkce = await createPkcePair();
  const kick = buildAuthorizationUrl("kick", { origin, env, state: created.token, pkce });
  assert.equal(kick.ok, true);
  assert.match(kick.url, /code_challenge/);
  const tiktok = buildAuthorizationUrl("tiktok", { origin, env, state: created.token, pkce });
  assert.match(tiktok.url, /tiktok\.com/);
});

test("token encryption round-trip does not leave plaintext in storage blob", async () => {
  const blob = await encryptStreamingSecret("refresh-token-value", SECRET);
  assert.equal(blob.includes("refresh-token-value"), false);
  assert.equal(await decryptStreamingSecret(blob, SECRET), "refresh-token-value");
  assert.equal(await decryptStreamingSecret(blob, "other"), "");
});

test("worker OAuth routes and LIVE lifecycle remain intact", () => {
  assert.equal(routeAccessKey("/api/profile/streaming/twitch/connect"), null);
  assert.match(workerSrc, /streamingOAuthCallback\(req,env/);
  assert.match(workerSrc, /profile\\\/streaming/);
  assert.match(workerSrc, /Connect the platform to verify ownership/);
  assert.equal(shouldAnnounceLive({ autoAnnounce: true, enabled: true, lastAnnouncedSessionId: "" }, { status: "live", sessionId: "s1" }), true);
  assert.equal(shouldDeleteLiveAnnouncement({ announcementMessageId: "9", nextStatus: "unknown", liveDetection: false }), false);
  assert.match(workerSrc, /last_announced_session_id!=\?/);
});

test("YouTube token exchange uses Control Center callback and maps Google errors", async () => {
  const origin = "https://bot.balticm.eu";
  const env = { GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsec" };
  let captured = "";
  const tokens = await exchangeAuthorizationCode("youtube", {
    origin,
    env,
    code: "auth-code",
    codeVerifier: "verifier-1",
    httpFetch: async (url, init) => {
      captured = String(init.body || "");
      assert.equal(url, "https://oauth2.googleapis.com/token");
      return { ok: false, json: async () => ({ error: "redirect_uri_mismatch" }) };
    }
  });
  assert.match(captured, /redirect_uri=https%3A%2F%2Fbot.balticm.eu%2Fapi%2Fprofile%2Fstreaming%2Fyoutube%2Fcallback/);
  assert.match(captured, /code_verifier=verifier-1/);
  assert.equal(tokens.ok, false);
  assert.equal(tokens.error, "YouTube is not configured with the Control Center callback URL.");
  assert.equal(youtubeTokenUserMessage({ error: "invalid_client" }), "YouTube connection is not configured.");
});

test("YouTube callback success and error paths including invalid state", async () => {
  const origin = "https://bot.balticm.eu";
  const env = { GOOGLE_CLIENT_ID: "gid" };
  const ok = await getAuthenticatedAccount("youtube", {
    env,
    accessToken: "access",
    httpFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ id: "UCabcdefghijklmnopqrstuvwx", snippet: { title: "Baltic Live", customUrl: "@baltic", thumbnails: { default: { url: "https://img.example/yt.png" } } } }] })
    })
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.displayName, "Baltic Live");
  const denied = await getAuthenticatedAccount("youtube", {
    env,
    accessToken: "access",
    httpFetch: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "YouTube Data API v3 has not been used", errors: [{ reason: "accessNotConfigured" }] } })
    })
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "YouTube Data API is not enabled for this Google project.");
  assert.equal(youtubeAccountUserMessage({}, 200), "This Google account has no YouTube channel");
  const created = await stateFor("youtube");
  const invalid = await validateStreamingOAuthState("not-valid", { secret: SECRET, expectedProvider: "youtube" });
  assert.equal(invalid.ok, false);
  const mismatch = await validateStreamingOAuthState(created.token, { secret: SECRET, expectedProvider: "twitch" });
  assert.equal(mismatch.ok, false);
  const fields = await readStreamingOAuthCallbackFields(new Request("https://bot.balticm.eu/api/profile/streaming/youtube/callback?error=access_denied&state=abc"));
  assert.equal(fields.error, "access_denied");
  const posted = await readStreamingOAuthCallbackFields(new Request("https://bot.balticm.eu/api/profile/streaming/youtube/callback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "code=ok-code&state=ok-state"
  }));
  assert.equal(posted.code, "ok-code");
  assert.equal(posted.state, "ok-state");
});

test("Profile OAuth query parameters are cleaned after the result is read", () => {
  const err = streamingProfileNoticeFromSearch("?streaming_error=The+connection+could+not+be+completed.");
  assert.equal(err.notice, "The connection could not be completed.");
  assert.equal(err.shouldClean, true);
  const ok = streamingProfileNoticeFromSearch("?streaming=connected&platform=youtube");
  assert.equal(ok.notice, "Account connected.");
  const success = streamingProfileNoticeFromSearch("?streaming_success=YouTube+connected");
  assert.equal(success.notice, "YouTube connected");
  assert.equal(strippedStreamingOAuthSearch("?streaming_error=x&platform=youtube&tab=1"), "tab=1");
  const ui = readFileSync(join(root, "src/Streamers.jsx"), "utf8");
  assert.match(ui, /history\.replaceState/);
  assert.match(ui, /strippedStreamingOAuthSearch/);
  assert.match(workerSrc, /p==="kick"\|\|p==="tiktok"\|\|p==="youtube"/);
});
