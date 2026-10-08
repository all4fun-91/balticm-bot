import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  COINS_COMMAND_DEFINITIONS,
  COINS_CURRENCY,
  COINS_DEFAULTS,
  PURCHASE_STATUSES,
  SHOP_ITEM_TYPES,
  TX_SOURCES,
  parseCoinAction,
  parseCoinsSettings,
  parseShopItem,
  premiumRedemptionBlocked
} from "../coins.js";
import {
  claimDaily,
  claimMessageReward,
  coinsLeaderboard,
  countTransactions,
  creditCoins,
  debitCoins,
  economyStats,
  ensureCoinsTables,
  ensureWallet,
  getCoinsConfig,
  getPurchase,
  getWallet,
  listShopItems,
  listTransactions,
  listWallets,
  setWalletIdentity,
  voiceRewardEligible
} from "../coins-db.js";
import {
  buyShopItem,
  claimDailyReward,
  coinsBalanceInteraction,
  coinsCommandsRouter,
  coinsDailyInteraction,
  coinsLeaderboardPage,
  coinsOverview,
  coinsPayInteraction,
  coinsPurchasesPage,
  coinsPurchaseFulfill,
  coinsPurchaseRefund,
  coinsShopCreate,
  coinsShopDelete,
  coinsShopList,
  coinsShopUpdate,
  coinsTransactionsPage,
  coinsWalletAdjust,
  coinsWalletDetail,
  coinsWalletsPage,
  gameEconomy,
  processCoinsMessage,
  processCoinsVoice,
  processTransfer,
  saveCoinsSettings
} from "../coins-api.js";
import {
  ACCESS_CONFIGURE,
  ACCESS_KEYS,
  ACCESS_OPERATE,
  requiredLevelForRequest,
  routeAccessKey
} from "../access-control.js";
import { PAGE_ACCESS_KEY, PAGE_PATHS } from "../src/control-center-state.js";
import { LEADERBOARD_COMMAND_DEFINITION, RANK_COMMAND_DEFINITION } from "../leveling.js";

/* --------------------------------------------------------------- harness */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const coinsJsx = readFileSync(join(root, "src", "Coins.jsx"), "utf8");
const coinsCss = readFileSync(join(root, "src", "coins.css"), "utf8");
const mainSrc = readFileSync(join(root, "src", "main.jsx"), "utf8");
const stateSrc = readFileSync(join(root, "src", "control-center-state.js"), "utf8");
const coinsApiSrc = readFileSync(join(root, "coins-api.js"), "utf8");
const accessSrc = readFileSync(join(root, "access-control.js"), "utf8");

function makeEnv() {
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
    BALTICM_VOICE_SERVICE_SECRET: "voice-secret"
  };
}

const req = (path, { method = "GET", body, ...query } = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return new Request(`https://bot.balticm.eu${path}${suffix}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
};

const read = async (pending) => { const res = await pending; return { status: res.status, body: await res.json() }; };

let gidCounter = 0;
const nextGuild = () => String(884200000000000000n + BigInt(++gidCounter));
const CHANNEL = "123456789012345678";
const REWARD_ROLE = "123456789012345601";
const REWARD_ROLE_2 = "123456789012345602";
const IGNORED_ROLE = "123456789012345609";
const BOT_ROLE = "123456789012345600";
const BOT_ID = "1543137268221354035";
const STAFF = "293469802188636160";
const OUTSIDER = "111111111111111111";
const USER_A = "310000000000000001";
const USER_B = "310000000000000002";
const USER_C = "310000000000000003";

const adminOf = (guildId) => ({ id: STAFF, username: "staff", global_name: "Staff", guilds: [{ id: guildId, name: "G" }] });
const outsider = { id: OUTSIDER, username: "outsider", global_name: "Outsider", guilds: [{ id: "987654321098765432", name: "Other" }] };

const ROLES = [
  { id: BOT_ROLE, name: "BalticM", position: 20, managed: true, permissions: "33554432" },
  { id: REWARD_ROLE, name: "Active", position: 8, managed: false },
  { id: REWARD_ROLE_2, name: "Veteran", position: 7, managed: false },
  { id: IGNORED_ROLE, name: "Muted", position: 3, managed: false },
  { id: "884200000000000001", name: "@everyone", position: 0, managed: false }
];

const rootFetch = globalThis.fetch;
const j = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

function stubDiscord({ match, roleGrants } = {}) {
  const prev = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const u = String((input && input.url) || input);
    if (!u.includes("discord.com/api/v10/")) return prev(input, init);
    if (match) { const custom = match(u, init); if (custom !== undefined) return custom; }
    if (/\/members\/@me$/.test(u)) return j({ roles: [BOT_ROLE] });
    if (/\/roles\/\d+$/.test(u)) { roleGrants?.push({ url: u, method: init.method || "GET" }); return j({}, 200); }
    if (/\/roles$/.test(u)) return j(ROLES);
    if (/\/guilds\/[^/]+\/channels$/.test(u)) return j([{ id: CHANNEL, type: 0, name: "general" }, { id: "222222222222222222", type: 2, name: "voice" }]);
    if (/\/members\/\d+$/.test(u)) {
      const id = (u.match(/\/members\/(\d+)$/) || [])[1];
      if (id === BOT_ID) return j({ roles: [BOT_ROLE] });
      return j({ user: { id, username: "member" + id.slice(-3), global_name: "Member " + id.slice(-3), avatar: "", bot: false }, nick: null, roles: [] });
    }
    if (/\/messages$/.test(u)) return j({ id: "posted" });
    if (/\/guilds\/[^/]+$/.test(u)) return j({ id: "guild", name: "Test Guild", permissions: "33554432" });
    return j({});
  };
  return () => { globalThis.fetch = prev; };
}

async function setup(guildId) {
  const env = makeEnv();
  await ensureCoinsTables(env);
  return env;
}

const save = (env, guildId, body) =>
  read(saveCoinsSettings(req("/api/coins", { method: "POST", guildId, body }), env, adminOf(guildId), guildId));
const enable = async (env, guildId, over = {}) => {
  const s = await save(env, guildId, { enabled: true, ...over });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body.settings;
};
const overview = (env, guildId, user) =>
  read(coinsOverview(req("/api/coins", { guildId }), env, user || adminOf(guildId), guildId));
const wallet = (env, guildId, userId) => getWallet(env, guildId, userId);
const fund = async (env, guildId, userId, amount) => {
  const { settings } = await getCoinsConfig(env, guildId);
  await ensureWallet(env, guildId, userId, settings);
  return creditCoins(env, { guildId, userId, amount, source: "admin_adjustment", reason: "test fund" });
};

/* --------------------------------------------- 1) settings + validation */

test("settings: safe bounds, defaults and the fixed Baltic Coins identity", async () => {
  // Out-of-range values clamp into the safety bounds instead of rejecting.
  const clamped = parseCoinsSettings({ enabled: true, dailyAmount: 9999999, messageCooldown: 1, voiceInterval: 5, startingBalance: -40 });
  assert.equal(clamped.ok, true);
  assert.equal(clamped.value.dailyAmount, 1000000, "daily amount clamps to its bound");
  assert.equal(clamped.value.messageCooldown, 10, "message cooldown clamps up to the anti-farm floor");
  assert.equal(clamped.value.voiceInterval, 60, "voice interval clamps to its floor");
  assert.equal(clamped.value.startingBalance, 0, "never negative");
  // Defaults match the spec exactly.
  const d = parseCoinsSettings({}).value;
  assert.equal(d.enabled, false, "economy is opt-in per guild");
  assert.equal(d.dailyAmount, COINS_DEFAULTS.dailyAmount);
  assert.equal(d.dailyAmount, 100);
  assert.equal(d.dailyCooldown, 86400, "24 hours");
  assert.equal(d.messageAmount, 5);
  assert.equal(d.messageCooldown, 60);
  assert.equal(d.voiceAmount, 10);
  assert.equal(d.voiceInterval, 600, "10 minutes");
  assert.equal(d.startingBalance, 0);
  assert.equal(d.transfersEnabled, true);
  assert.equal(d.shopEnabled, true);
  // Unknown keys are dropped; the currency identity cannot be renamed in V1.
  assert.ok(!("currency" in d) && !("icon" in d), "no display customization leaks into settings");
  assert.equal(COINS_CURRENCY, "Baltic Coins");
  // Excluded lists only keep valid snowflakes, deduplicated.
  const ex = parseCoinsSettings({ excludedChannels: [CHANNEL, CHANNEL, "nope"], excludedRoles: [IGNORED_ROLE, "abc"] }).value;
  assert.deepEqual(ex.excludedChannels, [CHANNEL]);
  assert.deepEqual(ex.excludedRoles, [IGNORED_ROLE]);
  // Persist round-trip through the real handler.
  const gid = nextGuild();
  const env = await setup(gid);
  const saved = await enable(env, gid, { dailyAmount: 250, messageAmount: 7 });
  assert.equal(saved.dailyAmount, 250);
  assert.equal((await overview(env, gid)).body.settings.messageAmount, 7, "overview returns what was saved");
});

/* ------------------------------------- 2) wallet creation + start balance */

test("wallet: created on demand, starting balance applied exactly once", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  // No starting balance by default.
  const w1 = await ensureWallet(env, gid, USER_A, (await overview(env, gid)).body.settings);
  assert.equal(w1.balance, 0);
  assert.equal((await overview(env, gid)).body.stats.wallets, 1, "overview counts real wallets");
  // Configured starting balance: three racing first-views still grant once.
  const gid2 = nextGuild();
  const env2 = await setup(gid2);
  await enable(env2, gid2, { startingBalance: 500 });
  const settings = (await overview(env2, gid2)).body.settings;
  const [a, b, c] = await Promise.all([
    ensureWallet(env2, gid2, USER_B, settings),
    ensureWallet(env2, gid2, USER_B, settings),
    ensureWallet(env2, gid2, USER_B, settings)
  ]);
  // No racing view may ever see MORE than the configured starting balance.
  for (const w of [a, b, c]) assert.ok(w.balance <= 500, "no racing view double-grants");
  assert.equal((await wallet(env2, gid2, USER_B)).balance, 500, "starting balance credited exactly once, finally");
  const starts = await listTransactions(env2, gid2, { userId: USER_B, limit: 50 });
  const startRows = starts.filter((t) => t.source === "starting_balance");
  assert.equal(startRows.length, 1, "exactly one starting-balance ledger entry");
  assert.equal(startRows[0].amount, 500);
  assert.equal(startRows[0].balanceAfter, 500);
});

/* ------------------------------------------------ 3) guild isolation */

test("two guilds: the same member runs two fully independent economies", async () => {
  const gA = nextGuild(), gB = nextGuild();
  const envA = await setup(gA), envB = await setup(gB);
  await enable(envA, gA, { dailyAmount: 100, messageAmount: 5 });
  await enable(envB, gB, { dailyAmount: 50, messageAmount: 2, startingBalance: 800 });

  // Settings are per guild.
  assert.equal((await overview(envA, gA)).body.settings.dailyAmount, 100);
  assert.equal((await overview(envB, gB)).body.settings.dailyAmount, 50);
  assert.equal((await overview(envB, gB)).body.settings.messageAmount, 2);

  // Balances never mix.
  await ensureWallet(envA, gA, USER_A, (await overview(envA, gA)).body.settings);
  await creditCoins(envA, { guildId: gA, userId: USER_A, amount: 5000, source: "admin_adjustment", reason: "A" });
  assert.equal((await wallet(envA, gA, USER_A)).balance, 5000);
  assert.equal(await wallet(envB, gB, USER_A), null, "no wallet exists in guild B until first use");

  // Daily claims are per guild — claiming in A does not lock B.
  const dA = await claimDailyReward(envA, gA, USER_A);
  const dB = await claimDailyReward(envB, gB, USER_A);
  assert.equal(dA.ok, true);
  assert.equal(dB.ok, true, "the same member claims both guild dailies");
  assert.equal(dA.amount, 100);
  assert.equal(dB.amount, 50);
  assert.equal((await wallet(envA, gA, USER_A)).balance, 5100);
  assert.equal((await wallet(envB, gB, USER_A)).balance, 850);

  // A transfer moves coins only inside its own guild.
  await ensureWallet(envA, gA, USER_B, {});
  const t = await processTransfer(envA, gA, { userId: USER_A }, { userId: USER_B }, 200, { idempotencyKey: "iso-1" });
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal((await wallet(envA, gA, USER_B)).balance, 200);
  assert.equal((await wallet(envB, gB, USER_B))?.balance ?? 0, 0, "guild B's USER_B untouched");

  // Queries and leaderboards only ever see one guild's rows.
  const bA = await coinsLeaderboard(envA, gA, { limit: 100 });
  const bB = await coinsLeaderboard(envB, gB, { limit: 100 });
  assert.deepEqual(bA.map((r) => r.userId).sort(), [USER_A, USER_B].sort());
  assert.deepEqual(bB.map((r) => r.userId), [USER_A]);
  const tA = await listTransactions(envA, gA, { limit: 100 });
  assert.ok(tA.length > 0);
  assert.ok(tA.every((t) => t.guildId === gA), "every ledger row is guild-scoped");
  // No cross-guild balance leakage in the directory either.
  const wB = await listWallets(envB, gB, { limit: 100 });
  assert.equal(wB.total, 1, "only guild B's wallets are listed");
});

/* ------------------------------- 4) routing, RBAC and page/guild wiring */

test("module wiring: route, access key, sidebar and guild-scoped UI", async () => {
  // Control Center state: page ↔ access key ↔ path.
  assert.equal(PAGE_ACCESS_KEY["Baltic Coins"], "coins");
  assert.equal(PAGE_PATHS["Baltic Coins"], "/coins");
  assert.ok(ACCESS_KEYS.includes("coins"), "the coins module has an RBAC key");
  // Reading = OPERATE, mutations = CONFIGURE.
  assert.equal(routeAccessKey("/api/coins"), "coins");
  assert.equal(routeAccessKey("/api/coins/wallets/123456789012345678/adjust"), "coins");
  assert.equal(requiredLevelForRequest("/api/coins", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/coins/leaderboard", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/coins", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/coins/wallets/123456789012345678/adjust", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/coins/shop", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/coins/shop/abc", "PUT"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/coins/purchases/abc/fulfill", "POST"), ACCESS_CONFIGURE, "fulfilment is a privileged action");
  assert.equal(requiredLevelForRequest("/api/coins/purchases/abc/refund", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/coins/wallets", "GET"), ACCESS_OPERATE);

  // Sidebar + route rendering in main.jsx, guild persistence helpers included.
  assert.ok(mainSrc.includes('import CoinsPage from"./Coins.jsx"'), "the module page is imported");
  assert.ok(mainSrc.includes('["Baltic Coins",Coins]'), "sidebar entry exists");
  assert.match(mainSrc, /page==="Baltic Coins"&&user&&<CoinsPage/);
  assert.ok(mainSrc.includes('canUseAccess(controlPermissions,"coins"'), "configure permission is checked");
  assert.ok(mainSrc.includes("readStoredGuildId") && mainSrc.includes("writeStoredGuildId"), "active guild survives a refresh");
  assert.ok(stateSrc.includes("balticm-selected-guild"), "guild storage key unchanged");

  // Every coins API call in the UI is guild-scoped.
  const apiCalls = coinsJsx.match(/api\/coins[^"`]*/g) || [];
  assert.ok(apiCalls.length >= 8, `expected the UI to call the coins API, found ${apiCalls.length}`);
  for (const call of apiCalls) {
    assert.ok(call.includes("guildId"), `UI request must carry guildId: ${call}`);
  }
  // Every worker coins route re-checks guild membership.
  const routeLines = workerSrc.split("\n").filter((l) => /api\\?\/coins/.test(l) && l.includes("canManageGuild"));
  assert.ok(routeLines.length >= 11, `all coins routes must check canManageGuild (found ${routeLines.length})`);
});

