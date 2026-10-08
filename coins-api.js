/* Baltic Coins V1 — API handlers, economy processors and Discord commands.

   Runs inside the Cloudflare worker; imports only the pure helpers
   (coins.js), the storage/wallet engine (coins-db.js) and Discord REST —
   never worker.js itself, so there are no import cycles. Every handler is
   guild-scoped: the guild id always comes from the authenticated request or
   the Discord interaction's own guild context, NEVER from a member-supplied
   pointer to another server.

   The same validated, atomic engine serves Discord commands, the Control
   Center and (later) games — see the `gameEconomy` service at the bottom. */

import {
  COINS_BOUNDS,
  COINS_CURRENCY,
  COINS_ICON,
  PURCHASE_STATUSES,
  SHOP_ITEM_TYPES,
  clampCoins,
  cooldownRemainingMs,
  fmtCoins,
  formatRemaining,
  parseCoinAction,
  parseCoinsSettings,
  parseShopItem,
  premiumRedemptionBlocked
} from "./coins.js";
import { SNOWFLAKE_OK as isSnowflake } from "./coins.js";
import {
  addShopItem,
  claimDaily,
  claimMessageReward,
  countMemberPurchases,
  countTransactions,
  createPurchase,
  creditCoins,
  debitCoins,
  deleteShopItem,
  economySeries,
  economyStats,
  ensureCoinsTables,
  ensureWallet,
  getCoinsConfig,
  getPurchase,
  getShopItem,
  getWallet,
  coinsLeaderboard,
  listPurchases,
  listShopItems,
  listTransactions,
  listWallets,
  messageSignature,
  saveCoinsConfig,
  setPurchaseStatus,
  setWalletIdentity,
  takeShopStock,
  restoreShopStock,
  transferCoins,
  updateShopItem,
  voiceRewardEligible
} from "./coins-db.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const botHeaders = (env) => ({ Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const transientStatus = (s) => s === 0 || s === 408 || s === 429 || s >= 500;

/** Discord REST with one automatic retry for transient failures. */
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

function describeDiscordFailure(status, what, noToken = false) {
  if (noToken) return "The bot token (DISCORD_BOT_TOKEN) is not configured for this worker.";
  const s = Number(status) || 0;
  if (s === 0) return `Discord could not be reached while checking ${what} (network error). Please try again.`;
  if (s === 401) return `Discord rejected the bot's credentials while checking ${what}. Reconnect the bot and try again.`;
  if (s === 403) return `Discord denied access while checking ${what} — the bot may have lost permissions.`;
  if (s === 404) return `Discord could not find ${what} — it may no longer exist.`;
  if (s === 429) return `Discord is rate limiting requests while checking ${what}. Wait a few seconds and try again.`;
  if (s >= 500) return `Discord had a server problem while checking ${what} (HTTP ${s}). Please try again.`;
  return `Could not verify ${what} (Discord HTTP ${s}). Please try again.`;
}

/** Re-checked in every handler: the session user must be a member of the guild. */
function manageable(user, guildId) {
  return !!(user && Array.isArray(user.guilds) && user.guilds.some((g) => String(g.id) === String(guildId)));
}

const BOT_CLIENT_ID = "1543137268221354035";
const EMBED_COLOR = 0xe8892c;
const COINS_FOOTER = "Baltic Coins • BalticM — PLAY TOGETHER";
const avatarCdn = (userId, hash) => (hash ? `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=64` : null);

export const SOURCE_LABEL = {
  starting_balance: "Starting balance",
  discord_daily: "Daily reward",
  discord_message: "Message reward",
  discord_voice: "Voice reward",
  discord_transfer: "Transfer",
  discord_shop: "Shop purchase",
  shop_refund: "Shop refund",
  game_reward: "Game reward",
  game_purchase: "Game purchase",
  admin_adjustment: "Admin adjustment",
  future_paid_purchase: "Coins purchase"
};

function coinEmbed({ title, description, fields = [], footer = true }) {
  const embed = { color: EMBED_COLOR };
  if (title) embed.title = title;
  if (description) embed.description = description;
  if (fields.length) embed.fields = fields;
  if (footer) embed.footer = { text: COINS_FOOTER };
  return embed;
}

/* --------------------------------------------------- interaction helpers */

const errReply = (msg) => ({ type: 4, data: { content: `⚠️ ${msg}`, flags: 64 } });
const noGuildReply = () => errReply("This command only works inside a Discord server.");
const okReply = (embeds) => ({ type: 4, data: { embeds } });

function identityOf(interaction) {
  const u = interaction?.member?.user || {};
  return {
    username: String(u.username || "").slice(0, 80),
    displayName: String(interaction?.member?.nick || u.global_name || u.username || "").slice(0, 80),
    avatar: String(u.avatar || "").slice(0, 80)
  };
}

function isAdminInteraction(interaction) {
  try { return (BigInt(interaction?.member?.permissions || "0") & (1n << 3n)) === (1n << 3n); } catch { return false; }
}

/* ------------------------------------------------ Control Center handlers */

