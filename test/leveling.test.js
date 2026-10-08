import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  ALLOWED_ANNOUNCE_PLACEHOLDERS,
  ANNOUNCE_BRANDING,
  DEFAULT_ANNOUNCE_CARD,
  DEFAULT_ANNOUNCE_MESSAGE,
  FREE_REWARD_ROLE_LIMIT,
  LEVELING_DEFAULTS,
  LEADERBOARD_COMMAND_DEFINITION,
  RANK_COMMAND_DEFINITION,
  clampXp,
  isSnowflake,
  levelForXp,
  levelProgress,
  messageSignature,
  parseAnnounceCard,
  parseLevelingSettings,
  parseReward,
  parseXpAction,
  planLevelingCommandSync,
  renderAnnounceMessage,
  renderLevelUpCard,
  rewardLimitBlocked,
  sanitizeAnnounceMessage,
  xpForLevel
} from "../leveling.js";
import {
  ensureLevelingTables,
  getLevelingMember,
  setMemberIdentity,
  setMemberTotals
} from "../leveling-db.js";
import {
  levelingAnnounceTest,
  levelingBoard,
  levelingLeaderboardInteraction,
  levelingOverview,
  levelingRankInteraction,
  levelingRewardAdd,
  levelingRewardUpdate,
  levelingServiceMessage,
  levelingServiceState,
  levelingServiceVoice,
  levelingXpAction,
  saveLevelingSettings
} from "../leveling-api.js";
import { ACCESS_KEYS, requiredLevelForRequest, routeAccessKey } from "../access-control.js";
import { PAGE_ACCESS_KEY, PAGE_PATHS } from "../src/control-center-state.js";

/* --------------------------------------------------------------- harness */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const levelingSrc = readFileSync(join(root, "leveling.js"), "utf8");
const apiSrc = readFileSync(join(root, "leveling-api.js"), "utf8");
const levelJsx = readFileSync(join(root, "src/Leveling.jsx"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");
const stateSrc = readFileSync(join(root, "src/control-center-state.js"), "utf8");
const reactionSvc = readFileSync(join(root, "reaction-service/index.js"), "utf8");
const voiceSvc = readFileSync(join(root, "voice-service/src/index.js"), "utf8");

function makeEnv(extra = {}) {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql) => ({
    bind(...args) {
      return {
        first: async () => db.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...args).map((r) => ({ ...r })), success: true }),
        run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } })
      };
    },
    first: async () => db.prepare(sql).get() ?? null,
    all: async () => ({ results: db.prepare(sql).all().map((r) => ({ ...r })), success: true }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run().changes) } })
  });
  return {
    BALTICM_DB: { prepare: stmt, batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; } },
    DISCORD_BOT_TOKEN: "test-token",
    BALTICM_REACTION_SERVICE_SECRET: "reaction-secret",
    BALTICM_VOICE_SERVICE_SECRET: "voice-secret",
    ...extra
  };
}

