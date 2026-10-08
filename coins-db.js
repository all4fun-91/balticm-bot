/* Baltic Coins V1 — D1 storage layer + THE wallet/ledger engine.

   Follows the leveling/tournaments conventions: CREATE TABLE IF NOT EXISTS
   plus additive try/catch ALTERs, guild-scoped keys for isolation, and
   indexes for history/leaderboard lookups. No production data is ever
   dropped or rewritten by a migration.

   ATOMICITY MODEL (D1 has no interactive transactions):
   - every balance change is ONE guarded UPDATE ... RETURNING statement, so
     concurrent debits can never overdraw (WHERE balance >= amount) and
     concurrent credits/claims are decided by the database, not by a
     read-then-write race;
   - the ledger row is written immediately after with the authoritative
     balance_after from RETURNING; if that INSERT fails the wallet change is
     compensated (reversed) before the error propagates, so a wallet can
     never silently disagree with its ledger;
   - idempotency keys live on a UNIQUE partial index per guild, so a replayed
     interaction or a retried request returns the FIRST result instead of
     double-spending.

   EVERY table and column is guild-scoped: one guild's economy can never read
   or write another's wallets, claims, shop or ledger. */

import { COINS_DEFAULTS, MESSAGE_SPAM_WINDOW_MS, TRANSFER_GAP_MS, assertNonNegative, clampCoins } from "./coins.js";

const iso = () => new Date().toISOString();
const dayKey = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);

export async function ensureCoinsTables(env) {
  const db = env.BALTICM_DB;
  if (!db) throw new Error("BALTICM_DB binding is not configured");

  await db.prepare(
    "CREATE TABLE IF NOT EXISTS coins_settings (guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, transfers_enabled INTEGER NOT NULL DEFAULT 1, shop_enabled INTEGER NOT NULL DEFAULT 1, starting_balance INTEGER NOT NULL DEFAULT 0, daily_enabled INTEGER NOT NULL DEFAULT 1, daily_amount INTEGER NOT NULL DEFAULT 100, daily_cooldown INTEGER NOT NULL DEFAULT 86400, message_enabled INTEGER NOT NULL DEFAULT 1, message_amount INTEGER NOT NULL DEFAULT 5, message_cooldown INTEGER NOT NULL DEFAULT 60, voice_enabled INTEGER NOT NULL DEFAULT 1, voice_amount INTEGER NOT NULL DEFAULT 10, voice_interval INTEGER NOT NULL DEFAULT 600, excluded_channels TEXT NOT NULL DEFAULT '[]', excluded_roles TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL)"
  ).run();

  await db.prepare(
    "CREATE TABLE IF NOT EXISTS coins_wallets (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', balance INTEGER NOT NULL DEFAULT 0, total_earned INTEGER NOT NULL DEFAULT 0, total_spent INTEGER NOT NULL DEFAULT 0, total_purchased INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (guild_id, user_id))"
  ).run();

  await db.prepare(
    "CREATE TABLE IF NOT EXISTS coins_transactions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, source TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, related_id TEXT NOT NULL DEFAULT '', actor_id TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', idempotency_key TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)"
  ).run();

  await db.prepare(
    "CREATE TABLE IF NOT EXISTS coins_claims (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, claimed_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id, kind))"
  ).run();

  await db.prepare(
    "CREATE TABLE IF NOT EXISTS coins_reward_state (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, last_message_at INTEGER NOT NULL DEFAULT 0, last_message_id TEXT NOT NULL DEFAULT '', last_message_sig TEXT NOT NULL DEFAULT '', last_sig_at INTEGER NOT NULL DEFAULT 0, last_voice_at INTEGER NOT NULL DEFAULT 0, voice_seen INTEGER NOT NULL DEFAULT 0, last_transfer_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, user_id))"
  ).run();

  await db.prepare(
    "CREATE TABLE IF NOT EXISTS coins_shop_items (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, item_type TEXT NOT NULL, role_id TEXT NOT NULL DEFAULT '', stock INTEGER, purchase_limit INTEGER, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();

  await db.prepare(
    "CREATE TABLE IF NOT EXISTS coins_purchases (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, item_id TEXT NOT NULL, item_name TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, status TEXT NOT NULL, idempotency_key TEXT NOT NULL DEFAULT '', failure_reason TEXT NOT NULL DEFAULT '', fulfilled_by TEXT NOT NULL DEFAULT '', fulfilled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();

  /* Future-ready (schema only, no public API in V1):
     - game integrations per guild with scoped allow-flags and reward limits;
     - paid Coins orders for the future real-money flow (purchased vs earned
       accounting is already tracked separately in coins_wallets.total_purchased). */
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS coins_game_integrations (guild_id TEXT NOT NULL, game_key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, allow_credit INTEGER NOT NULL DEFAULT 0, allow_debit INTEGER NOT NULL DEFAULT 0, daily_limit INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (guild_id, game_key))"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS coins_paid_orders (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, package_id TEXT NOT NULL DEFAULT '', amount_coins INTEGER NOT NULL DEFAULT 0, payment_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
  ).run();

  // Additive-only upgrades for databases created before a column existed.
  for (const sql of [
    "ALTER TABLE coins_wallets ADD COLUMN total_purchased INTEGER NOT NULL DEFAULT 0"
  ]) {
    try { await db.prepare(sql).run(); } catch { /* column exists */ }
  }

  for (const sql of [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_coins_tx_idem ON coins_transactions (guild_id, idempotency_key) WHERE idempotency_key <> ''",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_coins_purchase_idem ON coins_purchases (guild_id, idempotency_key) WHERE idempotency_key <> ''",
    "CREATE INDEX IF NOT EXISTS idx_coins_tx_user ON coins_transactions (guild_id, user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_coins_tx_guild ON coins_transactions (guild_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_coins_wallets_balance ON coins_wallets (guild_id, balance DESC)",
    "CREATE INDEX IF NOT EXISTS idx_coins_shop_guild ON coins_shop_items (guild_id, enabled)",
    "CREATE INDEX IF NOT EXISTS idx_coins_purchases_status ON coins_purchases (guild_id, status)"
  ]) {
    try { await db.prepare(sql).run(); } catch { /* index exists */ }
  }
}

/* ------------------------------------------------------------- settings */

const parseIds = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } };

function settingsFromRow(row) {
  if (!row) return { ...COINS_DEFAULTS, excludedChannels: [], excludedRoles: [] };
  return {
    enabled: Number(row.enabled) === 1,
    transfersEnabled: Number(row.transfers_enabled) === 1,
    shopEnabled: Number(row.shop_enabled) === 1,
    startingBalance: Number(row.starting_balance),
    dailyEnabled: Number(row.daily_enabled) === 1,
    dailyAmount: Number(row.daily_amount),
    dailyCooldown: Number(row.daily_cooldown),
    messageEnabled: Number(row.message_enabled) === 1,
    messageAmount: Number(row.message_amount),
    messageCooldown: Number(row.message_cooldown),
    voiceEnabled: Number(row.voice_enabled) === 1,
    voiceAmount: Number(row.voice_amount),
    voiceInterval: Number(row.voice_interval),
    excludedChannels: parseIds(row.excluded_channels),
    excludedRoles: parseIds(row.excluded_roles)
  };
}

export async function getCoinsConfig(env, guildId) {
  const row = await env.BALTICM_DB.prepare("SELECT * FROM coins_settings WHERE guild_id=?").bind(String(guildId)).first();
  return { exists: !!row, settings: settingsFromRow(row) };
}

export async function saveCoinsConfig(env, guildId, s) {
  await env.BALTICM_DB.prepare(
    "INSERT INTO coins_settings (guild_id, enabled, transfers_enabled, shop_enabled, starting_balance, daily_enabled, daily_amount, daily_cooldown, message_enabled, message_amount, message_cooldown, voice_enabled, voice_amount, voice_interval, excluded_channels, excluded_roles, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled,transfers_enabled=excluded.transfers_enabled,shop_enabled=excluded.shop_enabled,starting_balance=excluded.starting_balance,daily_enabled=excluded.daily_enabled,daily_amount=excluded.daily_amount,daily_cooldown=excluded.daily_cooldown,message_enabled=excluded.message_enabled,message_amount=excluded.message_amount,message_cooldown=excluded.message_cooldown,voice_enabled=excluded.voice_enabled,voice_amount=excluded.voice_amount,voice_interval=excluded.voice_interval,excluded_channels=excluded.excluded_channels,excluded_roles=excluded.excluded_roles,updated_at=excluded.updated_at"
  ).bind(
    String(guildId),
    s.enabled ? 1 : 0, s.transfersEnabled ? 1 : 0, s.shopEnabled ? 1 : 0, s.startingBalance,
    s.dailyEnabled ? 1 : 0, s.dailyAmount, s.dailyCooldown,
    s.messageEnabled ? 1 : 0, s.messageAmount, s.messageCooldown,
    s.voiceEnabled ? 1 : 0, s.voiceAmount, s.voiceInterval,
    JSON.stringify(s.excludedChannels), JSON.stringify(s.excludedRoles), iso()
  ).run();
}

/* --------------------------------------------------------------- wallets */

const WALLET_FIELDS = "guild_id AS guildId, user_id AS userId, username, display_name AS displayName, avatar, balance, total_earned AS totalEarned, total_spent AS totalSpent, total_purchased AS totalPurchased, created_at AS createdAt, updated_at AS updatedAt";

/** Remember how a member presents themselves so wallets, the Control
    Center and the leaderboard can show avatars and names (updated whenever
    an event carries a fresher identity; empty fields never overwrite). */