/** Guild directory for the settings pickers — text channels + assignable roles. */
async function guildDirectory(env, guildId) {
  const [channelsRes, rolesRes] = await Promise.all([
    discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/channels`),
    discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/roles`)
  ]);
  const channels = (Array.isArray(channelsRes.data) ? channelsRes.data : [])
    .filter((c) => c && (c.type === 0 || c.type === 5))
    .map((c) => ({ id: String(c.id), name: String(c.name || "channel") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const roles = (Array.isArray(rolesRes.data) ? rolesRes.data : [])
    .filter((r) => r && !r.managed && String(r.id) !== String(guildId))
    .map((r) => ({ id: String(r.id), name: String(r.name || "role") }))
    .sort((a, b) => b.name.localeCompare(a.name));
  return { channels, roles };
}

export async function coinsOverview(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  const u = new URL(req.url);
  const days = Math.max(7, Math.min(30, Number(u.searchParams.get("days")) || 14));
  const [{ settings, exists }, stats, series, richest, recent, directory] = await Promise.all([
    getCoinsConfig(env, guildId),
    economyStats(env, guildId),
    economySeries(env, guildId, days),
    coinsLeaderboard(env, guildId, { limit: 5 }),
    listTransactions(env, guildId, { limit: 8 }),
    guildDirectory(env, guildId)
  ]);
  return json({
    configured: exists,
    settings,
    currency: { name: COINS_CURRENCY, icon: COINS_ICON },
    stats,
    series,
    richest,
    recent,
    channels: directory.channels,
    roles: directory.roles
  });
}

export async function saveCoinsSettings(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = parseCoinsSettings(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  await saveCoinsConfig(env, guildId, parsed.value);
  return json({ ok: true, settings: parsed.value });
}

export async function coinsLeaderboardPage(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").slice(0, 40);
  const limitRaw = Number(u.searchParams.get("limit")) || 10;
  const limit = [10, 50, 100].includes(limitRaw) ? limitRaw : 10;
  const offset = Math.max(0, Number(u.searchParams.get("offset")) || 0);
  const rows = await coinsLeaderboard(env, guildId, { q, limit, offset });
  return json({
    q,
    limit,
    offset,
    entries: rows.map((r, i) => ({
      position: offset + i + 1,
      userId: r.userId,
      username: r.username || "",
      displayName: r.displayName || r.username || "",
      avatar: avatarCdn(r.userId, r.avatar),
      balance: Number(r.balance || 0),
      totalEarned: Number(r.totalEarned || 0),
      totalSpent: Number(r.totalSpent || 0)
    }))
  });
}

export async function coinsWalletsPage(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") || "").slice(0, 40);
  const limit = Math.max(1, Math.min(100, Number(u.searchParams.get("limit")) || 25));
  const offset = Math.max(0, Number(u.searchParams.get("offset")) || 0);
  const { wallets, total } = await listWallets(env, guildId, { q, limit, offset });
  return json({
    q,
    limit,
    offset,
    total,
    wallets: wallets.map((w) => ({
      userId: w.userId,
      username: w.username || "",
      displayName: w.displayName || w.username || "",
      avatar: avatarCdn(w.userId, w.avatar),
      balance: Number(w.balance || 0),
      totalEarned: Number(w.totalEarned || 0),
      totalSpent: Number(w.totalSpent || 0),
      updatedAt: w.updatedAt
    }))
  });
}

export async function coinsWalletDetail(req, env, user, guildId, userId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  if (!isSnowflake(userId)) return json({ error: "Unknown member." }, 400);
  await ensureCoinsTables(env);
  const [wallet, transactions, count] = await Promise.all([
    getWallet(env, guildId, userId),
    listTransactions(env, guildId, { userId, limit: 25 }),
    countTransactions(env, guildId, { userId })
  ]);
  if (!wallet) return json({ error: "That member has no wallet in this server." }, 404);
  return json({
    wallet: { ...wallet, avatar: avatarCdn(userId, wallet.avatar) },
    transactions,
    totalTransactions: count
  });
}

/** Add / Remove / Set — administrator action, fully audited in the ledger. */
export async function coinsWalletAdjust(req, env, user, guildId, userId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  if (!isSnowflake(userId)) return json({ error: "Unknown member." }, 400);
  await ensureCoinsTables(env);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = parseCoinAction({ ...body, userId });
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, 400);
  const { action, amount, reason } = parsed.value;

  // Never trust member ids from the browser: the target must be in THIS guild.
  const memberRes = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`);
  if (memberRes.status === 404) return json({ error: "That member is not in this server." }, 404);
  if (!memberRes.ok) return json({ error: "Could not verify the member. Please try again." }, 502);
  const dm = memberRes.data || {};
  const identity = {
    username: String(dm.user?.username || "").slice(0, 80),
    displayName: String(dm.nick || dm.user?.global_name || dm.user?.username || "").slice(0, 80),
    avatar: dm.user?.avatar || ""
  };

  const settings = (await getCoinsConfig(env, guildId)).settings;
  const before = await ensureWallet(env, guildId, userId, settings);
  await setWalletIdentity(env, guildId, userId, identity);
  const previousBalance = Number(before?.balance || 0);
  const idempotencyKey = body.requestId ? `admin:${guildId}:${String(body.requestId).slice(0, 60)}` : "";
  const actorId = String(user?.id || "");

  let balance = previousBalance;
  let changed = true;
  if (action === "add") {
    const res = await creditCoins(env, { guildId, userId, amount, source: "admin_adjustment", actorId, reason, idempotencyKey });
    if (!res.ok) return json({ error: res.error || "Could not credit that wallet." }, 400);
    balance = res.balance;
  } else if (action === "remove") {
    const res = await debitCoins(env, { guildId, userId, amount, source: "admin_adjustment", actorId, reason, idempotencyKey });
    if (!res.ok) return json({ error: res.error || "Could not debit that wallet.", code: res.code }, res.code === "insufficient_balance" ? 400 : 400);
    balance = res.balance;
  } else {
    // set: move the wallet TO the target with a single directional movement.
    const target = clampCoins(amount);
    if (target === previousBalance) {
      changed = false;
    } else if (target > previousBalance) {
      const res = await creditCoins(env, { guildId, userId, amount: target - previousBalance, source: "admin_adjustment", actorId, reason: reason || "Set balance", idempotencyKey });
      if (!res.ok) return json({ error: res.error || "Could not set that balance." }, 400);
      balance = res.balance;
    } else {
      const res = await debitCoins(env, { guildId, userId, amount: previousBalance - target, source: "admin_adjustment", actorId, reason: reason || "Set balance", idempotencyKey });
      if (!res.ok) return json({ error: res.error || "Could not set that balance." }, 400);
      balance = res.balance;
    }
  }
  return json({ ok: true, action, userId, previousBalance, balance, changed });
}

export async function coinsTransactionsPage(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  const u = new URL(req.url);
  const userId = isSnowflake(u.searchParams.get("userId")) ? u.searchParams.get("userId") : "";
  const source = String(u.searchParams.get("source") || "");
  const limit = Math.max(1, Math.min(100, Number(u.searchParams.get("limit")) || 25));
  const offset = Math.max(0, Number(u.searchParams.get("offset")) || 0);
  const [entries, total] = await Promise.all([
    listTransactions(env, guildId, { userId, source, limit, offset }),
    countTransactions(env, guildId, { userId, source })
  ]);
  return json({ entries, total, limit, offset });
}

/* ------------------------------------------------------------------ shop */

export async function coinsShopList(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  return json({ items: await listShopItems(env, guildId) });
}

async function botMemberRoles(env, guildId) {
  const byId = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${BOT_CLIENT_ID}`);
  if (byId.ok) return { ok: true, roles: Array.isArray(byId.data?.roles) ? byId.data.roles : [] };
  const byMe = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/@me`);
  if (byMe.ok) return { ok: true, roles: Array.isArray(byMe.data?.roles) ? byMe.data.roles : [] };
  return { ok: false, status: byMe.status || byId.status, noToken: !!(byId.noToken || byMe.noToken) };
}

/** Role must exist, be assignable (not managed/@everyone) and sit BELOW the
    bot's top role — the same Discord rules the Leveling rewards use. */
async function validateShopRole(env, guildId, roleId) {
  const [rolesRes, mine] = await Promise.all([
    discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/roles`),
    botMemberRoles(env, guildId)
  ]);
  if (!rolesRes.ok || !mine.ok) {
    const status = rolesRes.ok ? mine.status : rolesRes.status;
    return { error: describeDiscordFailure(status, "this server's role list", rolesRes.noToken || mine.noToken), status: 502, code: "role_verification_failed" };
  }
  const roles = Array.isArray(rolesRes.data) ? rolesRes.data : [];
  const role = roles.find((r) => String(r.id) === String(roleId));
  if (!role) return { error: "That role no longer exists in this server.", status: 400 };
  if (role.managed || String(role.id) === String(guildId)) return { error: "That role cannot be granted automatically (managed or @everyone).", status: 400 };
  const myIds = new Set(mine.roles.map(String));
  let topPosition = -1;
  for (const r of roles) if (myIds.has(String(r.id))) topPosition = Math.max(topPosition, Number(r.position) || 0);
  if (!((Number(role.position) || 0) < topPosition)) {
    return { error: "Move the bot's top role above the shop role in Server Settings → Roles (role hierarchy).", status: 400 };
  }
  return { role };
}