const req = (path, { method = "GET", body, guildId } = {}) =>
  new Request(`https://bot.balticm.eu${path}${guildId ? `?guildId=${guildId}` : ""}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

// Accepts a Response or a Promise<Response>, so helper call sites can pass
// handler results directly without a double await.
const read = async (pending) => { const res = await pending; return { status: res.status, body: await res.json() }; };

/** Unique guild ids per test isolate the module-level Discord caches. */
let gidCounter = 0;
const nextGuild = () => String(884100000000000000n + BigInt(++gidCounter));
const CHANNEL = "123456789012345678";
const REWARD_ROLE = "123456789012345601";
const REWARD_ROLE_2 = "123456789012345602";
const REWARD_ROLE_3 = "123456789012345603";
const REWARD_ROLE_4 = "123456789012345604";
const IGNORED_ROLE = "123456789012345609";
const BOT_ROLE = "123456789012345600";
const STAFF = "293469802188636160";
const OUTSIDER = "111111111111111111";
const USER_A = "310000000000000001";
const USER_B = "310000000000000002";
const USER_C = "310000000000000003";
const NOT_A_MEMBER = "310000000000000099";
let midCounter = 0;
const mid = () => String(410000000000000000n + BigInt(++midCounter));

const adminOf = (guildId) => ({ id: STAFF, username: "staff", global_name: "Staff", guilds: [{ id: guildId, name: "G" }] });
const outsider = { id: OUTSIDER, username: "outsider", global_name: "Outsider", guilds: [{ id: "987654321098765432", name: "Other" }] };

const ROLES = [
  { id: BOT_ROLE, name: "BalticM", position: 20, managed: true, permissions: "33554432" },
  { id: REWARD_ROLE, name: "Active", position: 8, managed: false },
  { id: REWARD_ROLE_2, name: "Veteran", position: 7, managed: false },
  { id: REWARD_ROLE_3, name: "Elite", position: 6, managed: false },
  { id: REWARD_ROLE_4, name: "Legend", position: 5, managed: false },
  { id: IGNORED_ROLE, name: "Muted", position: 3, managed: false },
  { id: "884100000000000001", name: "@everyone", position: 0, managed: false }
];

const rootFetch = globalThis.fetch;
function stubDiscord({ match, sent, roleGrants } = {}) {
  const j = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  globalThis.fetch = async (input, init = {}) => {
    const u = String((input && input.url) || input);
    if (!u.includes("discord.com/api/v10/")) return rootFetch(input, init);
    if (match) { const custom = match(u, init); if (custom !== undefined) return custom; }
    if (/\/members\/@me$/.test(u)) return j({ roles: [BOT_ROLE] });
    if (/\/roles\/\d+$/.test(u)) { roleGrants?.push({ url: u, method: init.method || "GET" }); return j({}, 200); }
    if (/\/roles$/.test(u)) return j(ROLES);
    if (/\/guilds\/[^/]+\/channels$/.test(u)) return j([{ id: CHANNEL, type: 0, name: "general" }, { id: "222222222222222222", type: 2, name: "voice" }]);
    if (/\/members\/\d+$/.test(u)) {
      const id = (u.match(/\/members\/(\d+)$/) || [])[1];
      // The bot's own member (resolved by explicit user id, like worker.js) —
      // carries the bot's role, which sets the hierarchy ceiling.
      if (id === "1543137268221354035") return j({ roles: [BOT_ROLE] });
      return j({ user: { id, username: "member" + id.slice(-3), global_name: "Member " + id.slice(-3), avatar: "", bot: false }, nick: null, roles: [] });
    }
    if (/\/messages$/.test(u)) { sent?.push(JSON.parse(init.body || "{}")); return j({ id: "posted" }); }
    if (/\/guilds\/[^/]+$/.test(u)) return j({ id: "guild", name: "Test Guild", permissions: "33554432" });
    return j({});
  };
  return () => { globalThis.fetch = rootFetch; };
}

async function setup(guildId, { premium = false } = {}) {
  const env = makeEnv();
  await ensureLevelingTables(env);
  if (premium) {
    await env.BALTICM_DB.prepare(
      "INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
    ).bind(`premium-plan:${guildId}`, JSON.stringify({ plan: "vip", source: "tebex", startsAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z" }), new Date().toISOString()).run();
  }
  return env;
}

const saveSettings = (env, guildId, body) =>
  read(saveLevelingSettings(req("/api/leveling", { method: "POST", guildId, body }), env, adminOf(guildId), guildId));
const sendMsg = (env, body) => read(levelingServiceMessage(req("/api/leveling/service/message", { method: "POST", body }), env));
const sendVoice = (env, body) => read(levelingServiceVoice(req("/api/leveling/service/voice", { method: "POST", body }), env));
const enableBasic = (env, guildId, over = {}) =>
  saveSettings(env, guildId, { enabled: true, minXp: 15, maxXp: 15, messageCooldown: 10, ...over });

const msg = (guildId, userId, over = {}) => ({
  guildId, channelId: CHANNEL, messageId: mid(), userId, username: "user" + userId.slice(-3),
  displayName: "Member " + userId.slice(-3), avatar: "", text: "hello world", ...over
});

/* ------------------------------------------------- level math (shared) */

test("level formula: predictable, integer-safe and clamped", () => {
  assert.equal(xpForLevel(1), 0, "everyone starts at level 1 with 0 XP");
  assert.equal(xpForLevel(2), 100);
  assert.equal(xpForLevel(3), 300);
  assert.equal(xpForLevel(10), 4500);
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(4499), 9);
  assert.equal(levelForXp(4500), 10, "the /rank example Level 10 = 4500 XP");
  assert.equal(levelForXp(-500), 1, "negative XP never produces a negative level");
  assert.equal(clampXp(-500), 0);
  assert.equal(clampXp("abc"), 0);
  assert.equal(levelForXp(Number.MAX_SAFE_INTEGER) > 1, true, "huge XP stays finite");
  // Monotonic: xpForLevel(levelForXp(x)) <= x for a spread of values.
  for (const x of [0, 1, 50, 100, 4499, 4500, 123456, 9e14]) {
    const level = levelForXp(x);
    assert.ok(xpForLevel(level) <= x, `xpForLevel(${level}) <= ${x}`);
    assert.ok(xpForLevel(level + 1) > x || x === Number.MAX_SAFE_INTEGER, `next level above ${x}`);
  }
  const p = levelProgress(4650);
  assert.equal(p.level, 10);
  assert.equal(p.into, 150);
  assert.equal(p.need, xpForLevel(11) - xpForLevel(10));
  assert.ok(p.ratio > 0 && p.ratio < 1);
});

test("announcement sanitisation: no arbitrary mentions, only safe placeholders", () => {
  assert.equal(DEFAULT_ANNOUNCE_MESSAGE, "🎉 {user} reached Level {level}!");
  assert.deepEqual(ALLOWED_ANNOUNCE_PLACEHOLDERS, ["user", "username", "level", "server"]);
  // Save-time: mention-like text and unknown placeholders are stripped.
  assert.equal(sanitizeAnnounceMessage("hey @everyone join <@&123456789012345678> {vip}"), "hey join");
  // Render-time: only the {user} mention survives, everything else neutralised.
  const out = renderAnnounceMessage("{user} hit {level} — thx {username} of {server}", {
    user: USER_A, username: "@everyone", level: 10, server: "<@&123456789012345678> Servers"
  });
  assert.ok(out.includes(`<@${USER_A}>`), "the levelled member is mentioned");
  assert.ok(!out.includes("@everyone"), "usernames can never ping everyone");
  assert.ok(!out.includes("<@&"), "role mentions never render");
  const custom = renderAnnounceMessage("Level {level}!", { user: USER_A, username: "x", level: 3, server: "s" });
  assert.equal(custom, "Level 3!");
  // messageSignature normalises obvious spam variants to one fingerprint.
  assert.equal(messageSignature("Hello!!!   WORLD"), messageSignature("hello world???"));
  assert.notEqual(messageSignature("hello world"), messageSignature("something else"));
});

test("settings validation: bounds, enums and Premium-required violations", () => {
  const clamped = parseLevelingSettings({ enabled: true, minXp: 9999, maxXp: 9999, messageCooldown: 1 }, { premium: false });
  assert.equal(clamped.ok, true, "out-of-range numbers are clamped, not rejected");
  assert.equal(clamped.value.minXp, 100, "clamped to the configured safety bound");
  assert.equal(clamped.value.maxXp, 200, "max XP has its own higher safety bound");
  assert.equal(clamped.value.messageCooldown, 10, "cooldown clamps up to the anti-farm minimum");
  // max < min after clamping is an explicit error.
  const bad = parseLevelingSettings({ minXp: 50, maxXp: 10 }, { premium: false });
  assert.equal(bad.ok, false);
  // Free guild: every Premium-only feature is reported, never silently rewritten.
  const blocked = parseLevelingSettings(
    { enabled: true, voiceXp: true, ignoredChannels: [CHANNEL], ignoredRoles: [IGNORED_ROLE], announceMessage: "custom {level}" },
    { premium: false }
  );
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.premiumRequired.sort(), ["announceMessage", "ignoredChannels", "ignoredRoles", "voiceXp"]);
  // Premium guild accepts the same payload.
  const ok = parseLevelingSettings(
    { enabled: true, voiceXp: true, ignoredChannels: [CHANNEL], ignoredRoles: [IGNORED_ROLE], announceMessage: "custom {level}" },
    { premium: true }
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.value.voiceXp, true);
  // Announce mode "channel" requires a real snowflake channel.
  const noChannel = parseLevelingSettings({ enabled: true, announceMode: "channel", announceChannelId: "nope" }, { premium: true });
  assert.equal(noChannel.ok, false);
  // Invalid announce mode falls back to off.
  const mode = parseLevelingSettings({ enabled: true, announceMode: "sideways" }, {});
  assert.equal(mode.value.announceMode, "off");
});

test("XP action parsing: enums, snowflakes, amounts and reset confirmation", () => {
  assert.equal(parseXpAction({ action: "destroy", userId: USER_A }).ok, false, "unknown actions are rejected");
  assert.equal(parseXpAction({ action: "add", userId: "not-a-snowflake", amount: 5 }).ok, false, "invalid member ids are rejected");
  assert.equal(parseXpAction({ action: "add", userId: USER_A, amount: 0 }).ok, false, "amount must be >= 1");
  assert.equal(parseXpAction({ action: "add", userId: USER_A, amount: 999999999 }).ok, false, "amount is bounded");
  const reset = parseXpAction({ action: "reset", userId: USER_A });
  assert.equal(reset.ok, false, "dangerous reset requires confirmation");
  assert.equal(reset.code, "confirm_required");
  assert.equal(parseXpAction({ action: "reset", userId: USER_A, confirm: true }).ok, true);
  const add = parseXpAction({ action: "add", userId: USER_A, amount: 25, reason: " event " });
  assert.equal(add.value.amount, 25);
  assert.equal(add.value.reason, "event");
  assert.equal(isSnowflake(USER_A), true);
  assert.equal(rewardLimitBlocked(3, false), true, "free servers stop at 3 reward roles");
  assert.equal(rewardLimitBlocked(3, true), false, "premium is unlimited");
  assert.equal(rewardLimitBlocked(50, false), true, "already over the limit — still blocked on Free (no bypass)");
  assert.equal(parseReward({ level: 0, roleId: REWARD_ROLE }).ok, false, "reward levels start at 1");
  assert.equal(parseReward({ level: 5, roleId: "abc" }).ok, false, "raw role ids are rejected");
  assert.equal(parseReward({ level: 5, roleId: REWARD_ROLE }).ok, true);
});

/* ------------------------------------------------------- message XP */

test("message XP: award, cooldown, replay, bot/webhook/DM ignored", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  assert.equal((await enableBasic(env, gid)).status, 200);

  // DM payload (no guild) is structurally impossible to award.
  assert.equal((await sendMsg(env, { channelId: CHANNEL, messageId: mid(), userId: USER_A })).status, 400);

  // Bot and webhook senders are ignored even if a forged service call lands.
  const asBot = await sendMsg(env, msg(gid, USER_A, { messageId: mid(), bot: true }));
  assert.equal(asBot.status, 200);
  assert.equal(asBot.body.ignored, "sender", "bot authors never earn XP");
  const asWebhook = await sendMsg(env, msg(gid, USER_A, { messageId: mid(), webhookId: "1" }));
  assert.equal(asWebhook.status, 200);
  assert.equal(asWebhook.body.ignored, "sender", "webhooks never earn XP");

  // First message awards min=max=15 XP deterministically.
  const m1 = msg(gid, USER_A);
  const first = await sendMsg(env, m1);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.awarded, 15);
  assert.equal(first.body.totalXp, 15);
  assert.equal(first.body.level, 1);

  // Cooldown: an immediate second message is not rewarded.
  const cooldown = await sendMsg(env, msg(gid, USER_A));
  assert.equal(cooldown.body.ignored, "cooldown");
  const row = await getLevelingMember(env, gid, USER_A);
  assert.equal(row.totalXp, 15, "cooldown never double-awards");

  // Replay of the SAME message id is ignored even after the cooldown passes.
  await env.BALTICM_DB.prepare("UPDATE leveling_members SET last_message_at=0 WHERE guild_id=? AND user_id=?").bind(gid, USER_A).run();
  const replay = await sendMsg(env, { ...m1, messageId: m1.messageId });
  assert.equal(replay.body.ignored, "duplicate", "replayed events are ignored");
  const replayRow = await getLevelingMember(env, gid, USER_A);
  assert.equal(replayRow.totalXp, 15, "replays never change XP");

  // After the cooldown, a new message is rewarded again.
  await env.BALTICM_DB.prepare("UPDATE leveling_members SET last_message_at=0 WHERE guild_id=? AND user_id=?").bind(gid, USER_A).run();
  const next = await sendMsg(env, msg(gid, USER_A, { messageId: mid(), text: "a completely different message" }));
  assert.equal(next.body.awarded, 15);
  assert.equal(next.body.totalXp, 30);

  // Obvious repeated spam (same signature as the previous message, cooldown
  // artificially bypassed) is never rewarded.
  await env.BALTICM_DB.prepare("UPDATE leveling_members SET last_message_at=0 WHERE guild_id=? AND user_id=?").bind(gid, USER_A).run();
  const spam = await sendMsg(env, msg(gid, USER_A, { messageId: mid(), text: "a completely different message" }));
  assert.ok(spam.body.ignored, "identical spam inside the window is ignored");
  assert.equal((await getLevelingMember(env, gid, USER_A)).totalXp, 30);

  // Disabled guilds and ignored channels/roles never award.
  const off = nextGuild();
  const env2 = await setup(off);
  assert.equal((await sendMsg(env2, msg(off, USER_A))).body.ignored, "disabled");
});

test("message XP: guild isolation and per-guild configuration", async () => {
  const gid = nextGuild(), other = nextGuild();
  const env = await setup(gid);
  await enableBasic(env, gid);
  const restore = stubDiscord();
  try {
  // other guild stays disabled: identical user, identical event — no award there.
  const a = await sendMsg(env, msg(gid, USER_A));
  const b = await sendMsg(env, msg(other, USER_A));
  assert.equal(a.body.awarded, 15);
  assert.equal(b.body.ignored, "disabled", "configuration is per guild");
  assert.equal(await getLevelingMember(env, other, USER_A), null, "no cross-guild row bleed");

  // Ignored channel + ignored role (premium guild so the ignore list is legal).
  const g2 = nextGuild();
  const env2 = await setup(g2, { premium: true });
  const saved = await saveSettings(env2, g2, { enabled: true, minXp: 15, maxXp: 15, messageCooldown: 10, ignoredChannels: [CHANNEL], ignoredRoles: [IGNORED_ROLE] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await sendMsg(env2, msg(g2, USER_A))).body.ignored, "channel");
  const notIgnored = await sendMsg(env2, msg(g2, USER_A, { channelId: "333333333333333333" }));
  assert.equal(notIgnored.body.awarded, 15, "other channels still work");
  const roleIgnored = await sendMsg(env2, msg(g2, USER_B, { channelId: "333333333333333333", memberRoleIds: [IGNORED_ROLE] }));
  assert.equal(roleIgnored.body.ignored, "role");
  const roleOk = await sendMsg(env2, msg(g2, USER_C, { channelId: "333333333333333333", memberRoleIds: [REWARD_ROLE] }));
  assert.equal(roleOk.body.awarded, 15, "non-ignored roles still earn");
  } finally { restore(); }
});

test("overview: daily XP / message counters and highest-level member", async () => {
  const gid = nextGuild();
  const env = await setup(gid, { premium: true });
  await enableBasic(env, gid, { voiceXp: true });
  await sendMsg(env, msg(gid, USER_A));
  await sendMsg(env, msg(gid, USER_B));
  await setMemberIdentity(env, gid, USER_A, { username: "alpha", displayName: "Alpha", avatar: "" });
  await setMemberIdentity(env, gid, USER_B, { username: "beta", displayName: "Beta", avatar: "" });
  await setMemberTotals(env, gid, USER_B, { totalXp: 4500, messageXp: 4500, voiceXp: 0 });
  const res = await read(levelingOverview(req("/api/leveling", { guildId: gid }), env, adminOf(gid), gid));
  assert.equal(res.status, 200);
  assert.equal(res.body.stats.membersWithXp, 2);
  assert.equal(res.body.stats.xpToday, 30, "15 + 15 awarded today");
  assert.equal(res.body.stats.messagesToday, 2);
  assert.equal(res.body.stats.topMember.displayName, "Beta");
  assert.equal(res.body.stats.topMember.level, 10);
  assert.equal(res.body.premium, true);
  assert.equal(res.body.freeRewardLimit, FREE_REWARD_ROLE_LIMIT);
  // Cross-guild overview: the OTHER guild sees nothing from this guild.
  const other = nextGuild();
  await setup(other);
  const cross = await read(levelingOverview(req("/api/leveling", { guildId: other }), env, adminOf(other), other));
  assert.equal(cross.body.stats.membersWithXp, 0, "stats never leak across guilds");
});

/* ----------------------------------------------- level-up + announcements */

test("level-up announcement fires exactly once per crossing (idempotent)", async () => {
  const gid = nextGuild();
  const env = await setup(gid, { premium: true });
  const sent = [];
  const restore = stubDiscord({ sent });
  try {
    await enableBasic(env, gid, { minXp: 100, maxXp: 100, announceMode: "same_channel" });
    const first = await sendMsg(env, msg(gid, USER_A)); // 100 XP → Level 2
    assert.equal(first.body.level, 2);
    assert.equal(first.body.leveledUp, true);
    assert.equal(sent.length, 1, "one announcement for the level-up");
    assert.ok(sent[0].content.includes(`<@${USER_A}>`), "the member is mentioned");
    assert.ok(sent[0].content.includes("Level 2"));
    assert.deepEqual(sent[0].allowed_mentions, { parse: [], users: [USER_A] }, "no arbitrary mentions can fire");

    // A NEW message below the next level threshold never announces …
    await env.BALTICM_DB.prepare("UPDATE leveling_members SET last_message_at=0 WHERE guild_id=? AND user_id=?").bind(gid, USER_A).run();
    const plateau = await sendMsg(env, msg(gid, USER_A, { text: "different text again" })); // 200 XP → still Level 2
    assert.equal(plateau.body.leveledUp, false, "no level crossing → no announcement");
    assert.equal(sent.length, 1, "no announcement without a crossing");

    // … the NEXT crossing announces exactly once …
    await env.BALTICM_DB.prepare("UPDATE leveling_members SET last_message_at=0 WHERE guild_id=? AND user_id=?").bind(gid, USER_A).run();
    const m3 = msg(gid, USER_A, { text: "third distinct message" });
    const again = await sendMsg(env, m3); // 300 XP → Level 3
    assert.equal(again.body.leveledUp, true);
    assert.equal(sent.length, 2, "each NEW level announces once");
    // … while replaying that SAME event never re-announces.
    await env.BALTICM_DB.prepare("UPDATE leveling_members SET last_message_at=0 WHERE guild_id=? AND user_id=?").bind(gid, USER_A).run();
    const replay = await sendMsg(env, { ...m3, text: "third distinct message" });
    assert.equal(replay.body.ignored, "duplicate", "duplicates never re-announce");
    assert.equal(sent.length, 2, "duplicates never re-announce");
  } finally { restore(); }
});

test("announcements respect off/custom modes and disabled state", async () => {
  const gid = nextGuild();
  const env = await setup(gid, { premium: true });
  const sent = [];
  const restore = stubDiscord({ sent });
  try {
    // Default settings: announcements off.
    await enableBasic(env, gid, { minXp: 100, maxXp: 100 });
    const off = await sendMsg(env, msg(gid, USER_A));
    assert.equal(off.body.level, 2);
    assert.equal(sent.length, 0, "announcements are opt-in");
    // Custom premium template with sanitisation applied at save.
    const saved = await saveSettings(env, gid, {
      enabled: true, minXp: 100, maxXp: 100, announceMode: "channel", announceChannelId: CHANNEL,
      announceMessage: "GG {username} → Level {level} @everyone {bogus}"
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.settings.announceMessage, "GG {username} → Level {level}", "unknown placeholders dropped at save");
    await sendMsg(env, msg(gid, USER_B));
    assert.equal(sent.length, 1);
    assert.equal(sent[sent.length - 1].content, "GG Member " + USER_B.slice(-3) + " → Level 2");
  } finally { restore(); }
});

/* ----------------------------------------------------------- voice XP */

test("voice XP: Premium-only, interval-gated, never alone/bot/AFK, reconnect-safe", async () => {
  const gid = nextGuild();
  const free = await setup(gid); // NO premium row
  await enableBasic(free, gid, { voiceXp: true }).then(r => {
    assert.equal(r.status, 403, "free guild cannot enable voice XP");
    assert.equal(r.body.code, "premium_required");
  });
  // A forged voice event from the service toward a FREE guild is rejected.
  const forged = await sendVoice(free, { guildId: gid, members: [{ userId: USER_A }] });
  assert.equal(forged.status, 403, JSON.stringify(forged.body));
  assert.equal(forged.body.code, "premium_required");

  const env = await setup(gid, { premium: true });
  await enableBasic(env, gid, { voiceXp: true, voiceXpAmount: 10, voiceInterval: 15 });
  const base = { userId: USER_A, username: "u", displayName: "U", avatar: "" };
  // First snapshot: clock starts, no instant reward (restart/reconnect safe).
  const t1 = await sendVoice(env, { guildId: gid, members: [{ ...base, bot: false, afk: false, alone: false }] });
  assert.equal(t1.status, 200);
  assert.equal(t1.body.awarded, 0, "first sight only starts the participation clock");
  // Ineligible members never award: bots, alone, AFK.
  const ineligible = await sendVoice(env, {
    guildId: gid,
    members: [
      // USER_A is still in voice (a real snapshot includes everyone present),
      // but inside the interval — so still no reward for anyone here.
      { ...base, bot: false, afk: false, alone: false },
      { ...base, userId: USER_B, bot: true, afk: false, alone: false },
      { ...base, userId: USER_C, bot: false, afk: false, alone: true },
      { ...base, userId: "310000000000000004", bot: false, afk: true, alone: false }
    ]
  });
  assert.equal(ineligible.body.awarded, 0);
  assert.equal(await getLevelingMember(env, gid, USER_B), null, "bots get no row at all");
  // Move the clock back past the interval → award once.
  await env.BALTICM_DB.prepare("UPDATE leveling_members SET last_voice_at=1 WHERE guild_id=? AND user_id=?").bind(gid, USER_A).run();
  const t2 = await sendVoice(env, { guildId: gid, members: [{ ...base, bot: false, afk: false, alone: false }] });
  assert.equal(t2.body.awarded, 1, "eligible member is rewarded after the interval");
  const row = await getLevelingMember(env, gid, USER_A);
  assert.equal(row.voiceXp, 10);
  assert.equal(row.totalXp, 10);
  // Immediate duplicate snapshot within the interval → no second reward.
  const t3 = await sendVoice(env, { guildId: gid, members: [{ ...base, bot: false, afk: false, alone: false }] });
  assert.equal(t3.body.awarded, 0, "interval prevents duplicate rewards after reconnect/restart");
  assert.equal((await getLevelingMember(env, gid, USER_A)).voiceXp, 10);
  // Leaving voice resets the clock so a rejoin cannot farm instantly.
  const t4 = await sendVoice(env, { guildId: gid, members: [] });
  assert.equal(t4.body.awarded, 0);
  const t5 = await sendVoice(env, { guildId: gid, members: [{ ...base, bot: false, afk: false, alone: false }] });
  assert.equal(t5.body.awarded, 0, "rejoin starts a fresh participation clock");
  // Premium guild with voice XP disabled by config → ignored, not an error.
  const g2 = nextGuild();
  const env2 = await setup(g2, { premium: true });
  await enableBasic(env2, g2);
  assert.equal((await sendVoice(env2, { guildId: g2, members: [{ userId: USER_A }] })).body.ignored, "disabled");
});

test("levelingServiceState exposes config+premium to the gateway services", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enableBasic(env, gid);
  const res = await read(levelingServiceState(env, gid));
  assert.equal(res.status, 200);
  assert.equal(res.body.config.enabled, true);
  assert.equal(res.body.premium, false);
  assert.equal((await read(levelingServiceState(env, "not-a-guild"))).status, 400);
});

/* --------------------------------------------------- rewards + roles */

test("reward roles: validation, assignment on level-up, duplicate prevention", async () => {
  const gid = nextGuild();
  const env = await setup(gid, { premium: true });
  const sent = [], roleGrants = [];
  const restore = stubDiscord({ sent, roleGrants });
  try {
    await enableBasic(env, gid, { minXp: 100, maxXp: 100 });
    const admin = adminOf(gid);
    // Configuration validates against Discord: exists, not managed, hierarchy.
    const add = await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid, body: { level: 2, roleId: REWARD_ROLE } }), env, admin, gid));
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.equal(add.body.reward.roleName, "Active");
    const ghost = await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid, body: { level: 3, roleId: "555555555555555555" } }), env, admin, gid));
    assert.equal(ghost.status, 400, "roles that do not exist are rejected");
    const managed = await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid, body: { level: 4, roleId: BOT_ROLE } }), env, admin, gid));
    assert.equal(managed.status, 400, "managed/integration roles are rejected");

    // Level-up grants the configured role exactly once.
    await sendMsg(env, msg(gid, USER_A)); // 100 XP → Level 2
    const row = await getLevelingMember(env, gid, USER_A);
    assert.equal(row.level, 2);
    assert.deepEqual(row.rewardedRoles, [REWARD_ROLE]);
    assert.equal(roleGrants.filter(g => g.method === "PUT").length, 1, "the role was granted once");

    // Repeat level events / restarts never re-assign or re-log the reward.
    const { grantEligibleRewards } = await import("../leveling-api.js");
    await grantEligibleRewards(env, gid, await getLevelingMember(env, gid, USER_A));
    await grantEligibleRewards(env, gid, await getLevelingMember(env, gid, USER_A));
    assert.equal(roleGrants.filter(g => g.method === "PUT").length, 1, "duplicate reward prevention via the ledger");

    // Removing the configuration never touches granted Discord roles.
    const reward = (await read(levelingOverview(req("/api/leveling", { guildId: gid }), env, admin, gid))).body.rewards[0];
    const del = await read(await (async () => levelingRewardDelete_wrap(env, admin, gid, reward.id))());
    assert.equal(del.status, 200);
    assert.equal(roleGrants.filter(g => g.method === "DELETE").length, 0, "roles are never removed");
    assert.deepEqual((await getLevelingMember(env, gid, USER_A)).rewardedRoles, [REWARD_ROLE], "the ledger keeps history");
  } finally { restore(); }
});

// Small wrapper so the DELETE route keeps its (req, env, user, guildId, id) shape.
async function levelingRewardDelete_wrap(env, user, guildId, id) {
  const { levelingRewardDelete } = await import("../leveling-api.js");
  return levelingRewardDelete(req(`/api/leveling/rewards/${id}`, { method: "DELETE", guildId }), env, user, guildId, id);
}

test("reward roles: FREE servers are capped at 3 with 403 premium_required", async () => {
  const gid = nextGuild();
  const env = await setup(gid); // free
  const restore = stubDiscord();
  try {
  const admin = adminOf(gid);
  for (const [i, roleId] of [REWARD_ROLE, REWARD_ROLE_2, REWARD_ROLE_3].entries()) {
    const res = await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid, body: { level: i + 1, roleId } }), env, admin, gid));
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  const fourth = await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid, body: { level: 4, roleId: REWARD_ROLE_4 } }), env, admin, gid));
  assert.equal(fourth.status, 403, JSON.stringify(fourth.body));
  assert.equal(fourth.body.code, "premium_required");
  } finally { restore(); }
});

/* ---------------------------------------------------------- leaderboard */

test("leaderboard: ordering, search and guild isolation", async () => {
  const gid = nextGuild(), other = nextGuild();
  const env = await setup(gid);
  await setup(other);
  await setMemberIdentity(env, gid, USER_A, { username: "alpha", displayName: "Alpha", avatar: "" });
  await setMemberIdentity(env, gid, USER_B, { username: "beta", displayName: "Beta", avatar: "" });
  await setMemberIdentity(env, gid, USER_C, { username: "gamma", displayName: "Member 003", avatar: "" });
  await setMemberTotals(env, gid, USER_A, { totalXp: 300, messageXp: 300, voiceXp: 0 });
  await setMemberTotals(env, gid, USER_B, { totalXp: 100, messageXp: 100, voiceXp: 0 });
  await setMemberTotals(env, gid, USER_C, { totalXp: 200, messageXp: 150, voiceXp: 50 });
  await setMemberTotals(env, other, USER_A, { totalXp: 99999, messageXp: 99999, voiceXp: 0 });

  const res = await read(levelingBoard(req("/api/leveling/leaderboard", { guildId: gid }), env, adminOf(gid), gid));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.entries.map(e => e.totalXp), [300, 200, 100], "sorted by total XP descending");
  assert.deepEqual(res.body.entries.map(e => e.position), [1, 2, 3]);
  assert.equal(res.body.entries.find(e => e.userId === USER_C).voiceXp, 50);
  assert.equal(res.body.entries.find(e => e.userId === USER_C).messageXp, 150);
  // Search filters by name (member identity comes from the event metadata).
  const search = await read(levelingBoard(req(`/api/leveling/leaderboard?guildId=${gid}&q=003`), env, adminOf(gid), gid));
  assert.equal(search.body.entries.length, 1, "search narrows to one member");
  assert.equal(search.body.entries[0].userId, USER_C);
  // Guild B's leaderboard never contains Guild A rows (and vice versa).
  const otherRes = await read(levelingBoard(req("/api/leveling/leaderboard", { guildId: other }), env, adminOf(other), other));
  assert.equal(otherRes.body.entries.length, 1);
  assert.equal(otherRes.body.entries[0].totalXp, 99999);
  // Cross-guild read attempt: a Guild A admin cannot fetch Guild B data.
  const attack = await read(levelingBoard(req("/api/leveling/leaderboard", { guildId: other }), env, adminOf(gid), other));
  assert.equal(attack.status, 403, "cross-guild reads are rejected");
});

/* ------------------------------------------------- admin XP management */

test("admin XP: add/remove/set/reset with authorization, confirmation and audit", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  const restore = stubDiscord({
    // NOT_A_MEMBER is not in the guild: Discord answers 404 so the handler rejects the target.
    match: (u) => (u.includes(`/members/${NOT_A_MEMBER}`) ? { ok: false, status: 404, json: async () => ({ message: "Unknown Member" }) } : undefined)
  });
  try {
  const admin = adminOf(gid);
  const audit = [];
  const onAudit = (entry) => audit.push(entry);
  const act = (body) => read(levelingXpAction(req("/api/leveling/xp", { method: "POST", guildId: gid, body }), env, admin, gid, { onAudit }));

  // Non-member of the guild (forged session/guild id) is rejected.
  const forged = await read(levelingXpAction(req("/api/leveling/xp", { method: "POST", guildId: gid, body: { action: "add", userId: USER_A, amount: 10 } }), env, outsider, gid, { onAudit }));
  assert.equal(forged.status, 403);
  assert.equal(forged.body.error, "Forbidden");

  // Targets that are not in the guild cannot receive XP rows.
  const ghost = await act({ action: "add", userId: NOT_A_MEMBER, amount: 10 });
  assert.equal(ghost.status, 404, JSON.stringify(ghost.body));

  // add → set → remove → reset
  const add = await act({ action: "add", userId: USER_A, amount: 50, reason: "event help" });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.previousXp, 0);
  assert.equal(add.body.newXp, 50);
  const set = await act({ action: "set", userId: USER_A, amount: 4500 });
  assert.equal(set.body.previousXp, 50);
  assert.equal(set.body.newXp, 4500);
  assert.equal(set.body.level, 10, "level derives safely from the new total");
  const remove = await act({ action: "remove", userId: USER_A, amount: 5000 });
  assert.equal(remove.body.newXp, 0, "XP never goes negative");
  // Reset is a dangerous action: confirmation required.
  await act({ action: "set", userId: USER_A, amount: 1234 });
  const unconfirmed = await act({ action: "reset", userId: USER_A });
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.body.code, "confirm_required");
  assert.equal((await getLevelingMember(env, gid, USER_A)).totalXp, 1234, "unconfirmed reset changes nothing");
  const reset = await act({ action: "reset", userId: USER_A, confirm: true });
  assert.equal(reset.body.newXp, 0);
  assert.equal((await getLevelingMember(env, gid, USER_A)).totalXp, 0);

  // Every manual change is recorded in the existing audit shape.
  assert.equal(audit.length, 5, "add, set, remove, set, reset are all audited");
  for (const entry of audit) {
    assert.equal(entry.actorId, STAFF);
    assert.equal(entry.action.startsWith("Leveling:"), true);
    assert.match(entry.details, /previous XP: \d+ → new XP: \d+/);
  }
  assert.match(audit[0].details, /event help/);
  // RBAC: manual XP changes require CONFIGURE (approved audit map).
  assert.equal(requiredLevelForRequest("/api/leveling/xp", "POST"), "configure");
  assert.equal(requiredLevelForRequest("/api/leveling", "POST"), "configure");
  assert.equal(requiredLevelForRequest("/api/leveling", "GET"), "operate");
  assert.equal(routeAccessKey("/api/leveling/xp"), "leveling");
  assert.ok(ACCESS_KEYS.includes("leveling"));
  } finally { restore(); }
});

test("forged guild ids and cross-guild writes are rejected at the handler", async () => {
  const gid = nextGuild(), other = nextGuild();
  const env = await setup(gid);
  await setup(other);
  const adminA = adminOf(gid), adminB = adminOf(other);
  // A (member of gid) forging guildId=other on every handler → 403.
  assert.equal((await read(levelingOverview(req("/api/leveling", { guildId: other }), env, adminA, other))).status, 403);
  assert.equal((await read(saveLevelingSettings(req("/api/leveling", { method: "POST", guildId: other, body: { enabled: true } }), env, adminA, other))).status, 403);
  assert.equal((await read(levelingXpAction(req("/api/leveling/xp", { method: "POST", guildId: other, body: { action: "add", userId: USER_A, amount: 5 } }), env, adminA, other, {}))).status, 403);
  assert.equal((await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: other, body: { level: 1, roleId: REWARD_ROLE } }), env, adminA, other))).status, 403);
  assert.equal((await read(levelingRewardUpdate(req("/api/leveling/rewards/some-id", { method: "PUT", guildId: other, body: { level: 1, roleId: REWARD_ROLE } }), env, adminA, other))).status, 403);
  assert.equal((await read(levelingAnnounceTest(req("/api/leveling/announce/test", { method: "POST", guildId: other, body: { channelId: CHANNEL } }), env, adminA, other))).status, 403);
  // Data in `other` is untouched.
  assert.equal(await getLevelingMember(env, other, USER_A), null);
  // B (member of other) still works on their own guild.
  await enableBasic(env, other);
  const ok = await sendMsg(env, msg(other, USER_A));
  assert.equal(ok.body.awarded, 15);
  // ...but cannot read gid's board.
  assert.equal((await read(levelingBoard(req("/api/leveling/leaderboard", { guildId: gid }), env, adminB, gid))).status, 403);
});

/* ------------------------------------------------------- Free vs Premium */

test("FREE guild: Premium settings requests are rejected server-side with 403", async () => {
  const gid = nextGuild();
  const env = await setup(gid); // free
  const cases = [
    { body: { enabled: true, voiceXp: true }, feature: "voiceXp" },
    { body: { enabled: true, ignoredChannels: [CHANNEL] }, feature: "ignoredChannels" },
    { body: { enabled: true, ignoredRoles: [IGNORED_ROLE] }, feature: "ignoredRoles" },
    { body: { enabled: true, announceMode: "same_channel", announceMessage: "custom {level}" }, feature: "announceMessage" }
  ];
  for (const c of cases) {
    const res = await saveSettings(env, gid, c.body);
    assert.equal(res.status, 403, `${c.feature} must be rejected on a free guild`);
    assert.equal(res.body.code, "premium_required");
    assert.ok(res.body.features.includes(c.feature), "the offending feature is named");
  }
  // The stored config never changed to a Premium state.
  const state = await read(levelingOverview(req("/api/leveling", { guildId: gid }), env, adminOf(gid), gid));
  assert.equal(state.body.settings.voiceXp, false);
  assert.equal(state.body.settings.ignoredChannels.length, 0);
  assert.equal(state.body.settings.announceMessage, "");
  assert.equal(state.body.premium, false);
  // FREE still works: enabling message XP and basic announcements is allowed.
  const basic = await saveSettings(env, gid, { enabled: true, minXp: 5, maxXp: 25, messageCooldown: 60, announceMode: "same_channel" });
  assert.equal(basic.status, 200, JSON.stringify(basic.body));
  assert.equal(basic.body.settings.enabled, true);
});

test("PREMIUM guild: voice XP and advanced configuration are allowed", async () => {
  const gid = nextGuild();
  const env = await setup(gid, { premium: true });
  const restore = stubDiscord();
  try {
  const res = await saveSettings(env, gid, {
    enabled: true, voiceXp: true, voiceXpAmount: 25, voiceInterval: 60,
    ignoredChannels: [CHANNEL], ignoredRoles: [IGNORED_ROLE],
    announceMode: "channel", announceChannelId: CHANNEL, announceMessage: "Level up {user}!"
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.premium, true);
  assert.equal(res.body.settings.voiceXp, true);
  assert.equal(res.body.settings.ignoredRoles.length, 1);
  // Cross-guild channel injection is refused (IDOR) even for premium.
  const bad = await saveSettings(env, gid, { enabled: true, announceMode: "channel", announceChannelId: "444444444444444444" });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  } finally { restore(); }
});

/* ---------------------------------------------------- /rank, /leaderboard */

test("/rank returns a polished embed with level, XP, rank and breakdown", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  const restore = stubDiscord();
  try {
  await setMemberIdentity(env, gid, USER_A, { username: "alpha", displayName: "Member 001", avatar: "hash1" });
  await setMemberIdentity(env, gid, USER_B, { username: "beta", displayName: "Member 002", avatar: "" });
  await setMemberTotals(env, gid, USER_A, { totalXp: 4650, messageXp: 4150, voiceXp: 500 });
  await setMemberTotals(env, gid, USER_B, { totalXp: 100, messageXp: 100, voiceXp: 0 });

  const res = await read(levelingRankInteraction(env, { guild_id: gid, data: { name: "rank", options: [] }, member: { user: { id: USER_A } } }));
  assert.equal(res.body.type, 4, "interaction response");
  const embed = res.body.data.embeds[0];
  assert.match(embed.title, /Member 001/);
  assert.match(embed.description, /Level 10/);
  assert.match(embed.description, /█/, "progress bar present");
  const fields = Object.fromEntries(embed.fields.map(f => [f.name, f.value]));
  assert.equal(fields["Server rank"], "#1 of 2");
  assert.equal(fields["Total XP"], (4650).toLocaleString());
  assert.equal(fields["Level"], "10");
  assert.equal(fields["Message XP"], (4150).toLocaleString());
  assert.equal(fields["Voice XP"], (500).toLocaleString());
  assert.match(embed.thumbnail.url.includes(USER_A) ? embed.thumbnail.url : "", /^https:\/\/cdn\.discordapp\.com\/avatars\//, "avatar shown");

  // /rank user:@member
  const other = await read(levelingRankInteraction(env, { guild_id: gid, data: { name: "rank", options: [{ name: "user", value: USER_B }] }, member: { user: { id: USER_A } } }));
  const otherFields = Object.fromEntries(other.body.data.embeds[0].fields.map(f => [f.name, f.value]));
  assert.equal(otherFields["Server rank"], "#2 of 2");
  assert.equal(otherFields["Level"], "2");

  // DMs / missing guild → graceful ephemeral error.
  const dm = await read(levelingRankInteraction(env, { data: { name: "rank", options: [] }, user: { id: USER_A } }));
  assert.equal(dm.body.type, 4);
  assert.equal(dm.body.data.flags, 64);
  assert.equal(dm.body.data.embeds, undefined);

  // Member with no XP row but present in Discord → zeroed rank card.
  const fresh = await read(levelingRankInteraction(env, { guild_id: gid, data: { name: "rank", options: [{ name: "user", value: NOT_A_MEMBER }] }, member: { user: { id: USER_A } } }));
  const freshFields = Object.fromEntries((fresh.body.data.embeds?.[0]?.fields || []).map(f => [f.name, f.value]));
  assert.equal(freshFields["Total XP"], (0).toLocaleString(), "zero-state card instead of an error");
  } finally { restore(); }
});

test("/leaderboard returns the top 10 in order with levels", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  for (let i = 1; i <= 12; i++) {
    const id = String(320000000000000000n + BigInt(i));
    await setMemberTotals(env, gid, id, { totalXp: i * 100, messageXp: i * 100, voiceXp: 0 });
    await setMemberIdentity(env, gid, id, { username: "u" + i, displayName: `Member ${String(i).padStart(3, "0")}`, avatar: "" });
  }
  const res = await read(levelingLeaderboardInteraction(env, { guild_id: gid, data: { name: "leaderboard" } }));
  const embed = res.body.data.embeds[0];
  assert.match(embed.title, /Leaderboard/);
  const lines = embed.description.split("\n");
  assert.equal(lines.length, 10, "top 10 only");
  assert.match(lines[0], /🥇/, "first place medal");
  assert.match(lines[0], /Member 012/, "highest XP first");
  assert.match(lines[9], /Member 003/, "tenth place");
  assert.match(lines[0], /Level \d+/);
  assert.match(embed.footer.text, /12 ranked members/);

  const dm = await read(levelingLeaderboardInteraction(env, { data: { name: "leaderboard" } }));
  assert.equal(dm.body.data.flags, 64, "DMs get an ephemeral refusal");
});

/* ------------------------------------------------------- command sync */

test("command sync: creates rank/leaderboard only and preserves /help and others", () => {
  assert.equal(RANK_COMMAND_DEFINITION.name, "rank");
  assert.equal(LEADERBOARD_COMMAND_DEFINITION.name, "leaderboard");
  assert.equal(RANK_COMMAND_DEFINITION.type, 1);
  // Empty list → plan says create exactly our two commands.
  const plans = planLevelingCommandSync([]);
  assert.deepEqual(plans.map(p => [p.action, p.name]), [["create", "rank"], ["create", "leaderboard"]]);
  // A realistic global list: /help + music commands must NEVER be planned.
  const existing = [
    { id: "1", name: "help", description: "Show BalticM.eu help, features and the Control Center link", type: 1, options: [] },
    { id: "2", name: "play", description: "Play music", type: 1, options: [{ type: 3, name: "query", required: false }] },
    { id: "3", name: "rank", description: RANK_COMMAND_DEFINITION.description, type: 1, options: RANK_COMMAND_DEFINITION.options },
    { id: "4", name: "leaderboard", description: LEADERBOARD_COMMAND_DEFINITION.description, type: 1, options: [] }
  ];
  const none = planLevelingCommandSync(existing);
  assert.deepEqual(none.map(p => p.action), ["none", "none"], "in-sync commands are untouched");
  // The plan output never references foreign commands — no delete/update path exists for them.
  const serialized = JSON.stringify(none);
  assert.ok(!serialized.includes("help") && !serialized.includes("play"));
  // Drifted description/options on OUR commands → update by id, nothing else.
  const drifted = planLevelingCommandSync([{ id: "3", name: "rank", description: "old", type: 1 }, ...existing.slice(0, 2)]);
  assert.equal(drifted[0].action, "update");
  assert.equal(drifted[0].id, "3");
  // Duplicate rows of our names are deduped — only our own duplicates.
  const dupes = planLevelingCommandSync([{ id: "9", name: "rank", description: "x", type: 1 }, ...existing]);
  assert.equal(dupes[0].action, "dedupe");
  assert.deepEqual(dupes[0].removeIds.filter(id => id !== "9").length, 1, "only the duplicate rank row is removed");
  // Unknown names in the list can never be part of a plan.
  assert.equal(planLevelingCommandSync([{ id: "77", name: "totally-foreign", description: "x", type: 1 }]).every(p => p.action === "create"), true);
});

test("worker source: merge-based registration, interactions wired, cron + audit intact", () => {
  // Registration function exists, uses the merge plan, and is in the cron.
  assert.match(workerSrc, /export async function ensureLevelingCommandsRegistered\(env\)\{/);
  assert.match(workerSrc, /planLevelingCommandSync\(/);
  assert.match(workerSrc, /ensureHelpCommandRegistered\(env\),ensureLevelingCommandsRegistered\(env\)(?:,ensureCoinsCommandsRegistered\(env\))?\]/, "cron runs help sync AND leveling sync (coins sync may follow)");
  // No bulk overwrite anywhere in the worker (preserve existing commands).
  assert.ok(!/bulkOverwrite|put\(.*commands/i.test(workerSrc), "no bulk command overwrite exists");
  // Interactions are handled before the external-bot fallback.
  assert.match(workerSrc, /===\"rank\"\)return levelingRankInteraction\(env,interaction\)/);
  assert.match(workerSrc, /===\"leaderboard\"\)return levelingLeaderboardInteraction\(env,interaction\)/);
  const rankAt = workerSrc.indexOf("levelingRankInteraction(env,interaction)");
  const helpAt = workerSrc.indexOf("helpCommandResponse()");
  const fallbackAt = workerSrc.indexOf("balticm.eu/discord-bot", rankAt);
  assert.ok(helpAt >= 0 && rankAt > helpAt, "handled after /help");
  assert.ok(rankAt < fallbackAt, "handled before the external bot fallback");
  // Service endpoints: secrets enforced before handlers; audit uses the existing Logs table writer.
  assert.match(workerSrc, /\/api\/leveling\/service\/message[\s\S]{0,400}BALTICM_REACTION_SERVICE_SECRET/);
  assert.match(workerSrc, /\/api\/leveling\/service\/voice[\s\S]{0,400}BALTICM_VOICE_SERVICE_SECRET/);
  assert.match(workerSrc, /levelingXpAction\(req,env,user,guildId,\{onAudit:entry=>addActivityLog\(env,guildId,entry\)\}\)/);
  // The membership gate exists on every leveling API route.
  // (The block ends where the NEXT module's routes begin — first the Baltic
  // Coins banner, then the tournaments block as the historical fallback.)
  const coinsBanner = workerSrc.indexOf("Baltic Coins V1: guild-scoped economy routes");
  const lvBlock = workerSrc.slice(
    workerSrc.indexOf('if(p==="/api/leveling")'),
    coinsBanner > 0 ? coinsBanner : workerSrc.indexOf("const trnPart=")
  );
  assert.ok(lvBlock.includes('if(p==="/api/leveling")'), "the leveling route block is present");
  assert.ok(
    (lvBlock.match(/if\(!canManageGuild\(user,guildId\)\)return json\(\{error:"Forbidden"\},403\);/g) || []).length === 6,
    "all six leveling API routes (incl. test announcement) re-check guild membership"
  );
  assert.ok(lvBlock.includes("/api/leveling/announce/test"), "test-announcement route lives inside the gated block");
  assert.ok(lvBlock.includes("levelingAnnounceTest(req,env,user,guildId)"));
  assert.ok(lvBlock.includes('req.method==="PUT"?levelingRewardUpdate(req,env,user,guildId,lvId)'), "reward edit is a gated PUT");
  assert.ok(workerSrc.includes("/api/leveling/leaderboard") && workerSrc.includes("/api/leveling/xp") && workerSrc.includes("/api/leveling/rewards"));
});

/* ------------------------------------------------------- gateway services */

test("gateway services: forwarding guards and no per-user timers", () => {
  // reaction-service: intent + DM/bot/webhook guards before any network call.
  assert.match(reactionSvc, /\(1<<0\)\|\(1<<9\)\|\(1<<10\)/, "GUILD_MESSAGES intent enabled for message XP");
  assert.match(reactionSvc, /MESSAGE_CREATE"\)void postMessageXpEvent/);
  assert.match(reactionSvc, /!d\?\.guild_id[\s\S]{0,40}d\?\.author\?\.bot\|\|d\?\.webhook_id\)return/, "DMs, bots and webhooks are dropped at the source");
  // voice-service: ONE interval for all guilds, config-gated, no per-user timers.
  assert.match(voiceSvc, /setInterval\(\(\)=>void postVoiceSnapshot\(\),60000\)/);
  assert.ok((voiceSvc.match(/setInterval\(/g) || []).length <= 3, "no per-member timer explosion");
  assert.match(voiceSvc, /config\?\.voiceXp!==true\)continue/, "voice XP only posts for enabled premium guilds");
  assert.match(voiceSvc, /api\/leveling\/service\/state/);
});

/* ---------------------------------------------------------- Control Center UI */

test("Control Center: /leveling nav, routing and access wiring", () => {
  assert.match(mainSrc, /\["Leveling",Star\]/, "sidebar item under ENGAGEMENT");
  assert.match(mainSrc, /import Leveling from"\.\/Leveling\.jsx"/);
  assert.match(mainSrc, /page==="Leveling"&&user&&<Leveling/);
  assert.match(mainSrc, /canUseAccess\(controlPermissions,"leveling",ACCESS_CONFIGURE\)/);
  assert.match(mainSrc, /premium=\{serverPlan\.premium\} onUpgrade=\{\(\)=>openPage\("Premium"\)\}/, "existing entitlement source + upgrade CTA");
  assert.equal(PAGE_PATHS.Leveling, "/leveling");
  assert.equal(PAGE_ACCESS_KEY.Leveling, "leveling");
  assert.match(stateSrc, /Leveling: "\/leveling"/);
});

test("Leveling UI: no native selects, locks are visible and never silent", () => {
  const native = levelJsx.match(/<select/g) || [];
  assert.equal(native.length, 0, "the Leveling page never renders a native <select>");
  // Premium locks stay visible with 🔒 Premium and reuse the upgrade CTA.
  assert.match(levelJsx, /🔒 Premium/);
  assert.match(levelJsx, /View Premium plans/);
  assert.match(levelJsx, /UpgradeHint/);
  assert.match(levelJsx, /onUpgrade/);
  // Locked interactions change nothing before showing the CTA.
  assert.match(levelJsx, /if\(key==="voiceXp"&&locked\)\{lock\(/);
  assert.match(levelJsx, /locked&&\(state\.rewards\|\|\[\]\)\.length>=3/);
  assert.match(levelJsx, /readOnly=\{locked\}/);
  // Dangerous reset always confirms client-side too.
  assert.ok((levelJsx.match(/window\.confirm\(/g) || []).length >= 2, "reward removal and XP reset both confirm");
  // Leaderboard exposes names/levels/XP — no raw ids rendered as visible text.
  assert.ok(!levelJsx.includes(">{m.userId}<") && !levelJsx.includes("{picked.id}"), "raw ids are never rendered");
  assert.match(levelJsx, /data-label="Voice XP"/);
  // CSS: responsive leaderboard collapse + 44px touch targets.
  const css = readFileSync(join(root, "src/leveling.css"), "utf8");
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /@media\(max-width:345px\)/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /grid-template-areas/, "leaderboard rows collapse into cards on mobile");
});

test("Leveling UI: channel/role selectors reuse the Tickets dropdown — floating, searchable, solid", () => {
  const css = readFileSync(join(root, "src/leveling.css"), "utf8");
  const main = mainSrc;
  // The SAME TicketOptionSelect widget, re-scoped exactly like `.ticketsPage
  // .modAction*` (style.css) — same declarations, not a lookalike dropdown.
  assert.match(levelJsx, /const Select=TicketOptionSelect;/, "the page renders the shared Tickets widget");
  assert.equal((levelJsx.match(/<select/g) || []).length, 0, "still zero native selects");
  // All three selectors: shared widget + search + viewport flip.
  assert.match(levelJsx, /id="lv-ignored-channel" label="Add ignored channel" search flip/);
  assert.match(levelJsx, /id="lv-ignored-role" label="Add ignored role" search flip/);
  assert.match(levelJsx, /id="lv-reward-role" label="Reward role" search flip/);
  // Real Discord ids are preserved as option values; labels are visible names.
  assert.match(levelJsx, /value:String\(c\.id\),label:"#"\+c\.name/);
  assert.match(levelJsx, /value:String\(r\.id\),label:"@"\+r\.name/);
  // Already-ignored entries are filtered out of the options (not selectable twice).
  assert.match(levelJsx, /channels\.filter\(c=>!\(form\.ignoredChannels\|\|\[\]\)\.includes\(String\(c\.id\)\)\)/);
  assert.match(levelJsx, /roles\.filter\(r=>!\(form\.ignoredRoles\|\|\[\]\)\.includes\(String\(r\.id\)\)\)/);
  // Selected entries render as removable chips, roles carry a colour dot.
  assert.match(levelJsx, /className="lvChips"/);
  assert.match(levelJsx, /lvChipDot/);
  assert.match(levelJsx, /hexColor\(r\.color\)/, "role colours flow into the dropdown options");
  assert.match(levelJsx, /const hexColor=c=>\{const n=Number\(c\)/);
  // CSS: the menu is a floating overlay — never in-flow, never transparent.
  assert.match(css, /\.lvPage \.modActionSelect\{position:relative/, "select is the positioning context");
  assert.match(css, /\.lvPage \.modActionMenu\{position:absolute/, "menu floats over the page, card height unchanged");
  assert.match(css, /\.lvPage \.modActionMenu\{[^}]*max-height:min\(320px,calc\(100dvh - 16px\)\)/, "300–360px cap that also fits the viewport");
  assert.match(css, /\.lvPage \.modActionMenu\{[^}]*overflow:auto/, "internal vertical scrolling");
  assert.match(css, /\.lvPage \.modActionMenu\{[^}]*background:#0e0c0a/, "solid Tickets background, no transparency");
  assert.match(css, /\.lvPage \.modActionMenu\{[^}]*border:1px solid rgba\(232,176,120,\.35\)/, "Tickets amber border");
  assert.match(css, /\.lvPage \.modActionMenu li\.selected\{[^}]*rgba\(232,137,44,\.18\)/, "selected item highlighted like Tickets");
  assert.match(css, /\.lvPage \.modActionMenu li\.active\{[^}]*rgba\(232,137,44,\.1\)/, "hover/active state matches Tickets");
  assert.match(css, /\.lvPage \.modActionMenu li\{[^}]*text-overflow:ellipsis/, "long names truncate instead of overflowing");
  assert.match(css, /\.lvPage \.modActionSearch\{position:sticky/, "search field pinned to the top of the menu");
  assert.match(css, /\.lvPage \.modActionSelect\.dropUp \.modActionMenu/, "menu flips above the trigger near the bottom edge");
  assert.match(css, /\.lvPage \.modActionTrigger\{[^}]*min-height:44px/, "44px touch target on the trigger");
  // The widget itself: Escape closes, outside click closes, search filters,
  // Enter picks the highlighted option instead of submitting the settings form.
  assert.match(main, /function TicketOptionSelect\(\{id,label,value,onChange,options,flip,search,disabled,locked,onLocked\}\)/);
  assert.match(main, /e\.key==="Escape"\)\{setOpen\(false\);trigger\.current\?\.focus\(\)/);
  assert.match(main, /if\(!root\.current\?\.contains\(e\.target\)\)setOpen\(false\)/);
  assert.match(main, /placeholder="Search…"/);
  assert.match(main, /if\(e\.key==="Enter"\)\{e\.preventDefault\(\);if\(active&&shown\.some/);
  // Flip decision uses the real menu height (320px caps need >260px of room).
  assert.match(main, /querySelector\("\.modActionMenu"\)\?\.offsetHeight\|\|260/);
  // Colour dot only renders for a validated hex value — no CSS injection.
  assert.match(main, /\^#\[0-9a-fA-F\]\{3,8\}\$/);
});

test("leveling API source: premium gate + entitlement reuse (no second system)", () => {
  assert.match(apiSrc, /import \{ guildPremiumActive \} from "\.\/tournaments-db\.js"/, "reuses the single Premium entitlement source");
  assert.ok(!/bot_config.*INSERT INTO bot_config \(key/i.test(apiSrc.replace(/CREATE TABLE IF NOT EXISTS bot_config[^\n]+/g, "")), "no second premium storage");
  assert.match(apiSrc, /code: "premium_required"/);
  assert.match(apiSrc, /Voice XP requires an active Premium subscription/);
  // Level math lives in exactly one shared helper used by API + UI.
  assert.match(levelingSrc, /export function levelForXp/);
  assert.match(apiSrc, /levelForXp/);
});

/* ------------------------------------------------------- Leveling V2 ---- */

test("V2 feedback placement: every action answers inside its own section", () => {
  const pageAt = levelJsx.indexOf('return <div className="lvPage">');
  const head = levelJsx.slice(pageAt, levelJsx.indexOf("OVERVIEW"));
  // The page header keeps only the load error — never action feedback.
  assert.ok(!/value=\{(notice|settingsNotice|rewardNotice|xpNotice|announceNotice)\}/.test(head), "no action notice renders at the top of the page");
  // Admin XP: success AND validation errors are written ONLY to the local
  // notice, which renders directly under the section's action buttons.
  const adminSec = levelJsx.slice(levelJsx.indexOf("ADMIN XP"));
  assert.match(adminSec, /<Notice value=\{xpNotice\}\/>/, "Admin XP feedback is local to its section");
  const handlers = levelJsx.slice(levelJsx.indexOf("const runXpAction"), levelJsx.indexOf("if(!user)return"));
  assert.match(handlers, /setXpNotice\(\{ok:false,text:"Enter the XP amount first\."\}\)/);
  assert.match(handlers, /setXpNotice\(\{ok:false,text:"Choose a member first\."\}\)/);
  assert.ok(!/setNotice\(/.test(levelJsx), "the old page-level notice state is gone entirely");
  // Settings save, rewards and the test announcement all have local notices.
  const formSec = levelJsx.slice(levelJsx.indexOf('<form className="lvPanel" onSubmit={save}>'));
  assert.match(formSec.slice(0, formSec.indexOf("</form>")), /<Notice value=\{settingsNotice\}\/>/, "save feedback sits with the Save button");
  assert.match(levelJsx, /<Notice value=\{rewardNotice\}\/>/);
  assert.match(levelJsx, /<Notice value=\{announceNotice\}\/>/);
  // The user is never scrolled away from the control they used.
  assert.ok(!/scrollIntoView|window\.scrollTo|location\.hash/.test(levelJsx), "no auto-scrolling of any kind");
  // Premium lock hints render inside the section that raised them too.
  assert.match(levelJsx, /locks\.voice&&<UpgradeHint/);
  assert.match(levelJsx, /locks\.ignored&&<UpgradeHint/);
  assert.match(levelJsx, /locks\.rewards&&<UpgradeHint/);
  assert.match(levelJsx, /locks\.announce&&<UpgradeHint/);
});

test("reward role verification: transient failures retry, real failures explain themselves", async () => {
  // The bot's member is resolved by its EXPLICIT user id first — Discord
  // often 400s GET members/@me (the original production bug), so that call is
  // only a fallback now.
  assert.match(apiSrc, /const BOT_CLIENT_ID = "1543137268221354035"/);
  assert.match(apiSrc, /members\/\$\{BOT_CLIENT_ID\}/);
  assert.match(apiSrc, /async function botMemberRoles\(/);
  // A single transient 500 on the role list is retried, not surfaced as an error.
  const gid = nextGuild();
  const env = await setup(gid);
  let roleListCalls = 0;
  const restore = stubDiscord({
    match: (u) => {
      if (/\/roles$/.test(u)) {
        roleListCalls++;
        if (roleListCalls === 1) return { ok: false, status: 500, json: async () => ({ message: "Internal Server Error" }) };
      }
      return undefined;
    }
  });
  try {
    const okRes = await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid, body: { level: 5, roleId: REWARD_ROLE } }), env, adminOf(gid), gid));
    assert.equal(okRes.status, 201, JSON.stringify(okRes.body));
    assert.ok(roleListCalls >= 2, "the transient 500 was retried instead of failing the action");
  } finally { restore(); }

  // Persistent outage → a specific message naming exactly what failed, plus
  // a single-role probe proving the chosen role itself is valid.
  const gid2 = nextGuild();
  const env2 = await setup(gid2);
  const restore2 = stubDiscord({
    match: (u) => (/\/roles$/.test(u) ? { ok: false, status: 429, json: async () => ({ message: "rate limited" }) } : undefined)
  });
  try {
    const res = await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid2, body: { level: 10, roleId: REWARD_ROLE } }), env2, adminOf(gid2), gid2));
    assert.equal(res.status, 502, JSON.stringify(res.body));
    assert.match(res.body.error, /rate limiting requests while checking this server's role list/, "the failing lookup is named");
    assert.match(res.body.error, /looks valid/, "a valid role is never called invalid without explanation");
    assert.equal(res.body.code, "role_verification_failed");
  } finally { restore2(); }
});

test("reward role verification: Manage Roles derived from the bot's role grants when Guild.permissions is absent", async () => {
  // Discord omits Guild.permissions for some bot tokens — the capability check
  // must derive Manage Roles from the roles the bot actually wears.
  const gid = nextGuild();
  const env = await setup(gid);
  const restore = stubDiscord({
    match: (u) => (/\/guilds\/[^/]+$/.test(u)
      ? { ok: true, status: 200, json: async () => ({ id: "guild", name: "Test Guild" }) }
      : undefined)
  });
  try {
    const res = await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid, body: { level: 5, roleId: REWARD_ROLE } }), env, adminOf(gid), gid));
    assert.equal(res.status, 201, JSON.stringify(res.body), "Manage Roles derived from the bot's own role grants");
  } finally { restore(); }

  // Ground truth still wins: a bot whose roles grant nothing gets the
  // actionable error instead of a false success.
  const gid2 = nextGuild();
  const env2 = await setup(gid2);
  const bareRoles = ROLES.map(r => (r.id === BOT_ROLE ? { ...r, permissions: "0" } : r));
  const restore2 = stubDiscord({
    match: (u) => {
      if (/\/guilds\/[^/]+$/.test(u)) return { ok: true, status: 200, json: async () => ({ id: "guild", name: "Test Guild" }) };
      if (/\/roles$/.test(u)) return { ok: true, status: 200, json: async () => bareRoles };
      return undefined;
    }
  });
  try {
    const res = await read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid2, body: { level: 5, roleId: REWARD_ROLE } }), env2, adminOf(gid2), gid2));
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /Manage Roles/, "still refuses when the bot genuinely lacks the permission");
  } finally { restore2(); }
});