/* --------------------------------------------------- 5) daily rewards */

test("daily reward: claim, cooldown, concurrency and the kill switch", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, { dailyAmount: 100 });

  // Disabled → clear message, nothing paid.
  await save(env, gid, { enabled: true, dailyEnabled: false });
  const off = await claimDailyReward(env, gid, USER_A);
  assert.equal(off.ok, false);
  assert.equal(off.code, "disabled");

  await save(env, gid, { enabled: true, dailyEnabled: true, dailyAmount: 100, dailyCooldown: 86400 });
  const first = await claimDailyReward(env, gid, USER_A);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.amount, 100);
  assert.equal(first.balance, 100);
  assert.ok(first.remainingMs > 86390000, "reports the 24h cooldown");
  assert.equal((await wallet(env, gid, USER_A)).balance, 100);

  // Second claim inside the cooldown → remaining time, no double pay.
  const second = await claimDailyReward(env, gid, USER_A);
  assert.equal(second.ok, false);
  assert.equal(second.code, "cooldown");
  assert.ok(second.remainingMs > 0);
  assert.equal((await wallet(env, gid, USER_A)).balance, 100, "cooldown never pays twice");
  const dailyRows = (await listTransactions(env, gid, { userId: USER_A, limit: 50 })).filter((t) => t.source === "discord_daily");
  assert.equal(dailyRows.length, 1);

  // Five concurrent claims → exactly one winner.
  const g2 = nextGuild();
  const env2 = await setup(g2);
  await enable(env2, g2, {});
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => claimDailyReward(env2, g2, USER_C)));
  const winners = results.filter((r) => r.ok);
  assert.equal(winners.length, 1, "one guarded UPDATE decides the winner");
  assert.equal((await wallet(env2, g2, USER_C)).balance, 100, "paid exactly once");
});

/* ------------------------------------------------ 6) message rewards */

test("message reward: award, cooldown, replay and repeated-message spam protection", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, { messageAmount: 5, messageCooldown: 60 });
  const payload = (over = {}) => ({
    guildId: gid, channelId: CHANNEL, messageId: String(700000000000000000 + Math.floor(Math.random() * 1e9)),
    userId: USER_A, username: "usera", displayName: "User A", avatar: "", text: "hello world", memberRoleIds: [], ...over
  });

  // Disabled economy → nothing moves.
  await save(env, gid, { enabled: false });
  assert.equal((await processCoinsMessage(env, payload())).ignored, "disabled");
  await save(env, gid, { enabled: true, messageEnabled: true, messageAmount: 5, messageCooldown: 60 });

  // First qualifying message pays.
  const first = await processCoinsMessage(env, payload({ messageId: "700000000000000001" }));
  assert.equal(first.awarded, 5, JSON.stringify(first));
  assert.equal(first.balance, 5);

  // A replayed gateway event for the SAME message id never pays again.
  const replay = await processCoinsMessage(env, payload({ messageId: "700000000000000001" }));
  assert.ok(replay.ignored === "cooldown", JSON.stringify(replay));
  assert.equal((await wallet(env, gid, USER_A)).balance, 5, "no double pay on replay");

  // A different message inside the 60s cooldown → cooldown, not paid.
  const within = await processCoinsMessage(env, payload({ messageId: "700000000000000002" }));
  assert.equal(within.ignored, "cooldown");
  assert.equal((await wallet(env, gid, USER_A)).balance, 5);

  // Bots / webhooks / excluded channels / excluded roles are never paid.
  assert.equal((await processCoinsMessage(env, payload({ bot: true }))).ignored, "sender");
  assert.equal((await processCoinsMessage(env, payload({ webhookId: "700000000000000999" }))).ignored, "sender");
  const otherChannel = await processCoinsMessage(env, payload({ channelId: "222222222222222222", userId: USER_C, messageId: "700000000000000005" }));
  assert.equal(otherChannel.awarded, 5, "a channel that is not excluded still pays a fresh member");
  await enable(env, gid, { excludedChannels: [CHANNEL] });
  assert.equal((await processCoinsMessage(env, payload())).ignored, "channel", "excluded channel pays nothing");
  await enable(env, gid, { excludedChannels: [], excludedRoles: [IGNORED_ROLE] });
  assert.equal((await processCoinsMessage(env, payload({ memberRoleIds: [IGNORED_ROLE] }))).ignored, "role");
  // Roles unknown (Discord lookup failed) → never pay on an unverifiable member.
  const restore404 = stubDiscord({ match: (u) => (u.includes(`/members/${USER_A}`) && !u.includes("/roles/") && !u.includes("@me")) ? j({}, 404) : undefined });
  try {
    assert.equal((await processCoinsMessage(env, payload({ memberRoleIds: null }))).ignored, "roles_unknown");
  } finally { restore404(); }

  // The ledger records exactly one message reward.
  const paid = (await listTransactions(env, gid, { userId: USER_A, source: "discord_message", limit: 50 }));
  assert.equal(paid.length, 1);
  assert.equal(paid[0].amount, 5);
});

test("message anti-farm: the guarded claim alone decides cooldown, replay and spam", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  const base = { guildId: gid, userId: USER_A, amount: 5 };
  const t0 = Date.parse("2026-01-01T00:00:00.000Z");
  const sigHello = "hello world";
  // First message claims.
  assert.equal(await claimMessageReward(env, { ...base, now: t0, cooldownMs: 60000, messageId: "m1", sig: sigHello }), true);
  // Replayed message id → blocked even if the cooldown has elapsed.
  assert.equal(await claimMessageReward(env, { ...base, now: t0 + 120000, cooldownMs: 60000, messageId: "m1", sig: "other" }), false,
    "same message id can never pay twice");
  // Different message past cooldown but the SAME repeated text inside the
  // 10-minute spam window → blocked (copy-paste farming).
  assert.equal(await claimMessageReward(env, { ...base, now: t0 + 90000, cooldownMs: 60000, messageId: "m2", sig: sigHello }), false,
    "repeated identical message inside the spam window is blocked");
  // Different content passes once the cooldown elapsed.
  assert.equal(await claimMessageReward(env, { ...base, now: t0 + 90000, cooldownMs: 60000, messageId: "m3", sig: "something new" }), true);
  // After the spam window the same signature is allowed again.
  assert.equal(await claimMessageReward(env, { ...base, now: t0 + 11 * 60000, cooldownMs: 60000, messageId: "m4", sig: sigHello }), true);
  // Zero cooldown still cannot replay the same message id.
  assert.equal(await claimMessageReward(env, { ...base, now: t0 + 12 * 60000, cooldownMs: 0, messageId: "m4", sig: "zzz" }), false);
});

/* -------------------------------------------------- 7) voice rewards */

test("voice reward: interval ticks, disconnects and restart safety", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, { voiceEnabled: true, voiceAmount: 10, voiceInterval: 600 });
  const members = [
    { userId: USER_A, username: "usera", displayName: "User A" },
    { userId: BOT_ID, username: "bot", displayName: "Bot", bot: true },
    { userId: USER_B, username: "userb", displayName: "User B", afk: true }
  ];

  // First snapshot only STARTS the participation clock — no free Coins.
  const tick1 = await processCoinsVoice(env, gid, members);
  assert.equal(tick1.awarded, 0, "first sight never pays");
  assert.equal((await wallet(env, gid, USER_A))?.balance ?? 0, 0);

  // Simulate a full interval elapsed (restart-safe: state lives in D1, not
  // in process memory — a bot restart mid-interval keeps the same clock).
  const elapsed = Date.now() - 601000;
  await env.BALTICM_DB.prepare(
    "UPDATE coins_reward_state SET voice_seen=1, last_voice_at=? WHERE guild_id=? AND user_id=?"
  ).bind(elapsed, gid, USER_A).run();
  const tick2 = await processCoinsVoice(env, gid, members);
  assert.equal(tick2.awarded, 1, "only the non-bot, non-AFK member earns");
  assert.equal((await wallet(env, gid, USER_A)).balance, 10);
  const voiceRows = (await listTransactions(env, gid, { source: "discord_voice", limit: 50 }));
  assert.equal(voiceRows.length, 1);
  assert.equal(voiceRows[0].amount, 10);

  // Immediately again → interval not reached, no duplicate reward.
  const tick3 = await processCoinsVoice(env, gid, members);
  assert.equal(tick3.awarded, 0);

  // Disconnect: leaving the snapshot resets the clock; rejoining must wait
  // a FULL interval again — disconnect/reconnect can never farm rewards.
  const t = Date.now();
  const g2 = nextGuild();
  const env2 = await setup(g2);
  await enable(env2, g2, {});
  const solo = [{ userId: USER_C }];
  assert.deepEqual(await voiceRewardEligible(env2, { guildId: g2, members: solo, now: t, intervalMs: 600000 }), [], "first sight");
  // Absent from snapshot → clock resets.
  assert.deepEqual(await voiceRewardEligible(env2, { guildId: g2, members: [], now: t + 700000, intervalMs: 600000 }), [], "absent member resets");
  // Rejoin: first sight again — even though 700s passed while away.
  assert.deepEqual(await voiceRewardEligible(env2, { guildId: g2, members: solo, now: t + 700100, intervalMs: 600000 }), [], "rejoin restarts the clock");
  // A full interval actually inside the channel pays.
  assert.deepEqual(await voiceRewardEligible(env2, { guildId: g2, members: solo, now: t + 1300101, intervalMs: 600000 }), [USER_C]);
  // Bots and AFK never appear in the eligible list.
  const withSlackers = [{ userId: USER_A, bot: true }, { userId: USER_B, afk: true }, { userId: "not-a-snowflake" }];
  assert.deepEqual(await voiceRewardEligible(env2, { guildId: g2, members: withSlackers, now: t + 1400101, intervalMs: 600000 }), []);
});