export async function coinsShopCreate(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = parseShopItem(body);
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, 400);
  if (parsed.value.itemType === "role") {
    const check = await validateShopRole(env, guildId, parsed.value.roleId);
    if (check.error) return json({ error: check.error, code: check.code }, check.status);
  }
  const item = await addShopItem(env, guildId, parsed.value);
  return json({ ok: true, item }, 201);
}

export async function coinsShopUpdate(req, env, user, guildId, id) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  const existing = await getShopItem(env, guildId, id);
  if (!existing) return json({ error: "Item not found" }, 404);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const parsed = parseShopItem(body, { existing });
  if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, 400);
  if (parsed.value.itemType === "role" && String(parsed.value.roleId) !== String(existing.roleId)) {
    const check = await validateShopRole(env, guildId, parsed.value.roleId);
    if (check.error) return json({ error: check.error, code: check.code }, check.status);
  }
  const item = await updateShopItem(env, guildId, id, parsed.value);
  if (!item) return json({ error: "Item not found" }, 404);
  return json({ ok: true, item });
}

export async function coinsShopDelete(req, env, user, guildId, id) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  const removed = await deleteShopItem(env, guildId, id);
  if (!removed) return json({ error: "Item not found" }, 404);
  return json({ ok: true });
}

/* ------------------------------------------------------ purchase actions */

export async function coinsPurchasesPage(req, env, user, guildId) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  const u = new URL(req.url);
  const status = PURCHASE_STATUSES.includes(u.searchParams.get("status")) ? u.searchParams.get("status") : "";
  const limit = Math.max(1, Math.min(100, Number(u.searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(u.searchParams.get("offset")) || 0);
  const purchases = await listPurchases(env, guildId, { status, limit, offset });
  return json({ purchases, limit, offset });
}

/** Staff marks a MANUAL reward as delivered. The Premium firewall is
    re-checked here — fulfilment can never hand out BalticM Premium. */
export async function coinsPurchaseFulfill(req, env, user, guildId, id) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  const purchase = await getPurchase(env, guildId, id);
  if (!purchase) return json({ error: "Purchase not found" }, 404);
  if (purchase.status !== "awaiting_fulfillment") {
    return json({ error: `Only purchases awaiting fulfilment can be marked fulfilled (this one is ${purchase.status}).` }, 400);
  }
  if (premiumRedemptionBlocked(purchase.itemName)) {
    return json({ error: "Blocked: Baltic Coins can never purchase BalticM Premium.", code: "premium_redemption_forbidden" }, 400);
  }
  await setPurchaseStatus(env, guildId, id, "completed", { fulfilledBy: String(user?.id || "") });
  return json({ ok: true, purchase: await getPurchase(env, guildId, id) });
}

export async function coinsPurchaseRefund(req, env, user, guildId, id) {
  if (!manageable(user, guildId)) return json({ error: "Forbidden" }, 403);
  await ensureCoinsTables(env);
  const purchase = await getPurchase(env, guildId, id);
  if (!purchase) return json({ error: "Purchase not found" }, 404);
  if (!["pending", "failed", "awaiting_fulfillment"].includes(purchase.status)) {
    return json({ error: `A ${purchase.status} purchase cannot be refunded here.` }, 400);
  }
  // Only a purchase that ACTUALLY charged Coins may return Coins. A failed
  // attempt (out of stock, insufficient balance, failure before the debit)
  // must never mint Coins that were never taken.
  const charged = await env.BALTICM_DB.prepare(
    "SELECT id FROM coins_transactions WHERE guild_id=? AND idempotency_key=?"
  ).bind(String(guildId), `purchase:${purchase.id}`).first();
  if (!charged) {
    if (purchase.status === "pending") {
      await setPurchaseStatus(env, guildId, id, "failed", { failureReason: "Closed without a charge — nothing to refund." });
    }
    const w = await getWallet(env, guildId, purchase.userId);
    return json({
      ok: true,
      refunded: false,
      note: "This purchase never charged any Coins, so nothing was taken to return.",
      balance: Number(w?.balance || 0)
    });
  }
  const item = await getShopItem(env, guildId, purchase.itemId);
  const refund = await creditCoins(env, {
    guildId, userId: purchase.userId, amount: purchase.price, source: "shop_refund",
    relatedId: purchase.id, actorId: String(user?.id || ""), reason: `Refund: ${purchase.itemName}`,
    idempotencyKey: `refund:${purchase.id}`
  });
  if (!refund.ok) return json({ error: refund.error || "Refund failed." }, 400);
  // A duplicate replay means the purchase was ALREADY refunded internally
  // (its stock was restored back then) — restoring again would inflate stock.
  if (item && !refund.duplicate) await restoreShopStock(env, guildId, item.id, item);
  await setPurchaseStatus(env, guildId, id, "refunded");
  return json({ ok: true, refunded: true, balance: refund.balance, duplicate: !!refund.duplicate });
}

/* -------------------------------------------------- economy processors ---
   Called from the existing gateway pipeline (worker hooks), never over a
   public route: message XP events already flow through the Control Center
   and voice snapshots through the Leveling voice endpoint. */

