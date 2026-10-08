/* BalticM Leveling V1 — API handlers, XP award pipeline and Discord
   interaction responses. Runs inside the Cloudflare worker; imports only the
   pure helpers (leveling.js), storage (leveling-db.js) and the existing
   Premium entitlement source (guildPremiumActive) — never worker.js itself,
   so there are no import cycles. Guild membership is re-checked per handler
   (defence in depth beside the router's RBAC gate); every query is
   guild-scoped so Guild A can never read or write Guild B's leveling data. */

import {
  ALLOWED_ANNOUNCE_PLACEHOLDERS,
  ANNOUNCE_MODES,
  DEFAULT_ANNOUNCE_MESSAGE,
  FREE_REWARD_ROLE_LIMIT,
  LEVELING_DEFAULTS,
  LEADERBOARD_COMMAND_DEFINITION,
  MESSAGE_SPAM_WINDOW_MS,
  RANK_COMMAND_DEFINITION,
  clampXp,
  isSnowflake,
  levelProgress,
  levelForXp,
  levelUpEmbed,
  messageSignature,
  parseLevelingSettings,
  parseReward,
  parseXpAction,
  renderAnnounceMessage,
  renderLevelUpCard,
  rewardLimitBlocked
} from "./leveling.js";
import {
  addReward,
  appendRewardedRoles,
  applyMessageAward,
  applyVoiceAward,
  bumpDaily,
  claimAnnouncement,
  clearVoiceSeen,
  countMembers,
  countRewards,
  dailyTotals,
  deleteReward,
  ensureLevelingMember,
  ensureLevelingTables,
  getLevelingConfig,
  getLevelingMember,
  leaderboard,
  listRewards,
  listVoiceSeen,
  markVoiceSeen,
  overviewStats,
  rankOf,
  releaseAnnouncement,
  saveLevelingConfig,
  setMemberIdentity,
  setMemberTotals,
  updateReward
} from "./leveling-db.js";
import { guildPremiumActive } from "./tournaments-db.js";
import { getCoinsConfig } from "./coins-db.js";
import { processCoinsMessage, processCoinsVoice } from "./coins-api.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const botHeaders = (env) => ({ Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Network errors, rate limits and 5xx deserve one automatic retry — a
    transient Discord hiccup must never surface as a validation failure. */
const transientStatus = (s) => s === 0 || s === 408 || s === 429 || s >= 500;

async function discordJson(env, url, init = {}, { retries = 1 } = {}) {
  if (!env.DISCORD_BOT_TOKEN) return { ok: false, status: 0, data: null, noToken: true };
  let last = { ok: false, status: 0, data: null };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(350);
    try {
      const r = await fetch(url, {
        ...init,
        headers: { ...botHeaders(env), ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) }
      });
      let data = null;
      try { data = await r.json(); } catch { /* empty body */ }
      last = { ok: r.ok, status: r.status, data, noToken: false };
      if (r.ok || !transientStatus(r.status)) return last;
    } catch {
      last = { ok: false, status: 0, data: null, noToken: false };
    }
  }
  return last;
}

/** Turn a failed Discord lookup into a specific, actionable message instead
    of a generic "could not verify" dead end. */
function describeDiscordFailure(status, what, noToken = false) {
  if (noToken) return "The bot token (DISCORD_BOT_TOKEN) is not configured for this worker.";
  const s = Number(status) || 0;
  if (s === 0) return `Discord could not be reached while checking ${what} (network error). Please try again.`;
  if (s === 401) return `Discord rejected the bot's credentials while checking ${what}. Reconnect the bot and try again.`;
  if (s === 403) return `Discord denied access while checking ${what} — the bot may have left this server or lost access.`;
  if (s === 404) return `Discord could not find ${what} — the bot may have left this server.`;
  if (s === 429) return `Discord is rate limiting requests while checking ${what}. Wait a few seconds and try again.`;
  if (s >= 500) return `Discord had a server problem while checking ${what} (HTTP ${s}). Please try again.`;
  return `Could not verify ${what} (Discord HTTP ${s}). Please try again.`;
}

/** Re-checked in every handler: the session user must be a member of the guild. */
function manageable(user, guildId) {
  return !!(user && Array.isArray(user.guilds) && user.guilds.some((g) => String(g.id) === String(guildId)));
}

const guildChannelCache = new Map(); // guildId -> {at, ids:Set}
const guildRoleCache = new Map(); // guildId -> {at, roles}
const guildNameCache = new Map(); // guildId -> {at, value:{name,icon}}
const botCapabilityCache = new Map(); // guildId -> {at, value}
const TTL = (map, id, ms) => {
  const hit = map.get(id);
  return hit && Date.now() - hit.at < ms ? hit.value : null;
};

async function guildRoleListFull(env, guildId) {
  const cached = TTL(guildRoleCache, guildId, 60000);
  if (cached) return { ok: true, roles: cached, status: 200 };
  const r = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/roles`);
  const roles = r.ok && Array.isArray(r.data) ? r.data : null;
  if (roles) guildRoleCache.set(guildId, { at: Date.now(), value: roles });
  return { ok: !!roles, roles, status: r.status, noToken: !!r.noToken };
}

async function guildRoleList(env, guildId) {
  return (await guildRoleListFull(env, guildId)).roles;
}

async function guildChannelIds(env, guildId) {
  const cached = TTL(guildChannelCache, guildId, 60000);
  if (cached) return cached;
  const r = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/channels`);
  const ids = r.ok && Array.isArray(r.data) ? new Set(r.data.map((c) => String(c.id))) : null;
  if (ids) guildChannelCache.set(guildId, { at: Date.now(), value: ids });
  return ids;
}