/* ------------------------------------------------------ 8) transfers */

test("transfers: success, linked ledger entries, limits and the kill switch", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  await fund(env, gid, USER_A, 1000);

  // Success: linked debit + credit sharing one transfer id.
  const t = await processTransfer(env, gid, { userId: USER_A }, { userId: USER_B }, 250, { idempotencyKey: "pay-1" });
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(t.fromBalance, 750);
  assert.equal(t.toBalance, 250);
  assert.equal((await wallet(env, gid, USER_A)).balance, 750);
  assert.equal((await wallet(env, gid, USER_B)).balance, 250);
  const rows = (await listTransactions(env, gid, { limit: 50 })).filter((r) => r.source === "discord_transfer");
  assert.equal(rows.length, 2, "one debit + one credit entry");
  const debit = rows.find((r) => r.amount < 0);
  const credit = rows.find((r) => r.amount > 0);
  assert.equal(debit.amount, -250);
  assert.equal(credit.amount, 250);
  assert.equal(debit.relatedId, credit.relatedId, "entries are linked by the transfer id");
  assert.ok(debit.relatedId, "the transfer id is recorded");

  // Insufficient balance → refused, nothing moves.
  const poor = await processTransfer(env, gid, { userId: USER_B }, { userId: USER_A }, 9999, { idempotencyKey: "pay-2" });
  assert.equal(poor.ok, false);
  assert.equal((await wallet(env, gid, USER_B)).balance, 250, "failed transfer moves nothing");

  // Self-transfer, invalid amounts.
  assert.equal((await processTransfer(env, gid, { userId: USER_A }, { userId: USER_A }, 10)).ok, false);
  assert.equal((await processTransfer(env, gid, { userId: USER_A }, { userId: USER_B }, 0)).ok, false);
  assert.equal((await processTransfer(env, gid, { userId: USER_A }, { userId: USER_B }, -50)).ok, false);
  assert.equal((await processTransfer(env, gid, { userId: USER_A }, { userId: USER_B }, 2.5)).ok, false, "no fractional coins");
  assert.equal((await processTransfer(env, gid, { userId: USER_A }, { userId: USER_B }, 1e9 + 1)).ok, false, "bounded amount");

  // Transfers kill switch.
  await save(env, gid, { enabled: true, transfersEnabled: false });
  const off = await processTransfer(env, gid, { userId: USER_A }, { userId: USER_B }, 10);
  assert.equal(off.ok, false);
  assert.match(off.error, /disabled/i);
  await save(env, gid, { enabled: true, transfersEnabled: true });

  // Duplicate request id → the recorded outcome, never a second movement.
  // (A fresh sender: the outgoing-transfer rate gap blocks USER_A by now.)
  await fund(env, gid, USER_C, 500);
  const dup1 = await processTransfer(env, gid, { userId: USER_C }, { userId: USER_A }, 100, { idempotencyKey: "pay-dup" });
  const dup2 = await processTransfer(env, gid, { userId: USER_C }, { userId: USER_A }, 100, { idempotencyKey: "pay-dup" });
  assert.equal(dup1.ok, true, JSON.stringify(dup1));
  assert.equal(dup2.ok, true);
  assert.equal(dup2.duplicate, true, "the replay is recognised");
  assert.equal((await wallet(env, gid, USER_C)).balance, 400, "charged exactly once");
  assert.equal((await wallet(env, gid, USER_A)).balance, 850);
  assert.equal((await wallet(env, gid, USER_B)).balance, 250, "no stray movement");
  const dupRows = (await listTransactions(env, gid, { limit: 100 })).filter((r) => r.source === "discord_transfer");
  assert.equal(dupRows.length, 4, "two transfers = two debit/credit pairs, no extras");
});

test("transfers: concurrent sends can never overdraw the sender", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  await fund(env, gid, USER_A, 1000);

  // Five simultaneous 300-Coin sends: the atomic guard + outgoing rate gap
  // mean at most one can succeed — and in no case may Coins be created.
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map((n) => processTransfer(env, gid, { userId: USER_A }, { userId: USER_B }, 300, { idempotencyKey: `race-${n}` }))
  );
  const ok = results.filter((r) => r.ok);
  assert.ok(ok.length <= 1, `at most one concurrent send may win (got ${ok.length})`);
  const after = (await wallet(env, gid, USER_A)).balance;
  assert.ok(after >= 0, "balance never goes negative");
  assert.ok(after >= 700, "never lost more than the single winning send");
  const sent = 1000 - after;
  assert.equal(sent, 300 * ok.length, "total outflow equals exactly the winning transfers");
  assert.equal((await wallet(env, gid, USER_B)).balance, sent, "recipient received exactly what the sender lost");

  // Direct engine race: ten simultaneous 300-Coin debits from 1000.
  const g2 = nextGuild();
  const env2 = await setup(g2);
  await fund(env2, g2, USER_C, 1000);
  const debits = await Promise.all(
    Array.from({ length: 10 }, () => debitCoins(env2, { guildId: g2, userId: USER_C, amount: 300, source: "discord_shop", reason: "race" }))
  );
  const won = debits.filter((d) => d.ok);
  assert.equal(won.length, 3, "only three 300-Coin debits fit in 1000");
  assert.equal((await wallet(env2, g2, USER_C)).balance, 100, "exact remainder, no overdraft");
  assert.equal((await wallet(env2, g2, USER_C)).balance >= 0, true);
});

/* ------------------------------------------- 9) admin wallet operations */

test("admin adjustments: add, remove and set — audited and guarded", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  const adjust = (userId, body) => read(coinsWalletAdjust(
    req(`/api/coins/wallets/${userId}/adjust`, { method: "POST", guildId: gid, body }),
    env, adminOf(gid), gid, userId
  ));
  const restore = stubDiscord();
  try {

  // Add.
  const add = await adjust(USER_A, { action: "add", amount: 500, reason: "Event reward", confirm: true });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.balance, 500);
  assert.equal(add.body.previousBalance, 0);
  // Remove.
  const rem = await adjust(USER_A, { action: "remove", amount: 200, reason: "Correction", confirm: true });
  assert.equal(rem.status, 200);
  assert.equal(rem.body.balance, 300);
  // Set — up.
  const setUp = await adjust(USER_A, { action: "set", amount: 1000, reason: "Rebase", confirm: true });
  assert.equal(setUp.body.balance, 1000);
  // Set — down.
  const setDown = await adjust(USER_A, { action: "set", amount: 40, reason: "Reset", confirm: true });
  assert.equal(setDown.body.balance, 40);
  // Set — equal: no movement, no ledger noise.
  const before = (await listTransactions(env, gid, { userId: USER_A, limit: 100 })).length;
  const setSame = await adjust(USER_A, { action: "set", amount: 40, reason: "Noop", confirm: true });
  assert.equal(setSame.status, 200);
  assert.equal(setSame.body.changed, false);
  assert.equal((await listTransactions(env, gid, { userId: USER_A, limit: 100 })).length, before, "no-op writes no ledger row");

  // Guard rails.
  const broke = await adjust(USER_A, { action: "remove", amount: 99999, reason: "too much", confirm: true });
  assert.equal(broke.status, 400);
  assert.equal(broke.body.code, "insufficient_balance");
  assert.equal((await wallet(env, gid, USER_A)).balance, 40, "balance untouched by the refused removal");
  const noConfirm = await adjust(USER_A, { action: "add", amount: 10, confirm: false });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.code, "confirm_required", "balance changes require explicit confirmation");
  const zero = await adjust(USER_A, { action: "add", amount: 0, confirm: true });
  assert.equal(zero.status, 400);
  const badAction = await adjust(USER_A, { action: "mint", amount: 10, confirm: true });
  assert.equal(badAction.status, 400);
  assert.match(badAction.body.error, /wallet action/i);

  // Audit trail: actor, reason and both balances are stored per change.
  const txs = await listTransactions(env, gid, { userId: USER_A, source: "admin_adjustment", limit: 50 });
  assert.equal(txs.length, 4, "add + remove + two sets wrote, the no-op did not");
  assert.deepEqual(txs.map((t) => t.amount).sort((x, y) => x - y), [-960, -200, 500, 700], "+500, −200, +700 (set 300→1000), −960 (set 1000→40)");
  assert.ok(txs.every((t) => t.actorId === STAFF), "every adjustment records the admin id");
  assert.ok(txs.every((t) => t.reason.length > 0), "every adjustment records a reason");
  const newest = (await listTransactions(env, gid, { userId: USER_A, limit: 5 }))[0];
  assert.ok(newest.balanceAfter >= 0, "ledger never stores a negative balance");

  // Target member must actually be in THIS guild (never trust the browser).
  const restore = stubDiscord({ match: (u) => (u.includes(`/members/${USER_C}`) && !u.includes("/roles") && !u.includes("@me")) ? j({}, 404) : undefined });
  try {
    const ghost = await adjust(USER_C, { action: "add", amount: 10, confirm: true });
    assert.equal(ghost.status, 404);
    assert.match(ghost.body.error, /not in this server/i);
  } finally { restore(); }

  // A user from ANOTHER guild can never touch this guild's wallets.
  const foreign = await read(coinsWalletAdjust(
    req(`/api/coins/wallets/${USER_A}/adjust`, { method: "POST", guildId: gid, body: { action: "add", amount: 10, confirm: true } }),
    env, outsider, gid, USER_A
  ));
  assert.equal(foreign.status, 403, "outsider denied");
  assert.equal((await wallet(env, gid, USER_A)).balance, 40);

  // Overview/wallet reads are equally closed to outsiders.
  assert.equal((await overview(env, gid, outsider)).status, 403);
  assert.equal((await read(coinsWalletsPage(req("/api/coins/wallets", { guildId: gid }), env, outsider, gid))).status, 403);
  assert.equal((await read(coinsShopList(req("/api/coins/shop", { guildId: gid }), env, outsider, gid))).status, 403);
  assert.equal((await read(coinsLeaderboardPage(req("/api/coins/leaderboard", { guildId: gid }), env, outsider, gid))).status, 403);
  assert.equal((await read(coinsTransactionsPage(req("/api/coins/transactions", { guildId: gid }), env, outsider, gid))).status, 403);
  } finally { restore(); }
});

/* -------------------------------------------------------- 10) shop */