export async function processCoinsMessage(env, body) {
  const guildId = String(body?.guildId || "");
  const channelId = String(body?.channelId || "");
  const messageId = String(body?.messageId || "");
  const userId = String(body?.userId || "");
  if (!isSnowflake(guildId) || !isSnowflake(channelId) || !isSnowflake(messageId) || !isSnowflake(userId)) return { ignored: "payload" };
  if (body.bot === true || body.webhookId || body.webhook_id) return { ignored: "sender" };
  await ensureCoinsTables(env);
  const { settings } = await getCoinsConfig(env, guildId);
  if (!settings.enabled || !settings.messageEnabled) return { ignored: "disabled" };
  if (settings.excludedChannels.includes(channelId)) return { ignored: "channel" };
  let memberRoleIds = Array.isArray(body.memberRoleIds) ? body.memberRoleIds.map(String) : null;
  if (settings.excludedRoles.length) {
    if (!memberRoleIds) {
      const m = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`);
      memberRoleIds = m.ok && Array.isArray(m.data?.roles) ? m.data.roles.map(String) : null;
      if (!memberRoleIds) return { ignored: "roles_unknown" };
    }
    if (settings.excludedRoles.some((id) => memberRoleIds.includes(String(id)))) return { ignored: "role" };
  }
  const now = Date.now();
  // One guarded claim decides cooldown AND replay AND repeated-spam in SQL —
  // the same qualifying event can never pay twice.
  const claimed = await claimMessageReward(env, {
    guildId, userId, amount: settings.messageAmount, now,
    cooldownMs: settings.messageCooldown * 1000, messageId,
    sig: messageSignature(body.text ?? "")
  });
  if (!claimed) return { ignored: "cooldown" };
  await ensureWallet(env, guildId, userId, settings);
  await setWalletIdentity(env, guildId, userId, { username: body.username, displayName: body.displayName, avatar: body.avatar });
  const res = await creditCoins(env, {
    guildId, userId, amount: settings.messageAmount, source: "discord_message",
    idempotencyKey: `msg:${guildId}:${messageId}`, reason: "Message reward"
  });
  return { awarded: res.ok ? settings.messageAmount : 0, balance: res.balance || 0 };
}

export async function processCoinsVoice(env, guildId, members) {
  if (!isSnowflake(guildId)) return { ignored: "payload" };
  await ensureCoinsTables(env);
  const { settings } = await getCoinsConfig(env, guildId);
  if (!settings.enabled || !settings.voiceEnabled) return { ignored: "disabled" };
  const list = Array.isArray(members) ? members : [];
  const now = Date.now();
  const eligible = await voiceRewardEligible(env, { guildId, members: list, now, intervalMs: settings.voiceInterval * 1000 });
  let awarded = 0;
  for (const userId of eligible) {
    await ensureWallet(env, guildId, userId, settings);
    const m = list.find((x) => String(x?.userId) === userId);
    await setWalletIdentity(env, guildId, userId, { username: m?.username, displayName: m?.displayName || m?.username, avatar: m?.avatar });
    const res = await creditCoins(env, {
      guildId, userId, amount: settings.voiceAmount, source: "discord_voice",
      idempotencyKey: `voice:${guildId}:${userId}:${now}`, reason: "Voice reward"
    });
    if (res.ok) awarded++;
  }
  return { awarded };
}

/** /daily — cooldown decided by ONE guarded UPDATE (concurrent-safe). */
export async function claimDailyReward(env, guildId, userId, identity = null) {
  await ensureCoinsTables(env);
  const { settings } = await getCoinsConfig(env, guildId);
  if (!settings.enabled || !settings.dailyEnabled) {
    return { ok: false, code: "disabled", error: "Daily rewards are disabled in this server." };
  }
  await ensureWallet(env, guildId, userId, settings);
  if (identity) await setWalletIdentity(env, guildId, userId, identity);
  const claim = await claimDaily(env, { guildId, userId, cooldownSeconds: settings.dailyCooldown });
  if (!claim.ok) {
    const wallet = await getWallet(env, guildId, userId);
    return { ok: false, code: "cooldown", remainingMs: claim.remainingMs, balance: Number(wallet?.balance || 0) };
  }
  const res = await creditCoins(env, {
    guildId, userId, amount: settings.dailyAmount, source: "discord_daily",
    idempotencyKey: `daily:${guildId}:${userId}:${claim.claimedAt}`, reason: "Daily reward"
  });
  if (!res.ok) return { ok: false, error: res.error || "The daily reward could not be credited." };
  return {
    ok: true,
    amount: settings.dailyAmount,
    balance: res.balance,
    nextAtMs: claim.claimedAt + settings.dailyCooldown * 1000,
    remainingMs: settings.dailyCooldown * 1000
  };
}

/** /pay — same-guild only, atomic, rate-gapped, idempotent. */
export async function processTransfer(env, guildId, from, to, amount, { idempotencyKey = "" } = {}) {
  await ensureCoinsTables(env);
  const { settings } = await getCoinsConfig(env, guildId);
  if (!settings.enabled || !settings.transfersEnabled) {
    return { ok: false, error: "Transfers are disabled in this server." };
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > COINS_BOUNDS.transferAmount[1]) {
    return { ok: false, error: `Send a whole number of Coins between 1 and ${fmtCoins(COINS_BOUNDS.transferAmount[1])}.` };
  }
  if (String(from.userId) === String(to.userId)) return { ok: false, error: "You cannot send Coins to yourself." };
  await ensureWallet(env, guildId, from.userId, settings);
  await ensureWallet(env, guildId, to.userId, settings);
  if (from.identity) await setWalletIdentity(env, guildId, from.userId, from.identity);
  if (to.identity) await setWalletIdentity(env, guildId, to.userId, to.identity);
  return transferCoins(env, { guildId, fromUserId: from.userId, toUserId: to.userId, amount, idempotencyKey, reason: "Transfer" });
}

/* ------------------------------------------------------- shop purchasing */

export async function resolveShopItem(env, guildId, needle) {
  const items = await listShopItems(env, guildId, { enabledOnly: true });
  const n = String(needle || "").toLowerCase().replace(/^#/, "").trim();
  if (!n) return null;
  return items.find((i) => String(i.id) === n || i.name.toLowerCase() === n)
    || items.find((i) => i.name.toLowerCase().includes(n))
    || null;
}

async function refundPurchaseInternal(env, guildId, purchase, { restoreItem = null } = {}) {
  const refund = await creditCoins(env, {
    guildId, userId: purchase.userId, amount: purchase.price, source: "shop_refund",
    relatedId: purchase.id, reason: `Refund: ${purchase.itemName}`,
    idempotencyKey: `refund:${purchase.id}`
  });
  if (restoreItem) await restoreShopStock(env, guildId, restoreItem.id, restoreItem);
  return refund;
}

/**
 * The one purchase pipeline used by /coins buy. Durable states + guarded
 * stock + idempotency keys make double charges, stock races and duplicate
 * retries impossible; a FAILED role delivery always refunds the Coins.
 */
export async function buyShopItem(env, guildId, userId, itemNeedle, { idempotencyKey = "", identity = null, meta = "" } = {}) {
  await ensureCoinsTables(env);
  const { settings } = await getCoinsConfig(env, guildId);
  if (!settings.enabled || !settings.shopEnabled) return { ok: false, error: "The shop is disabled in this server." };
  const fresh = isSnowflake(itemNeedle) && String(itemNeedle).length >= 15
    ? await getShopItem(env, guildId, itemNeedle)
    : await resolveShopItem(env, guildId, itemNeedle);
  if (!fresh || Number(fresh.enabled) !== 1) return { ok: false, error: "That item is not available in this server's shop." };

  // Idempotent replay check FIRST: a retried request must return its
  // recorded outcome — never a limit error, never a second charge.
  if (idempotencyKey) {
    const prior = await env.BALTICM_DB.prepare(
      "SELECT id FROM coins_purchases WHERE guild_id=? AND idempotency_key=?"
    ).bind(String(guildId), String(idempotencyKey)).first();
    if (prior) {
      const purchase = await getPurchase(env, guildId, prior.id);
      const wallet = await getWallet(env, guildId, userId);
      const balance = Number(wallet?.balance || 0);
      if (purchase.status === "completed") return { ok: true, duplicate: true, purchase, balance };
      if (purchase.status === "awaiting_fulfillment") return { ok: true, duplicate: true, pending: true, purchase, balance };
      return { ok: false, duplicate: true, error: `This purchase already has status "${purchase.status}".`, purchase, balance };
    }
  }

  if (fresh.purchaseLimit !== null && fresh.purchaseLimit !== undefined) {
    const used = await countMemberPurchases(env, guildId, userId, fresh.id);
    if (used >= fresh.purchaseLimit) {
      return { ok: false, error: `You already reached this item's purchase limit (${fresh.purchaseLimit}).` };
    }
  }

  const { purchase, duplicate } = await createPurchase(env, { guildId, userId, item: fresh, idempotencyKey, status: "pending" });
  if (duplicate) {
    // Replay of the SAME attempt → return the recorded outcome, never charge again.
    const wallet = await getWallet(env, guildId, userId);
    const balance = Number(wallet?.balance || 0);
    if (purchase.status === "completed") return { ok: true, duplicate: true, purchase, balance };
    if (purchase.status === "awaiting_fulfillment") return { ok: true, duplicate: true, pending: true, purchase, balance };
    return { ok: false, duplicate: true, error: `This purchase already has status "${purchase.status}".`, purchase, balance };
  }

  await ensureWallet(env, guildId, userId, settings);
  if (identity) await setWalletIdentity(env, guildId, userId, identity);

  const stocked = await takeShopStock(env, guildId, fresh.id);
  if (!stocked) {
    await setPurchaseStatus(env, guildId, purchase.id, "failed", { failureReason: "Out of stock" });
    return { ok: false, error: "That item is out of stock.", purchase };
  }

  const debit = await debitCoins(env, {
    guildId, userId, amount: fresh.price, source: "discord_shop",
    relatedId: purchase.id, idempotencyKey: `purchase:${purchase.id}`, reason: `Shop: ${fresh.name}`, meta
  });
  if (!debit.ok) {
    await restoreShopStock(env, guildId, fresh.id, fresh);
    await setPurchaseStatus(env, guildId, purchase.id, "failed", { failureReason: "Insufficient balance" });
    return { ok: false, error: "You do not have enough Baltic Coins for that item.", purchase, balance: debit.balance };
  }

  if (fresh.itemType === "manual") {
    await setPurchaseStatus(env, guildId, purchase.id, "awaiting_fulfillment");
    return { ok: true, pending: true, purchase: await getPurchase(env, guildId, purchase.id), balance: debit.balance };
  }

  // --- Discord role delivery -------------------------------------------
  const fail = async (reason, { refund = true } = {}) => {
    if (refund) await refundPurchaseInternal(env, guildId, purchase, { restoreItem: fresh });
    await setPurchaseStatus(env, guildId, purchase.id, "failed", { failureReason: reason });
    const wallet = await getWallet(env, guildId, userId);
    return { ok: false, error: reason, purchase: await getPurchase(env, guildId, purchase.id), balance: Number(wallet?.balance || 0) };
  };

  const roleCheck = await validateShopRole(env, guildId, fresh.roleId);
  if (roleCheck.error) return fail(roleCheck.error);
  const member = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`);
  if (!member.ok) return fail(member.status === 404 ? "That member is no longer in this server." : describeDiscordFailure(member.status, "the member", member.noToken));
  const owned = Array.isArray(member.data?.roles) ? member.data.roles.map(String) : [];
  if (owned.includes(String(fresh.roleId))) return fail("You already have that role.", { refund: true });

  const res = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${fresh.roleId}`, { method: "PUT" });
  if (res.ok || res.status === 204) {
    await setPurchaseStatus(env, guildId, purchase.id, "completed");
    return { ok: true, purchase: await getPurchase(env, guildId, purchase.id), balance: debit.balance };
  }
  if ([400, 403, 404].includes(res.status)) {
    return fail(res.status === 403
      ? "The bot cannot grant that role (permissions or role hierarchy). Your Coins were refunded."
      : "Discord refused to grant that role. Your Coins were refunded.");
  }
  // Delivery UNVERIFIED (network/5xx): keep the charge, flag for staff —
  // auto-refunding here could hand out both the role and the Coins.
  await setPurchaseStatus(env, guildId, purchase.id, "failed", { failureReason: "Delivery unverified — staff review required (refunding after confirming no role was granted)" });
  return { ok: false, uncertain: true, error: "The role delivery could not be confirmed. Staff will review this purchase — no Coins were lost silently.", purchase: await getPurchase(env, guildId, purchase.id) };
}