async function guildMeta(env, guildId) {
  const cached = TTL(guildNameCache, guildId, 300000);
  if (cached) return cached;
  const r = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}`);
  const value = {
    name: r.ok && r.data?.name ? String(r.data.name) : "this server",
    icon: r.ok && r.data?.icon ? String(r.data.icon) : ""
  };
  guildNameCache.set(guildId, { at: Date.now(), value });
  return value;
}

async function guildName(env, guildId) {
  return (await guildMeta(env, guildId)).name;
}

/** Server icon CDN URL for the card footer (null when the guild has none). */
async function guildIconUrl(env, guildId) {
  const icon = (await guildMeta(env, guildId)).icon;
  return icon ? `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128` : null;
}

const MANAGE_ROLES = 1n << 25n;
const ADMINISTRATOR = 1n << 3n;

// The bot's user id — same constant as worker.js (CLIENT_ID). Discord often
// returns 400 for GET members/@me (worker.js has hit this before: "Discord
// often returns 400 for members/@me on GET"), which used to poison the whole
// capability check and surface as the misleading "Could not verify the role"
// error. Resolve the bot's member by its explicit user id FIRST, @me second.
const BOT_CLIENT_ID = "1543137268221354035";

async function botMemberRoles(env, guildId) {
  const byId = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${BOT_CLIENT_ID}`);
  if (byId.ok) return { ok: true, roles: Array.isArray(byId.data?.roles) ? byId.data.roles : [], status: 200 };
  const byMe = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/@me`);
  if (byMe.ok) return { ok: true, roles: Array.isArray(byMe.data?.roles) ? byMe.data.roles : [], status: 200 };
  return { ok: false, status: byMe.status || byId.status, noToken: !!(byId.noToken || byMe.noToken) };
}

/** Bot's Manage Roles permission + top-role position, for reward validation.
    When a lookup fails the exact cause is reported (`failureWhat` /
    `failureStatus`) so callers can answer with something actionable. */
async function botCapability(env, guildId) {
  const cached = TTL(botCapabilityCache, guildId, 30000);
  if (cached) return cached;
  const [guildRes, memberRes, roleList] = await Promise.all([
    discordJson(env, `https://discord.com/api/v10/guilds/${guildId}`),
    botMemberRoles(env, guildId),
    guildRoleListFull(env, guildId)
  ]);
  if (!guildRes.ok || !memberRes.ok || !roleList.ok) {
    const noToken = !!(guildRes.noToken || memberRes.noToken || roleList.noToken);
    const what = !guildRes.ok ? "this server" : !memberRes.ok ? "the bot's membership of this server" : "this server's role list";
    const status = !guildRes.ok ? guildRes.status : !memberRes.ok ? memberRes.status : roleList.status;
    return { ready: false, noToken, failureWhat: what, failureStatus: status };
  }
  const roles = roleList.roles;
  const mine = new Set(memberRes.roles.map(String));
  let manageRoles = false;
  try {
    const given = BigInt(guildRes.data.permissions || "0");
    manageRoles = (given & MANAGE_ROLES) === MANAGE_ROLES || (given & ADMINISTRATOR) === ADMINISTRATOR;
  } catch { manageRoles = false; }
  if (!manageRoles) {
    // Discord omits Guild.permissions for some bot tokens — derive the truth
    // from the roles the bot actually wears (@everyone OR its role grants,
    // Administrator implies everything). Role permissions are ground truth, so
    // a bot that truly lacks Manage Roles still fails with the actionable error.
    try {
      let effective = 0n;
      for (const role of roles) {
        const id = String(role.id);
        if (id === String(guildId) || mine.has(id)) effective |= BigInt(role.permissions || "0");
      }
      manageRoles = (effective & MANAGE_ROLES) === MANAGE_ROLES || (effective & ADMINISTRATOR) === ADMINISTRATOR;
    } catch { /* keep false → the actionable error below is still correct */ }
  }
  let topPosition = -1;
  for (const role of roles) if (mine.has(String(role.id))) topPosition = Math.max(topPosition, Number(role.position) || 0);
  const value = { ready: true, manageRoles, topPosition, roles };
  botCapabilityCache.set(guildId, { at: Date.now(), value });
  return value;
}

/** Shared reward validation for add AND update: Discord must know the role,
    it must be assignable (not managed, bot has Manage Roles, bot's top role
    sits above it), and the level/role mapping must not already exist. */
