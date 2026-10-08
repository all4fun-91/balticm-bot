/* BalticM Leveling V1 — D1 storage layer.
   Follows the existing worker conventions: CREATE TABLE IF NOT EXISTS plus
   additive try/catch ALTERs, guild-scoped keys (guild_id + user_id) for
   isolation, and indexes for leaderboard/guild/member lookups. No production
   data is ever dropped or rewritten by a migration. */

import { LEVELING_DEFAULTS, clampXp, levelForXp } from "./leveling.js";

const iso = () => new Date().toISOString();
const dayKey = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);
export { dayKey };

export async function ensureLevelingTables(env) {
  const db = env.BALTICM_DB;
  if (!db) throw new Error("BALTICM_DB binding is not configured");
  // Same idempotent shape the worker/tournaments use for the shared KV table,
  // so guildPremiumActive() can read entitlement rows from a cold database.
  await db.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS leveling_config (guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, message_xp INTEGER NOT NULL DEFAULT 1, voice_xp INTEGER NOT NULL DEFAULT 0, min_xp INTEGER NOT NULL DEFAULT 15, max_xp INTEGER NOT NULL DEFAULT 25, message_cooldown INTEGER NOT NULL DEFAULT 60, voice_xp_amount INTEGER NOT NULL DEFAULT 10, voice_interval INTEGER NOT NULL DEFAULT 60, announce_mode TEXT NOT NULL DEFAULT 'off', announce_channel_id TEXT NOT NULL DEFAULT '', announce_message TEXT NOT NULL DEFAULT '', announce_card TEXT NOT NULL DEFAULT '', ignored_channels TEXT NOT NULL DEFAULT '[]', ignored_roles TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL)"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS leveling_members (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', total_xp INTEGER NOT NULL DEFAULT 0, message_xp INTEGER NOT NULL DEFAULT 0, voice_xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 0, last_message_id TEXT NOT NULL DEFAULT '', last_message_at INTEGER NOT NULL DEFAULT 0, last_message_sig TEXT NOT NULL DEFAULT '', last_sig_at INTEGER NOT NULL DEFAULT 0, last_voice_at INTEGER NOT NULL DEFAULT 0, voice_seen INTEGER NOT NULL DEFAULT 0, rewarded_roles TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL, PRIMARY KEY (guild_id, user_id))"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS leveling_rewards (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, level INTEGER NOT NULL, role_id TEXT NOT NULL, role_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS leveling_daily (guild_id TEXT NOT NULL, day TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, messages INTEGER NOT NULL DEFAULT 0, voice_xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (guild_id, day))"
  ).run();
  // V4 announcement idempotency ledger: one row per (guild, member, level)
  // that was actually announced. Additive — existing databases pick it up on
  // the next request without touching any XP, config or reward data.
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS leveling_announces (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, level INTEGER NOT NULL, announced_at TEXT NOT NULL, PRIMARY KEY (guild_id, user_id, level))"
  ).run();
  // Additive-only upgrades for databases created before a column existed.
  for (const sql of [
    "ALTER TABLE leveling_members ADD COLUMN voice_seen INTEGER NOT NULL DEFAULT 0",
    // V3: the level-up card schema lives beside (never inside) the legacy
    // announce_message column, so existing custom messages are untouched.
    "ALTER TABLE leveling_config ADD COLUMN announce_card TEXT NOT NULL DEFAULT ''"
  ]) {
    try { await db.prepare(sql).run(); } catch { /* column exists */ }
  }
  for (const sql of [
    "CREATE INDEX IF NOT EXISTS idx_leveling_members_board ON leveling_members (guild_id, total_xp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_leveling_members_level ON leveling_members (guild_id, level DESC)",
    "CREATE INDEX IF NOT EXISTS idx_leveling_rewards_guild ON leveling_rewards (guild_id, level)",
    "CREATE INDEX IF NOT EXISTS idx_leveling_daily_day ON leveling_daily (guild_id, day)"
  ]) {
    try { await db.prepare(sql).run(); } catch { /* index exists */ }
  }
}