export async function setWalletIdentity(env, guildId, userId, meta) {
  const username = String(meta?.username || "").slice(0, 80);
  const displayName = String(meta?.displayName || "").slice(0, 80);
  const avatar = String(meta?.avatar || "").slice(0, 80);
  if (!username && !displayName && !avatar) return;
  await env.BALTICM_DB.prepare(
    "UPDATE coins_wallets SET username=CASE WHEN ?<>'' THEN ? ELSE username END, display_name=CASE WHEN ?<>'' THEN ? ELSE display_name END, avatar=CASE WHEN ?<>'' THEN ? ELSE avatar END WHERE guild_id=? AND user_id=?"
  ).bind(username, username, displayName, displayName, avatar, avatar, String(guildId), String(userId)).run();
}

export async function getWallet(env, guildId, userId) {
  return env.BALTICM_DB.prepare(`SELECT ${WALLET_FIELDS} FROM coins_wallets WHERE guild_id=? AND user_id=?`)
    .bind(String(guildId), String(userId)).first();
}

/** Create the wallet if missing. The configured starting balance is credited
    EXACTLY ONCE — guarded by the wallet INSERT itself plus a ledger
    idempotency key, so two racing first-views can never double-grant it. */
export async function ensureWallet(env, guildId, userId, settings) {
  const now = iso();
  const r = await env.BALTICM_DB.prepare(
    "INSERT OR IGNORE INTO coins_wallets (guild_id, user_id, balance, total_earned, total_spent, total_purchased, created_at, updated_at) VALUES (?,?,0,0,0,0,?,?)"
  ).bind(String(guildId), String(userId), now, now).run();
  const created = Number(r.meta?.changes || 0) > 0;
  if (created && Number(settings?.startingBalance || 0) > 0) {
    await creditCoins(env, {
      guildId, userId,
      amount: clampCoins(settings.startingBalance),
      source: "starting_balance",
      reason: "Starting balance",
      idempotencyKey: `start:${guildId}:${userId}`
    });
  }
  return getWallet(env, guildId, userId);
}

/* --------------------------------------------------------- ledger engine */

async function findLedgerByIdempotencyKey(env, guildId, key) {
  if (!key) return null;
  return env.BALTICM_DB.prepare(
    "SELECT id, guild_id AS guildId, user_id AS userId, source, amount, balance_after AS balanceAfter, related_id AS relatedId, actor_id AS actorId, reason, idempotency_key AS idempotencyKey, meta, created_at AS createdAt FROM coins_transactions WHERE guild_id=? AND idempotency_key=?"
  ).bind(String(guildId), String(key)).first();
}

async function insertLedger(env, { guildId, userId, source, amount, balanceAfter, relatedId = "", actorId = "", reason = "", idempotencyKey = "", meta = "" }) {
  const id = globalThis.crypto.randomUUID();
  await env.BALTICM_DB.prepare(
    "INSERT INTO coins_transactions (id, guild_id, user_id, source, amount, balance_after, related_id, actor_id, reason, idempotency_key, meta, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, String(guildId), String(userId), source, Math.floor(amount), assertNonNegative(balanceAfter), String(relatedId), String(actorId), String(reason).slice(0, 120), String(idempotencyKey), String(meta).slice(0, 500), iso()).run();
  return id;
}

/**
 * Credit Coins (atomic). Returns { ok, balance, ledgerId, duplicate? }.
 * Never produces a negative balance; the idempotency key makes replays free.
 */
export async function creditCoins(env, { guildId, userId, amount, source, relatedId = "", actorId = "", reason = "", idempotencyKey = "", meta = "" }) {
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt < 1) return { ok: false, code: "invalid_amount", error: "Credit amount must be a positive whole number." };
  const replay = await findLedgerByIdempotencyKey(env, guildId, idempotencyKey);
  if (replay) return { ok: true, duplicate: true, balance: replay.balanceAfter, ledgerId: replay.id };

  const now = iso();
  const row = await env.BALTICM_DB.prepare(
    "UPDATE coins_wallets SET balance=MIN(?, balance+?), total_earned=total_earned+?, total_purchased=total_purchased+?, updated_at=? WHERE guild_id=? AND user_id=? RETURNING balance"
  ).bind(COINS_MAX_SAFE, amt, amt, source === "future_paid_purchase" ? amt : 0, now, String(guildId), String(userId)).first();
  if (!row) return { ok: false, code: "no_wallet", error: "That member has no wallet in this server." };
  try {
    const ledgerId = await insertLedger(env, { guildId, userId, source, amount: amt, balanceAfter: row.balance, relatedId, actorId, reason, idempotencyKey, meta });
    return { ok: true, balance: row.balance, ledgerId };
  } catch (e) {
    // Compensate: the ledger is the source of truth — undo the wallet change.
    try {
      await env.BALTICM_DB.prepare(
        "UPDATE coins_wallets SET balance=balance-?, total_earned=total_earned-?, total_purchased=total_purchased-?, updated_at=? WHERE guild_id=? AND user_id=?"
      ).bind(amt, amt, source === "future_paid_purchase" ? amt : 0, now, String(guildId), String(userId)).run();
    } catch { /* best effort — the error below still surfaces */ }
    throw e;
  }
}