test("reward roles: duplicate level/role mappings rejected, PUT edit works in place", async () => {
  const gid = nextGuild();
  const env = await setup(gid, { premium: true });
  const restore = stubDiscord();
  try {
    const admin = adminOf(gid);
    const post = (body) => read(levelingRewardAdd(req("/api/leveling/rewards", { method: "POST", guildId: gid, body }), env, admin, gid));
    const first = await post({ level: 5, roleId: REWARD_ROLE });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const dup = await post({ level: 5, roleId: REWARD_ROLE });
    assert.equal(dup.status, 400);
    assert.match(dup.body.error, /already configured/);
    const levelTaken = await post({ level: 5, roleId: REWARD_ROLE_2 });
    assert.equal(levelTaken.status, 400);
    assert.match(levelTaken.body.error, /already awards/);
    const roleTaken = await post({ level: 6, roleId: REWARD_ROLE });
    assert.equal(roleTaken.status, 400);
    assert.match(roleTaken.body.error, /already the reward for Level 5/);

    // Editing is a real in-place update of the SAME row (never delete+insert,
    // so a failed validation can never lose the previous mapping).
    const second = await post({ level: 10, roleId: REWARD_ROLE_2 });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    const id = first.body.reward.id;
    const put = (body) => read(levelingRewardUpdate(req(`/api/leveling/rewards/${id}`, { method: "PUT", guildId: gid, body }), env, admin, gid, id));
    const moved = await put({ level: 7, roleId: REWARD_ROLE }); // same level+role as itself → allowed
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.reward.level, 7);
    const conflictLevel = await put({ level: 10, roleId: REWARD_ROLE });
    assert.equal(conflictLevel.status, 400, "an edit cannot collide with another mapping");
    assert.match(conflictLevel.body.error, /already awards/);
    const conflictRole = await put({ level: 7, roleId: REWARD_ROLE_2 });
    assert.equal(conflictRole.status, 400);
    assert.match(conflictRole.body.error, /already the reward for Level 10/);

    const rows = (await read(levelingOverview(req("/api/leveling", { guildId: gid }), env, admin, gid))).body.rewards;
    assert.equal(rows.length, 2, "edits never duplicate or lose mappings");
    assert.deepEqual(rows.map(r => [r.level, r.roleName]), [[7, "Active"], [10, "Veteran"]], "updated values persisted in place");
  } finally { restore(); }
});