async function validateRewardTarget(env, guildId, { level, roleId }, { excludeId = null } = {}) {
  const cap = await botCapability(env, guildId);
  if (!cap.ready) {
    // Distinguish "the role is fine, Discord just blinked" from "no such role"
    // by probing the single-role endpoint before answering.
    const probe = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`);
    const base = describeDiscordFailure(cap.failureStatus, cap.failureWhat, cap.noToken);
    if (probe.status === 404) return { error: "That role no longer exists in this server.", status: 400 };
    if (probe.ok) return { error: `${base} The role itself looks valid — this is a temporary verification problem and nothing was changed.`, status: 502, code: "role_verification_failed" };
    return { error: base, status: 502, code: "role_verification_failed" };
  }
  const role = cap.roles.find((r) => String(r.id) === String(roleId));
  if (!role) return { error: "That role no longer exists in this server.", status: 400 };
  if (role.managed || String(role.id) === String(guildId)) return { error: "That role cannot be assigned automatically (managed/integration role).", status: 400 };
  if (!cap.manageRoles) return { error: "The bot needs the Manage Roles permission to grant reward roles. Enable it in Server Settings → Roles, above the reward role.", status: 400 };
  if (!((Number(role.position) || 0) < cap.topPosition)) {
    return { error: "Move the bot's top role above the reward role in your server settings (role hierarchy).", status: 400 };
  }
  const rows = (await listRewards(env, guildId)).filter((r) => String(r.id) !== String(excludeId || ""));
  const sameLevel = rows.find((r) => Number(r.level) === Number(level));
  if (sameLevel && String(sameLevel.roleId) === String(roleId)) return { error: "That reward is already configured.", status: 400 };
  if (sameLevel) return { error: `Level ${level} already awards @${sameLevel.roleName || sameLevel.roleId} — remove that reward first.`, status: 400 };
  const sameRole = rows.find((r) => String(r.roleId) === String(roleId));
  if (sameRole) return { error: `That role is already the reward for Level ${sameRole.level} — each role can only be used once.`, status: 400 };
  return { role };
}

function avatarUrl(userId, avatar) {
  return avatar ? `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=64` : null;
}

/* ------------------------------------------------------------- settings */

export async function levelingOverview(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureLevelingTables(env);
  const [premium, cfg, stats, rewards, total] = await Promise.all([
    guildPremiumActive(env, guildId),
    getLevelingConfig(env, guildId),
    overviewStats(env, guildId),
    listRewards(env, guildId),
    countMembers(env, guildId)
  ]);
  return json({
    settings: cfg.settings,
    configured: cfg.exists,
    premium: !!premium,
    freeRewardLimit: FREE_REWARD_ROLE_LIMIT,
    rewards,
    totalMembers: total,
    stats: {
      membersWithXp: stats.membersWithXp,
      xpToday: stats.today.xp,
      messagesToday: stats.today.messages,
      voiceXpToday: stats.today.voiceXp,
      topMember: stats.topMember
        ? {
            displayName: stats.topMember.displayName || stats.topMember.username || "Member",
            username: stats.topMember.username || "",
            avatar: avatarUrl(stats.topMember.userId, stats.topMember.avatar),
            level: Number(stats.topMember.level || 0),
            totalXp: Number(stats.topMember.totalXp || 0)
          }
        : null
    }
  });
}

export async function saveLevelingSettings(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureLevelingTables(env);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const premium = !!(await guildPremiumActive(env, guildId));
  const parsed = parseLevelingSettings(body, { premium });
  if (!parsed.ok) {
    if (parsed.premiumRequired) {
      return json(
        {
          error: "Voice XP, ignored roles/channels and custom level-up messages or cards require an active Premium subscription for this server.",
          code: "premium_required",
          features: parsed.premiumRequired
        },
        403
      );
    }
    return json({ error: parsed.error }, 400);
  }
  const s = parsed.value;
  // Cross-guild IDOR: every referenced channel/role must exist in THIS guild.
  if (s.announceMode === "channel" || s.ignoredChannels.length) {
    const ids = await guildChannelIds(env, guildId);
    if (!ids) return json({ error: "Could not verify the selected channels. Please try again." }, 502);
    const bad = [s.announceChannelId, ...s.ignoredChannels].filter((id) => id && !ids.has(String(id)));
    if (bad.length) return json({ error: "One of the selected channels does not belong to this server." }, 400);
  }
  // V4: the bot must actually be able to SEND into the chosen announcement
  // channel (View Channel + Send Messages + Embed Links). Only a DEFINITIVE
  // answer blocks the save — transient Discord problems never lock the page.
  if (s.announceMode === "channel") {
    const cap = await channelSendCapability(env, guildId, s.announceChannelId);
    if (cap.blocked) return json({ error: cap.blocked }, 400);
  }
  if (s.ignoredRoles.length) {
    const roles = await guildRoleList(env, guildId);
    if (!roles) return json({ error: "Could not verify the selected roles. Please try again." }, 502);
    const known = new Set(roles.map((r) => String(r.id)));
    if (s.ignoredRoles.some((id) => !known.has(String(id)))) {
      return json({ error: "One of the selected roles does not belong to this server." }, 400);
    }
  }
  await saveLevelingConfig(env, guildId, s);
  return json({ ok: true, settings: s, premium });
}

/* ------------------------------------------------------------ leaderboard */

export async function levelingBoard(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureLevelingTables(env);
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").slice(0, 40);
  const rows = await leaderboard(env, guildId, { q, limit: 50 });
  const total = await countMembers(env, guildId);
  return json({
    q,
    totalMembers: total,
    entries: rows.map((r, i) => ({
      position: i + 1,
      userId: r.userId,
      displayName: r.displayName || r.username || "Member",
      username: r.username || "",
      avatar: avatarUrl(r.userId, r.avatar),
      level: Number(r.level || 0),
      totalXp: Number(r.totalXp || 0),
      messageXp: Number(r.messageXp || 0),
      voiceXp: Number(r.voiceXp || 0)
    }))
  });
}

/* --------------------------------------------------- admin XP management */

export async function levelingXpAction(req, env, user, guildId, { onAudit } = {}) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureLevelingTables(env);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = parseXpAction(body);
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, parsed.code ? 400 : 400);
  const { action, userId, amount, reason, targetName } = parsed.value;

  // Never trust member ids from the browser: the target must be in THIS guild.
  const memberRes = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`);
  if (memberRes.status === 404) return json({ error: "That member is not in this server." }, 404);
  if (!memberRes.ok) return json({ error: "Could not verify the member. Please try again." }, 502);
  const dm = memberRes.data || {};
  const identity = {
    username: String(dm.user?.username || "").slice(0, 80),
    displayName: String(dm.nick || dm.user?.global_name || dm.user?.username || targetName || userId).slice(0, 80),
    avatar: dm.user?.avatar || ""
  };

  const before = await getLevelingMember(env, guildId, userId);
  const prevTotal = clampXp(before?.totalXp || 0);
  const prevMessage = clampXp(before?.messageXp || 0);
  const prevVoice = clampXp(before?.voiceXp || 0);
  let nextTotal = prevTotal,
    nextMessage = prevMessage,
    nextVoice = prevVoice;
  if (action === "add") nextTotal = clampXp(prevTotal + amount);
  else if (action === "remove") nextTotal = clampXp(Math.max(0, prevTotal - amount));
  else if (action === "set") nextTotal = clampXp(amount);
  else if (action === "reset") { nextTotal = 0; nextMessage = 0; nextVoice = 0; }
  if (action !== "reset") {
    nextMessage = Math.min(prevMessage, nextTotal);
    nextVoice = Math.min(prevVoice, Math.max(0, nextTotal - nextMessage));
  }

  await setMemberIdentity(env, guildId, userId, identity);
  await setMemberTotals(env, guildId, userId, { totalXp: nextTotal, messageXp: nextMessage, voiceXp: nextVoice });
  const newLevel = levelForXp(nextTotal);
  const oldLevel = levelForXp(prevTotal);

  // Raising XP may unlock reward roles — grant idempotently (never removes).
  let granted = [];
  if (newLevel > oldLevel) {
    const row = await getLevelingMember(env, guildId, userId);
    granted = await grantEligibleRewards(env, guildId, row);
  }

  // ADMIN XP ANNOUNCEMENT POLICY (V4): add/set that crosses to a NEW level
  // announces through the same dispatcher as automatic XP — once per level
  // (ledger), target = this guild's configured channel only, branded by the
  // real entitlement. remove/reset (level decreases or unchanged) NEVER
  // announces, and a Discord failure can never fail the admin action.
  let announced = false;
  if (newLevel > oldLevel && (action === "add" || action === "set")) {
    try {
      const { settings } = await getLevelingConfig(env, guildId);
      announced = await announceLevelUp(env, guildId, settings, {
        userId,
        username: identity.username,
        displayName: identity.displayName,
        level: newLevel,
        channelId: "",
        avatar: avatarUrl(userId, identity.avatar || ""),
        source: "admin"
      });
    } catch { /* announcing must never fail the XP action */ }
  }

  const labels = { add: "Leveling: add XP", remove: "Leveling: remove XP", set: "Leveling: set XP", reset: "Leveling: reset XP" };
  try {
    onAudit?.({
      actorId: String(user?.id || ""),
      actorName: String(user?.global_name || user?.username || ""),
      action: labels[action],
      target: identity.displayName || userId,
      source: "BALTICM",
      details: `previous XP: ${prevTotal} → new XP: ${nextTotal}${reason ? ` — ${reason}` : ""}`
    });
  } catch { /* audit must never break the action */ }

  return json({
    ok: true,
    action,
    userId,
    targetName: identity.displayName,
    previousXp: prevTotal,
    newXp: nextTotal,
    level: newLevel,
    rewarded: granted,
    announced
  });
}

