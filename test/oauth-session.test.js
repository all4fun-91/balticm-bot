import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  COOKIE_SESSION,
  COOKIE_STATE,
  attachRefreshedSessionCookie,
  buildAuthSessionPayload,
  compactAccessibleGuilds,
  createSignedOAuthState,
  cookieHeader,
  handleAuthMe,
  runOAuthCallback,
  signPayload,
  validateOAuthState,
  verifyPayload
} from "../oauth-session.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const SECRET = "test-session-secret-oauth-regression";

function mockDiscordFetch({ user, guilds, tokenOk = true, meOk = true }) {
  return async (url, init) => {
    const u = String(url);
    if (u.includes("/oauth2/token")) {
      return {
        ok: tokenOk,
        json: async () => tokenOk ? { access_token: "tok" } : { error: "invalid" }
      };
    }
    if (u.includes("/users/@me/guilds")) {
      return { ok: true, json: async () => guilds };
    }
    if (u.includes("/users/@me")) {
      return { ok: meOk, json: async () => user };
    }
    throw new Error("unexpected fetch " + u + " " + (init?.method || ""));
  };
}

test("signed OAuth state validates even when the state cookie is missing", async () => {
  const { nonce, token } = await createSignedOAuthState(SECRET);
  const ok = await validateOAuthState(token, "", SECRET);
  assert.equal(ok.ok, true);
  assert.equal(ok.nonce, nonce);
});

test("legacy UUID state still validates when cookie matches", async () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const ok = await validateOAuthState(uuid, uuid, SECRET);
  assert.equal(ok.ok, true);
});