const parseIds = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } };
const parseRoles = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x.map(String).filter(Boolean) : []; } catch { return []; } };
const parseCard = (v) => { try { const x = JSON.parse(String(v || "")); return x && typeof x === "object" && !Array.isArray(x) ? x : null; } catch { return null; } };

function configFromRow(row) {
  if (!row) return { ...LEVELING_DEFAULTS, ignoredChannels: [], ignoredRoles: [] };
  return {
    enabled: Number(row.enabled) === 1,
    messageXp: Number(row.message_xp) === 1,
    voiceXp: Number(row.voice_xp) === 1,
    minXp: Number(row.min_xp),
    maxXp: Number(row.max_xp),
    messageCooldown: Number(row.message_cooldown),
    voiceXpAmount: Number(row.voice_xp_amount),
    voiceInterval: Number(row.voice_interval),
    announceMode: String(row.announce_mode || "off"),
    announceChannelId: String(row.announce_channel_id || ""),
    announceMessage: String(row.announce_message || ""),
    announceCard: parseCard(row.announce_card),
    ignoredChannels: parseIds(row.ignored_channels),
    ignoredRoles: parseIds(row.ignored_roles)
  };
}

export async function getLevelingConfig(env, guildId) {
  const row = await env.BALTICM_DB.prepare("SELECT * FROM leveling_config WHERE guild_id=?").bind(String(guildId)).first();
  return { exists: !!row, settings: configFromRow(row) };
}

export async function saveLevelingConfig(env, guildId, s) {
  const now = iso();
  await env.BALTICM_DB.prepare(
    "INSERT INTO leveling_config (guild_id, enabled, message_xp, voice_xp, min_xp, max_xp, message_cooldown, voice_xp_amount, voice_interval, announce_mode, announce_channel_id, announce_message, announce_card, ignored_channels, ignored_roles, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET enabled=excluded.enabled,message_xp=excluded.message_xp,voice_xp=excluded.voice_xp,min_xp=excluded.min_xp,max_xp=excluded.max_xp,message_cooldown=excluded.message_cooldown,voice_xp_amount=excluded.voice_xp_amount,voice_interval=excluded.voice_interval,announce_mode=excluded.announce_mode,announce_channel_id=excluded.announce_channel_id,announce_message=excluded.announce_message,announce_card=excluded.announce_card,ignored_channels=excluded.ignored_channels,ignored_roles=excluded.ignored_roles,updated_at=excluded.updated_at"
  ).bind(
    String(guildId), s.enabled ? 1 : 0, s.messageXp ? 1 : 0, s.voiceXp ? 1 : 0,
    s.minXp, s.maxXp, s.messageCooldown, s.voiceXpAmount, s.voiceInterval,
    s.announceMode, s.announceChannelId, s.announceMessage,
    s.announceCard ? JSON.stringify(s.announceCard) : "",
    JSON.stringify(s.ignoredChannels), JSON.stringify(s.ignoredRoles), now
  ).run();
}

const MEMBER_FIELDS = "guild_id AS guildId, user_id AS userId, username, display_name AS displayName, avatar, total_xp AS totalXp, message_xp AS messageXp, voice_xp AS voiceXp, level, last_message_id AS lastMessageId, last_message_at AS lastMessageAt, last_message_sig AS lastMessageSig, last_sig_at AS lastSigAt, last_voice_at AS lastVoiceAt, voice_seen AS voiceSeen, rewarded_roles AS rewardedRoles, updated_at AS updatedAt";

export async function getLevelingMember(env, guildId, userId) {
  const row = await env.BALTICM_DB.prepare(`SELECT ${MEMBER_FIELDS} FROM leveling_members WHERE guild_id=? AND user_id=?`)
    .bind(String(guildId), String(userId)).first();
  if (row) row.rewardedRoles = parseRoles(row.rewardedRoles);
  return row || null;
}