/* ----------------------------------------------------------- reward roles */

export async function levelingRewardAdd(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureLevelingTables(env);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = parseReward(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const premium = !!(await guildPremiumActive(env, guildId));
  const count = await countRewards(env, guildId);
  if (rewardLimitBlocked(count, premium)) {
    return json(
      { error: `Free servers can configure up to ${FREE_REWARD_ROLE_LIMIT} reward roles. Premium unlocks unlimited reward roles.`, code: "premium_required" },
      403
    );
  }
  const check = await validateRewardTarget(env, guildId, parsed.value, { excludeId: null });
  if (check.error) return json({ error: check.error, ...(check.code ? { code: check.code } : {}) }, check.status);
  const role = check.role;
  const id = await addReward(env, guildId, { ...parsed.value, roleName: role.name || "" });
  return json({ ok: true, reward: { id, level: parsed.value.level, roleId: parsed.value.roleId, roleName: role.name || "" } }, 201);
}

export async function levelingRewardUpdate(req, env, user, guildId, id) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureLevelingTables(env);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = parseReward(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const row = (await listRewards(env, guildId)).find((r) => String(r.id) === String(id));
  if (!row) return json({ error: "Reward not found" }, 404);
  // Updating never consumes a Free-tier slot (count is unchanged) and never
  // re-validates against itself — same Discord rules as adding.
  const check = await validateRewardTarget(env, guildId, parsed.value, { excludeId: id });
  if (check.error) return json({ error: check.error, ...(check.code ? { code: check.code } : {}) }, check.status);
  const updated = await updateReward(env, guildId, id, { ...parsed.value, roleName: check.role.name || "" });
  if (!updated) return json({ error: "Reward not found" }, 404);
  return json({ ok: true, reward: { id: String(id), level: parsed.value.level, roleId: parsed.value.roleId, roleName: check.role.name || "" } });
}

export async function levelingRewardDelete(req, env, user, guildId, id) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureLevelingTables(env);
  const removed = await deleteReward(env, guildId, id);
  if (!removed) return json({ error: "Reward not found" }, 404);
  // Only the configuration row is removed — granted Discord roles are never
  // touched (unrelated roles must not be removed by this system).
  return json({ ok: true });
}

/**
 * Grant every configured reward role at or below the member's level that is
 * not already in the persisted ledger. Idempotent: a restart or a repeated
 * level event never re-assigns or re-logs the same reward, and nothing is
 * ever removed.
 */