test("OAuth state fails when query is missing, mismatched, or forged", async () => {
  const { token } = await createSignedOAuthState(SECRET);
  assert.equal((await validateOAuthState("", "nonce", SECRET)).ok, false);
  assert.equal((await validateOAuthState(token, "stale-login-cookie", SECRET)).ok, true);
  assert.equal((await validateOAuthState("forged.payload", "", SECRET)).ok, false);
  assert.equal((await validateOAuthState("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "", SECRET)).ok, false);
});

test("successful callback creates session cookie without requiring owner/manage/RBAC", async () => {
  const { nonce, token } = await createSignedOAuthState(SECRET);
  const user = { id: "42", username: "aivis", global_name: "Aivis", avatar: "abc" };
  const req = new Request("https://bot.balticm.eu/api/auth/callback?code=ok&state=" + encodeURIComponent(token), {
    headers: { Cookie: `${COOKIE_STATE}=${nonce}` }
  });
  const res = await runOAuthCallback(req, {
    SESSION_SECRET: SECRET,
    DISCORD_CLIENT_SECRET: "discord-secret"
  }, {
    clientId: "1543137268221354035",
    publicOrigin: "https://bot.balticm.eu",
    redirectUri: "https://bot.balticm.eu/api/auth/callback",
    fetchFn: mockDiscordFetch({
      user,
      guilds: [{ id: "99", name: "Member Only", permissions: "0", owner: false }]
    }),
    discoverAccessibleGuilds: async () => {
      throw new Error("RBAC/guild discovery must not block login");
    }
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "/");
  const setCookie = res.headers.get("Set-Cookie") || "";
  assert.equal(setCookie.includes(", balticm_"), false, "must not combine multiple Set-Cookie values");
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [setCookie];
  assert.equal(cookies.filter((c) => c.startsWith(COOKIE_SESSION + "=")).length, 1);
  const sessionLine = cookies.find((c) => c.startsWith(COOKIE_SESSION + "="));
  assert.ok(sessionLine, "balticm_session Set-Cookie must be present");
  assert.match(sessionLine, /Path=\//);
  assert.match(sessionLine, /HttpOnly/);
  assert.match(sessionLine, /Secure/);
  assert.match(sessionLine, /SameSite=Lax/);
  const raw = sessionLine.split(";")[0].slice(COOKIE_SESSION.length + 1);
  const session = await verifyPayload(raw, SECRET);
  assert.equal(session.id, "42");
  assert.equal(session.username, "aivis");
  assert.deepEqual(session.guilds, []);
});

test("successful callback still attaches accessible guilds when discovery succeeds", async () => {
  const { token } = await createSignedOAuthState(SECRET);
  const req = new Request("https://bot.balticm.eu/api/auth/callback?code=ok&state=" + encodeURIComponent(token));
  const res = await runOAuthCallback(req, {
    SESSION_SECRET: SECRET,
    DISCORD_CLIENT_SECRET: "discord-secret"
  }, {
    clientId: "cid",
    publicOrigin: "https://bot.balticm.eu",
    redirectUri: "https://bot.balticm.eu/api/auth/callback",
    fetchFn: mockDiscordFetch({
      user: { id: "7", username: "owner", global_name: "Owner", avatar: null },
      guilds: [{ id: "100", name: "Baltic Mayhem", icon: "ico", owner: true, permissions: "8" }]
    }),
    discoverAccessibleGuilds: async (_id, gs) => gs.filter((g) => g.owner)
  });
  const cookies = res.headers.getSetCookie();
  const sessionLine = cookies.find((c) => c.startsWith(COOKIE_SESSION + "="));
  const raw = sessionLine.split(";")[0].slice(COOKIE_SESSION.length + 1);
  const session = await verifyPayload(raw, SECRET);
  assert.equal(session.guilds[0].id, "100");
  assert.equal(session.guilds[0].owner, true);
});

test("invalid or missing OAuth state redirects without a session cookie", async () => {
  const req = new Request("https://bot.balticm.eu/api/auth/callback?code=ok&state=wrong", {
    headers: { Cookie: `${COOKIE_STATE}=expected` }
  });
  const res = await runOAuthCallback(req, {
    SESSION_SECRET: SECRET,
    DISCORD_CLIENT_SECRET: "discord-secret"
  }, {
    clientId: "cid",
    publicOrigin: "https://bot.balticm.eu",
    redirectUri: "https://bot.balticm.eu/api/auth/callback",
    fetchFn: async () => {
      throw new Error("Discord must not be called for invalid state");
    }
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("Location"), "https://bot.balticm.eu/?auth=invalid");
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  assert.equal(cookies.some((c) => c.startsWith(COOKIE_SESSION + "=") && !c.includes("Max-Age=0")), false);
});

test("compactAccessibleGuilds caps session size", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: String(1000 + i), name: "G" + i, icon: null, owner: false }));
  assert.equal(compactAccessibleGuilds(many).length, 30);
});

test("create session cookie then /api/auth/me authenticates with the same sign/verify functions", async () => {
  const user = { id: "293469802188636160", username: "aivis", global_name: "Aivis", avatar: "abc" };
  const payload = buildAuthSessionPayload(user, [{ id: "884027552174317569", name: "Baltic | Mayhem", icon: null, owner: true }]);
  const token = await signPayload(payload, SECRET);
  const serialized = cookieHeader(COOKIE_SESSION, token, 86400);
  const raw = serialized.split(";")[0].slice(COOKIE_SESSION.length + 1);
  assert.equal(raw, token);
  const req = new Request("https://bot.balticm.eu/api/auth/me", {
    headers: { Cookie: `${COOKIE_SESSION}=${raw}` }
  });
  const res = await handleAuthMe(req, { SESSION_SECRET: SECRET }, {
    refreshGuilds: async (sessionUser) => sessionUser.guilds
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.user.id, user.id);
  assert.equal(body.user.username, "aivis");
  assert.equal(body.user.guilds[0].id, "884027552174317569");
});

test("callback session cookie is accepted by the production /api/auth/me handler", async () => {
  const { token } = await createSignedOAuthState(SECRET);
  const callbackRes = await runOAuthCallback(
    new Request("https://bot.balticm.eu/api/auth/callback?code=ok&state=" + encodeURIComponent(token)),
    { SESSION_SECRET: SECRET, DISCORD_CLIENT_SECRET: "discord-secret" },
    {
      clientId: "cid",
      publicOrigin: "https://bot.balticm.eu",
      redirectUri: "https://bot.balticm.eu/api/auth/callback",
      fetchFn: mockDiscordFetch({
        user: { id: "9", username: "login", global_name: "Login", avatar: null },
        guilds: []
      })
    }
  );
  const sessionLine = callbackRes.headers.getSetCookie().find((c) => c.startsWith(COOKIE_SESSION + "="));
  const raw = sessionLine.split(";")[0].slice(COOKIE_SESSION.length + 1);
  const meRes = await handleAuthMe(
    new Request("https://bot.balticm.eu/api/auth/me", { headers: { Cookie: `${COOKIE_SESSION}=${raw}` } }),
    { SESSION_SECRET: SECRET }
  );
  assert.equal(meRes.status, 200);
  const body = await meRes.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.user.id, "9");
});

test("auth/me cookie refresh failure still leaves the user authenticated", async () => {
  const headers = new Headers();
  const attached = await attachRefreshedSessionCookie(headers, buildAuthSessionPayload({ id: "1", username: "x" }, []), SECRET, async () => {
    throw new Error("sign failed");
  });
  assert.equal(attached, false);
  assert.equal(headers.get("Set-Cookie"), null);
});

test("worker wires login/callback through oauth-session and does not use Set-Cookie-2", () => {
  assert.match(workerSrc, /from "\.\/oauth-session\.js"/);
  assert.match(workerSrc, /createSignedOAuthState/);
  assert.match(workerSrc, /runOAuthCallback/);
  assert.match(workerSrc, /handleAuthMe/);
  assert.match(workerSrc, /resolveSession/);
  assert.match(workerSrc, /filterOAuthGuilds/);
  assert.doesNotMatch(workerSrc, /Set-Cookie-2/);
  assert.doesNotMatch(workerSrc, /discoverAccessibleGuildsFromOAuth\(env,user\.id/);
  assert.match(workerSrc, /scope","identify guilds"/);
});