/** Create the row when it does not exist yet (idempotent). */
export async function ensureLevelingMember(env, guildId, userId) {
  await env.BALTICM_DB.prepare(
    "INSERT OR IGNORE INTO leveling_members (guild_id, user_id, username, display_name, avatar, total_xp, message_xp, voice_xp, level, last_message_id, last_message_at, last_message_sig, last_sig_at, last_voice_at, voice_seen, rewarded_roles, updated_at) VALUES (?,?,?,?,?,0,0,0,0,'',0,'',0,0,0,'[]',?)"
  ).bind(String(guildId), String(userId), "", "", "", iso()).run();
}

/**
 * Guarded message award: the WHERE clause enforces the per-member cooldown
 * and message-id replay protection atomically in the database, so duplicate
 * Discord events or replayed service requests can never double-award.
 */
export async function applyMessageAward(env, { guildId, userId, meta, amount, now, cooldownMs, messageId, sig, spamWindowMs }) {
  const total = clampXp((meta.totalXp || 0) + amount);
  const level = levelForXp(total);
  const r = await env.BALTICM_DB.prepare(
    "UPDATE leveling_members SET username=?, display_name=?, avatar=?, message_xp=message_xp+?, total_xp=?, level=?, last_message_id=?, last_message_at=?, last_message_sig=?, last_sig_at=?, updated_at=? WHERE guild_id=? AND user_id=? AND last_message_at <= ? AND last_message_id <> ? AND NOT (last_message_sig = ? AND last_message_sig <> '' AND last_sig_at > ?)"
  ).bind(
    String(meta.username || ""), String(meta.displayName || ""), String(meta.avatar || ""),
    amount, total, level, String(messageId || ""), now, String(sig || ""), now, iso(),
    String(guildId), String(userId), now - cooldownMs, String(messageId || ""), String(sig || ""), now - spamWindowMs
  ).run();
  return { changed: Number(r.meta?.changes || 0) > 0, total, level };
}

/** Guarded voice award: interval enforced in SQL (restart/replay safe). */
export async function applyVoiceAward(env, { guildId, userId, meta, amount, now, intervalMs }) {
  const total = clampXp((meta.totalXp || 0) + amount);
  const level = levelForXp(total);
  const r = await env.BALTICM_DB.prepare(
    "UPDATE leveling_members SET username=?, display_name=?, avatar=?, voice_xp=voice_xp+?, total_xp=?, level=?, last_voice_at=?, updated_at=? WHERE guild_id=? AND user_id=? AND last_voice_at < ?"
  ).bind(
    String(meta.username || ""), String(meta.displayName || ""), String(meta.avatar || ""),
    amount, total, level, now, iso(), String(guildId), String(userId), now - intervalMs
  ).run();
  return { changed: Number(r.meta?.changes || 0) > 0, total, level };
}

/** Present in the current voice snapshot: start/restart the participation clock without awarding. */
export async function markVoiceSeen(env, guildId, userId, now) {
  await env.BALTICM_DB.prepare(
    "UPDATE leveling_members SET voice_seen=1, last_voice_at=?, updated_at=? WHERE guild_id=? AND user_id=? AND voice_seen=0"
  ).bind(now, iso(), String(guildId), String(userId)).run();
}

/** Not in the snapshot (left voice / ineligible): reset so rejoining restarts the clock. */
export async function clearVoiceSeen(env, guildId, userIds) {
  for (const userId of userIds) {
    await env.BALTICM_DB.prepare(
      "UPDATE leveling_members SET voice_seen=0, last_voice_at=0, updated_at=? WHERE guild_id=? AND user_id=?"
    ).bind(iso(), String(guildId), String(userId)).run();
  }
}

export async function listVoiceSeen(env, guildId) {
  const r = await env.BALTICM_DB.prepare("SELECT user_id AS userId FROM leveling_members WHERE guild_id=? AND voice_seen=1")
    .bind(String(guildId)).all();
  return (r.results || []).map((x) => String(x.userId));
}

/* ------------------------------------------------ V4 announcement ledger --
   A level crossing is announced at most ONCE per (guild, member, level).
   The claim is taken atomically BEFORE the Discord send, so two concurrent
   events (or a replayed one) can never double-post; a FAILED send releases
   the claim so the next crossing of that level can retry. Claiming is
   guild-scoped, so one server's ledger can never suppress another's. */