test("shop: creation validation, role delivery, failures refunded, stock and limits", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  const roleGrants = [];
  const restore = stubDiscord({ roleGrants });
  try {
    const createItem = (body) => read(coinsShopCreate(
      req("/api/coins/shop", { method: "POST", guildId: gid, body }), env, adminOf(gid), gid));

    // --- creation-time validation -------------------------------------
    const noName = await createItem({ price: 10, itemType: "manual" });
    assert.equal(noName.status, 400, "name required");
    const badPrice = await createItem({ name: "Hat", price: 0, itemType: "manual" });
    assert.equal(badPrice.status, 400);
    const badType = await createItem({ name: "Hat", price: 10, itemType: "magic" });
    assert.equal(badType.status, 400, "only role / manual item types exist");
    const noRole = await createItem({ name: "Hat", price: 10, itemType: "role" });
    assert.equal(noRole.status, 400, "role items must name a role");
    const managed = await createItem({ name: "Hat", price: 10, itemType: "role", roleId: BOT_ROLE });
    assert.equal(managed.status, 400, "managed roles are refused");

    // A role ABOVE the bot's top role is refused at creation (hierarchy).
    const highRestore = stubDiscord({ match: (u) => u.endsWith("/roles") ? j(ROLES.map((r) => r.id === REWARD_ROLE_2 ? { ...r, position: 30 } : r)) : undefined });
    try {
      const high = await createItem({ name: "Too high", price: 10, itemType: "role", roleId: REWARD_ROLE_2 });
      assert.equal(high.status, 400);
      assert.match(high.body.error, /hierarchy/i);
    } finally { highRestore(); }

    // --- happy path ----------------------------------------------------
    const ok = await createItem({ name: "Golden role", description: "Shiny", price: 250, itemType: "role", roleId: REWARD_ROLE, purchaseLimit: 1, enabled: true });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const item = ok.body.item;
    await fund(env, gid, USER_A, 1000);

    const buy = await buyShopItem(env, gid, USER_A, "Golden role", { idempotencyKey: "buy-ok-1", identity: { username: "usera", displayName: "User A", avatar: "" } });
    assert.equal(buy.ok, true, JSON.stringify(buy));
    assert.equal(buy.purchase.status, "completed");
    assert.equal(buy.balance, 750, "charged exactly the price");
    assert.equal(roleGrants.length, 1, "the role was granted via Discord");
    assert.equal(roleGrants[0].method, "PUT");
    assert.ok(roleGrants[0].url.includes(REWARD_ROLE));

    // Duplicate purchase (same idempotency key) → recorded outcome, no charge.
    const dup = await buyShopItem(env, gid, USER_A, "Golden role", { idempotencyKey: "buy-ok-1" });
    assert.equal(dup.ok, true);
    assert.equal(dup.duplicate, true);
    assert.equal(dup.balance, 750, "never charged twice");
    const rows = (await listTransactions(env, gid, { userId: USER_A, source: "discord_shop", limit: 50 }));
    assert.equal(rows.length, 1, "exactly one purchase debit");

    // Purchase limit (a NEW attempt, not a replay) is enforced.
    const limited = await buyShopItem(env, gid, USER_A, "Golden role", { idempotencyKey: "buy-ok-2" });
    assert.equal(limited.ok, false);
    assert.match(limited.error, /purchase limit/i);
    assert.equal((await wallet(env, gid, USER_A)).balance, 750, "a refused buy charges nothing");

    // --- role hierarchy failure at purchase time: full refund -----------
    const hier = await createItem({ name: "Big role", price: 100, itemType: "role", roleId: REWARD_ROLE_2, stock: 1, enabled: true });
    assert.equal(hier.status, 201, JSON.stringify(hier.body));
    const hierRestore = stubDiscord({ match: (u) => u.endsWith("/roles") ? j(ROLES.map((r) => r.id === REWARD_ROLE_2 ? { ...r, position: 30 } : r)) : undefined });
    let hierBuy;
    try {
      hierBuy = await buyShopItem(env, gid, USER_A, "Big role", { idempotencyKey: "buy-hier" });
    } finally { hierRestore(); }
    assert.equal(hierBuy.ok, false);
    assert.match(hierBuy.error, /hierarchy/i);
    assert.equal((await wallet(env, gid, USER_A)).balance, 750, "Coins were returned in full");
    assert.equal((await getPurchase(env, gid, hierBuy.purchase.id)).status, "failed");
    assert.match((await getPurchase(env, gid, hierBuy.purchase.id)).failureReason, /hierarchy/i);
    assert.equal((await listShopItems(env, gid)).find((i) => i.id === hier.body.item.id).stock, 1, "stock restored after the failure");

    // Endpoint refund of that already-refunded failure: idempotent — no
    // second credit, and NO second stock restore (would inflate stock).
    const hierRefund = await read(coinsPurchaseRefund(
      req(`/api/coins/purchases/${hierBuy.purchase.id}/refund`, { method: "POST", guildId: gid, body: {} }),
      env, adminOf(gid), gid, hierBuy.purchase.id));
    assert.equal(hierRefund.status, 200, JSON.stringify(hierRefund.body));
    assert.equal(hierRefund.body.duplicate, true, "the internal refund already happened");
    assert.equal((await wallet(env, gid, USER_A)).balance, 750, "no second credit");
    assert.equal((await listShopItems(env, gid)).find((i) => i.id === hier.body.item.id).stock, 1, "stock NOT restored twice");

    // --- already owns the role → refunded -------------------------------
    const ownsRestore = stubDiscord({ match: (u) => (u.includes(`/members/${USER_A}`) && !u.includes("@me") && !u.includes("/roles/")) ? j({ user: { id: USER_A, username: "usera" }, nick: null, roles: [REWARD_ROLE_2] }) : undefined });
    let owns;
    try {
      const ownItem = await createItem({ name: "Own role", price: 50, itemType: "role", roleId: REWARD_ROLE_2, enabled: true });
      assert.equal(ownItem.status, 201);
      owns = await buyShopItem(env, gid, USER_A, "Own role", { idempotencyKey: "buy-owns" });
    } finally { ownsRestore(); }
    assert.equal(owns.ok, false);
    assert.match(owns.error, /already have that role/i);
    assert.equal((await wallet(env, gid, USER_A)).balance, 750, "refunded in full");

    // --- stock race: only one buyer gets the last unit ------------------
    const stockItem = await createItem({ name: "Limited pass", price: 50, itemType: "manual", stock: 1, enabled: true });
    assert.equal(stockItem.status, 201);
    const aStock = await buyShopItem(env, gid, USER_A, "Limited pass", { idempotencyKey: "stock-1" });
    assert.equal(aStock.ok, true);
    assert.equal(aStock.purchase.status, "awaiting_fulfillment", "manual rewards wait for staff");
    await fund(env, gid, USER_B, 500);
    const bStock = await buyShopItem(env, gid, USER_B, "Limited pass", { idempotencyKey: "stock-2" });
    assert.equal(bStock.ok, false);
    assert.match(bStock.error, /out of stock/i);
    assert.equal((await wallet(env, gid, USER_B)).balance, 500, "out of stock charges nothing");
    assert.equal((await listShopItems(env, gid)).find((i) => i.id === stockItem.body.item.id).stock, 0);

    // Refunding the never-charged stock failure must NOT mint Coins.
    const stockRefund = await read(coinsPurchaseRefund(
      req(`/api/coins/purchases/${bStock.purchase.id}/refund`, { method: "POST", guildId: gid, body: {} }),
      env, adminOf(gid), gid, bStock.purchase.id));
    assert.equal(stockRefund.status, 200, JSON.stringify(stockRefund.body));
    assert.equal(stockRefund.body.refunded, false, "nothing was ever charged");
    assert.equal((await wallet(env, gid, USER_B)).balance, 500, "no Coins were minted");
    assert.equal((await listShopItems(env, gid)).find((i) => i.id === stockItem.body.item.id).stock, 0, "stock not inflated");
    assert.equal((await listTransactions(env, gid, { userId: USER_B, source: "shop_refund", limit: 10 })).length, 0, "no refund ledger row");

    // --- insufficient balance: refused, stock restored ------------------
    const pricey = await createItem({ name: "Pricey role", price: 900, itemType: "role", roleId: REWARD_ROLE_2, stock: 1, enabled: true });
    assert.equal(pricey.status, 201);
    const poorBuy = await buyShopItem(env, gid, USER_B, "Pricey role", { idempotencyKey: "poor-1" });
    assert.equal(poorBuy.ok, false);
    assert.match(poorBuy.error, /enough Baltic Coins/i);
    assert.equal((await wallet(env, gid, USER_B)).balance, 500, "unchanged");
    assert.equal((await listShopItems(env, gid)).find((i) => i.id === pricey.body.item.id).stock, 1, "stock restored");
    assert.equal((await getPurchase(env, gid, poorBuy.purchase.id)).status, "failed");

    // --- update + delete + listing -------------------------------------
    const upd = await read(coinsShopUpdate(
      req(`/api/coins/shop/${item.id}`, { method: "PUT", guildId: gid, body: { name: "Golden role", description: "Shinier", price: 300, itemType: "role", roleId: REWARD_ROLE, purchaseLimit: 2, enabled: true } }),
      env, adminOf(gid), gid, item.id));
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    assert.equal(upd.body.item.price, 300);
    const listed = await read(coinsShopList(req("/api/coins/shop", { guildId: gid }), env, adminOf(gid), gid));
    assert.equal(listed.status, 200);
    assert.ok(listed.body.items.every((i) => i.guildId === gid), "shop listing is guild-scoped");
    const del = await read(coinsShopDelete(
      req(`/api/coins/shop/${item.id}`, { method: "DELETE", guildId: gid }), env, adminOf(gid), gid, item.id));
    assert.equal(del.status, 200);
    assert.equal((await listShopItems(env, gid)).some((i) => i.id === item.id), false);
    const delAgain = await read(coinsShopDelete(
      req(`/api/coins/shop/${item.id}`, { method: "DELETE", guildId: gid }), env, adminOf(gid), gid, item.id));
    assert.equal(delAgain.status, 404, "double delete is a clean 404");
  } finally { restore(); }
});

/* ------------------------------------------ 11) manual fulfilment */

test("manual reward: purchase → staff fulfilment with a full audit trail", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  const restore = stubDiscord();
  try {
    const createItem = (body) => read(coinsShopCreate(
      req("/api/coins/shop", { method: "POST", guildId: gid, body }), env, adminOf(gid), gid));
    const ok = await createItem({ name: "Custom nickname", description: "Staff grants it manually", price: 150, itemType: "manual", stock: 5, enabled: true });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    await fund(env, gid, USER_A, 400);

    // Purchase: coins deducted atomically, durable awaiting state, stock taken.
    const buy = await buyShopItem(env, gid, USER_A, "Custom nickname", { idempotencyKey: "manual-1" });
    assert.equal(buy.ok, true, JSON.stringify(buy));
    assert.equal(buy.pending, true, "manual rewards are never auto-delivered");
    assert.equal(buy.purchase.status, "awaiting_fulfillment");
    assert.equal(buy.balance, 250, "charged exactly once");
    assert.equal((await listShopItems(env, gid)).find((i) => i.id === ok.body.item.id).stock, 4);

    // It shows up in the staff queue, guild-scoped.
    const page = await read(coinsPurchasesPage(req("/api/coins/purchases", { guildId: gid, status: "awaiting_fulfillment" }), env, adminOf(gid), gid));
    assert.equal(page.status, 200);
    assert.equal(page.body.purchases.length, 1);
    assert.equal(page.body.purchases[0].itemName, "Custom nickname");
    assert.equal(page.body.purchases[0].price, 150);

    // Staff marks it fulfilled → completed + who + when (audit history).
    const ful = await read(coinsPurchaseFulfill(
      req(`/api/coins/purchases/${buy.purchase.id}/fulfill`, { method: "POST", guildId: gid, body: {} }),
      env, adminOf(gid), gid, buy.purchase.id));
    assert.equal(ful.status, 200, JSON.stringify(ful.body));
    assert.equal(ful.body.purchase.status, "completed");
    assert.equal(ful.body.purchase.fulfilledBy, STAFF, "the fulfilling admin id is recorded");
    assert.ok(ful.body.purchase.fulfilledAt, "fulfilment time is recorded");

    // Fulfil twice → clean refusal (state machine, not a silent no-op).
    const twice = await read(coinsPurchaseFulfill(
      req(`/api/coins/purchases/${buy.purchase.id}/fulfill`, { method: "POST", guildId: gid, body: {} }),
      env, adminOf(gid), gid, buy.purchase.id));
    assert.equal(twice.status, 400);
    assert.match(twice.body.error, /awaiting fulfilment/i);

    // Refund an awaiting purchase: coins come back, stock is restored.
    const buy2 = await buyShopItem(env, gid, USER_A, "Custom nickname", { idempotencyKey: "manual-2" });
    assert.equal(buy2.ok, true);
    assert.equal((await wallet(env, gid, USER_A)).balance, 100);
    const ref = await read(coinsPurchaseRefund(
      req(`/api/coins/purchases/${buy2.purchase.id}/refund`, { method: "POST", guildId: gid, body: {} }),
      env, adminOf(gid), gid, buy2.purchase.id));
    assert.equal(ref.status, 200, JSON.stringify(ref.body));
    assert.equal(ref.body.refunded, true);
    assert.equal((await wallet(env, gid, USER_A)).balance, 250, "the price came back");
    assert.equal((await getPurchase(env, gid, buy2.purchase.id)).status, "refunded");
    assert.equal((await listShopItems(env, gid)).find((i) => i.id === ok.body.item.id).stock, 4, "restored to the post-first-purchase value");
    const refundRows = (await listTransactions(env, gid, { userId: USER_A, source: "shop_refund", limit: 10 }));
    assert.equal(refundRows.length, 1, "exactly one refund credit");
    assert.equal(refundRows[0].amount, 150);
  } finally { restore(); }
});