/* ------------------------------------------- Discord slash commands ---- */

export async function coinsBalanceInteraction(env, interaction) {
  try {
    const guildId = String(interaction?.guild_id || "");
    if (!guildId) return noGuildReply();
    await ensureCoinsTables(env);
    const selfId = String(interaction?.member?.user?.id || "");
    const asked = interaction?.data?.options?.find((o) => o.name === "member")?.value;
    const userId = String(asked || selfId);
    if (!isSnowflake(userId)) return errReply("Could not resolve that member.");
    const { settings } = await getCoinsConfig(env, guildId);
    // Read-only views never mint a starting balance while the economy is off.
    const wallet = await ensureWallet(env, guildId, userId, settings.enabled ? settings : { ...settings, startingBalance: 0 });
    const label = userId === selfId ? "Your" : "Their";
    return okReply([coinEmbed({
      title: `${COINS_ICON} ${label} Baltic Coins balance`,
      description: `**${fmtCoins(wallet?.balance || 0)} ${COINS_CURRENCY}**`,
      fields: [
        { name: "Total earned", value: fmtCoins(wallet?.totalEarned || 0), inline: true },
        { name: "Total spent", value: fmtCoins(wallet?.totalSpent || 0), inline: true },
        { name: "Server", value: "This server's independent economy", inline: true }
      ]
    })]);
  } catch (e) {
    console.log(JSON.stringify({ component: "coins", event: "command-failed", command: "balance", detail: String(e?.message || e).slice(0, 200) }));
    return errReply("Could not load that balance right now. Please try again.");
  }
}