export async function grantEligibleRewards(env, guildId, member) {
  if (!member) return [];
  const rewards = await listRewards(env, guildId);
  const ledger = new Set(member.rewardedRoles || []);
  const eligible = rewards.filter((r) => Number(r.level) <= Number(member.level || 0) && !ledger.has(String(r.roleId)));
  if (!eligible.length) return [];
  const cap = await botCapability(env, guildId);
  if (!cap.ready || !cap.manageRoles) return [];
  const granted = [];
  for (const reward of eligible) {
    const role = cap.roles.find((r) => String(r.id) === String(reward.roleId));
    if (!role || role.managed || String(role.id) === String(guildId)) continue;
    if (!((Number(role.position) || 0) < cap.topPosition)) continue;
    const res = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${member.userId}/roles/${reward.roleId}`, { method: "PUT" });
    if (res.ok || res.status === 204 || res.status === 403 || res.status === 400) {
      if (res.ok || res.status === 204) granted.push(String(reward.roleId));
    }
  }
  if (granted.length) await appendRewardedRoles(env, guildId, member.userId, granted);
  return granted;
}

/* -------------------------------------------------- service endpoints ----
   Called only by the BalticM gateway services (X-BalticM-Service-Secret is
   verified by the worker router before these handlers run). */

export async function levelingServiceState(env, guildId) {
  if (!isSnowflake(guildId)) return json({ error: "guildId is required" }, 400);
  await ensureLevelingTables(env);
  const [premium, cfg, coinsCfg] = await Promise.all([
    guildPremiumActive(env, guildId),
    getLevelingConfig(env, guildId),
    // The coins tables are created by the coins module's own handlers; a
    // deployment (or guild) that has never used Baltic Coins must not break
    // this gateway endpoint — missing tables simply mean "economy off".
    getCoinsConfig(env, guildId).catch(() => null)
  ]);
  // `coins` is additive: the voice gateway uses it to know when a guild wants
  // Coin voice rewards even if Leveling voice XP itself is off.
  const coins = coinsCfg?.settings || {};
  return json({ config: cfg.settings, premium: !!premium, coins: { enabled: coins.enabled === true, voice: coins.enabled === true && coins.voiceEnabled === true } });
}

export async function levelingServiceMessage(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const guildId = String(body.guildId || "");
  const channelId = String(body.channelId || "");
  const messageId = String(body.messageId || "");
  const userId = String(body.userId || "");
  if (!isSnowflake(guildId) || !isSnowflake(channelId) || !isSnowflake(messageId) || !isSnowflake(userId)) {
    return json({ error: "Invalid event payload" }, 400);
  }
  // Defence in depth: even a forged service call cannot farm XP with bot or
  // webhook authors (the gateway service already drops them at the source).
  if (body.bot === true || body.webhookId || body.webhook_id) return json({ ok: true, ignored: "sender" });
  await ensureLevelingTables(env);
  // Baltic Coins: the SAME gateway event also feeds this guild's economy
  // (worker-side, so message rewards need no extra infrastructure). A coins
  // failure must never break XP — it is logged and the XP path continues.
  try { await processCoinsMessage(env, body); }
  catch (e) { console.log(JSON.stringify({ component: "coins", event: "message-hook-failed", guildId, detail: String(e?.message || e).slice(0, 200) })); }
  const { settings } = await getLevelingConfig(env, guildId);
  if (!settings.enabled || !settings.messageXp) return json({ ok: true, ignored: "disabled" });
  if (settings.ignoredChannels.includes(channelId)) return json({ ok: true, ignored: "channel" });

  let memberRoleIds = Array.isArray(body.memberRoleIds) ? body.memberRoleIds.map(String).filter(isSnowflake) : null;
  if (settings.ignoredRoles.length) {
    if (!memberRoleIds) {
      const m = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`);
      memberRoleIds = m.ok && Array.isArray(m.data?.roles) ? m.data.roles.map(String) : null;
      if (!memberRoleIds) return json({ ok: true, ignored: "roles_unknown" });
    }
    if (settings.ignoredRoles.some((id) => memberRoleIds.includes(String(id)))) return json({ ok: true, ignored: "role" });
  }

  const now = Date.now();
  const meta = (await getLevelingMember(env, guildId, userId)) || { totalXp: 0, username: "", displayName: "", avatar: "", rewardedRoles: [] };
  if (meta.lastMessageId && String(meta.lastMessageId) === messageId) return json({ ok: true, ignored: "duplicate" });
  const cooldownMs = settings.messageCooldown * 1000;
  if (Number(meta.lastMessageAt || 0) > now - cooldownMs) return json({ ok: true, ignored: "cooldown" });

  const sig = messageSignature(body.text ?? body.sig ?? "");
  const amount = settings.minXp + Math.floor(Math.random() * (settings.maxXp - settings.minXp + 1));
  const identity = {
    username: String(body.username || meta.username || "").slice(0, 80),
    displayName: String(body.displayName || meta.displayName || body.username || userId).slice(0, 80),
    avatar: String(body.avatar ?? meta.avatar ?? "").slice(0, 80)
  };
  await ensureLevelingMember(env, guildId, userId);
  const oldLevel = levelForXp(meta.totalXp || 0);
  const result = await applyMessageAward(env, {
    guildId, userId, meta, amount, now, cooldownMs, messageId, sig, spamWindowMs: MESSAGE_SPAM_WINDOW_MS
  });
  if (!result.changed) {
    const row = await getLevelingMember(env, guildId, userId);
    const reason = row && String(row.lastMessageId) === messageId ? "duplicate" : "cooldown";
    return json({ ok: true, ignored: reason });
  }
  await setMemberIdentity(env, guildId, userId, identity);
  await bumpDaily(env, guildId, { xp: amount, messages: 1 });
  const leveledUp = result.level > oldLevel;
  if (leveledUp) {
    await announceLevelUp(env, guildId, settings, {
      userId, username: identity.username, displayName: identity.displayName, level: result.level, channelId,
      avatar: avatarUrl(userId, identity.avatar || meta.avatar || ""), source: "message"
    });
    const row = await getLevelingMember(env, guildId, userId);
    await grantEligibleRewards(env, guildId, row);
  }
  return json({ ok: true, awarded: amount, totalXp: result.total, level: result.level, leveledUp });
}

export async function levelingServiceVoice(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const guildId = String(body.guildId || "");
  if (!isSnowflake(guildId)) return json({ error: "Invalid event payload" }, 400);
  await ensureLevelingTables(env);
  // Baltic Coins: voice snapshots also feed the economy — processed BEFORE
  // the Premium/XP gates so Coin voice rewards work for Free guilds too and
  // are fully independent from Leveling's own settings.
  try { await processCoinsVoice(env, guildId, Array.isArray(body.members) ? body.members : []); }
  catch (e) { console.log(JSON.stringify({ component: "coins", event: "voice-hook-failed", guildId, detail: String(e?.message || e).slice(0, 200) })); }
  // Voice XP is Premium-only — enforced server-side on the event itself.
  const premium = !!(await guildPremiumActive(env, guildId));
  if (!premium) {
    return json({ error: "Voice XP requires an active Premium subscription for this server.", code: "premium_required" }, 403);
  }
  const { settings } = await getLevelingConfig(env, guildId);
  if (!settings.enabled || !settings.voiceXp) return json({ ok: true, ignored: "disabled" });
  const members = Array.isArray(body.members) ? body.members.slice(0, 500) : [];
  const present = new Set();
  const now = Date.now();
  const intervalMs = settings.voiceInterval * 1000;
  let awarded = 0;

  for (const m of members) {
    const userId = String(m?.userId || "");
    if (!isSnowflake(userId)) continue;
    present.add(userId);
    const identity = {
      username: String(m.username || "").slice(0, 80),
      displayName: String(m.displayName || m.username || userId).slice(0, 80),
      avatar: String(m.avatar || "").slice(0, 80)
    };
    const eligible = !m.bot && !m.afk && !m.alone;
    if (!eligible) continue;
    await ensureLevelingMember(env, guildId, userId);
    const meta = (await getLevelingMember(env, guildId, userId)) || { totalXp: 0, rewardedRoles: [] };
    if (Number(meta.voiceSeen || 0) !== 1) {
      // First sight: start the participation clock, no instant reward.
      await markVoiceSeen(env, guildId, userId, now);
      continue;
    }
    const oldLevel = levelForXp(meta.totalXp || 0);
    const result = await applyVoiceAward(env, { guildId, userId, meta, amount: settings.voiceXpAmount, now, intervalMs });
    if (!result.changed) continue;
    awarded++;
    await setMemberIdentity(env, guildId, userId, identity);
    await bumpDaily(env, guildId, { xp: settings.voiceXpAmount, voiceXp: settings.voiceXpAmount });
    if (result.level > oldLevel) {
      await announceLevelUp(env, guildId, settings, {
        userId, username: identity.username, displayName: identity.displayName, level: result.level, channelId: "",
        avatar: avatarUrl(userId, identity.avatar || ""), source: "voice"
      });
      const row = await getLevelingMember(env, guildId, userId);
      await grantEligibleRewards(env, guildId, row);
    }
  }

  // Members who left voice (or became ineligible by leaving the snapshot)
  // reset their clock, so reconnects and restarts can never farm rewards.
  const seen = await listVoiceSeen(env, guildId);
  const stale = seen.filter((id) => !present.has(String(id)));
  if (stale.length) await clearVoiceSeen(env, guildId, stale);
  return json({ ok: true, awarded, members: present.size });
}