/* ------------------------------------- 12) the Premium redemption ban */

test("Baltic Coins can never purchase BalticM Premium — backend and fulfilment", async () => {
  // Shared recogniser catches every Premium/subscription wording.
  for (const bad of ["Premium 30 days", "premium", "VIP month", "Tebex package", "Subscription code", "Activation code", "promo code", "premium trial"]) {
    assert.equal(premiumRedemptionBlocked(bad), true, `must block: ${bad}`);
  }
  for (const fine of ["Golden role", "Custom nickname", "Event sword", "VIP section"]) {
    assert.equal(premiumRedemptionBlocked(fine), false, `allowed: ${fine}`);
  }

  // Item creation refuses Premium rewards before anything is stored.
  const blockedName = parseShopItem({ name: "Premium week", price: 100, itemType: "manual" });
  assert.equal(blockedName.ok, false);
  assert.equal(blockedName.code, "premium_redemption_forbidden");
  const blockedDesc = parseShopItem({ name: "Reward", description: "Grants a Premium subscription", price: 100, itemType: "manual" });
  assert.equal(blockedDesc.ok, false);
  assert.match(blockedDesc.error, /never purchase BalticM Premium/i);

  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  const restore = stubDiscord();
  try {
    const created = await read(coinsShopCreate(
      req("/api/coins/shop", { method: "POST", guildId: gid, body: { name: "Premium month", price: 500, itemType: "manual" } }),
      env, adminOf(gid), gid));
    assert.equal(created.status, 400);
    assert.equal(created.body.code, "premium_redemption_forbidden");
    assert.equal((await listShopItems(env, gid)).length, 0, "nothing was stored");

    // Defence in depth: even a poisoned row that somehow reached the DB
    // (legacy data, direct write) CANNOT be fulfilled — the fulfilment
    // layer re-checks the firewall.
    const now = new Date().toISOString();
    await env.BALTICM_DB.prepare(
      "INSERT INTO coins_purchases (id, guild_id, user_id, item_id, item_name, price, status, idempotency_key, failure_reason, fulfilled_by, fulfilled_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?, '', '', NULL, ?,?)"
    ).bind("poisoned-premium", gid, USER_A, "none", "Premium week", 100, "awaiting_fulfillment", "", now, now).run();
    const ful = await read(coinsPurchaseFulfill(
      req(`/api/coins/purchases/poisoned-premium/fulfill`, { method: "POST", guildId: gid, body: {} }),
      env, adminOf(gid), gid, "poisoned-premium"));
    assert.equal(ful.status, 400);
    assert.equal(ful.body.code, "premium_redemption_forbidden", "fulfilment refuses even a stored Premium reward");
    assert.equal((await getPurchase(env, gid, "poisoned-premium")).status, "awaiting_fulfillment", "not fulfilled");

    // Structural: there is no item type or transaction source that grants
    // Premium, and no shop path bypasses the check.
    assert.deepEqual([...SHOP_ITEM_TYPES], ["role", "manual"]);
    assert.ok(TX_SOURCES.every((s) => !/premium/i.test(s)), "no Premium-adjacent ledger source");
    // The guard is invoked on item creation (via parseShopItem) and on
    // fulfilment — both paths are asserted against the real handlers above.
    assert.ok(coinsApiSrc.includes("premiumRedemptionBlocked(purchase.itemName)"), "fulfilment re-checks");
  } finally { restore(); }
});

/* --------------------------------------- 13) ledger + history integrity */

test("ledger: wallet and history stay provably consistent through every operation", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, { startingBalance: 100 });
  const restore = stubDiscord();
  try {
    // Exercise every ledger source the V1 economy can produce.
    await ensureWallet(env, gid, USER_A, (await getCoinsConfig(env, gid)).settings);   // starting_balance
    await claimDailyReward(env, gid, USER_A);                                          // discord_daily
    await fund(env, gid, USER_A, 400);                                                 // admin_adjustment
    await fund(env, gid, USER_B, 500);
    await processTransfer(env, gid, { userId: USER_B }, { userId: USER_A }, 150, { idempotencyKey: "hist-1" }); // transfer
    const item = await read(coinsShopCreate(
      req("/api/coins/shop", { method: "POST", guildId: gid, body: { name: "Manual thing", price: 60, itemType: "manual", enabled: true } }),
      env, adminOf(gid), gid));
    assert.equal(item.status, 201);
    const buy = await buyShopItem(env, gid, USER_A, "Manual thing", { idempotencyKey: "hist-buy" }); // discord_shop
    assert.equal(buy.ok, true);

    // Core invariant: wallet balance === Σ ledger amounts, and the newest
    // entry's balance_after matches the wallet exactly.
    for (const uid of [USER_A, USER_B]) {
      const w = await getWallet(env, gid, uid);
      const txs = await listTransactions(env, gid, { userId: uid, limit: 100 });
      const sum = txs.reduce((acc, t) => acc + t.amount, 0);
      assert.equal(sum, w.balance, `Σ ledger === wallet balance for ${uid}`);
      assert.equal(w.totalEarned, txs.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0), "total earned === Σ credits");
      assert.equal(w.totalSpent, txs.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0), "total spent === Σ debits");
      assert.ok(txs.every((t) => t.balanceAfter >= 0), "no negative balance_after ever recorded");
      const newest = txs.find((t) => t.balanceAfter === w.balance);
      assert.ok(newest, "some entry lands on the current balance");
      assert.ok(txs.every((t) => TX_SOURCES.includes(t.source)), "every row uses a known source");
    }

    // Counts and pagination.
    const count = await countTransactions(env, gid, { userId: USER_A });
    const all = await listTransactions(env, gid, { userId: USER_A, limit: 100 });
    assert.equal(count, all.length);
    const page1 = await listTransactions(env, gid, { userId: USER_A, limit: 2, offset: 0 });
    const page2 = await listTransactions(env, gid, { userId: USER_A, limit: 2, offset: 2 });
    assert.equal(page1.length, 2);
    assert.equal(page2.length, 2);
    assert.notEqual(page1[0].id, page2[0].id, "pages do not overlap");
    // Source filter through the real handler.
    const dailyOnly = await read(coinsTransactionsPage(
      req("/api/coins/transactions", { guildId: gid, source: "discord_daily" }), env, adminOf(gid), gid));
    assert.equal(dailyOnly.status, 200);
    assert.ok(dailyOnly.body.entries.every((t) => t.source === "discord_daily"));
    assert.equal(dailyOnly.body.total, 1);
  } finally { restore(); }
});

test("overview: real statistics, richest list and per-day series", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, { startingBalance: 0 });
  const o = await overview(env, gid);
  assert.equal(o.status, 200);
  assert.equal(o.body.currency.name, "Baltic Coins");
  assert.equal(o.body.currency.icon, "🪙");
  assert.equal(o.body.stats.circulation, 0, "empty guild reports zeros, not NaN");
  assert.equal(o.body.stats.wallets, 0);
  assert.equal(o.body.stats.totalTransactions, 0);
  assert.equal(o.body.series.length, 14, "default 14-day window");
  assert.ok(o.body.series.every((d) => d.earned === 0 && d.spent === 0));

  // Real activity flows straight into the stats.
  await fund(env, gid, USER_A, 300);
  await fund(env, gid, USER_B, 700);
  await processTransfer(env, gid, { userId: USER_B }, { userId: USER_A }, 100, { idempotencyKey: "ov-1" });
  const after = await overview(env, gid);
  assert.equal(after.body.stats.circulation, 1000, "circulation = Σ balances");
  assert.equal(after.body.stats.wallets, 2);
  assert.equal(after.body.stats.holders, 2, "both hold Coins");
  assert.ok(after.body.stats.totalTransactions >= 3);
  assert.ok(after.body.stats.earnedToday >= 1000);
  assert.ok(after.body.stats.spentToday >= 100, "today's spending = the 100-Coin transfer out");
  assert.ok(after.body.stats.activeToday >= 2, "active members are counted from real rows");
  assert.equal(after.body.richest[0].userId, USER_B, "richest sorted by balance");
  assert.equal(after.body.richest[0].balance, 600);
  assert.equal(after.body.recent.length >= 1, true);
  const today = after.body.series[after.body.series.length - 1];
  assert.ok(today.earned >= 1000, "today's series carries the real credits");

  // days is clamped to 7..30.
  const long = await read(coinsOverview(req("/api/coins", { guildId: gid, }), env, adminOf(gid), gid));
  assert.equal(long.status, 200);
  assert.ok(long.body.series.length >= 7 && long.body.series.length <= 30);
  // Outsiders see nothing.
  assert.equal((await overview(env, gid, outsider)).status, 403);
});

/* ----------------------------------------- 14) leaderboard accuracy */

test("leaderboard: correct order, search, pagination and guild scoping", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  await fund(env, gid, USER_A, 300);
  await fund(env, gid, USER_B, 1000);
  await fund(env, gid, USER_C, 500);
  await setWalletIdentity(env, gid, USER_B, { username: "member002", displayName: "Member 002", avatar: "" });
  const rows = await coinsLeaderboard(env, gid, { limit: 10 });
  assert.deepEqual(rows.map((r) => r.userId), [USER_B, USER_C, USER_A], "sorted by balance, descending");
  assert.deepEqual(rows.map((r) => r.balance), [1000, 500, 300]);
  const top1 = await coinsLeaderboard(env, gid, { limit: 1 });
  assert.equal(top1.length, 1);
  assert.equal(top1[0].userId, USER_B);
  const search = await coinsLeaderboard(env, gid, { q: "member002", limit: 10 });
  assert.equal(search.length, 1, "username search narrows the board");
  assert.equal(search[0].userId, USER_B);
  // Through the handler: positions are stable and offset-aware.
  const page = await read(coinsLeaderboardPage(req("/api/coins/leaderboard", { limit: 50 }), env, adminOf(gid), gid));
  assert.equal(page.status, 200);
  assert.equal(page.body.entries[0].position, 1);
  assert.equal(page.body.entries[1].position, 2);
  assert.equal(page.body.limit, 50);
  assert.ok(page.body.entries.every((e) => e.balance >= 0));
  // Another guild's wallets never appear.
  const other = nextGuild();
  const env2 = await setup(other);
  await fund(env2, other, USER_C, 99999);
  const board2 = await read(coinsLeaderboardPage(req("/api/coins/leaderboard", { limit: 100 }), env2, adminOf(other), other));
  assert.deepEqual(board2.body.entries.map((e) => e.userId), [USER_C], "only this guild's members");
  const back = await read(coinsLeaderboardPage(req("/api/coins/leaderboard", { limit: 100 }), env, adminOf(gid), gid));
  assert.equal(back.body.entries.some((e) => e.balance === 99999), false, "no leakage from the other guild");
});

/* --------------------------------- 15) game economy service (future) */