export async function coinsDailyInteraction(env, interaction) {
  try {
    const guildId = String(interaction?.guild_id || "");
    if (!guildId) return noGuildReply();
    const userId = String(interaction?.member?.user?.id || "");
    const result = await claimDailyReward(env, guildId, userId, identityOf(interaction));
    if (result.code === "disabled") return errReply(result.error);
    if (result.code === "cooldown") {
      return okReply([coinEmbed({
        title: `${COINS_ICON} Daily reward — on cooldown`,
        description: `Next daily available in **${formatRemaining(result.remainingMs)}**.\nCurrent balance: **${fmtCoins(result.balance)} ${COINS_CURRENCY}**`
      })]);
    }
    if (!result.ok) return errReply(result.error || "The daily reward could not be claimed.");
    return okReply([coinEmbed({
      title: `${COINS_ICON} Daily reward claimed!`,
      description: `You received **${fmtCoins(result.amount)} ${COINS_CURRENCY}**.\nNew balance: **${fmtCoins(result.balance)} ${COINS_CURRENCY}**\nNext claim in **${formatRemaining(result.remainingMs)}**.`
    })]);
  } catch (e) {
    console.log(JSON.stringify({ component: "coins", event: "command-failed", command: "daily", detail: String(e?.message || e).slice(0, 200) }));
    return errReply("Could not claim your daily reward right now. Please try again.");
  }
}

export async function coinsPayInteraction(env, interaction) {
  try {
    const guildId = String(interaction?.guild_id || "");
    if (!guildId) return noGuildReply();
    const options = interaction?.data?.options || [];
    const targetId = String(options.find((o) => o.name === "member")?.value || "");
    const amountRaw = Number(options.find((o) => o.name === "amount")?.value);
    const senderId = String(interaction?.member?.user?.id || "");
    if (!isSnowflake(targetId)) return errReply("Choose the member you want to pay.");
    const amount = Math.floor(amountRaw);
    if (!Number.isFinite(amount) || amount < 1) return errReply("Send a whole number of Coins greater than zero.");
    if (targetId === senderId) return errReply("You cannot send Coins to yourself.");
    const resolved = interaction?.data?.resolved?.users?.[targetId];
    if (resolved?.bot) return errReply("You cannot pay a bot.");
    const targetIdentity = resolved
      ? { username: String(resolved.username || "").slice(0, 80), displayName: String(resolved.global_name || resolved.username || "").slice(0, 80), avatar: String(resolved.avatar || "").slice(0, 80) }
      : null;
    // The interaction id makes a retried/double-clicked /pay idempotent.
    const idempotencyKey = interaction?.id ? `pay:${guildId}:${String(interaction.id)}` : "";
    const result = await processTransfer(
      env, guildId,
      { userId: senderId, identity: identityOf(interaction) },
      { userId: targetId, identity: targetIdentity },
      amount, { idempotencyKey }
    );
    if (!result.ok) return errReply(result.error);
    return okReply([coinEmbed({
      title: `${COINS_ICON} Transfer sent`,
      description: `Sent **${fmtCoins(amount)} ${COINS_CURRENCY}** to <@${targetId}>.\nYour balance: **${fmtCoins(result.fromBalance)} ${COINS_CURRENCY}**${result.duplicate ? "\n*(already processed — never charged twice)*" : ""}`
    })]);
  } catch (e) {
    console.log(JSON.stringify({ component: "coins", event: "command-failed", command: "pay", detail: String(e?.message || e).slice(0, 200) }));
    return errReply("The transfer could not be completed. Please try again.");
  }
}

async function adminAdjustCoins(env, interaction, { action, targetId, amount, reason }) {
  const guildId = String(interaction.guild_id || "");
  const actorId = String(interaction?.member?.user?.id || "");
  const settings = (await getCoinsConfig(env, guildId)).settings;
  const member = await discordJson(env, `https://discord.com/api/v10/guilds/${guildId}/members/${targetId}`);
  if (member.status === 404) return { error: "That member is not in this server." };
  if (!member.ok) return { error: "Could not verify that member. Please try again." };
  const identity = {
    username: String(member.data?.user?.username || "").slice(0, 80),
    displayName: String(member.data?.nick || member.data?.user?.global_name || member.data?.user?.username || "").slice(0, 80),
    avatar: member.data?.user?.avatar || ""
  };
  const wallet = await ensureWallet(env, guildId, targetId, settings);
  await setWalletIdentity(env, guildId, targetId, identity);
  const previousBalance = Number(wallet?.balance || 0);
  const idempotencyKey = interaction?.id ? `admin:${guildId}:${String(interaction.id)}` : "";
  let balance = previousBalance;
  if (action === "add") {
    const res = await creditCoins(env, { guildId, userId: targetId, amount, source: "admin_adjustment", actorId, reason, idempotencyKey });
    if (!res.ok) return { error: res.error || "Could not credit that wallet." };
    balance = res.balance;
  } else if (action === "remove") {
    const res = await debitCoins(env, { guildId, userId: targetId, amount, source: "admin_adjustment", actorId, reason, idempotencyKey });
    if (!res.ok) return { error: res.error || "Could not debit that wallet." };
    balance = res.balance;
  } else {
    const target = clampCoins(amount);
    if (target > previousBalance) {
      const res = await creditCoins(env, { guildId, userId: targetId, amount: target - previousBalance, source: "admin_adjustment", actorId, reason: reason || "Set balance", idempotencyKey });
      if (!res.ok) return { error: res.error || "Could not set that balance." };
      balance = res.balance;
    } else if (target < previousBalance) {
      const res = await debitCoins(env, { guildId, userId: targetId, amount: previousBalance - target, source: "admin_adjustment", actorId, reason: reason || "Set balance", idempotencyKey });
      if (!res.ok) return { error: res.error || "Could not set that balance." };
      balance = res.balance;
    }
  }
  return { previousBalance, balance };
}