/* ---------------------------------------- V4 announcement dispatcher -----
   ONE dispatcher for every level crossing: message XP, voice XP and admin
   Add/Set XP all land here. Guarantees:
   - Per-level ledger: a (guild, member, level) crossing is announced at
     MOST ONCE — replays, restarts and re-crossings after an XP decrease can
     never double-post; a FAILED send releases the claim so a later crossing
     of that level retries instead of losing the announcement.
   - Every outcome is logged with actionable detail (announce-sent with the
     Discord message id, announce-failed with channel + reason + missing
     permissions, announce-skipped with its reason, announce-duplicate) —
     announcements can no longer fail silently.
   - The dispatcher NEVER throws: a Discord outage can break neither the XP
     award nor the reward-role grants that run after it.
   - Target isolation: only THIS guild's configured channel (mode "channel")
     or the channel the XP was earned in (mode "same_channel") is used.
   ADMIN XP POLICY (documented): add/set that crosses a NEW level announces
   exactly like an automatic crossing; remove/reset — and any action that
   leaves the level unchanged — never announces.
   Voice note: mode "same_channel" has no origin channel for voice or admin
   events, so those crossings are skipped with a logged reason (choose
   "Specific channel" to announce them). */

const VIEW_CHANNEL_BIT = 1n << 10n;
const SEND_MESSAGES_BIT = 1n << 11n;
const EMBED_LINKS_BIT = 1n << 14n;

/** Can the bot actually post into this channel? Turns opaque 403/404s into
    "grant View Channel / Send Messages / Embed Links" guidance and blocks
    saving an announcement channel the bot demonstrably cannot use. Returns
    {} (never blocks) whenever the answer is not DEFINITIVE — a transient
    Discord problem must never lock the settings page. */
async function channelSendCapability(env, guildId, channelId) {
  try {
    const r = await discordJson(env, `https://discord.com/api/v10/channels/${channelId}`);
    if (!r.ok) {
      return r.status === 404
        ? { blocked: "That announcement channel no longer exists (it was deleted, or the bot cannot see it). Choose another channel." }
        : {}; // transient verification problem — do not block
    }
    const ch = r.data || {};
    if (!ch.id) return {}; // indeterminate answer — do not block
    if (ch.guild_id && String(ch.guild_id) !== String(guildId)) {
      return { blocked: "That channel does not belong to this server." };
    }
    const type = Number(ch.type);
    if (Number.isFinite(type) && type !== 0 && type !== 5) {
      return { blocked: "Choose a text channel for level-up announcements." };
    }
    // Effective permissions: guild @everyone + the bot's roles, then channel
    // overwrites (everyone → bot's roles → the bot member itself).
    const [roleList, mine] = await Promise.all([guildRoleListFull(env, guildId), botMemberRoles(env, guildId)]);
    if (!roleList.ok || !mine.ok) return {};
    const myIds = new Set(mine.roles.map(String));
    let eff = 0n;
    try {
      const everyone = roleList.roles.find((x) => String(x.id) === String(guildId));
      eff = BigInt(everyone?.permissions || "0");
      for (const role of roleList.roles) if (myIds.has(String(role.id))) eff |= BigInt(role.permissions || "0");
      if ((eff & ADMINISTRATOR) === ADMINISTRATOR) return { ok: true };
      const ows = Array.isArray(ch.permission_overwrites) ? ch.permission_overwrites : [];
      const bits = (pred, key) => {
        let v = 0n;
        for (const o of ows) if (pred(o)) { try { v |= BigInt(o[key] || "0"); } catch { /* ignore malformed */ } }
        return v;
      };
      const everyoneOw = (o) => Number(o.type) === 0 && String(o.id) === String(guildId);
      const roleOw = (o) => Number(o.type) === 0 && myIds.has(String(o.id));
      const memberOw = (o) => Number(o.type) === 1 && String(o.id) === String(BOT_CLIENT_ID);
      eff &= ~bits(everyoneOw, "deny");
      eff |= bits(everyoneOw, "allow");
      eff &= ~bits(roleOw, "deny");
      eff |= bits(roleOw, "allow");
      eff &= ~bits(memberOw, "deny");
      eff |= bits(memberOw, "allow");
    } catch { return {}; }
    const missing = [];
    if ((eff & VIEW_CHANNEL_BIT) !== VIEW_CHANNEL_BIT) missing.push("View Channel");
    if ((eff & SEND_MESSAGES_BIT) !== SEND_MESSAGES_BIT) missing.push("Send Messages");
    if ((eff & EMBED_LINKS_BIT) !== EMBED_LINKS_BIT) missing.push("Embed Links");
    if (!missing.length) return { ok: true };
    return {
      blocked: `The bot cannot post announcements in that channel yet — missing: ${missing.join(", ")}. Grant those permissions to the bot's role in Server Settings → Roles (above any channel override), or choose another channel.`
    };
  } catch { return {}; }
}