const COINS_MAX_SAFE = 1000000000;

/**
 * Debit Coins (atomic + overdraw-proof). The WHERE clause enforces
 * `balance >= amount` in the database, so two concurrent debits can never
 * both spend the same Coins.
 */
export async function debitCoins(env, { guildId, userId, amount, source, relatedId = "", actorId = "", reason = "", idempotencyKey = "", meta = "" }) {
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt < 1) return { ok: false, code: "invalid_amount", error: "Debit amount must be a positive whole number." };
  const replay = await findLedgerByIdempotencyKey(env, guildId, idempotencyKey);
  if (replay) return { ok: true, duplicate: true, balance: replay.balanceAfter, ledgerId: replay.id };

  const now = iso();
  const row = await env.BALTICM_DB.prepare(
    "UPDATE coins_wallets SET balance=balance-?, total_spent=total_spent+?, updated_at=? WHERE guild_id=? AND user_id=? AND balance>=? RETURNING balance"
  ).bind(amt, amt, now, String(guildId), String(userId), amt).first();
  if (!row) {
    const wallet = await getWallet(env, guildId, userId);
    return { ok: false, code: "insufficient_balance", error: "This member does not have enough Baltic Coins.", balance: wallet ? wallet.balance : 0 };
  }
  try {
    const ledgerId = await insertLedger(env, { guildId, userId, source, amount: -amt, balanceAfter: row.balance, relatedId, actorId, reason, idempotencyKey, meta });
    return { ok: true, balance: row.balance, ledgerId };
  } catch (e) {
    try {
      await env.BALTICM_DB.prepare(
        "UPDATE coins_wallets SET balance=balance+?, total_spent=total_spent-?, updated_at=? WHERE guild_id=? AND user_id=?"
      ).bind(amt, amt, now, String(guildId), String(userId)).run();
    } catch { /* best effort */ }
    throw e;
  }
}

/**
 * Member-to-member transfer inside ONE guild. Debit first (guarded), credit
 * second; if the credit cannot land, the debit is refunded immediately so a
 * half-finished transfer can never destroy Coins. Linked ledger entries share
 * the transfer id in `related_id`, and the outgoing-transfer rate gap is
 * enforced atomically on the reward-state row.
 */