/** Router for /coins subcommands (leaderboard, shop, buy, history, admin). */
export async function coinsCommandsRouter(env, interaction) {
  try {
    const guildId = String(interaction?.guild_id || "");
    if (!guildId) return noGuildReply();
    await ensureCoinsTables(env);
    const group = interaction?.data?.options?.[0];
    const sub = String(group?.name || "");
    const args = Array.isArray(group?.options) ? group.options : [];
    const arg = (name) => args.find((o) => o.name === name)?.value;

    if (sub === "leaderboard") {
      const limit = [10, 50, 100].includes(Number(arg("limit"))) ? Number(arg("limit")) : 10;
      const rows = await coinsLeaderboard(env, guildId, { limit });
      if (!rows.length) return okReply([coinEmbed({ title: `${COINS_ICON} Baltic Coins leaderboard`, description: "No wallets yet in this server." })]);
      const lines = rows.map((r, i) => {
        const name = r.displayName || r.username || `<@${r.userId}>`;
        return `**${i + 1}.** ${name} — **${fmtCoins(r.balance)}**`;
      });
      return okReply([coinEmbed({ title: `${COINS_ICON} Richest members — Top ${rows.length}`, description: lines.join("\n") })]);
    }

    if (sub === "shop") {
      const items = await listShopItems(env, guildId, { enabledOnly: true });
      if (!items.length) return okReply([coinEmbed({ title: `${COINS_ICON} Server shop`, description: "No items are for sale right now." })]);
      const lines = items.slice(0, 20).map((i) => {
        const stock = i.stock === null || i.stock === undefined ? "" : ` · stock ${i.stock}`;
        return `**${i.name}** — ${fmtCoins(i.price)} Coins${i.itemType === "role" ? " · Discord role" : " · manual reward"}${stock}${i.description ? `\n↳ ${i.description.slice(0, 120)}` : ""}`;
      });
      return okReply([coinEmbed({ title: `${COINS_ICON} Server shop`, description: lines.join("\n\n") })]);
    }

    if (sub === "buy") {
      const userId = String(interaction?.member?.user?.id || "");
      const needle = String(arg("item") || "");
      const result = await buyShopItem(env, guildId, userId, needle, {
        idempotencyKey: interaction?.id ? `buy:${guildId}:${String(interaction.id)}` : "",
        identity: identityOf(interaction)
      });
      if (!result.ok) return errReply(result.error);
      if (result.pending) {
        return okReply([coinEmbed({
          title: `${COINS_ICON} Purchase received`,
          description: `**${result.purchase.itemName}** — ${fmtCoins(result.purchase.price)} Coins\nStaff will fulfil your reward soon.\nBalance: **${fmtCoins(result.balance)} ${COINS_CURRENCY}**`
        })]);
      }
      return okReply([coinEmbed({
        title: `${COINS_ICON} Purchase complete`,
        description: `You bought **${result.purchase.itemName}** for ${fmtCoins(result.purchase.price)} Coins.\nBalance: **${fmtCoins(result.balance)} ${COINS_CURRENCY}**`
      })]);
    }

    if (sub === "history") {
      const userId = String(interaction?.member?.user?.id || "");
      const limit = [5, 10].includes(Number(arg("limit"))) ? Number(arg("limit")) : 5;
      const rows = await listTransactions(env, guildId, { userId, limit });
      if (!rows.length) return okReply([coinEmbed({ title: `${COINS_ICON} Wallet history`, description: "No transactions yet." })]);
      const lines = rows.map((t) => {
        const sign = t.amount >= 0 ? "+" : "−";
        return `${sign}${fmtCoins(Math.abs(t.amount))} · ${SOURCE_LABEL[t.source] || t.source} → bal ${fmtCoins(t.balanceAfter)}`;
      });
      return okReply([coinEmbed({ title: `${COINS_ICON} Your recent transactions`, description: lines.join("\n") })]);
    }

    if (sub === "admin") {
      if (!isAdminInteraction(interaction)) return errReply("Administrator permission is required for wallet management.");
      const action = String(arg("action") || "");
      const targetId = String(arg("member") || "");
      const reason = String(arg("reason") || "").slice(0, 120);
      if (!isSnowflake(targetId)) return errReply("Choose a valid member.");
      const userId = String(interaction?.member?.user?.id || "");

      if (action === "view") {
        const wallet = await ensureWallet(env, guildId, targetId, (await getCoinsConfig(env, guildId)).settings);
        return okReply([coinEmbed({
          title: `${COINS_ICON} Wallet — <@${targetId}>`,
          description: `Balance: **${fmtCoins(wallet?.balance || 0)} ${COINS_CURRENCY}**`,
          fields: [
            { name: "Earned", value: fmtCoins(wallet?.totalEarned || 0), inline: true },
            { name: "Spent", value: fmtCoins(wallet?.totalSpent || 0), inline: true }
          ]
        })]);
      }
      if (action === "history") {
        const rows = await listTransactions(env, guildId, { userId: targetId, limit: 10 });
        const lines = rows.length
          ? rows.map((t) => `${t.amount >= 0 ? "+" : "−"}${fmtCoins(Math.abs(t.amount))} · ${SOURCE_LABEL[t.source] || t.source}${t.actorId ? ` · by <@${t.actorId}>` : ""} → bal ${fmtCoins(t.balanceAfter)}`)
          : ["No transactions yet."];
        return okReply([coinEmbed({ title: `${COINS_ICON} Wallet history — <@${targetId}>`, description: lines.join("\n") })]);
      }
      const amount = Math.floor(Number(arg("amount")));
      if (!Number.isFinite(amount) || amount < 1) return errReply("Provide a whole Coin amount for this action.");
      const result = await adminAdjustCoins(env, interaction, { action, targetId, amount, reason });
      if (result.error) return errReply(result.error);
      return okReply([coinEmbed({
        title: `${COINS_ICON} Wallet updated`,
        description: `<@${targetId}>: ${fmtCoins(result.previousBalance)} → **${fmtCoins(result.balance)} ${COINS_CURRENCY}**${reason ? `\nReason: ${reason}` : ""}`
      })]);
    }

    return errReply("Unknown /coins subcommand.");
  } catch (e) {
    console.log(JSON.stringify({ component: "coins", event: "command-failed", command: "coins", detail: String(e?.message || e).slice(0, 200) }));
    return errReply("That command could not be completed. Please try again.");
  }
}

/* -------------------------------------- future game economy service ----
   THE reusable wallet API for future BalticM games (RPG, fishing, racing …)
   and authorized external integrations. Games share the guild's Baltic Coins
   wallet — never a per-game wallet — and every call requires a per-guild
   integration row with the matching allow-flag, so a game can never mint
   unlimited Coins. There is intentionally NO public HTTP route to this
   service in V1; it is invoked from inside the worker only. */