export async function claimAnnouncement(env, guildId, userId, level) {
  const r = await env.BALTICM_DB.prepare(
    "INSERT OR IGNORE INTO leveling_announces (guild_id, user_id, level, announced_at) VALUES (?,?,?,?)"
  ).bind(String(guildId), String(userId), Math.max(1, Math.floor(Number(level) || 1)), iso()).run();
  return Number(r.meta?.changes || 0) > 0;
}

export async function releaseAnnouncement(env, guildId, userId, level) {
  const r = await env.BALTICM_DB.prepare("DELETE FROM leveling_announces WHERE guild_id=? AND user_id=? AND level=?")
    .bind(String(guildId), String(userId), Math.max(1, Math.floor(Number(level) || 1))).run();
  return Number(r.meta?.changes || 0) > 0;
}

export async function bumpDaily(env, guildId, { xp = 0, messages = 0, voiceXp = 0 }, day = dayKey()) {
  if (!xp && !messages && !voiceXp) return;
  await env.BALTICM_DB.prepare(
    "INSERT INTO leveling_daily (guild_id, day, xp, messages, voice_xp) VALUES (?,?,?,?,?) ON CONFLICT(guild_id,day) DO UPDATE SET xp=xp+excluded.xp,messages=messages+excluded.messages,voice_xp=voice_xp+excluded.voice_xp"
  ).bind(String(guildId), day, xp, messages, voiceXp).run();
}

export async function dailyTotals(env, guildId, day = dayKey()) {
  const row = await env.BALTICM_DB.prepare("SELECT xp, messages, voice_xp AS voiceXp FROM leveling_daily WHERE guild_id=? AND day=?")
    .bind(String(guildId), day).first();
  return { xp: Number(row?.xp || 0), messages: Number(row?.messages || 0), voiceXp: Number(row?.voiceXp || 0) };
}

export async function overviewStats(env, guildId) {
  const [members, top, daily] = await Promise.all([
    env.BALTICM_DB.prepare("SELECT COUNT(*) AS n FROM leveling_members WHERE guild_id=? AND total_xp>0").bind(String(guildId)).first(),
    env.BALTICM_DB.prepare("SELECT user_id AS userId, username, display_name AS displayName, avatar, level, total_xp AS totalXp FROM leveling_members WHERE guild_id=? ORDER BY level DESC, total_xp DESC LIMIT 1").bind(String(guildId)).first(),
    dailyTotals(env, guildId)
  ]);
  return { membersWithXp: Number(members?.n || 0), topMember: top || null, today: daily };
}

const like = (q) => `%${String(q || "").replace(/[%_]/g, " ").trim().slice(0, 40)}%`;

export async function leaderboard(env, guildId, { q = "", limit = 50 } = {}) {
  const needle = String(q || "").trim();
  const sql = needle
    ? `SELECT ${MEMBER_FIELDS} FROM leveling_members WHERE guild_id=? AND (display_name LIKE ? OR username LIKE ?) ORDER BY total_xp DESC, level DESC, user_id ASC LIMIT ?`
    : `SELECT ${MEMBER_FIELDS} FROM leveling_members WHERE guild_id=? ORDER BY total_xp DESC, level DESC, user_id ASC LIMIT ?`;
  const bind = needle ? [String(guildId), like(needle), like(needle), Math.max(1, Math.min(200, limit))] : [String(guildId), Math.max(1, Math.min(200, limit))];
  const r = await env.BALTICM_DB.prepare(sql).bind(...bind).all();
  return (r.results || []).map((row) => ({ ...row, rewardedRoles: parseRoles(row.rewardedRoles) }));
}

/** 1-based leaderboard position; ties share a rank. */
export async function rankOf(env, guildId, totalXp) {
  const row = await env.BALTICM_DB.prepare("SELECT COUNT(*) AS n FROM leveling_members WHERE guild_id=? AND total_xp > ?")
    .bind(String(guildId), clampXp(totalXp)).first();
  return Number(row?.n || 0) + 1;
}