/** Turn a failed Discord send into an ACTIONABLE explanation: deleted
    channel, missing View/Send/Embed permissions, rejected payload, bad
    token, rate limit or outage — used by the worker log AND the test
    announcement's error message. */
async function explainSendFailure(env, guildId, channelId, status, noToken = false, what = "the level-up announcement") {
  const s = Number(status) || 0;
  if (s === 404) return "The announcement channel no longer exists (deleted) — pick a new channel in Control Center → Leveling → Announce where.";
  const cap = await channelSendCapability(env, guildId, channelId);
  if (cap.blocked) return cap.blocked;
  if (s === 400) return "Discord rejected the announcement payload for that channel (HTTP 400). Check the channel's message settings and try again.";
  return describeDiscordFailure(s, what, noToken);
}

const logAnnounce = (entry, value) => {
  console.log(JSON.stringify({ component: "leveling", ...entry }));
  return value;
};

async function announceLevelUp(env, guildId, settings, { userId, username, displayName, level, channelId, avatar = null, source = "message" }) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  try {
    const mode = settings.announceMode || "off";
    if (mode === "off") return logAnnounce({ event: "announce-skipped", reason: "mode-off", guildId, userId, level: lvl, source }, false);
    const target = mode === "channel" ? settings.announceChannelId : channelId;
    if (!isSnowflake(target)) {
      const reason = mode === "channel" ? "no-channel-configured" : "no-origin-channel";
      return logAnnounce({ event: "announce-skipped", reason, mode, guildId, userId, level: lvl, source }, false);
    }
    // Atomic per-level claim: the FIRST event wins, everyone else logs
    // announce-duplicate instead of double-posting to Discord.
    if (!(await claimAnnouncement(env, guildId, userId, lvl))) {
      return logAnnounce({ event: "announce-duplicate", mode, guildId, channelId: target, userId, level: lvl, source }, false);
    }
    let sent = false;
    try {
      const server = await guildName(env, guildId);
      // Branding is decided here, server-side, from the real entitlement:
      // FREE servers get the promotional footer, Premium servers never do —
      // and the card renderer re-applies that rule even if a card was forged.
      const [premium, nextReward, serverIcon] = await Promise.all([
        guildPremiumActive(env, guildId),
        nextRewardAfter(env, guildId, lvl),
        guildIconUrl(env, guildId)
      ]);
      const card = settings.announceCard && typeof settings.announceCard === "object" ? settings.announceCard : null;
      // V3 card mode: the card IS the message (content stays empty); legacy
      // mode keeps the exact V1/V2 behaviour — rendered content + simple embed.
      const content = card
        ? ""
        : renderAnnounceMessage(settings.announceMessage || DEFAULT_ANNOUNCE_MESSAGE, {
            user: userId,
            username: displayName || username,
            level: lvl,
            server
          });
      const embed = card
        ? renderLevelUpCard(card, { user: userId, username: displayName || username, level: lvl, server, premium: !!premium, nextReward, avatar, serverIcon })
        : levelUpEmbed({ level: lvl, server, premium: !!premium, nextReward });
      if (!card && !content && !embed) return false; // nothing to send → claim released in finally
      const res = await discordJson(env, `https://discord.com/api/v10/channels/${target}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content,
          embeds: [embed],
          // Never allow @everyone/@here/role pings; only the levelled-up user
          // may be mentioned, and only when {user} is part of the template.
          allowed_mentions: { parse: [], users: [String(userId)] }
        })
      });
      if (res.ok) {
        sent = true;
        logAnnounce({ event: "announce-sent", mode, guildId, channelId: target, messageId: String(res.data?.id || ""), userId, level: lvl, source });
      } else {
        const detail = await explainSendFailure(env, guildId, target, res.status, !!res.noToken);
        logAnnounce({ event: "announce-failed", mode, guildId, channelId: target, status: res.status, userId, level: lvl, source, detail });
      }
    } catch (err) {
      logAnnounce({ event: "announce-failed", stage: "exception", mode, guildId, channelId: target, userId, level: lvl, source, detail: String(err?.message || err).slice(0, 200) }, undefined);
    } finally {
      // A failed send must not consume the claim: the next crossing of this
      // level retries instead of losing the announcement forever.
      if (!sent) { try { await releaseAnnouncement(env, guildId, userId, lvl); } catch { /* best effort */ } }
    }
    return sent;
  } catch (err) {
    // Absolute last resort: announcing can never break the XP pipeline.
    return logAnnounce({ event: "announce-failed", stage: "fatal", guildId, userId, level: lvl, source, detail: String(err?.message || err).slice(0, 200) }, false);
  }
}

async function nextRewardAfter(env, guildId, level) {
  const rewards = await listRewards(env, guildId);
  return rewards.find((r) => Number(r.level) > Number(level)) || null;
}

/** Admin-triggered preview: posts a clearly-marked test message to a real
    channel. It never touches the XP pipeline — no XP is granted, no level is
    crossed, no reward role can fire, and it can never duplicate a real
    level-up announcement. */
export async function levelingAnnounceTest(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureLevelingTables(env);
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const channelId = String((body && body.channelId) || "").trim();
  if (!isSnowflake(channelId)) return json({ error: "Choose a channel for the test announcement." }, 400);
  const ids = await guildChannelIds(env, guildId);
  if (!ids) return json({ error: "Could not verify this server's channels. Please try again." }, 502);
  if (!ids.has(String(channelId))) return json({ error: "That channel does not belong to this server." }, 400);
  const [{ settings }, premium] = await Promise.all([getLevelingConfig(env, guildId), guildPremiumActive(env, guildId)]);
  const server = await guildName(env, guildId);
  const sampleName = String(user?.global_name || user?.username || "Admin").slice(0, 80);
  const sampleLevel = Math.max(1, Math.min(1000, Math.floor(Number(body.level)) || 10));
  const nextReward = await nextRewardAfter(env, guildId, sampleLevel);
  const serverIcon = await guildIconUrl(env, guildId);
  const card = settings.announceCard && typeof settings.announceCard === "object" ? settings.announceCard : null;
  // The 🧪 marker line identifies the message as a test in BOTH modes; the
  // embed itself is sent exactly as the editor previewed it.
  const content = `🧪 **Test announcement** — preview only, no XP granted.${
    card ? "" : "\n" + renderAnnounceMessage(settings.announceMessage || DEFAULT_ANNOUNCE_MESSAGE, {
      user: String(user?.id || ""),
      username: sampleName,
      level: sampleLevel,
      server
    })
  }`;
  const embeds = card
    ? [renderLevelUpCard(card, {
        user: String(user?.id || ""),
        username: sampleName,
        level: sampleLevel,
        server,
        premium: !!premium,
        nextReward,
        avatar: avatarUrl(user?.id, user?.avatar),
        serverIcon
      })]
    : [levelUpEmbed({ level: sampleLevel, server, premium: !!premium, nextReward, test: true })];
  const res = await discordJson(env, `https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      embeds,
      allowed_mentions: { parse: [] }
    })
  });
  if (!res.ok) {
    // Actionable: deleted channel, missing View/Send/Embed permissions,
    // rate limit or outage — never a bare HTTP status.
    const detail = await explainSendFailure(env, guildId, channelId, res.status, !!res.noToken, "the test announcement");
    return json({ error: detail }, 502);
  }
  return json({ ok: true, test: true, channelId: String(channelId), content });
}