test("game economy: shared wallet, per-guild authorization, caps, no public route", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  const GAME = "balticm-rpg";
  const integ = (over = {}) => ({
    guildId: gid, gameKey: GAME, enabled: 1, allowCredit: 1, allowDebit: 1, dailyLimit: 0, ...over
  });
  const insertInteg = async (g, row) => env.BALTICM_DB.prepare(
    "INSERT INTO coins_game_integrations (guild_id, game_key, enabled, allow_credit, allow_debit, daily_limit, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
  ).bind(g, row.gameKey, row.enabled, row.allowCredit, row.allowDebit, row.dailyLimit, new Date().toISOString(), new Date().toISOString()).run();

  // Not connected → every operation is refused, nothing reads the wallet.
  const noRow = await gameEconomy.getBalance(env, { guildId: gid, gameKey: GAME, userId: USER_A });
  assert.equal(noRow.ok, false);
  assert.equal(noRow.code, "game_unauthorized");
  assert.equal((await gameEconomy.credit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 10, eventKey: "e1" })).ok, false);
  assert.equal((await gameEconomy.debit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 10, eventKey: "e2" })).ok, false);
  assert.equal((await gameEconomy.refund(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 10, eventKey: "e3" })).ok, false);
  // A row that exists but is disabled, or missing its flags → still refused.
  await insertInteg(gid, integ({ enabled: 0 }));
  assert.equal((await gameEconomy.credit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 10, eventKey: "e1" })).ok, false, "disabled integration");
  await env.BALTICM_DB.prepare("UPDATE coins_game_integrations SET enabled=1, allow_credit=0, allow_debit=0 WHERE guild_id=? AND game_key=?").bind(gid, GAME).run();
  assert.equal((await gameEconomy.credit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 10, eventKey: "e1" })).ok, false, "no credit permission");
  assert.equal((await gameEconomy.debit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 10, eventKey: "e2" })).ok, false, "no debit permission");

  // Authorized: credit into the SHARED guild wallet (game_reward source).
  await env.BALTICM_DB.prepare("UPDATE coins_game_integrations SET enabled=1, allow_credit=1, allow_debit=1, daily_limit=0 WHERE guild_id=? AND game_key=?").bind(gid, GAME).run();
  await fund(env, gid, USER_A, 500);
  const win = await gameEconomy.credit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 25, eventKey: "quest-1", reason: "Quest reward" });
  assert.equal(win.ok, true, JSON.stringify(win));
  assert.equal((await wallet(env, gid, USER_A)).balance, 525, "the game spent the SAME wallet");
  const winRows = (await listTransactions(env, gid, { userId: USER_A, source: "game_reward", limit: 10 }));
  assert.equal(winRows.length, 1);
  assert.ok(winRows[0].relatedId.startsWith(`${GAME}:`), "the game and event are recorded");
  // Duplicate event key → replay, never a second mint.
  const dup = await gameEconomy.credit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 25, eventKey: "quest-1" });
  assert.equal(dup.duplicate, true);
  assert.equal((await wallet(env, gid, USER_A)).balance, 525, "event replay pays nothing");

  // Debit: overdraw-proof through the same guarded engine.
  const spend = await gameEconomy.debit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 25, eventKey: "sword-1", reason: "Buy sword" });
  assert.equal(spend.ok, true);
  assert.equal((await wallet(env, gid, USER_A)).balance, 500);
  const tooMuch = await gameEconomy.debit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 99999, eventKey: "castle" });
  assert.equal(tooMuch.ok, false);
  assert.equal((await wallet(env, gid, USER_A)).balance, 500, "balance never negative");
  // Refund of the sword purchase — idempotent per event.
  const r1 = await gameEconomy.refund(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 25, eventKey: "sword-1" });
  const r2 = await gameEconomy.refund(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 25, eventKey: "sword-1" });
  assert.equal(r1.ok, true);
  assert.equal(r2.duplicate, true, "one refund per game event");
  assert.equal((await wallet(env, gid, USER_A)).balance, 525, "refunded exactly once");

  // Daily reward cap: a game can never mint beyond its authorization.
  await env.BALTICM_DB.prepare("UPDATE coins_game_integrations SET daily_limit=40 WHERE guild_id=? AND game_key=?").bind(gid, GAME).run();
  const capHit = await gameEconomy.credit(env, { guildId: gid, gameKey: GAME, userId: USER_A, amount: 30, eventKey: "daily-1" });
  assert.equal(capHit.ok, false);
  assert.match(capHit.error, /daily reward limit/i);
  assert.equal((await wallet(env, gid, USER_A)).balance, 525, "the capped credit paid nothing");

  // History can be scoped to one game.
  const hist = await gameEconomy.history(env, { guildId: gid, userId: USER_A, gameKey: GAME, limit: 50 });
  assert.equal(hist.ok, true);
  assert.ok(hist.transactions.length >= 3, "game events are individually listed");

  // Authorization is per guild: another server never inherits the row.
  const g2 = nextGuild();
  const env2 = await setup(g2);
  const crossGame = await gameEconomy.credit(env2, { guildId: g2, gameKey: GAME, userId: USER_A, amount: 10, eventKey: "x" });
  assert.equal(crossGame.ok, false, "no cross-guild game authorization");

  // V1 ships NO public credit/debit endpoint — the service is worker-internal.
  assert.ok(!/gameEconomy/.test(workerSrc), "the HTTP layer cannot reach the game service");
  assert.ok(!/api\/coins\/game/.test(workerSrc), "no public game API route exists");
  assert.equal((await read(coinsShopCreate(
    req("/api/coins/shop", { method: "POST", guildId: gid, body: { name: "Game coins pack", price: 10, itemType: "manual" } }),
    env, adminOf(gid), gid))).status, 201, "a normal manual item still works");
});

/* ------------------------- 16) UI contracts: alignment + responsiveness */