test("XP settings persistence: the configured 10–20 / 3600 values round-trip untouched", async () => {
  const gid = nextGuild();
  const env = await setup(gid, { premium: true });
  const restore = stubDiscord(); // announce channel verification hits Discord
  try {
  const saved = await saveSettings(env, gid, {
    enabled: true, minXp: 10, maxXp: 20, messageCooldown: 3600,
    voiceXp: true, voiceXpAmount: 10, voiceInterval: 3600,
    announceMode: "channel", announceChannelId: CHANNEL
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const state = await read(levelingOverview(req("/api/leveling", { guildId: gid }), env, adminOf(gid), gid));
  const s = state.body.settings;
  assert.deepEqual(
    { enabled: s.enabled, messageXp: s.messageXp, minXp: s.minXp, maxXp: s.maxXp, messageCooldown: s.messageCooldown, voiceXp: s.voiceXp, voiceXpAmount: s.voiceXpAmount, voiceInterval: s.voiceInterval, announceChannelId: s.announceChannelId },
    { enabled: true, messageXp: true, minXp: 10, maxXp: 20, messageCooldown: 3600, voiceXp: true, voiceXpAmount: 10, voiceInterval: 3600, announceChannelId: CHANNEL },
    "every value survives the save → read round trip"
  );
  // Re-saving the same payload (what the UI does on every Save click) is idempotent.
  const again = await saveSettings(env, gid, { ...s });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.settings.minXp, 10);
  assert.equal(again.body.settings.maxXp, 20);
  assert.equal(again.body.settings.messageCooldown, 3600);
  } finally { restore(); }
});

test("level-up branding: FREE servers get the footer, Premium never does", async () => {
  // FREE guild → celebratory embed carries the promotional footer.
  const gid = nextGuild();
  const env = await setup(gid);
  const sent = [];
  const restore = stubDiscord({ sent });
  try {
    await enableBasic(env, gid, { minXp: 100, maxXp: 100, announceMode: "same_channel" });
    const first = await sendMsg(env, msg(gid, USER_A));
    assert.equal(first.body.leveledUp, true, JSON.stringify(first.body));
    assert.equal(sent.length, 1);
    const embed = sent[0].embeds[0];
    assert.ok(embed.title.includes("Level 2"), "celebratory embed title");
    assert.equal(embed.footer.text, ANNOUNCE_BRANDING, "free servers carry the branded footer");
    assert.ok(sent[0].content.includes(`<@${USER_A}>`), "the content line still mentions the member");
    assert.deepEqual(sent[0].allowed_mentions, { parse: [], users: [USER_A] }, "no arbitrary mentions");
  } finally { restore(); }

  // PREMIUM guild → no promotional footer, same celebration.
  const gid2 = nextGuild();
  const env2 = await setup(gid2, { premium: true });
  const sent2 = [];
  const restore2 = stubDiscord({ sent: sent2 });
  try {
    await enableBasic(env2, gid2, { minXp: 100, maxXp: 100, announceMode: "same_channel" });
    await sendMsg(env2, msg(gid2, USER_B));
    assert.equal(sent2.length, 1);
    assert.equal(sent2[0].embeds[0].footer, undefined, "premium announcements never show the promo footer");
  } finally { restore2(); }
});

test("test announcement: clearly marked, channel-validated, grants no XP", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  const sent = [];
  const restore = stubDiscord({ sent });
  try {
    await enableBasic(env, gid, { announceMode: "off" });
    const admin = adminOf(gid);
    const testAnnounce = (body, user = admin) => read(levelingAnnounceTest(req("/api/leveling/announce/test", { method: "POST", guildId: gid, body }), env, user, gid));

    // Channels must belong to THIS guild.
    const bad = await testAnnounce({ channelId: "444444444444444444" });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.match(bad.body.error, /does not belong/);
    assert.equal(sent.length, 0, "nothing is sent for a rejected channel");
    const missing = await testAnnounce({});
    assert.equal(missing.status, 400);

    // Valid send: marked as a test, zero pings, real free-server branding.
    const ok = await testAnnounce({ channelId: CHANNEL });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.test, true);
    assert.ok(ok.body.content.startsWith("🧪"), "the message identifies itself as a test");
    assert.match(ok.body.content, /no XP granted/);
    assert.deepEqual(sent[0].allowed_mentions, { parse: [] }, "a test can never ping anyone");
    assert.equal(sent[0].embeds[0].footer.text, ANNOUNCE_BRANDING, "matches what a real free-server level-up would carry");
    // It never touched the XP pipeline.
    assert.equal(await getLevelingMember(env, gid, USER_A), null, "no XP row was created");
    const overview = await read(levelingOverview(req("/api/leveling", { guildId: gid }), env, admin, gid));
    assert.equal(overview.body.stats.membersWithXp, 0, "no member gained XP");
  } finally { restore(); }
});