export async function countMembers(env, guildId) {
  const row = await env.BALTICM_DB.prepare("SELECT COUNT(*) AS n FROM leveling_members WHERE guild_id=?").bind(String(guildId)).first();
  return Number(row?.n || 0);
}

/* ------------------------------------------------------------- rewards */

export async function listRewards(env, guildId) {
  const r = await env.BALTICM_DB.prepare("SELECT id, level, role_id AS roleId, role_name AS roleName, created_at AS createdAt FROM leveling_rewards WHERE guild_id=? ORDER BY level ASC, created_at ASC")
    .bind(String(guildId)).all();
  return r.results || [];
}

export async function countRewards(env, guildId) {
  const row = await env.BALTICM_DB.prepare("SELECT COUNT(*) AS n FROM leveling_rewards WHERE guild_id=?").bind(String(guildId)).first();
  return Number(row?.n || 0);
}

export async function addReward(env, guildId, { level, roleId, roleName = "" }) {
  const id = globalThis.crypto.randomUUID();
  await env.BALTICM_DB.prepare("INSERT INTO leveling_rewards (id, guild_id, level, role_id, role_name, created_at) VALUES (?,?,?,?,?,?)")
    .bind(id, String(guildId), level, String(roleId), String(roleName).slice(0, 80), iso()).run();
  return id;
}

export async function deleteReward(env, guildId, id) {
  const r = await env.BALTICM_DB.prepare("DELETE FROM leveling_rewards WHERE id=? AND guild_id=?").bind(String(id), String(guildId)).run();
  return Number(r.meta?.changes || 0) > 0;
}

/** In-place edit of a configured reward (same row — never a delete+insert,
    so a failed validation can never lose the previous mapping). */
export async function updateReward(env, guildId, id, { level, roleId, roleName = "" }) {
  const r = await env.BALTICM_DB.prepare("UPDATE leveling_rewards SET level=?, role_id=?, role_name=? WHERE id=? AND guild_id=?")
    .bind(level, String(roleId), String(roleName).slice(0, 80), String(id), String(guildId)).run();
  return Number(r.meta?.changes || 0) > 0;
}

/** Persist which reward roles were already granted (idempotency ledger). */
export async function appendRewardedRoles(env, guildId, userId, roleIds) {
  const row = await getLevelingMember(env, guildId, userId);
  if (!row) return [];
  const merged = [...new Set([...(row.rewardedRoles || []), ...roleIds.map(String)])].slice(0, 200);
  await env.BALTICM_DB.prepare("UPDATE leveling_members SET rewarded_roles=?, updated_at=? WHERE guild_id=? AND user_id=?")
    .bind(JSON.stringify(merged), iso(), String(guildId), String(userId)).run();
  return merged;
}

/** Direct total-XP write used by admin add/remove/set/reset (level derived safely). */
export async function setMemberTotals(env, guildId, userId, totals) {
  const totalXp = clampXp(totals.totalXp);
  const messageXp = clampXp(totals.messageXp);
  const voiceXp = clampXp(totals.voiceXp);
  await ensureLevelingMember(env, guildId, userId);
  await env.BALTICM_DB.prepare(
    "UPDATE leveling_members SET total_xp=?, message_xp=?, voice_xp=?, level=?, updated_at=? WHERE guild_id=? AND user_id=?"
  ).bind(totalXp, messageXp, voiceXp, levelForXp(totalXp), iso(), String(guildId), String(userId)).run();
}

export async function setMemberIdentity(env, guildId, userId, meta) {
  await ensureLevelingMember(env, guildId, userId);
  await env.BALTICM_DB.prepare("UPDATE leveling_members SET username=?, display_name=?, avatar=?, updated_at=? WHERE guild_id=? AND user_id=?")
    .bind(String(meta.username || ""), String(meta.displayName || ""), String(meta.avatar || ""), iso(), String(guildId), String(userId)).run();
}