/* ------------------------------------------------------- /rank, /leaderboard */

const EMBED_COLOR = 0xe8892c;
const progressBar = (ratio) => {
  const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  return "█".repeat(filled) + "░".repeat(10 - filled);
};

async function memberIdentityFromDiscord(env, guildId, userId) {
  const m = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`);
  if (!m.ok) return null;
  const u = m.data?.user || {};
  return {
    username: String(u.username || "").slice(0, 80),
    displayName: String(m.data?.nick || u.global_name || u.username || userId).slice(0, 80),
    avatar: u.avatar || ""
  };
}

export async function levelingRankInteraction(env, interaction) {
  try {
    const guildId = String(interaction?.guild_id || "");
    if (!isSnowflake(guildId)) {
      return json({ type: 4, data: { content: "🛟 /rank only works inside a Discord server.", flags: 64 } });
    }
    await ensureLevelingTables(env);
    const options = interaction?.data?.options || [];
    const asked = options.find((o) => String(o.name) === "user");
    const userId = String(asked?.value || interaction?.member?.user?.id || interaction?.user?.id || "");
    if (!isSnowflake(userId)) {
      return json({ type: 4, data: { content: "Could not resolve that member.", flags: 64 } });
    }
    let row = await getLevelingMember(env, guildId, userId);
    if (!row) {
      const identity = await memberIdentityFromDiscord(env, guildId, userId);
      if (!identity) {
        return json({ type: 4, data: { content: "That member has no XP data in this server yet.", flags: 64 } });
      }
      row = { userId, ...identity, totalXp: 0, messageXp: 0, voiceXp: 0, level: levelForXp(0), rewardedRoles: [] };
    }
    const progress = levelProgress(row.totalXp);
    const rank = await rankOf(env, guildId, row.totalXp);
    const total = await countMembers(env, guildId);
    const name = row.displayName || row.username || "Member";
    const avatar = avatarUrl(row.userId, row.avatar);
    const embed = {
      color: EMBED_COLOR,
      title: `📊 ${name}`,
      description: `${progressBar(progress.ratio)} **Level ${progress.level}** — ${progress.into.toLocaleString()} / ${progress.need.toLocaleString()} XP to next level`,
      fields: [
        { name: "Server rank", value: `#${rank} of ${Math.max(total, 1)}`, inline: true },
        { name: "Total XP", value: Number(row.totalXp || 0).toLocaleString(), inline: true },
        { name: "Level", value: String(progress.level), inline: true },
        { name: "Message XP", value: Number(row.messageXp || 0).toLocaleString(), inline: true },
        { name: "Voice XP", value: Number(row.voiceXp || 0).toLocaleString(), inline: true }
      ],
      footer: { text: "BalticM.eu • PLAY TOGETHER • MANAGE SMARTER" }
    };
    if (avatar) embed.thumbnail = { url: avatar };
    return json({ type: 4, data: { embeds: [embed] } });
  } catch (e) {
    return json({ type: 4, data: { content: "Could not load rank data right now. Please try again.", flags: 64 } });
  }
}

export async function levelingLeaderboardInteraction(env, interaction) {
  try {
    const guildId = String(interaction?.guild_id || "");
    if (!isSnowflake(guildId)) {
      return json({ type: 4, data: { content: "🛟 /leaderboard only works inside a Discord server.", flags: 64 } });
    }
    await ensureLevelingTables(env);
    const rows = await leaderboard(env, guildId, { limit: 10 });
    const total = await countMembers(env, guildId);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.length
      ? rows.map((r, i) => {
          const name = (r.displayName || r.username || "Member").replace(/[*_`|]/g, "").slice(0, 40);
          return `**${medals[i] || `${i + 1}.`}** ${name} — **Level ${Number(r.level || 0)}** • ${Number(r.totalXp || 0).toLocaleString()} XP`;
        })
      : ["No XP has been awarded in this server yet."];
    const embed = {
      color: EMBED_COLOR,
      title: "🏆 Leaderboard — Top 10",
      description: lines.join("\n"),
      footer: { text: `${total} ranked member${total === 1 ? "" : "s"} • BalticM.eu` }
    };
    return json({ type: 4, data: { embeds: [embed] } });
  } catch (e) {
    return json({ type: 4, data: { content: "Could not load the leaderboard right now. Please try again.", flags: 64 } });
  }
}

export { RANK_COMMAND_DEFINITION, LEADERBOARD_COMMAND_DEFINITION, ALLOWED_ANNOUNCE_PLACEHOLDERS, ANNOUNCE_MODES, LEVELING_DEFAULTS };