export async function transferCoins(env, { guildId, fromUserId, toUserId, amount, idempotencyKey = "", reason = "", meta = "" }) {
  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt < 1) return { ok: false, error: "Enter a whole number of Coins greater than zero." };
  if (!String(fromUserId) || String(fromUserId) === String(toUserId)) return { ok: false, error: "You cannot send Coins to yourself." };

  // Replay protection: an identical request id returns the first outcome.
  if (idempotencyKey) {
    const existing = await findLedgerByIdempotencyKey(env, guildId, `${idempotencyKey}:debit`);
    if (existing) return { ok: true, duplicate: true, balance: existing.balanceAfter, transferId: existing.relatedId };
  }
  const transferId = globalThis.crypto.randomUUID();

  // Outgoing-transfer rate gap (abuse prevention), enforced atomically.
  await env.BALTICM_DB.prepare(
    "INSERT OR IGNORE INTO coins_reward_state (guild_id, user_id, last_message_at, last_message_id, last_message_sig, last_sig_at, last_voice_at, voice_seen, last_transfer_at) VALUES (?,?,?,?,?,?,?,?,0)"
  ).bind(String(guildId), String(fromUserId), 0, "", "", 0, 0, 0).run();
  const gapRow = await env.BALTICM_DB.prepare(
    "UPDATE coins_reward_state SET last_transfer_at=? WHERE guild_id=? AND user_id=? AND last_transfer_at<=? RETURNING last_transfer_at AS lastTransferAt"
  ).bind(Date.now(), String(guildId), String(fromUserId), Date.now() - TRANSFER_GAP_MS).first();
  if (!gapRow) return { ok: false, code: "rate_limited", error: "You are transferring Coins too quickly — wait a few seconds and try again." };

  const debit = await debitCoins(env, {
    guildId, userId: fromUserId, amount: amt, source: "discord_transfer",
    relatedId: transferId, reason: `Transfer to ${toUserId}`, idempotencyKey: idempotencyKey ? `${idempotencyKey}:debit` : "", meta
  });
  if (!debit.ok) return debit;

  const credit = await creditCoins(env, {
    guildId, userId: toUserId, amount: amt, source: "discord_transfer",
    relatedId: transferId, reason: `Transfer from ${fromUserId}`, idempotencyKey: idempotencyKey ? `${idempotencyKey}:credit` : "", meta
  });
  if (!credit.ok) {
    // Refund the sender — the transfer never happened.
    await creditCoins(env, {
      guildId, userId: fromUserId, amount: amt, source: "discord_transfer",
      relatedId: transferId, reason: "Transfer refunded (recipient credit failed)",
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:reversal` : ""
    });
    return { ok: false, error: "The transfer could not be completed — no Coins were lost." };
  }
  return { ok: true, transferId, fromBalance: debit.balance, toBalance: credit.balance };
}

/* ------------------------------------------------------------ daily claim */

/** Atomic daily claim: one guarded UPDATE decides who wins a concurrent
    double-claim. Returns { ok, claimedAt } or { ok:false, remainingMs }. */
export async function claimDaily(env, { guildId, userId, cooldownSeconds, now = Date.now() }) {
  await env.BALTICM_DB.prepare(
    "INSERT OR IGNORE INTO coins_claims (guild_id, user_id, kind, claimed_at) VALUES (?,?,'daily',0)"
  ).bind(String(guildId), String(userId)).run();
  const updated = await env.BALTICM_DB.prepare(
    "UPDATE coins_claims SET claimed_at=? WHERE guild_id=? AND user_id=? AND kind='daily' AND claimed_at<=? RETURNING claimed_at AS claimedAt"
  ).bind(now, String(guildId), String(userId), now - Number(cooldownSeconds || 0) * 1000).first();
  if (updated) return { ok: true, claimedAt: now };
  const row = await env.BALTICM_DB.prepare(
    "SELECT claimed_at AS claimedAt FROM coins_claims WHERE guild_id=? AND user_id=? AND kind='daily'"
  ).bind(String(guildId), String(userId)).first();
  const remainingMs = Math.max(0, Number(row?.claimedAt || 0) + Number(cooldownSeconds || 0) * 1000 - now);
  return { ok: false, code: "cooldown", claimedAt: Number(row?.claimedAt || 0), remainingMs };
}

/* -------------------------------------------------- message/voice rewards */

async function ensureRewardState(env, guildId, userId) {
  await env.BALTICM_DB.prepare(
    "INSERT OR IGNORE INTO coins_reward_state (guild_id, user_id, last_message_at, last_message_id, last_message_sig, last_sig_at, last_voice_at, voice_seen, last_transfer_at) VALUES (?,?,?,?,?,?,?,?,0)"
  ).bind(String(guildId), String(userId), 0, "", "", 0, 0, 0).run();
}

/** Message signature — normalised, truncated, never raw text (anti-farm). */
export function messageSignature(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
}

/**
 * Guarded message-reward claim: cooldown, message-id replay protection and
 * repeated-signature spam protection are ALL enforced inside one UPDATE, so
 * duplicate gateway events or replayed service requests can never double-pay.
 */
export async function claimMessageReward(env, { guildId, userId, amount, now, cooldownMs, messageId, sig, spamWindowMs = MESSAGE_SPAM_WINDOW_MS }) {
  await ensureRewardState(env, guildId, userId);
  const r = await env.BALTICM_DB.prepare(
    "UPDATE coins_reward_state SET last_message_at=?, last_message_id=?, last_message_sig=?, last_sig_at=? WHERE guild_id=? AND user_id=? AND last_message_at<=? AND last_message_id<>? AND NOT (last_message_sig=? AND last_message_sig<>'' AND last_sig_at>?)"
  ).bind(now, String(messageId || ""), String(sig || ""), now, String(guildId), String(userId), now - cooldownMs, String(messageId || ""), String(sig || ""), now - spamWindowMs).run();
  return Number(r.meta?.changes || 0) > 0;
}

/**
 * Voice tick: returns the user ids that EARN this tick. First sight only
 * starts the participation clock; leaving the snapshot resets it, so
 * disconnects, restarts and reconnects can never farm rewards.
 */
export async function voiceRewardEligible(env, { guildId, members, now, intervalMs }) {
  const present = new Set();
  const eligible = [];
  for (const m of members) {
    const userId = String(m?.userId || "");
    if (!/^\d{16,22}$/.test(userId)) continue;
    present.add(userId);
    if (m.bot || m.afk || m.alone) continue;
    await ensureRewardState(env, guildId, userId);
    const row = await env.BALTICM_DB.prepare(
      "SELECT voice_seen AS voiceSeen, last_voice_at AS lastVoiceAt FROM coins_reward_state WHERE guild_id=? AND user_id=?"
    ).bind(String(guildId), String(userId)).first();
    if (Number(row?.voiceSeen || 0) !== 1) {
      await env.BALTICM_DB.prepare(
        "UPDATE coins_reward_state SET voice_seen=1, last_voice_at=? WHERE guild_id=? AND user_id=?"
      ).bind(now, String(guildId), String(userId)).run();
      continue;
    }
    const claimed = await env.BALTICM_DB.prepare(
      "UPDATE coins_reward_state SET last_voice_at=? WHERE guild_id=? AND user_id=? AND last_voice_at<? RETURNING last_voice_at AS t"
    ).bind(now, String(guildId), String(userId), now - intervalMs).first();
    if (claimed) eligible.push(userId);
  }
  // Members absent from the snapshot reset their clock (disconnect safety).
  const seen = await env.BALTICM_DB.prepare(
    "SELECT user_id AS userId FROM coins_reward_state WHERE guild_id=? AND voice_seen=1"
  ).bind(String(guildId)).all();
  for (const row of seen.results || []) {
    if (!present.has(String(row.userId))) {
      await env.BALTICM_DB.prepare(
        "UPDATE coins_reward_state SET voice_seen=0, last_voice_at=0 WHERE guild_id=? AND user_id=?"
      ).bind(String(guildId), String(String(row.userId))).run();
    }
  }
  return eligible;
}

/* ------------------------------------------------------------------ shop */

const ITEM_FIELDS = "id, guild_id AS guildId, name, description, price, item_type AS itemType, role_id AS roleId, stock, purchase_limit AS purchaseLimit, enabled, created_at AS createdAt, updated_at AS updatedAt";

export async function listShopItems(env, guildId, { enabledOnly = false } = {}) {
  const sql = enabledOnly
    ? `SELECT ${ITEM_FIELDS} FROM coins_shop_items WHERE guild_id=? AND enabled=1 ORDER BY price ASC`
    : `SELECT ${ITEM_FIELDS} FROM coins_shop_items WHERE guild_id=? ORDER BY enabled DESC, price ASC`;
  const r = await env.BALTICM_DB.prepare(sql).bind(String(guildId)).all();
  return r.results || [];
}

export async function getShopItem(env, guildId, id) {
  return env.BALTICM_DB.prepare(`SELECT ${ITEM_FIELDS} FROM coins_shop_items WHERE guild_id=? AND id=?`)
    .bind(String(guildId), String(id)).first();
}

export async function addShopItem(env, guildId, item) {
  const id = globalThis.crypto.randomUUID();
  const now = iso();
  await env.BALTICM_DB.prepare(
    "INSERT INTO coins_shop_items (id, guild_id, name, description, price, item_type, role_id, stock, purchase_limit, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(id, String(guildId), item.name, item.description, item.price, item.itemType, item.roleId, item.stock, item.purchaseLimit, item.enabled ? 1 : 0, now, now).run();
  return getShopItem(env, guildId, id);
}

export async function updateShopItem(env, guildId, id, item) {
  const r = await env.BALTICM_DB.prepare(
    "UPDATE coins_shop_items SET name=?, description=?, price=?, item_type=?, role_id=?, stock=?, purchase_limit=?, enabled=?, updated_at=? WHERE guild_id=? AND id=?"
  ).bind(item.name, item.description, item.price, item.itemType, item.roleId, item.stock, item.purchaseLimit, item.enabled ? 1 : 0, iso(), String(guildId), String(id)).run();
  return Number(r.meta?.changes || 0) > 0 ? getShopItem(env, guildId, id) : null;
}

export async function deleteShopItem(env, guildId, id) {
  const r = await env.BALTICM_DB.prepare("DELETE FROM coins_shop_items WHERE guild_id=? AND id=?").bind(String(guildId), String(id)).run();
  return Number(r.meta?.changes || 0) > 0;
}

/** Stock is decremented inside a guarded UPDATE — two buyers racing for the
    last unit can never both win it. Returns false when the item is out. */
export async function takeShopStock(env, guildId, id) {
  const r = await env.BALTICM_DB.prepare(
    "UPDATE coins_shop_items SET stock=stock-1, updated_at=? WHERE guild_id=? AND id=? AND stock IS NOT NULL AND stock>0"
  ).bind(iso(), String(guildId), String(id)).run();
  const item = await getShopItem(env, guildId, id);
  if (item && item.stock === null) return true; // unlimited stock
  return Number(r.meta?.changes || 0) > 0;
}

export async function restoreShopStock(env, guildId, id, item) {
  if (item && item.stock !== null && item.stock !== undefined) {
    await env.BALTICM_DB.prepare(
      "UPDATE coins_shop_items SET stock=stock+1, updated_at=? WHERE guild_id=? AND id=?"
    ).bind(iso(), String(guildId), String(id)).run();
  }
}

/* ------------------------------------------------------------ purchases */

const PURCHASE_FIELDS = "id, guild_id AS guildId, user_id AS userId, item_id AS itemId, item_name AS itemName, price, status, idempotency_key AS idempotencyKey, failure_reason AS failureReason, fulfilled_by AS fulfilledBy, fulfilled_at AS fulfilledAt, created_at AS createdAt, updated_at AS updatedAt";

export async function createPurchase(env, { guildId, userId, item, idempotencyKey = "", status = "pending" }) {
  if (idempotencyKey) {
    const existing = await env.BALTICM_DB.prepare(
      `SELECT ${PURCHASE_FIELDS} FROM coins_purchases WHERE guild_id=? AND idempotency_key=?`
    ).bind(String(guildId), String(idempotencyKey)).first();
    if (existing) return { purchase: existing, duplicate: true };
  }
  const id = globalThis.crypto.randomUUID();
  const now = iso();
  try {
    await env.BALTICM_DB.prepare(
      "INSERT INTO coins_purchases (id, guild_id, user_id, item_id, item_name, price, status, idempotency_key, failure_reason, fulfilled_by, fulfilled_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?, '', '', NULL, ?,?)"
    ).bind(id, String(guildId), String(userId), String(item.id), String(item.name), Math.floor(item.price), status, String(idempotencyKey), now, now).run();
  } catch (e) {
    // Lost the race on the unique idempotency index → the other request won;
    // return ITS purchase so a retry can never double-charge.
    if (idempotencyKey) {
      const existing = await env.BALTICM_DB.prepare(
        `SELECT ${PURCHASE_FIELDS} FROM coins_purchases WHERE guild_id=? AND idempotency_key=?`
      ).bind(String(guildId), String(idempotencyKey)).first();
      if (existing) return { purchase: existing, duplicate: true };
    }
    throw e;
  }
  const purchase = await getPurchase(env, guildId, id);
  return { purchase, duplicate: false };
}

export async function getPurchase(env, guildId, id) {
  return env.BALTICM_DB.prepare(`SELECT ${PURCHASE_FIELDS} FROM coins_purchases WHERE guild_id=? AND id=?`)
    .bind(String(guildId), String(id)).first();
}

export async function setPurchaseStatus(env, guildId, id, status, { failureReason = "", fulfilledBy = "" } = {}) {
  const now = iso();
  const r = await env.BALTICM_DB.prepare(
    "UPDATE coins_purchases SET status=?, failure_reason=?, fulfilled_by=CASE WHEN ?<>'' THEN ? ELSE fulfilled_by END, fulfilled_at=CASE WHEN ?='completed' AND ?<>'' THEN ? ELSE fulfilled_at END, updated_at=? WHERE guild_id=? AND id=?"
  ).bind(status, String(failureReason).slice(0, 200), String(fulfilledBy), String(fulfilledBy), status, String(fulfilledBy), now, now, String(guildId), String(id)).run();
  return Number(r.meta?.changes || 0) > 0;
}

export async function countMemberPurchases(env, guildId, userId, itemId) {
  const row = await env.BALTICM_DB.prepare(
    "SELECT COUNT(*) AS n FROM coins_purchases WHERE guild_id=? AND user_id=? AND item_id=? AND status IN ('pending','processing','completed','awaiting_fulfillment')"
  ).bind(String(guildId), String(userId), String(itemId)).first();
  return Number(row?.n || 0);
}

export async function listPurchases(env, guildId, { status = "", limit = 50, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  if (status) {
    const r = await env.BALTICM_DB.prepare(
      `SELECT ${PURCHASE_FIELDS} FROM coins_purchases WHERE guild_id=? AND status=? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
    ).bind(String(guildId), String(status), lim, off).all();
    return r.results || [];
  }
  const r = await env.BALTICM_DB.prepare(
    `SELECT ${PURCHASE_FIELDS} FROM coins_purchases WHERE guild_id=? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
  ).bind(String(guildId), lim, off).all();
  return r.results || [];
}

/* --------------------------------------------------------- query surface */

export async function listTransactions(env, guildId, { userId = "", source = "", limit = 25, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 25));
  const off = Math.max(0, Number(offset) || 0);
  const where = ["guild_id=?"];
  const binds = [String(guildId)];
  if (userId) { where.push("user_id=?"); binds.push(String(userId)); }
  if (source) { where.push("source=?"); binds.push(String(source)); }
  const r = await env.BALTICM_DB.prepare(
    `SELECT id, guild_id AS guildId, user_id AS userId, source, amount, balance_after AS balanceAfter, related_id AS relatedId, actor_id AS actorId, reason, meta, created_at AS createdAt FROM coins_transactions WHERE ${where.join(" AND ")} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`
  ).bind(...binds, lim, off).all();
  return r.results || [];
}

/** Paginated wallet directory for the Control Center. */
export async function listWallets(env, guildId, { q = "", limit = 25, offset = 0 } = {}) {
  const needle = String(q || "").trim();
  const lim = Math.max(1, Math.min(100, Number(limit) || 25));
  const off = Math.max(0, Number(offset) || 0);
  if (needle) {
    const r = await env.BALTICM_DB.prepare(
      `SELECT ${WALLET_FIELDS} FROM coins_wallets WHERE guild_id=? AND (display_name LIKE ? OR username LIKE ? OR user_id=?) ORDER BY balance DESC LIMIT ? OFFSET ?`
    ).bind(String(guildId), `%${needle}%`, `%${needle}%`, needle, lim, off).all();
    const total = await env.BALTICM_DB.prepare(
      "SELECT COUNT(*) AS n FROM coins_wallets WHERE guild_id=? AND (display_name LIKE ? OR username LIKE ? OR user_id=?)"
    ).bind(String(guildId), `%${needle}%`, `%${needle}%`, needle).first();
    return { wallets: r.results || [], total: Number(total?.n || 0) };
  }
  const r = await env.BALTICM_DB.prepare(
    `SELECT ${WALLET_FIELDS} FROM coins_wallets WHERE guild_id=? ORDER BY balance DESC, user_id ASC LIMIT ? OFFSET ?`
  ).bind(String(guildId), lim, off).all();
  const total = await env.BALTICM_DB.prepare("SELECT COUNT(*) AS n FROM coins_wallets WHERE guild_id=?").bind(String(guildId)).first();
  return { wallets: r.results || [], total: Number(total?.n || 0) };
}

export async function countTransactions(env, guildId, { userId = "", source = "" } = {}) {
  const where = ["guild_id=?"];
  const binds = [String(guildId)];
  if (userId) { where.push("user_id=?"); binds.push(String(userId)); }
  if (source) { where.push("source=?"); binds.push(String(source)); }
  const row = await env.BALTICM_DB.prepare(`SELECT COUNT(*) AS n FROM coins_transactions WHERE ${where.join(" AND ")}`).bind(...binds).first();
  return Number(row?.n || 0);
}

export async function coinsLeaderboard(env, guildId, { q = "", limit = 10, offset = 0 } = {}) {
  const needle = String(q || "").trim();
  const lim = Math.max(1, Math.min(100, Number(limit) || 10));
  const off = Math.max(0, Number(offset) || 0);
  const sql = needle
    ? "SELECT user_id AS userId, username, display_name AS displayName, avatar, balance, total_earned AS totalEarned, total_spent AS totalSpent, updated_at AS updatedAt FROM coins_wallets WHERE guild_id=? AND (display_name LIKE ? OR username LIKE ? OR user_id=?) ORDER BY balance DESC LIMIT ? OFFSET ?"
    : "SELECT user_id AS userId, username, display_name AS displayName, avatar, balance, total_earned AS totalEarned, total_spent AS totalSpent, updated_at AS updatedAt FROM coins_wallets WHERE guild_id=? ORDER BY balance DESC, user_id ASC LIMIT ? OFFSET ?";
  const binds = needle ? [String(guildId), `%${needle}%`, `%${needle}%`, needle, lim, off] : [String(guildId), lim, off];
  const r = await env.BALTICM_DB.prepare(sql).bind(...binds).all();
  return r.results || [];
}

export async function economyStats(env, guildId, day = dayKey()) {
  const [circulation, wallets, totals, txCount, daily, active] = await Promise.all([
    env.BALTICM_DB.prepare("SELECT COALESCE(SUM(balance),0) AS v FROM coins_wallets WHERE guild_id=?").bind(String(guildId)).first(),
    env.BALTICM_DB.prepare("SELECT COUNT(*) AS n, COUNT(CASE WHEN balance>0 THEN 1 END) AS holders FROM coins_wallets WHERE guild_id=?").bind(String(guildId)).first(),
    env.BALTICM_DB.prepare("SELECT COALESCE(SUM(total_earned),0) AS earned, COALESCE(SUM(total_spent),0) AS spent FROM coins_wallets WHERE guild_id=?").bind(String(guildId)).first(),
    env.BALTICM_DB.prepare("SELECT COUNT(*) AS n FROM coins_transactions WHERE guild_id=?").bind(String(guildId)).first(),
    env.BALTICM_DB.prepare("SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS earned, COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) AS spent FROM coins_transactions WHERE guild_id=? AND created_at LIKE ?").bind(String(guildId), `${day}%`).first(),
    env.BALTICM_DB.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM coins_transactions WHERE guild_id=? AND created_at LIKE ?").bind(String(guildId), `${day}%`).first()
  ]);
  return {
    circulation: Number(circulation?.v || 0),
    wallets: Number(wallets?.n || 0),
    holders: Number(wallets?.holders || 0),
    totalTransactions: Number(txCount?.n || 0),
    totalEarned: Number(totals?.earned || 0),
    totalSpent: Number(totals?.spent || 0),
    earnedToday: Number(daily?.earned || 0),
    spentToday: Number(daily?.spent || 0),
    activeToday: Number(active?.n || 0)
  };
}

/** Earned/spent per day for the overview chart (last `days` days, UTC days). */
export async function economySeries(env, guildId, days = 14) {
  const out = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = dayKey(now - i * 86400000);
    out.push({ day: d, earned: 0, spent: 0 });
  }
  const since = out[0].day;
  const r = await env.BALTICM_DB.prepare(
    "SELECT substr(created_at,1,10) AS day, COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS earned, COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) AS spent FROM coins_transactions WHERE guild_id=? AND created_at>=? GROUP BY day"
  ).bind(String(guildId), `${since}T00:00:00.000Z`).all();
  const byDay = new Map((r.results || []).map((row) => [String(row.day), row]));
  for (const point of out) {
    const hit = byDay.get(point.day);
    if (hit) { point.earned = Number(hit.earned || 0); point.spent = Number(hit.spent || 0); }
  }
  return out;
}