test("V2 RBAC: test announcement and reward edit require CONFIGURE on leveling", () => {
  assert.equal(requiredLevelForRequest("/api/leveling/announce/test", "POST"), "configure");
  assert.equal(requiredLevelForRequest("/api/leveling/rewards/abc123", "PUT"), "configure");
  assert.equal(requiredLevelForRequest("/api/leveling/rewards/abc123", "DELETE"), "configure");
  assert.equal(requiredLevelForRequest("/api/leveling/announce/test", "GET"), "operate");
  assert.equal(routeAccessKey("/api/leveling/announce/test"), "leveling");
});

test("V2/V3 UI polish: compact seven-control XP row, card builder/preview, chips, search, rewards", () => {
  const css = readFileSync(join(root, "src/leveling.css"), "utf8");
  // ONE compact row holds all seven XP controls (Message: toggle/min/max/
  // cooldown + Voice: toggle/amount/interval) with proportional widths —
  // the old nested Voice XP container (lvXpRow3) is gone.
  assert.match(levelJsx, /className="lvXpRow"/);
  assert.ok(!levelJsx.includes("lvXpRow3"), "Voice XP lives in the shared row, not a nested container");
  assert.equal((levelJsx.match(/className="lvXpRow"/g) || []).length, 1, "exactly ONE XP settings row on the page");
  assert.match(css, /\.lvXpRow\{display:grid;gap:12px;align-items:start;grid-template-columns:minmax\(0,1\.15fr\) minmax\(0,\.75fr\) minmax\(0,\.75fr\) minmax\(0,1\.2fr\) minmax\(0,1\.15fr\) minmax\(0,\.75fr\) minmax\(0,1\.2fr\)\}/, "seven proportional tracks");
  assert.match(css, /@media\(max-width:1000px\)/, "wraps to two rows first");
  assert.match(css, /@media\(max-width:767px\)[\s\S]{0,400}\.lvXpRow\{grid-template-columns:1fr\}/, "single column on mobile");
  // Multiline card description editor + placeholder chips + live preview + test action.
  assert.match(levelJsx, /<textarea/);
  assert.match(levelJsx, /ALLOWED_ANNOUNCE_PLACEHOLDERS\.map\(/);
  assert.match(levelJsx, /renderLevelUpCard\(/, "the preview renders through the shared card renderer");
  assert.match(apiSrc, /renderLevelUpCard\(/, "the Discord payload uses the SAME renderer as the preview");
  // The separate test panel and its duplicate channel picker are gone — the
  // inline test always reuses the selected Announcement Channel.
  assert.ok(!levelJsx.includes('id="lv-test-channel"'), "no second channel picker for tests");
  assert.ok(!levelJsx.includes("lvTestCol"), "the separate TEST ANNOUNCEMENT panel is gone");
  assert.match(levelJsx, /form\.announceMode==="channel"\?form\.announceChannelId:""/);
  assert.match(levelJsx, /Send test announcement/);
  assert.match(levelJsx, /ANNOUNCE_BRANDING/, "the preview shows the free-server footer");
  assert.match(css, /\.lvPreview\{/);
  assert.match(css, /\.lvTestBtn\{/);
  assert.match(css, /\.lvPhChip\{/);
  // Chips: readable names, real X buttons, hover + keyboard focus states.
  assert.match(levelJsx, /className="lvChipName"/);
  assert.match(levelJsx, /title="Remove"/);
  assert.match(css, /\.lvChip button:focus-visible/);
  // Searches: single border with one focus ring, avatars + empty state.
  assert.match(css, /\.lvSearch:focus-within/);
  assert.match(css, /\.lvSearch input:focus,\.lvSearch input:focus-visible\{outline:none;border:0;box-shadow:none\}/);
  assert.match(levelJsx, /avatarSrc\(m\)/);
  assert.match(levelJsx, /cdn\.discordapp\.com\/avatars\//);
  assert.match(levelJsx, /No members match/);
  assert.match(css, /\.lvMemberNo\{/);
  // Rewards: compact rows with in-place edit and confirmed removal.
  assert.match(levelJsx, /startEdit\(r\)/);
  assert.match(levelJsx, /editingId\?updateReward:addReward/);
  assert.match(css, /\.lvRewardRow button\{min-height:36px/);
  // Touch-target guarantee: style.css's `.contentWell button{min-height:40px}`
  // ships AFTER this file — Leveling controls re-assert themselves at .lvPage
  // specificity so they can never be flattened to neutral 40px buttons.
  assert.match(css, /\.lvPage \.lvToggle\{min-height:44px/);
  assert.match(css, /\.lvPage \.lvFormActions \.lvPrimary\{/);
  assert.match(css, /\.lvPage \.lvTestBtn\{/);
  assert.match(css, /\.lvPage \.lvChip button\{/);
});

/* ------------------------------------------------------- Leveling V3 ---- */

test("V3 card schema: sanitised fields, backward-compatible settings, Free custom cards blocked", () => {
  // Absent card → null (legacy announcement path stays intact).
  assert.equal(parseAnnounceCard(undefined).value, null);
  assert.equal(parseAnnounceCard(null).ok, true);
  const def = parseAnnounceCard(DEFAULT_ANNOUNCE_CARD, { premium: true }).value;
  assert.equal(def.mode, "ready");
  assert.equal(def.title, "🏆 LEVEL UP!");
  assert.match(def.description, /\{user\}/, "the ready-made card keeps its placeholders");
  // The ready-made card is available to FREE servers too.
  assert.equal(parseAnnounceCard(DEFAULT_ANNOUNCE_CARD, { premium: false }).ok, true);

  // Every text field is mention-stripped and unknown placeholders dropped;
  // colours normalise and only https:// images survive.
  const dirty = parseAnnounceCard({
    mode: "custom",
    title: "Hi @everyone {vip}",
    description: "Go <@&123456789012345678> {level}",
    color: "#F0A",
    emoji: "@here 🏆",
    footer: "@everyone only",
    image: "http://evil.test/x.png",
    thumbnail: false
  }, { premium: true }).value;
  assert.equal(dirty.title, "Hi");
  assert.equal(dirty.description, "Go {level}");
  assert.equal(dirty.color, "#ff00aa");
  assert.equal(dirty.emoji, "🏆");
  assert.equal(dirty.footer, "only");
  assert.equal(dirty.image, "", "http:// images are rejected");
  assert.equal(dirty.thumbnail, false);
  assert.match(parseAnnounceCard({ image: "https://cdn.discordapp.com/attachments/1/2/x.png" }, { premium: true }).value.image, /^https:\/\//);
  // FREE can never store a CUSTOM card — the feature is named in the 403.
  const free = parseAnnounceCard({ ...DEFAULT_ANNOUNCE_CARD, mode: "custom" }, { premium: false });
  assert.equal(free.ok, false);
  assert.deepEqual(free.premiumRequired, ["announceCard"]);

  // Backward compatibility through the full settings parser: no card key →
  // legacy path; an existing custom message is never discarded.
  const legacy = parseLevelingSettings(
    { enabled: true, announceMessage: "🎉 leveled up {user} ! \n⭐ You reached Level {level} !", announceCard: null },
    { premium: true }
  );
  assert.equal(legacy.ok, true);
  assert.equal(legacy.value.announceCard, null, "no card → legacy announcement path");
  assert.match(legacy.value.announceMessage, /leveled up \{user\} !/, "the multiline message survives verbatim");
  const both = parseLevelingSettings({ enabled: true, announceMessage: "old text", announceCard: { mode: "custom", title: "T" } }, { premium: true });
  assert.equal(both.value.announceCard.mode, "custom");
  assert.equal(both.value.announceMessage, "old text", "adding a card never discards the saved message");
  const blocked = parseLevelingSettings({ enabled: true, announceCard: { mode: "custom" } }, { premium: false });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.premiumRequired, ["announceCard"]);
  // V3 dropdown presets: 24 hours (86400s) is a valid cooldown/interval.
  const day = parseLevelingSettings({ messageCooldown: 86400, voiceInterval: 86400 }, { premium: true });
  assert.equal(day.ok, true, JSON.stringify(day));
  assert.equal(day.value.messageCooldown, 86400);
  assert.equal(day.value.voiceInterval, 86400);
});

test("V3 card rendering: one shared renderer for preview and payload, forge-proof branding", () => {
  const custom = {
    ...DEFAULT_ANNOUNCE_CARD,
    mode: "custom",
    title: "Level {level}!",
    description: "Nice {username} in {server}",
    color: "#ff0000",
    emoji: "🎉",
    footer: "My footer",
    image: "https://cdn.discordapp.com/attachments/1/2/img.png"
  };
  const embed = renderLevelUpCard(custom, {
    user: USER_A, username: "Alpha", level: 10, server: "Baltic | Mayhem", premium: true,
    nextReward: { level: 25, roleName: "Elite" },
    avatar: "https://cdn.discordapp.com/avatars/1/abc.png",
    serverIcon: "https://cdn.discordapp.com/icons/1/h.png"
  });
  assert.equal(embed.title, "Level 10!");
  assert.ok(embed.description.startsWith("🎉\nNice Alpha in Baltic | Mayhem"), "emoji line + filled description");
  assert.ok(embed.description.includes("Next reward: **Level 25** → @Elite"));
  assert.equal(embed.color, 0xff0000);
  assert.equal(embed.author.name, "Baltic | Mayhem", "the actual server name is on the card");
  assert.equal(embed.thumbnail.url, "https://cdn.discordapp.com/avatars/1/abc.png");
  assert.equal(embed.image.url, "https://cdn.discordapp.com/attachments/1/2/img.png");
  assert.equal(embed.footer.text, "My footer");
  assert.equal(embed.footer.icon_url, "https://cdn.discordapp.com/icons/1/h.png");
  assert.ok(!renderLevelUpCard({ ...custom, showNextReward: false }, { nextReward: { level: 25, roleName: "Elite" } }).description.includes("Next reward"));

  // FREE: the branding decision is re-applied INSIDE the renderer, so a
  // forged card payload can neither drop nor replace the footer.
  const forged = renderLevelUpCard({ ...custom, footer: "drop the branding" }, { server: "S", premium: false });
  assert.equal(forged.footer.text, ANNOUNCE_BRANDING);
  assert.equal(forged.footer.icon_url, undefined);
  const forgedWithIcon = renderLevelUpCard(custom, { server: "S", premium: false, serverIcon: "https://cdn.discordapp.com/icons/1/h.png" });
  assert.equal(forgedWithIcon.footer.text, ANNOUNCE_BRANDING, "branding survives even when the server icon is shown");
  assert.equal(forgedWithIcon.footer.icon_url, "https://cdn.discordapp.com/icons/1/h.png");

  // READY mode ignores every custom field — the built-in BalticM card only.
  const ready = renderLevelUpCard({ ...custom, mode: "ready" }, { user: USER_A, username: "Alpha", level: 3, server: "S", premium: true });
  assert.equal(ready.title, "🏆 LEVEL UP!");
  assert.ok(ready.description.includes("You reached Level 3!"));
  assert.equal(ready.footer, undefined, "Premium + no footer + no icon → no footer at all");

  // {user} renders as a real mention in the description but the display name
  // in titles — raw mention markup never lands in a title.
  const mention = renderLevelUpCard({ ...custom, title: "{user} hit {level}", description: "{user} hit {level}" }, { user: USER_A, username: "Alpha", level: 4, server: "S", premium: true });
  assert.equal(mention.title, "Alpha hit 4");
  assert.ok(mention.description.includes(`<@${USER_A}>`));
});

test("V3 announcements: card payload matches the shared renderer; tests stay marked and XP-free", async () => {
  const gid = nextGuild();
  const env = await setup(gid, { premium: true });
  const sent = [];
  const restore = stubDiscord({ sent });
  try {
    const card = { ...DEFAULT_ANNOUNCE_CARD, mode: "custom", title: "Card {level}", description: "Hey {username}" };
    const saved = await saveSettings(env, gid, {
      enabled: true, minXp: 100, maxXp: 100,
      announceMode: "channel", announceChannelId: CHANNEL,
      announceMessage: "legacy text", announceCard: card
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.settings.announceMessage, "legacy text", "the legacy message survives a card save");
    assert.equal(saved.body.settings.announceCard.mode, "custom");

    // Real level-up → the payload Discord receives is EXACTLY what
    // renderLevelUpCard() produces — the same call the preview makes.
    const first = await sendMsg(env, msg(gid, USER_A)); // 100 XP → Level 2
    assert.equal(first.body.leveledUp, true, JSON.stringify(first.body));
    assert.equal(sent.length, 1);
    const expected = renderLevelUpCard(saved.body.settings.announceCard, {
      user: USER_A, username: "Member 001", level: 2, server: "Test Guild",
      premium: true, nextReward: null, avatar: null, serverIcon: null
    });
    assert.deepEqual(sent[0].embeds[0], expected, "preview renderer === Discord payload");
    assert.equal(sent[0].content, "", "in card mode the card IS the message");
    assert.deepEqual(sent[0].allowed_mentions, { parse: [], users: [USER_A] }, "mentions stay restricted");

    // Test announcement: marked with 🧪, embed identical to the editor's
    // card, and it grants absolutely no XP.
    const t = await read(levelingAnnounceTest(req("/api/leveling/announce/test", { method: "POST", guildId: gid, body: { channelId: CHANNEL } }), env, adminOf(gid), gid));
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.ok(t.body.content.startsWith("🧪"), "the message identifies itself as a test");
    assert.match(t.body.content, /no XP granted/);
    const expectedTest = renderLevelUpCard(saved.body.settings.announceCard, {
      user: STAFF, username: "Staff", level: 10, server: "Test Guild",
      premium: true, nextReward: null, avatar: null, serverIcon: null
    });
    assert.deepEqual(sent[1].embeds[0], expectedTest, "the test embed is the editor's card, byte for byte");
    assert.deepEqual(sent[1].allowed_mentions, { parse: [] });
    assert.equal(await getLevelingMember(env, gid, USER_B), null, "the test granted nobody XP");
    assert.equal((await getLevelingMember(env, gid, USER_A)).totalXp, 100, "XP untouched by the test");
  } finally { restore(); }

  // FREE guild: a custom card is refused server-side with the feature named.
  const freeGuild = nextGuild();
  const freeEnv = await setup(freeGuild);
  const blocked = await saveSettings(freeEnv, freeGuild, { enabled: true, announceCard: { ...DEFAULT_ANNOUNCE_CARD, mode: "custom" } });
  assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, "premium_required");
  assert.ok(blocked.body.features.includes("announceCard"));
});

test("V3 UI: interval dropdowns, compact ignored dropdowns, inline test, two-mode card builder", () => {
  const css = readFileSync(join(root, "src/leveling.css"), "utf8");
  const dbSrc = readFileSync(join(root, "leveling-db.js"), "utf8");
  // Seconds-backed interval dropdowns: 3600 → "1 hour", anything else →
  // "Custom…" with a manual field. No native selects anywhere.
  assert.match(levelJsx, /const INTERVAL_PRESETS=\[60,300,600,900,1800,3600,7200,10800,21600,43200,86400\]/);
  assert.match(levelJsx, /intervalPreset/);
  assert.match(levelJsx, /id="lv-message-cooldown" label="Message cooldown" flip/);
  assert.match(levelJsx, /id="lv-voice-interval" label="Voice XP interval" flip/);
  assert.equal((levelJsx.match(/<select/g) || []).length, 0, "still zero native selects");
  assert.match(levelingSrc, /messageCooldown: \[10, 86400\]/, "backend accepts the 24-hour preset");
  assert.match(levelingSrc, /voiceInterval: \[15, 86400\]/);
  // Compact ignored dropdowns: two ~340px columns, full width on mobile.
  assert.match(css, /\.lvIgnored\{grid-template-columns:repeat\(2,minmax\(0,340px\)\)\}/);
  assert.match(css, /@media\(max-width:767px\)[\s\S]{0,400}\.lvIgnored\{grid-template-columns:1fr\}/);
  assert.match(levelJsx, /className="lvGrid lvIgnored"/);
  // Two-mode card builder: cursor-position insert + confirmed reset.
  assert.match(levelJsx, /Ready-made card/);
  assert.match(levelJsx, /Custom card/);
  assert.match(levelJsx, /setSelectionRange/);
  assert.match(levelJsx, /window\.confirm\("Reset the Level-Up card/);
  // ONE shared schema/renderer behind preview AND payload.
  assert.match(levelJsx, /renderLevelUpCard\(/);
  assert.match(levelingSrc, /export function parseAnnounceCard\(/);
  assert.match(levelingSrc, /export function renderLevelUpCard\(/);
  // The schema persists through an additive column — never a rewrite.
  assert.match(dbSrc, /ALTER TABLE leveling_config ADD COLUMN announce_card/);
});

/* ------------------------------------------------------- Leveling V3.1 -- */

test("V3.1 two-column card builder: editor left, sticky realistic preview right", () => {
  const css = readFileSync(join(root, "src/leveling.css"), "utf8");
  const dbSrc = readFileSync(join(root, "leveling-db.js"), "utf8");
  // 1) Desktop two-column layout — editor LEFT and preview RIGHT, ~50/50,
  //    minmax(0,…) on both tracks so neither column can overflow.
  const bAt = levelJsx.indexOf('className="lvCardBuilder"');
  assert.ok(bAt > 0, "the Level-Up Card section is a two-column builder");
  const eAt = levelJsx.indexOf('className="lvCardEdit"', bAt);
  const pAt = levelJsx.indexOf('className="lvCardPreviewCol"', bAt);
  assert.ok(eAt > bAt && pAt > eAt, "the editor column renders BEFORE the preview column");
  assert.match(css, /\.lvCardBuilder\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);gap:16px;align-items:start\}/, "50/50 desktop columns");
  assert.match(css, /\.lvCardPreviewCol\{[^}]*position:sticky;top:calc\(var\(--header\) \+ 8px\)/, "sticky below the fixed Control Center header");
  // 2) Responsive stacking — one column below 1200px with sticky disabled…
  assert.match(css, /@media\(max-width:1199px\)\{[\s\S]{0,240}?\.lvCardBuilder\{grid-template-columns:1fr\}[\s\S]{0,200}?\.lvCardPreviewCol\{position:static\}/, "tablet/mobile stack, no sticky trap");
  // …and the field grid collapses to a single column on mobile.
  assert.match(css, /@media\(max-width:767px\)[\s\S]{0,700}\.lvCardGrid\{grid-template-columns:1fr\}/);
  // 3) Preview width — a realistic Discord embed (Discord caps embeds at
  //    512px) instead of a stretched dashboard panel.
  assert.match(css, /\.lvCardPreviewCol \.lvDiscordEmbed\{max-width:512px\}/);
  // 4) Live preview — built from live form state through the shared renderer:
  //    editing a field updates it instantly and never sends a request.
  assert.match(levelJsx, /const card=form\.announceCard\|\|DEFAULT_ANNOUNCE_CARD/);
  assert.match(levelJsx, /renderLevelUpCard\(card,\{/);
  const builderSrc = levelJsx.slice(bAt, levelJsx.indexOf("</form>", bAt));
  assert.ok(!/\bapi\(|fetch\(/.test(builderSrc), "editing the preview never calls the API");
  // 5) Dynamic server name — always the selected guild with a fallback,
  //    never a hardcoded one (the bot's own name may appear, the guild may not).
  assert.match(levelJsx, /server:guildName\|\|"this server"/);
  assert.ok(!levelJsx.includes("Baltic | Mayhem"), "no hardcoded guild name in the UI");
  assert.ok(!css.includes("Baltic | Mayhem"), "no hardcoded guild name in the styles");
  // 6) Existing placeholders — same four tokens, still inserted at the cursor.
  assert.deepEqual([...ALLOWED_ANNOUNCE_PLACEHOLDERS], ["user", "username", "level", "server"]);
  assert.match(levelJsx, /ALLOWED_ANNOUNCE_PLACEHOLDERS\.map\(/);
  assert.match(levelJsx, /setSelectionRange/);
  // 7+8) Premium footer hiding vs Free footer enforcement — one shared
  //      renderer, enforced server-side (see also “V3 card rendering”).
  const card = { mode: "custom", title: "T", description: "D {user}", color: "#e8892c", emoji: "🎉", thumbnail: false, serverIcon: false, showNextReward: false, image: "", footer: "Mine" };
  const ctx = { user: "123", username: "Sam", level: 7, server: "My Guild" };
  assert.equal(renderLevelUpCard(card, { ...ctx, premium: true }).footer.text, "Mine", "Premium keeps its custom footer");
  assert.equal(renderLevelUpCard({ ...card, footer: "" }, { ...ctx, premium: true }).footer, undefined, "Premium may hide the footer entirely");
  assert.equal(renderLevelUpCard(card, { ...ctx, premium: false }).footer.text, ANNOUNCE_BRANDING, "Free always gets the BalticM footer, even with a custom one");
  assert.match(levelJsx, /\{!isPremium&&<small className="lvHint">Free servers always include: \{ANNOUNCE_BRANDING\}<\/small>\}/, "the preview states the Free branding rule");
  // 9) Save/reset — ONE save submit inside the builder with its notice right
  //    beside it, reset still confirmed; persistence is covered by the
  //    settings round-trip tests above.
  assert.match(builderSrc, /<button type="submit"[^>]*>\{busy\?"Saving…":"Save settings"\}/);
  assert.equal((levelJsx.match(/<Notice value=\{settingsNotice\}\/>/g) || []).length, 1, "exactly one save notice, inside the form");
  assert.match(levelJsx, /window\.confirm\("Reset the Level-Up card/);
  // 10) Test-announcement safety untouched — the inline test is the only
  //     sender, it reuses the selected channel (payload in “V3 announcements”).
  assert.match(levelJsx, /form\.announceMode==="channel"\?form\.announceChannelId:""/);
  assert.ok(!levelJsx.includes('id="lv-test-channel"'), "still no second channel picker");
  // 11) No horizontal overflow — overflow-safe minmax tracks everywhere.
  assert.match(css, /\.lvCardBuilder\{[^}]*minmax\(0,1fr\)[^}]*minmax\(0,1fr\)/);
  assert.match(css, /\.lvXpRow\{display:grid;[^}]*minmax\(0,1\.15fr\)/);
  // 12) Leveling API compatibility — this pass is UI-only: the shared
  //     renderer, settings parser and additive schema are untouched.
  assert.match(apiSrc, /renderLevelUpCard\(/);
  assert.match(levelingSrc, /export function parseLevelingSettings\(/);
  assert.match(dbSrc, /ALTER TABLE leveling_config ADD COLUMN announce_card/);
});
/* ------------------------------------------------------- V4 announcements */

test("V4 announcements: admin XP crossings announce once, failures never silent", async () => {
  const gid = nextGuild();
  const env = await setup(gid, { premium: true });
  const sent = [];
  const urls = [];
  let failNext = false;
  const restore = stubDiscord({
    sent,
    match: (u) => {
      if (/\/messages$/.test(u)) {
        urls.push(u);
        if (failNext) return { ok: false, status: 403, json: async () => ({ message: "Missing Access" }) };
      }
      return undefined;
    }
  });
  // Capture the dispatcher's structured worker logs for this test only.
  const logs = [];
  const realLog = console.log;
  console.log = (...a) => { logs.push(a.join(" ")); };
  const events = () => logs.filter((l) => l.includes('"component":"leveling"')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  try {
    await enableBasic(env, gid, { announceMode: "channel", announceChannelId: CHANNEL, announceCard: { ...DEFAULT_ANNOUNCE_CARD } });
    const admin = adminOf(gid);
    const act = (body) => read(levelingXpAction(req("/api/leveling/xp", { method: "POST", guildId: gid, body }), env, admin, gid, { onAudit: () => {} }));

    // 1) add that crosses to a NEW level announces ONCE, into THIS guild's
    //    configured channel, with the dynamic server name from Discord.
    const a1 = await act({ action: "add", userId: USER_A, amount: 300 });
    assert.equal(a1.status, 200, JSON.stringify(a1.body));
    assert.equal(a1.body.level, 3);
    assert.equal(a1.body.announced, true, "an upward admin crossing announces");
    assert.equal(sent.length, 1);
    assert.ok(urls[0].includes(`/channels/${CHANNEL}/messages`), "target = this guild's configured channel only");
    assert.equal(sent[0].embeds[0].author.name, "Test Guild", "server name comes from Discord, never hardcoded");
    assert.equal(sent[0].content, "", "card mode: the card IS the message");
    // Manual admin XP is TOTAL XP only — it must never masquerade as Message/Voice XP.
    const row = await getLevelingMember(env, gid, USER_A);
    assert.equal(row.messageXp, 0, "admin XP never counts as Message XP");
    assert.equal(row.voiceXp, 0, "admin XP never counts as Voice XP");

    // 2) An action that does NOT cross a level never announces.
    const a2 = await act({ action: "add", userId: USER_A, amount: 50 }); // 350 XP → still Level 3
    assert.equal(a2.body.level, 3);
    assert.equal(a2.body.announced, false, "unchanged level → no announcement");
    assert.equal(sent.length, 1);

    // 3) Re-crossing an ALREADY announced level never duplicates (ledger).
    await act({ action: "remove", userId: USER_A, amount: 350 }); // → 0 XP
    const a3 = await act({ action: "add", userId: USER_A, amount: 300 }); // → Level 3 again
    assert.equal(a3.body.announced, false, "the per-level ledger blocks a duplicate");
    assert.equal(sent.length, 1);
    assert.ok(events().some((e) => e.event === "announce-duplicate"), "the duplicate is logged, not silent");

    // 4) A multi-level jump announces exactly ONE message, at the HIGHEST level.
    const a4 = await act({ action: "add", userId: USER_A, amount: 9200 }); // 9500 XP → Level 14
    assert.equal(a4.body.level, 14);
    assert.equal(a4.body.announced, true);
    assert.equal(sent.length, 2, "one message even though many levels were crossed");
    assert.match(JSON.stringify(sent[1].embeds), /Level 14/);

    // 5) Level DECREASES and resets never announce.
    const down = await act({ action: "remove", userId: USER_A, amount: 9000 });
    assert.equal(down.body.announced, false, "a decrease never announces");
    const reset = await act({ action: "reset", userId: USER_A, confirm: true });
    assert.equal(reset.body.announced, false, "reset never announces");
    assert.equal(sent.length, 2, "no announcement for decreases or resets");

    // 6) Discord failure: the admin action still succeeds, the failure is
    //    logged with actionable detail, and the claim is released so a later
    //    crossing of the same level RETRIES instead of losing the announce.
    failNext = true;
    const blocked = await act({ action: "add", userId: USER_A, amount: 100 }); // 0 → Level 2
    assert.equal(blocked.status, 200, "a Discord outage never fails the admin action");
    assert.equal(blocked.body.announced, false);
    assert.equal(sent.length, 2);
    const failed = events().filter((e) => e.event === "announce-failed").pop();
    assert.ok(failed, "announce failures are logged — never silent");
    assert.equal(failed.status, 403);
    assert.equal(failed.channelId, CHANNEL, "the log names the failing channel");
    assert.match(failed.detail, /denied|permission|cannot/i, "the log explains WHY");
    failNext = false;
    await act({ action: "remove", userId: USER_A, amount: 100 }); // → 0 XP
    const retry = await act({ action: "add", userId: USER_A, amount: 100 }); // → Level 2 again
    assert.equal(retry.body.announced, true, "a failed send releases the claim so the next crossing retries");
    assert.equal(sent.length, 3);
    assert.ok(events().some((e) => e.event === "announce-sent" && e.messageId === "posted" && e.channelId === CHANNEL), "success is logged with the Discord message id");

    // 7) FREE guild: branding is enforced server-side on admin crossings too.
    const g2 = nextGuild();
    const freeEnv = await setup(g2);
    await enableBasic(freeEnv, g2, { announceMode: "channel", announceChannelId: CHANNEL, announceCard: { ...DEFAULT_ANNOUNCE_CARD } });
    const freeAct = (body) => read(levelingXpAction(req("/api/leveling/xp", { method: "POST", guildId: g2, body }), freeEnv, adminOf(g2), g2, { onAudit: () => {} }));
    const f1 = await freeAct({ action: "add", userId: USER_B, amount: 300 });
    assert.equal(f1.body.announced, true, JSON.stringify(f1.body));
    const freeMsg = sent[sent.length - 1];
    assert.equal(freeMsg.embeds[0].footer.text, ANNOUNCE_BRANDING, "FREE guilds always carry the mandatory branding");
    assert.equal(freeMsg.embeds[0].author.name, "Test Guild");

    // 8) same_channel + admin event (no origin channel): skipped WITH a
    //    logged reason — documented policy, not a silent failure.
    const g3 = nextGuild();
    const env3 = await setup(g3, { premium: true });
    await enableBasic(env3, g3, { announceMode: "same_channel" });
    const act3 = (body) => read(levelingXpAction(req("/api/leveling/xp", { method: "POST", guildId: g3, body }), env3, adminOf(g3), g3, { onAudit: () => {} }));
    const before = sent.length;
    const s1 = await act3({ action: "add", userId: USER_C, amount: 300 });
    assert.equal(s1.status, 200);
    assert.equal(s1.body.announced, false, "admin events have no origin channel in same_channel mode");
    assert.equal(sent.length, before, "nothing was sent");
    assert.ok(events().some((e) => e.event === "announce-skipped" && e.reason === "no-origin-channel" && e.source === "admin"), "the skip is logged with its reason");

    // 9) Announcements disabled → the crossing still succeeds and the
    //    dispatcher logs WHY nothing was sent (never a silent no-op).
    const g4 = nextGuild();
    const env4 = await setup(g4, { premium: true });
    await enableBasic(env4, g4); // announceMode defaults to "off"
    const act4 = (body) => read(levelingXpAction(req("/api/leveling/xp", { method: "POST", guildId: g4, body }), env4, adminOf(g4), g4, { onAudit: () => {} }));
    const o1 = await act4({ action: "add", userId: USER_A, amount: 300 });
    assert.equal(o1.status, 200);
    assert.equal(o1.body.announced, false, "disabled announcements never send");
    assert.ok(events().some((e) => e.event === "announce-skipped" && e.reason === "mode-off" && e.guildId === g4), "disabled announcements log why nothing was sent");
  } finally { console.log = realLog; restore(); }
});

/* --------------------------------------------------------- V4 leaderboard */

test("V4 leaderboard: every value sits directly beneath its header column", () => {
  const css = readFileSync(join(root, "src/leveling.css"), "utf8");
  // ONE shared grid template: the header row and every member row are the
  // same `.lvBoardRow` grid, so tracks can never drift apart.
  assert.match(css, /\.lvBoardRow\{display:grid;grid-template-columns:52px minmax\(160px,1\.6fr\) repeat\(4,minmax\(76px,1fr\)\)/);
  // Header cells adopt the SAME alignment as the values beneath them:
  // rank centered, MEMBER left, and the four numeric columns right.
  assert.match(css, /\.lvBoardHead>span:nth-child\(1\)\{text-align:center\}/, "# header matches the centered rank/medal");
  assert.match(css, /\.lvBoardHead>span:nth-child\(n\+3\)\{text-align:right\}/, "Level/Total/Message/Voice headers right-align like their values");
  assert.match(css, /\.lvBoardRow>span\[data-label\]\{text-align:right\}/, "numeric values right-align on desktop");
  assert.match(css, /\.lvPos\{text-align:center/);
  assert.match(css, /font-variant-numeric:tabular-nums/, "tabular figures keep digits on a fixed grid");
  assert.match(css, /\.lvBoardHead>span\{white-space:nowrap/, "column headers never wrap mid-label");
  // Header exposes rank + the five columns in order …
  assert.match(levelJsx, /<span>#<\/span><span>MEMBER<\/span><span>LEVEL<\/span><span>TOTAL XP<\/span><span>MESSAGE XP<\/span><span>VOICE XP<\/span>/);
  // … and each member row's value cells map 1:1 onto those same tracks.
  const row = levelJsx.match(/className="lvBoardRow" role="row"[\s\S]*?<\/div>/);
  assert.ok(row, "a member row exists to compare against the header");
  const labels = [...row[0].matchAll(/data-label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Level", "Total XP", "Message XP", "Voice XP"], "value cells map 1:1 onto the four header columns");
  // Numbers are formatted with thousands separators; admin XP stays out of
  // the Message/Voice columns (the server-side test above asserts that).
  assert.match(levelJsx, /const fmt=n=>Number\(n\|\|0\)\.toLocaleString\(\)/);
  // Mobile: responsive labelled cards — header hidden, no squeezed columns,
  // labels rendered before values, left-aligned and readable.
  assert.match(css, /@media\(max-width:767px\)[\s\S]*?\.lvBoardHead\{display:none\}/);
  assert.match(css, /grid-template-areas:"pos member member" "\. level total" "\. mvoice vvoice"/);
  assert.match(css, /\.lvBoardRow>span\[data-label\]\{text-align:left\}/);
  assert.match(css, /content:attr\(data-label\) " · "/);
});