test("UI: leaderboard alignment contract and mobile layout (no repeat of the Leveling bug)", () => {
  // The board is ONE grid per row: rank centered, member left, numbers
  // right — the header cells use the exact same rules as their columns.
  assert.match(coinsCss, /\.cnBoardRow>span:nth-child\(1\)\{text-align:center\}/, "rank column centered");
  assert.match(coinsCss, /\.cnBoardRow>span:nth-child\(2\)\{text-align:left/, "member column left");
  assert.match(coinsCss, /\.cnBoardRow>span:nth-child\(n\+3\)\{text-align:right/, "number columns right");
  assert.match(coinsCss, /\.cnBoardHead\{background/, "header participates in the same row grid");
  // Tables: numeric headers right-align exactly like their cells.
  assert.match(coinsCss, /\.cnTable th\.num\{text-align:right\}/);
  assert.match(coinsCss, /\.cnTable td\.num\{text-align:right/);
  assert.match(coinsCss, /font-variant-numeric:tabular-nums/, "aligned digit widths");
  // JSX: header labels and value labels come from the same markup shape.
  assert.ok(coinsJsx.includes('role="table" aria-label="Baltic Coins leaderboard"'));
  assert.match(coinsJsx, /cnBoardRow cnBoardHead/);
  for (const label of ["BALANCE", "TOTAL EARNED", "TOTAL SPENT"]) {
    assert.ok(coinsJsx.includes(`<span>${label}</span>`), `header cell: ${label}`);
  }
  // Values carry data-label for the mobile card layout — the header is
  // hidden at ≤768px so nothing can overlap.
  assert.match(coinsCss, /\.cnTable thead\{display:none\}/);
  assert.match(coinsCss, /\.cnBoardHead\{display:none\}/);
  assert.match(coinsCss, /content:attr\(data-label\)/);
  assert.match(coinsJsx, /data-label="Balance"/);
  assert.match(coinsJsx, /data-label="Member"/);

  // Responsive breakpoints per spec: 1920/1280 default, 768, 430, 345.
  for (const bp of ["1024px", "768px", "430px", "345px"]) {
    assert.ok(coinsCss.includes(`@media (max-width:${bp})`), `breakpoint ${bp} covered`);
  }
  // Overflow guards: bounded panels, overflow-hidden wrappers, min-width:0
  // on flexible containers, and no fixed-width page that could scroll.
  assert.match(coinsCss, /\.cnTableWrap\{[^}]*overflow:hidden/);
  assert.match(coinsCss, /\.cnPage\{[^}]*max-width:1240px/);
  assert.match(coinsCss, /min-width:0/);
  assert.ok(!/min-width:\s*[4-9]\d\dpx/.test(coinsCss), "no container demands more than 768px");
  // No auto-scrolling, no text overlap risks (nowrap only on tiny chips).
  assert.ok(!/scrollIntoView|scrollTop|window\.scrollTo/.test(coinsJsx), "no programmatic scrolling");
  // Design language: dark/orange BalticM palette, no hardcoded guild names.
  assert.match(coinsCss, /#e8892c/);
  assert.match(coinsCss, /#15171c/);
  assert.ok(!coinsJsx.includes("Baltic | Mayhem") && !coinsCss.includes("Baltic | Mayhem"), "no hardcoded guild");
  // States: loading, empty and per-section inline success/error notices.
  assert.ok(coinsJsx.includes("Loading economy…"), "loading state");
  assert.ok(coinsJsx.includes("cnEmpty"), "empty state");
  assert.match(coinsJsx, /cnNotice ok|"cnNotice "/, "inline notices");
  assert.equal((coinsJsx.match(/role="alert"/g) || []).length >= 1, true, "errors are announced");
  // Confirmation dialogs for balance-changing operations (server also gates).
  assert.match(coinsJsx, /window\.confirm\(/);
  assert.equal((coinsJsx.match(/window\.confirm\(/g) || []).length >= 2, true, "wallet + delete confirmations");
  // Searchable dropdowns come from the shared widget, guild directory driven.
  assert.match(coinsJsx, /state\.channels\|\|\[\]/);
  assert.match(coinsJsx, /state\.roles\|\|\[\]/);
  // Server selection + refresh: every load path keys off selectedGuild.
  assert.match(coinsJsx, /if\(!selectedGuild\)return/);
  assert.match(coinsJsx, /\[selectedGuild\]/);
});

/* --------------------- 16b) UI contracts: search + dropdown polish */

test("UI: unified search field with a single border and whole-field orange focus", () => {
  // ONE container border — the inner input never draws its own border/ring
  // (the host's generic input:focus box-shadow used to nest a second ring
  // inside the container border).
  assert.match(coinsCss, /\.cnPage \.cnSearch\{[^}]*border:1px solid #343842/, "the container owns the single border");
  assert.match(coinsCss, /\.cnPage \.cnSearch\{[^}]*border-radius:8px/, "consistent radius with the other controls");
  assert.match(coinsCss, /\.cnPage \.cnSearch\{[^}]*min-height:40px/, "40px height matches the field inputs and triggers");
  assert.match(coinsCss, /\.cnPage \.cnSearch input\{[^}]*border:0/, "the input itself has no border");
  assert.match(coinsCss, /\.cnPage \.cnSearch input\{[^}]*box-shadow:none/, "no inherited ring on the input");
  assert.match(coinsCss, /\.cnPage \.cnSearch input:focus,\.cnPage \.cnSearch input:focus-visible\{[^}]*box-shadow:none/, "the host focus glow cannot re-nest");
  // Focus is expressed on the WHOLE field: subtle orange border + soft ring.
  assert.match(coinsCss, /\.cnPage \.cnSearch:focus-within\{border-color:#e8892c/, "orange focus border around the entire field");
  assert.match(coinsCss, /\.cnPage \.cnSearch:focus-within\{[^}]*box-shadow:0 0 0 3px rgba\(232,137,44,\.14\)/, "subtle ring, not a hard glow");
  // The clear button is a plain icon control — no nested button chrome.
  assert.match(coinsCss, /\.cnPage \.cnSearch button\{[^}]*border:0/, "clear button carries no border");
  assert.match(coinsCss, /\.cnPage \.cnSearch button\{[^}]*background:none/, "clear button carries no background");
  // Scoped under .cnPage so it beats style.css' later `.contentWell button`
  // and `input:focus` rules by specificity, not by source order.
  assert.match(coinsCss, /\.cnPage \.cnSearch\{/, "scoped above the host chrome");
  // Both Baltic Coins search fields use the unified control.
  assert.equal((coinsJsx.match(/className="cnSearch"/g) || []).length, 2, "Members & Wallets + Leaderboard");
  // Search icon + input + clear live in the same single-border container.
  assert.match(coinsJsx, /<form className="cnSearch"[\s\S]{0,120}?<Search\/>/, "the icon renders inside the field");
  // Search/filter behaviour is untouched.
  assert.match(coinsJsx, /onSubmit=\{e=>\{e.preventDefault\(\);loadWallets\(walletQ\)\}\}/);
  assert.match(coinsJsx, /onSubmit=\{e=>\{e.preventDefault\(\);loadBoard\(boardLimit,boardQ\)\}\}/);
});

test("UI: every Baltic Coins dropdown re-scopes the Tickets/Leveling widget", () => {
  // Same declarations as `.ticketsPage .modAction*` / `.lvPage .modAction*`,
  // re-scoped — a shared widget, not a lookalike.
  assert.match(coinsCss, /\.cnPage \.modActionSelect\{position:relative/, "select is the positioning context");
  assert.match(coinsCss, /\.cnPage \.modActionSelect\.open\{z-index:6\}/, "open dropdown stacks above siblings");
  assert.match(coinsCss, /\.cnPage \.modActionTrigger\{[^}]*min-height:40px/, "trigger matches the Tickets trigger sizing");
  assert.match(coinsCss, /\.cnPage \.modActionTrigger\{[^}]*border-radius:8px/, "matches the Baltic Coins control radius");
  assert.match(coinsCss, /\.cnPage \.modActionTrigger\{[^}]*background:#15171c/, "dark theme background, not the host chrome");
  assert.match(coinsCss, /\.cnPage \.modActionTrigger:disabled\{[^}]*opacity/, "disabled state present");
  assert.match(coinsCss, /\.cnPage \.modActionTrigger span\{[^}]*text-overflow:ellipsis/, "long current values truncate on the trigger");
  // Open/focus: subtle orange border + soft ring, exactly like the search.
  assert.match(coinsCss, /\.cnPage \.modActionSelect\.open \.modActionTrigger,\.cnPage \.modActionTrigger:focus-visible\{[^}]*border-color:#e8892c/, "open/focus turns the trigger orange");
  // Menu: floating overlay that cannot be clipped by cards, solid Tickets
  // background, amber border, capped and internally scrollable.
  assert.match(coinsCss, /\.cnPage \.modActionMenu\{position:absolute/, "menu floats over the page, card height unchanged");
  assert.match(coinsCss, /\.cnPage \.modActionMenu\{[^}]*max-height:min\(320px,calc\(100dvh - 16px\)\)/, "cap that also fits the viewport");
  assert.match(coinsCss, /\.cnPage \.modActionMenu\{[^}]*overflow:auto/, "internal vertical scrolling");
  assert.match(coinsCss, /\.cnPage \.modActionMenu\{[^}]*background:#0e0c0a/, "solid Tickets background, no transparency");
  assert.match(coinsCss, /\.cnPage \.modActionMenu\{[^}]*border:1px solid rgba\(232,176,120,\.35\)/, "Tickets amber border");
  assert.match(coinsCss, /\.cnPage \.modActionMenu\{[^}]*z-index:8/, "menu paints above panel content");
  // Near-viewport-edge flip (all four selects pass `flip`).
  assert.match(coinsCss, /\.cnPage \.modActionSelect\.dropUp \.modActionMenu/, "menu flips above the trigger near the bottom edge");
  // Item states: hover/keyboard-active, selected, disabled.
  assert.match(coinsCss, /\.cnPage \.modActionMenu li\{[^}]*text-overflow:ellipsis/, "long option names truncate instead of overflowing");
  assert.match(coinsCss, /\.cnPage \.modActionMenu li:hover\{background:rgba\(232,137,44,\.12\)/, "hover state");
  assert.match(coinsCss, /\.cnPage \.modActionMenu li\.active\{background:rgba\(232,137,44,\.1\)/, "keyboard-active state matches Tickets");
  assert.match(coinsCss, /\.cnPage \.modActionMenu li\.selected\{background:rgba\(232,137,44,\.18\)/, "selected state matches Tickets");
  assert.match(coinsCss, /\.cnPage \.modActionMenu li\[aria-disabled="true"\]\{[^}]*opacity/, "disabled option state");
  // Sticky in-menu search with its own focus treatment.
  assert.match(coinsCss, /\.cnPage \.modActionSearch\{position:sticky/, "search field pinned to the top of the menu");
  assert.match(coinsCss, /\.cnPage \.modActionSearch input\{[^}]*border-radius:8px/, "in-menu search matches the field chrome");
  // Nothing in the dropdown's ancestry scrolls/clips it.
  for (const box of [/\.cnPanel\{[^}]*overflow/, /\.cnIgnored\{[^}]*overflow/, /\.cnGroup\{[^}]*overflow/, /\.cnShopForm\{[^}]*overflow/]) {
    assert.ok(!box.test(coinsCss), `dropdown containers must not clip: ${box}`);
  }
  // Mobile: 44px touch target on the trigger, like Tickets and Leveling.
  assert.match(coinsCss, /@media \(max-width:768px\)\{[\s\S]{0,400}?\.cnPage \.modActionTrigger\{min-height:44px/, "mobile keeps the 44px trigger");
  // SCOPE: all four selectors (excluded channels, excluded roles, shop role,
  // transaction source) use the shared widget with search + edge flip.
  const selects = coinsJsx.match(/<Select id="[^"]+"[\s\S]*?\/>/g) || [];
  assert.equal(selects.length, 4, `expected the four Baltic Coins dropdowns, found ${selects.length}: ${selects}`);
  for (const s of selects) {
    assert.ok(s.includes("search flip"), `dropdown must be searchable + edge-flipping: ${s}`);
  }
  assert.match(coinsJsx, /Select id="cn-exch"/, "excluded channels dropdown");
  assert.match(coinsJsx, /Select id="cn-exrl"/, "excluded roles dropdown");
  assert.match(coinsJsx, /Select id="cn-shoprole"/, "shop role dropdown");
  assert.match(coinsJsx, /Select id="cn-txsrc"/, "transaction source filter");
  // Keyboard navigation + Escape live in the shared widget (main.jsx).
  assert.match(mainSrc, /function TicketOptionSelect\(/, "the shared widget owns keyboard behaviour");
  assert.match(mainSrc, /key==="Escape"/, "Escape closes the dropdown");
  assert.match(mainSrc, /key==="ArrowDown"\|\|e\.key==="ArrowUp"/, "arrow keys navigate the options");
});

/* --------------------------------------------- 17) Discord slash commands */

test("slash commands: definitions, registry safety and guild context", async () => {
  // The four top-level names the coins module registers…
  const names = COINS_COMMAND_DEFINITIONS.map((d) => d.name);
  assert.deepEqual(names, ["balance", "daily", "pay", "coins"]);
  // …never collide with the commands that already exist (help/rank/…).
  const existing = new Set(["help", RANK_COMMAND_DEFINITION.name, LEADERBOARD_COMMAND_DEFINITION.name]);
  for (const n of names) assert.equal(existing.has(n), false, `must not overwrite /${n}`);
  // Subcommand shape matches the spec.
  const coins = COINS_COMMAND_DEFINITIONS.find((d) => d.name === "coins");
  assert.deepEqual(coins.options.map((o) => o.name), ["leaderboard", "shop", "buy", "history", "admin"]);
  const lb = coins.options.find((o) => o.name === "leaderboard");
  assert.deepEqual(lb.options[0].choices.map((c) => c.value), [10, 50, 100]);
  const pay = COINS_COMMAND_DEFINITIONS.find((d) => d.name === "pay");
  assert.equal(pay.options[0].type, 6, "member is a user picker");
  assert.equal(pay.options[1].type, 10, "amount is a number");
  // The worker registers them on the shared scheduler and routes them.
  assert.ok(workerSrc.includes("ensureCoinsCommandsRegistered"), "commands sync from the existing scheduler");
  assert.match(workerSrc, /if\(cn==="balance"\)return coinsBalanceInteraction/);
  assert.match(workerSrc, /if\(cn==="daily"\)return coinsDailyInteraction/);
  assert.match(workerSrc, /if\(cn==="pay"\)return coinsPayInteraction/);
  assert.match(workerSrc, /if\(cn==="coins"\)return coinsCommandsRouter/);
  // The sync plan only touches ITS OWN command names (no overwrite of others).
  assert.match(workerSrc, /planLevelingCommandSync\(Array\.isArray\(list\)\?list:\[\],COINS_COMMAND_DEFINITIONS\)/);
  // Outside a guild every command refuses cleanly (interaction guild context).
  const env = await setup(nextGuild());
  const dm = (data) => ({ id: "1", guild_id: "", member: { user: { id: USER_A } }, data });
  for (const res of [
    await coinsBalanceInteraction(env, dm({ name: "balance" })),
    await coinsDailyInteraction(env, dm({ name: "daily" })),
    await coinsPayInteraction(env, dm({ name: "pay" })),
    await coinsCommandsRouter(env, dm({ name: "coins" }))
  ]) {
    assert.equal(res.type, 4, "always answers");
    assert.ok(String(res.data.content).includes("only works inside a Discord server"));
    assert.equal(res.data.flags, 64, "ephemeral");
  }
});

/* --------------------------------------- 18) command behaviour end-to-end */

test("commands end-to-end: /balance /daily /pay answer with real wallet data", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, { dailyAmount: 100 });
  const restore = stubDiscord();
  try {
    const make = (name, userId, over = {}) => ({
      id: over.id || "900000000000000001",
      guild_id: gid,
      member: { user: { id: userId, username: "user" + userId.slice(-3), global_name: "Member " + userId.slice(-3), avatar: "" }, permissions: over.permissions || "0", nick: null, roles: [] },
      data: { name, options: over.options || [], resolved: over.resolved },
      resolved: over.resolved
    });

    // /balance — own wallet, then someone else's public balance.
    const b1 = await coinsBalanceInteraction(env, make("balance", USER_A));
    assert.equal(b1.type, 4);
    assert.ok(!("flags" in b1.data), "success embeds follow the bot's convention (public embed like /rank; errors are ephemeral)");
    const e1 = b1.data.embeds[0];
    assert.ok(e1.title.includes("Your"), "self view");
    assert.ok(e1.description.includes("0"), "new wallet starts at 0");
    assert.ok(e1.footer.text.includes("Baltic Coins"));
    await fund(env, gid, USER_B, 750);
    const b2 = await coinsBalanceInteraction(env, make("balance", USER_A, { options: [{ name: "member", value: USER_B }] }));
    const e2 = b2.data.embeds[0];
    assert.ok(e2.title.includes("Their"), "other member view");
    assert.ok(e2.description.includes("750"), "real balance shown");

    // /daily — first claim succeeds, second is on cooldown.
    const d1 = await coinsDailyInteraction(env, make("daily", USER_A));
    assert.ok(d1.data.embeds[0].title.includes("claimed"), JSON.stringify(d1.data));
    const desc = d1.data.embeds[0].description;
    assert.ok(desc.includes("100") && desc.includes("New balance"), "amount + new balance + next claim");
    assert.equal((await wallet(env, gid, USER_A)).balance, 100);
    const d2 = await coinsDailyInteraction(env, make("daily", USER_A));
    assert.ok(d2.data.embeds[0].title.includes("cooldown"));
    assert.ok(d2.data.embeds[0].description.includes("Next daily available in"), "remaining time shown");
    assert.equal((await wallet(env, gid, USER_A)).balance, 100, "cooldown pays nothing");

    // /pay — happy path with resolved identity.
    const p1 = await coinsPayInteraction(env, make("pay", USER_A, {
      id: "900000000000000010",
      options: [{ name: "member", value: USER_C }, { name: "amount", value: 50 }],
      resolved: { users: { [USER_C]: { username: "memberc", global_name: "Member C", avatar: "", bot: false } } }
    }));
    assert.ok(p1.data.embeds[0].title.includes("Transfer sent"), JSON.stringify(p1.data));
    assert.ok(p1.data.embeds[0].description.includes("50") && p1.data.embeds[0].description.includes(`<@${USER_C}>`));
    assert.equal((await wallet(env, gid, USER_A)).balance, 50);
    assert.equal((await wallet(env, gid, USER_C)).balance, 50);

    // /pay — same interaction id replayed → recognised, never re-charged.
    const p2 = await coinsPayInteraction(env, make("pay", USER_A, {
      id: "900000000000000010",
      options: [{ name: "member", value: USER_C }, { name: "amount", value: 50 }],
      resolved: { users: { [USER_C]: { username: "memberc", global_name: "Member C", avatar: "", bot: false } } }
    }));
    assert.ok(p2.data.embeds[0].description.includes("never charged twice"), JSON.stringify(p2.data));
    assert.equal((await wallet(env, gid, USER_A)).balance, 50, "replay charged nothing");

    // /pay — guard rails: self, bot, zero amount, over balance.
    const self = await coinsPayInteraction(env, make("pay", USER_A, { id: "900000000000000011", options: [{ name: "member", value: USER_A }, { name: "amount", value: 10 }] }));
    assert.ok(String(self.data.content).includes("yourself"));
    const botPay = await coinsPayInteraction(env, make("pay", USER_A, {
      id: "900000000000000012",
      options: [{ name: "member", value: BOT_ID }, { name: "amount", value: 10 }],
      resolved: { users: { [BOT_ID]: { username: "bot", bot: true } } }
    }));
    assert.ok(String(botPay.data.content).includes("cannot pay a bot"));
    const zero = await coinsPayInteraction(env, make("pay", USER_A, { id: "900000000000000013", options: [{ name: "member", value: USER_C }, { name: "amount", value: 0 }] }));
    assert.ok(String(zero.data.content).includes("greater than zero"));
    const broke = await coinsPayInteraction(env, make("pay", USER_A, { id: "900000000000000014", options: [{ name: "member", value: USER_C }, { name: "amount", value: 9999 }] }));
    assert.ok(String(broke.data.content).includes("⚠️"), "insufficient balance answered ephemerally");
    assert.equal((await wallet(env, gid, USER_A)).balance, 50, "no failed pay moved Coins");
  } finally { restore(); }
});

test("commands end-to-end: /coins leaderboard, shop, buy, history and admin", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  const restore = stubDiscord();
  try {
    const route = (userId, group, { permissions = "0", id = "910000000000000001" } = {}) => coinsCommandsRouter(env, {
      id, guild_id: gid,
      member: { user: { id: userId, username: "user" + userId.slice(-3), global_name: "Member " + userId.slice(-3), avatar: "" }, permissions, nick: null, roles: [] },
      data: { name: "coins", options: [group] }
    });
    await fund(env, gid, USER_A, 800);
    await fund(env, gid, USER_B, 300);
    await setWalletIdentity(env, gid, USER_A, { username: "member001", displayName: "Member 001", avatar: "" });
    await setWalletIdentity(env, gid, USER_B, { username: "member002", displayName: "Member 002", avatar: "" });

    // leaderboard
    const lb = await route(USER_A, { name: "leaderboard", options: [{ name: "limit", value: 10 }] });
    assert.ok(lb.data.embeds[0].title.includes("Richest members"), JSON.stringify(lb.data));
    assert.ok(lb.data.embeds[0].description.includes("Member 001"), "rank 1 shown");
    assert.ok(lb.data.embeds[0].description.includes("800"));

    // shop listing
    const item = await read(coinsShopCreate(
      req("/api/coins/shop", { method: "POST", guildId: gid, body: { name: "Shield", description: "A sturdy shield", price: 200, itemType: "role", roleId: REWARD_ROLE, enabled: true } }),
      env, adminOf(gid), gid));
    assert.equal(item.status, 201, JSON.stringify(item.body));
    const shop = await route(USER_A, { name: "shop" });
    assert.ok(shop.data.embeds[0].title.includes("Server shop"));
    assert.ok(shop.data.embeds[0].description.includes("Shield") && shop.data.embeds[0].description.includes("200"));

    // buy — real role delivery through the command layer
    const buy = await route(USER_A, { name: "buy", options: [{ name: "item", value: "Shield" }] }, { id: "910000000000000002" });
    assert.ok(buy.data.embeds[0].title.includes("Purchase complete"), JSON.stringify(buy.data));
    assert.ok(buy.data.embeds[0].description.includes("600"), "balance after purchase shown");
    assert.equal((await wallet(env, gid, USER_A)).balance, 600);
    // buy — unknown item refused
    const nope = await route(USER_A, { name: "buy", options: [{ name: "item", value: "Nothing" }] }, { id: "910000000000000003" });
    assert.ok(String(nope.data.content).includes("not available"), JSON.stringify(nope.data));

    // history
    const hist = await route(USER_A, { name: "history", options: [{ name: "limit", value: 5 }] });
    assert.ok(hist.data.embeds[0].title.includes("recent transactions"));
    assert.ok(hist.data.embeds[0].description.includes("Shop purchase"), "real ledger lines");

    // admin — non-administrators are refused before anything moves.
    const denied = await route(USER_A, { name: "admin", options: [{ name: "action", value: "add" }, { name: "member", value: USER_B }, { name: "amount", value: 100 }] });
    assert.ok(String(denied.data.content).includes("Administrator permission is required"), JSON.stringify(denied.data));
    assert.equal((await wallet(env, gid, USER_B)).balance, 300, "nothing moved");
    // admin — administrators get audited add / remove / set / view / history.
    const add = await route(STAFF, { name: "admin", options: [{ name: "action", value: "add" }, { name: "member", value: USER_B }, { name: "amount", value: 100 }, { name: "reason", value: "Compensation" }] }, { permissions: "8", id: "910000000000000004" });
    assert.ok(add.data.embeds[0].description.includes("300"), "previous → new balance");
    assert.ok(add.data.embeds[0].description.includes("400"));
    assert.equal((await wallet(env, gid, USER_B)).balance, 400);
    const view = await route(STAFF, { name: "admin", options: [{ name: "action", value: "view" }, { name: "member", value: USER_B }] }, { permissions: "8" });
    assert.ok(view.data.embeds[0].description.includes("400"));
    const adminHist = await route(STAFF, { name: "admin", options: [{ name: "action", value: "history" }, { name: "member", value: USER_B }] }, { permissions: "8" });
    assert.ok(adminHist.data.embeds[0].description.includes("admin_adjustment") || adminHist.data.embeds[0].description.includes("Admin adjustment"), JSON.stringify(adminHist.data));
    const set = await route(STAFF, { name: "admin", options: [{ name: "action", value: "set" }, { name: "member", value: USER_B }, { name: "amount", value: 42 }] }, { permissions: "8", id: "910000000000000005" });
    assert.ok(set.data.embeds[0].description.includes("42"));
    assert.equal((await wallet(env, gid, USER_B)).balance, 42);
    // The adjustment is in the ledger with actor + reason.
    const audited = (await listTransactions(env, gid, { userId: USER_B, source: "admin_adjustment", limit: 10 }));
    assert.ok(audited.some((t) => t.actorId === STAFF && t.reason === "Compensation"));
    // Unknown subcommand → clean ephemeral refusal.
    const bogus = await route(USER_A, { name: "wat" });
    assert.ok(String(bogus.data.content).includes("Unknown /coins subcommand"));
  } finally { restore(); }
});

test("game economy: transfer + purchase reuse the shared pipeline under game authorization", async () => {
  const gid = nextGuild();
  const env = await setup(gid);
  await enable(env, gid, {});
  const GAME = "balticm-fishing";
  const setInteg = (enabled, allowCredit, allowDebit) => env.BALTICM_DB.prepare(
    "INSERT INTO coins_game_integrations (guild_id, game_key, enabled, allow_credit, allow_debit, daily_limit, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?) ON CONFLICT(guild_id, game_key) DO UPDATE SET enabled=excluded.enabled, allow_credit=excluded.allow_credit, allow_debit=excluded.allow_debit"
  ).bind(gid, GAME, enabled, allowCredit, allowDebit, new Date().toISOString(), new Date().toISOString()).run();

  // Unauthorized → refused, nothing moves.
  assert.equal((await gameEconomy.transfer(env, { guildId: gid, gameKey: GAME, fromUserId: USER_A, toUserId: USER_B, amount: 10, eventKey: "t1" })).ok, false);
  assert.equal((await gameEconomy.purchase(env, { guildId: gid, gameKey: GAME, userId: USER_A, item: "Hat", eventKey: "p1" })).ok, false);
  await setInteg(1, 1, 0); // credit only — transfers and purchases need debit too
  assert.equal((await gameEconomy.transfer(env, { guildId: gid, gameKey: GAME, fromUserId: USER_A, toUserId: USER_B, amount: 10, eventKey: "t1" })).ok, false, "both flags required to move Coins");
  assert.equal((await gameEconomy.purchase(env, { guildId: gid, gameKey: GAME, userId: USER_A, item: "Hat", eventKey: "p1" })).ok, false, "debit permission required to buy");

  // Fully authorized game.
  await setInteg(1, 1, 1);
  await fund(env, gid, USER_A, 500);
  const t = await gameEconomy.transfer(env, { guildId: gid, gameKey: GAME, fromUserId: USER_A, toUserId: USER_B, amount: 75, eventKey: "trade-1", reason: "Fish trade" });
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal((await wallet(env, gid, USER_A)).balance, 425);
  assert.equal((await wallet(env, gid, USER_B)).balance, 75, "the shared guild wallet moved, no per-game wallet");
  const legs = (await listTransactions(env, gid, { limit: 50 })).filter((x) => x.relatedId === t.transferId);
  assert.equal(legs.length, 2, "linked debit + credit pair");
  assert.ok(legs.every((x) => x.meta.includes(GAME)), "both entries identify the game");
  // Duplicate event → replay, single movement.
  const t2 = await gameEconomy.transfer(env, { guildId: gid, gameKey: GAME, fromUserId: USER_A, toUserId: USER_B, amount: 75, eventKey: "trade-1" });
  assert.equal(t2.duplicate, true);
  assert.equal((await wallet(env, gid, USER_A)).balance, 425, "event replay moved nothing");
  // Same-member transfer refused.
  assert.equal((await gameEconomy.transfer(env, { guildId: gid, gameKey: GAME, fromUserId: USER_A, toUserId: USER_A, amount: 5, eventKey: "t2" })).ok, false);
  // Over-balance refused, never negative.
  assert.equal((await gameEconomy.transfer(env, { guildId: gid, gameKey: GAME, fromUserId: USER_B, toUserId: USER_A, amount: 9999, eventKey: "t3" })).ok, false);
  assert.equal((await wallet(env, gid, USER_B)).balance, 75);

  // Game purchase through the SAME shop pipeline.
  const restore = stubDiscord();
  try {
    const item = await read(coinsShopCreate(
      req("/api/coins/shop", { method: "POST", guildId: gid, body: { name: "Boat pass", price: 100, itemType: "manual", stock: 2, enabled: true } }),
      env, adminOf(gid), gid));
    assert.equal(item.status, 201, JSON.stringify(item.body));
    const p = await gameEconomy.purchase(env, { guildId: gid, gameKey: GAME, userId: USER_A, item: "Boat pass", eventKey: "voyage-1" });
    assert.equal(p.ok, true, JSON.stringify(p));
    assert.equal(p.purchase.status, "awaiting_fulfillment");
    assert.equal((await wallet(env, gid, USER_A)).balance, 325, "charged through the shared purchase pipeline");
    assert.equal((await listShopItems(env, gid)).find((i) => i.id === item.body.item.id).stock, 1, "shared stock enforced");
    // Duplicate game event → replayed outcome, no second charge.
    const p2 = await gameEconomy.purchase(env, { guildId: gid, gameKey: GAME, userId: USER_A, item: "Boat pass", eventKey: "voyage-1" });
    assert.equal(p2.duplicate, true);
    assert.equal((await wallet(env, gid, USER_A)).balance, 325);
    // Missing event id → refused (idempotency required).
    const noKey = await gameEconomy.purchase(env, { guildId: gid, gameKey: GAME, userId: USER_A, item: "Boat pass" });
    assert.equal(noKey.ok, false);
    assert.equal(noKey.code, "invalid_event");
    // Game transactions stay in the spec's ledger vocabulary + audit shape.
    const rows = (await listTransactions(env, gid, { limit: 100 }));
    assert.ok(rows.every((x) => TX_SOURCES.includes(x.source)), "only the 11 spec sources ever appear");
    const shopRow = rows.find((x) => x.reason === "Shop: Boat pass");
    assert.ok(shopRow && shopRow.meta.includes(GAME), "the game purchase row identifies the game + event");
    const hist = await gameEconomy.history(env, { guildId: gid, userId: USER_A, gameKey: GAME, limit: 50 });
    assert.ok(hist.transactions.length >= 2, "game history is retrievable per game");
    assert.ok(hist.transactions.every((x) => x.meta.includes(GAME)), "only game-tagged rows in the game view");
  } finally { restore(); }
});

/* __APPEND_POINT__ */