async function gameIntegration(env, guildId, gameKey) {
  await ensureCoinsTables(env);
  const key = String(gameKey || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
  if (!key) return null;
  const row = await env.BALTICM_DB.prepare(
    "SELECT game_key AS gameKey, enabled, allow_credit AS allowCredit, allow_debit AS allowDebit, daily_limit AS dailyLimit FROM coins_game_integrations WHERE guild_id=? AND game_key=?"
  ).bind(String(guildId), key).first();
  return row || null;
}

const gameDenied = (msg) => ({ ok: false, code: "game_unauthorized", error: msg });

export const gameEconomy = {
  /** Read a guild wallet (integration must be enabled). */
  async getBalance(env, { guildId, gameKey, userId }) {
    const integ = await gameIntegration(env, guildId, gameKey);
    if (!integ || Number(integ.enabled) !== 1) return gameDenied("This game is not connected to this server's economy.");
    const wallet = await getWallet(env, guildId, userId);
    return { ok: true, balance: Number(wallet?.balance || 0) };
  },

  /** Credit Coins from a game event (game_reward) — allow-flag + daily cap. */
  async credit(env, { guildId, gameKey, userId, amount, eventKey, reason = "" }) {
    const integ = await gameIntegration(env, guildId, gameKey);
    if (!integ || Number(integ.enabled) !== 1) return gameDenied("This game is not connected to this server's economy.");
    if (Number(integ.allowCredit) !== 1) return gameDenied("This game may not award Coins in this server.");
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt < 1) return { ok: false, code: "invalid_amount", error: "Amount must be a positive whole number." };
    const limit = Number(integ.dailyLimit || 0);
    if (limit > 0) {
      const day = new Date().toISOString().slice(0, 10);
      const row = await env.BALTICM_DB.prepare(
        "SELECT COALESCE(SUM(amount),0) AS v FROM coins_transactions WHERE guild_id=? AND source='game_reward' AND created_at LIKE ?"
      ).bind(String(guildId), `${day}%`).first();
      if (Number(row?.v || 0) + amt > limit) return gameDenied(`This game's daily reward limit (${fmtCoins(limit)} Coins) has been reached.`);
    }
    const { settings } = await getCoinsConfig(env, guildId);
    await ensureWallet(env, guildId, userId, settings);
    return creditCoins(env, {
      guildId, userId, amount: amt, source: "game_reward",
      relatedId: `${integ.gameKey}:${String(eventKey || "").slice(0, 80)}`,
      reason, meta: JSON.stringify({ game: integ.gameKey }),
      idempotencyKey: `game:${guildId}:${integ.gameKey}:${String(eventKey || "").slice(0, 80)}`
    });
  },

  /** Spend Coins on a game event (game_purchase) — overdraw-proof. */
  async debit(env, { guildId, gameKey, userId, amount, eventKey, reason = "" }) {
    const integ = await gameIntegration(env, guildId, gameKey);
    if (!integ || Number(integ.enabled) !== 1) return gameDenied("This game is not connected to this server's economy.");
    if (Number(integ.allowDebit) !== 1) return gameDenied("This game may not spend Coins in this server.");
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt < 1) return { ok: false, code: "invalid_amount", error: "Amount must be a positive whole number." };
    await ensureWallet(env, guildId, userId, (await getCoinsConfig(env, guildId)).settings);
    return debitCoins(env, {
      guildId, userId, amount: amt, source: "game_purchase",
      relatedId: `${integ.gameKey}:${String(eventKey || "").slice(0, 80)}`,
      reason, meta: JSON.stringify({ game: integ.gameKey }),
      idempotencyKey: `gamepay:${guildId}:${integ.gameKey}:${String(eventKey || "").slice(0, 80)}`
    });
  },

  /** Move Coins between two members of this guild (trades, gifting).
      Requires BOTH allow-flags — one side spends, the other earns. The
      ledger keeps the spec's `discord_transfer` vocabulary for the linked
      pair; `meta` identifies the game on both entries. Idempotent per event. */
  async transfer(env, { guildId, gameKey, fromUserId, toUserId, amount, eventKey, reason = "" }) {
    const integ = await gameIntegration(env, guildId, gameKey);
    if (!integ || Number(integ.enabled) !== 1) return gameDenied("This game is not connected to this server's economy.");
    if (Number(integ.allowCredit) !== 1 || Number(integ.allowDebit) !== 1) {
      return gameDenied("This game may not move Coins in this server (both credit and debit permission are required).");
    }
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt < 1) return { ok: false, code: "invalid_amount", error: "Amount must be a positive whole number." };
    if (!eventKey) return { ok: false, code: "invalid_event", error: "A game transfer requires an event id for idempotency." };
    if (String(fromUserId) === String(toUserId)) return { ok: false, code: "invalid_target", error: "A game cannot transfer Coins to the same member." };
    const { settings } = await getCoinsConfig(env, guildId);
    await ensureWallet(env, guildId, fromUserId, settings);
    await ensureWallet(env, guildId, toUserId, settings);
    return transferCoins(env, {
      guildId, fromUserId, toUserId, amount: amt,
      idempotencyKey: `gametransfer:${guildId}:${integ.gameKey}:${String(eventKey || "").slice(0, 80)}`,
      reason, meta: JSON.stringify({ game: integ.gameKey })
    });
  },

  /** Buy an item from the guild's shared shop on behalf of a member —
      the SAME purchase pipeline (stock, limits, idempotent states) the
      Discord `/coins buy` command uses, namespaced by the game event. */
  async purchase(env, { guildId, gameKey, userId, item, eventKey, identity = null }) {
    const integ = await gameIntegration(env, guildId, gameKey);
    if (!integ || Number(integ.enabled) !== 1) return gameDenied("This game is not connected to this server's economy.");
    if (Number(integ.allowDebit) !== 1) return gameDenied("This game may not spend Coins in this server.");
    if (!eventKey) return { ok: false, code: "invalid_event", error: "A game purchase requires an event id for idempotency." };
    return buyShopItem(env, guildId, userId, item, {
      idempotencyKey: `gamebuy:${guildId}:${integ.gameKey}:${String(eventKey).slice(0, 80)}`,
      identity,
      meta: JSON.stringify({ game: integ.gameKey, event: String(eventKey).slice(0, 80) })
    });
  },

  /** Reverse a game purchase (idempotent — one refund per event). */
  async refund(env, { guildId, gameKey, userId, amount, eventKey, reason = "Game refund" }) {
    const integ = await gameIntegration(env, guildId, gameKey);
    if (!integ || Number(integ.enabled) !== 1) return gameDenied("This game is not connected to this server's economy.");
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt < 1) return { ok: false, code: "invalid_amount", error: "Amount must be a positive whole number." };
    await ensureWallet(env, guildId, userId, (await getCoinsConfig(env, guildId)).settings);
    return creditCoins(env, {
      guildId, userId, amount: amt, source: "game_purchase",
      relatedId: `${integ.gameKey}:${String(eventKey || "").slice(0, 80)}`,
      reason, meta: JSON.stringify({ game: integ.gameKey, refund: true }),
      idempotencyKey: `gamerefund:${guildId}:${integ.gameKey}:${String(eventKey || "").slice(0, 80)}`
    });
  },

  /** Transaction history for one wallet (optionally only one game's). */
  async history(env, { guildId, userId, limit = 25, gameKey = "" }) {
    await ensureCoinsTables(env);
    const rows = await listTransactions(env, guildId, { userId, limit });
    if (!gameKey) return { ok: true, transactions: rows };
    const prefix = `${String(gameKey).slice(0, 40)}:`;
    return { ok: true, transactions: rows.filter((t) => String(t.relatedId || "").startsWith(prefix) || String(t.meta || "").includes(String(gameKey))) };
  }
};
