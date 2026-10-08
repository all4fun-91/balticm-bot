/* Baltic Coins V1 — pure shared helpers (no I/O, no Discord, no DOM).
   The worker (API, wallet/ledger engine, slash commands) and the Control
   Center both import this file so bounds, validation and command planning
   behave identically everywhere. Every value is guild-scoped upstream —
   this module never sees a guild id without its caller attaching one. */

import { isSnowflake } from "./leveling.js";

export const COINS_CURRENCY = "Baltic Coins";
export const COINS_ICON = "🪙";

export const COINS_DEFAULTS = {
  enabled: false, // per-guild opt-in: nothing moves until an admin enables it
  transfersEnabled: true,
  shopEnabled: true,
  startingBalance: 0,
  dailyEnabled: true,
  dailyAmount: 100,
  dailyCooldown: 86400, // seconds (24 hours)
  messageEnabled: true,
  messageAmount: 5,
  messageCooldown: 60,
  voiceEnabled: true,
  voiceAmount: 10,
  voiceInterval: 600, // 10 minutes
  excludedChannels: [],
  excludedRoles: []
};

/* Safe configuration limits — an admin can never configure an economy that
   floods the bot or drains the ledger. All amounts are integers. */
export const COINS_BOUNDS = {
  startingBalance: [0, 1000000],
  dailyAmount: [1, 1000000],
  dailyCooldown: [60, 604800], // 1 minute … 7 days
  messageAmount: [1, 1000],
  messageCooldown: [10, 86400],
  voiceAmount: [1, 10000],
  voiceInterval: [60, 86400],
  transferAmount: [1, 1000000000],
  adjustAmount: [1, 1000000000],
  shopPrice: [1, 1000000000],
  shopStock: [0, 1000000],
  purchaseLimit: [1, 10000]
};

/** Hard ceiling for any single wallet — keeps every balance a safe integer. */
export const COINS_MAX_BALANCE = 1000000000;
/** Minimum gap between two outgoing transfers from one member (ms). */
export const TRANSFER_GAP_MS = 5000;
/** Repeated identical message signatures inside this window never reward. */
export const MESSAGE_SPAM_WINDOW_MS = 10 * 60 * 1000;

/** Every balance change MUST carry one of these sources. */
export const TX_SOURCES = [
  "starting_balance",
  "discord_daily",
  "discord_message",
  "discord_voice",
  "discord_transfer",
  "discord_shop",
  "shop_refund",
  "game_reward",
  "game_purchase",
  "admin_adjustment",
  "future_paid_purchase"
];

export const SHOP_ITEM_TYPES = ["role", "manual"];
export const PURCHASE_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "refunded",
  "awaiting_fulfillment"
];

export const COINS_COMMAND_DEFINITIONS = [
  { name: "balance", description: "Show your Baltic Coins balance in this server", type: 1, options: [
    { type: 6, name: "member", description: "View another member's public balance", required: false }
  ] },
  { name: "daily", description: "Claim your daily Baltic Coins reward", type: 1, options: [] },
  { name: "pay", description: "Transfer Baltic Coins to another member of this server", type: 1, options: [
    { type: 6, name: "member", description: "Member to pay", required: true },
    { type: 10, name: "amount", description: "How many Coins to send", required: true }
  ] },
  { name: "coins", description: "Baltic Coins economy — balance, shop, leaderboard and admin", type: 1, options: [
    { type: 1, name: "leaderboard", description: "The richest members in this server", options: [
      { type: 4, name: "limit", description: "How many members", required: false, choices: [
        { name: "Top 10", value: 10 }, { name: "Top 50", value: 50 }, { name: "Top 100", value: 100 }
      ] }
    ] },
    { type: 1, name: "shop", description: "Browse this server's shop" },
    { type: 1, name: "buy", description: "Buy an item from this server's shop", options: [
      { type: 3, name: "item", description: "Item name (or part of it)", required: true }
    ] },
    { type: 1, name: "history", description: "Your recent Baltic Coins transactions", options: [
      { type: 4, name: "limit", description: "How many entries", required: false, choices: [
        { name: "5", value: 5 }, { name: "10", value: 10 }
      ] }
    ] },
    { type: 1, name: "admin", description: "Manage a member's wallet (administrators only)", options: [
      { type: 3, name: "action", description: "Wallet action", required: true, choices: [
        { name: "Add Coins", value: "add" },
        { name: "Remove Coins", value: "remove" },
        { name: "Set balance", value: "set" },
        { name: "View wallet", value: "view" },
        { name: "View history", value: "history" }
      ] },
      { type: 6, name: "member", description: "Target member", required: true },
      { type: 10, name: "amount", description: "Coin amount (add/remove/set)", required: false },
      { type: 3, name: "reason", description: "Why this changes (audit log)", required: false }
    ] }
  ] }
];

const SNOWFLAKE_OK = isSnowflake;
export { SNOWFLAKE_OK };

/** Integer clamp into a safe range; never negative, never fractional. */
export function clampCoins(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, COINS_MAX_BALANCE);
}

function num(value, fallback, [min, max]) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function idList(value, max = 100) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || "").trim()).filter(SNOWFLAKE_OK))].slice(0, max);
}

/** Positive whole-coin amount inside the configured bounds. */
export function parseCoinAmount(value, bounds = COINS_BOUNDS.transferAmount) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return { ok: false, error: "Enter a whole number of Coins greater than zero." };
  if (n > bounds[1]) return { ok: false, error: `Amount must be ${bounds[1].toLocaleString("en-US")} Coins or less.` };
  return { ok: true, value: n };
}

/** Never allow a negative balance anywhere in the system. */
export function assertNonNegative(balance) {
  return Math.max(0, Math.floor(Number(balance) || 0));
}

/* ------------------------------------------ Premium redemption firewall --
   Baltic Coins can NEVER purchase BalticM Premium — permanent, enforced on
   the backend and the fulfilment layer, never just hidden in the UI. A
   manual reward whose text promises Premium/subscription/redemption codes
   is rejected at creation AND at fulfilment time. */
export const PREMIUM_REDEMPTION_RE = /premium|tebex|subscription|activation\s*code|promo\s*code|(?:vip|premium)\s*(?:day|week|month|year|code|key|trial)/i;

export function premiumRedemptionBlocked(text) {
  return PREMIUM_REDEMPTION_RE.test(String(text || ""));
}

export function assertNotPremiumReward(name, description = "") {
  if (premiumRedemptionBlocked(name) || premiumRedemptionBlocked(description)) {
    return {
      ok: false,
      code: "premium_redemption_forbidden",
      error: "Baltic Coins can never purchase BalticM Premium. Remove Premium/subscription wording from this reward — Coins and Premium stay separate systems."
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------ settings --*/

/** Full settings payload. Unknown keys are dropped; every number lands inside
    the safe bounds; the currency identity stays Baltic Coins / 🪙 in V1. */
export function parseCoinsSettings(body) {
  const b = body && typeof body === "object" ? body : {};
  const value = {
    enabled: b.enabled === true,
    transfersEnabled: b.transfersEnabled !== false,
    shopEnabled: b.shopEnabled !== false,
    startingBalance: num(b.startingBalance, COINS_DEFAULTS.startingBalance, COINS_BOUNDS.startingBalance),
    dailyEnabled: b.dailyEnabled !== false,
    dailyAmount: num(b.dailyAmount, COINS_DEFAULTS.dailyAmount, COINS_BOUNDS.dailyAmount),
    dailyCooldown: num(b.dailyCooldown, COINS_DEFAULTS.dailyCooldown, COINS_BOUNDS.dailyCooldown),
    messageEnabled: b.messageEnabled !== false,
    messageAmount: num(b.messageAmount, COINS_DEFAULTS.messageAmount, COINS_BOUNDS.messageAmount),
    messageCooldown: num(b.messageCooldown, COINS_DEFAULTS.messageCooldown, COINS_BOUNDS.messageCooldown),
    voiceEnabled: b.voiceEnabled !== false,
    voiceAmount: num(b.voiceAmount, COINS_DEFAULTS.voiceAmount, COINS_BOUNDS.voiceAmount),
    voiceInterval: num(b.voiceInterval, COINS_DEFAULTS.voiceInterval, COINS_BOUNDS.voiceInterval),
    excludedChannels: idList(b.excludedChannels),
    excludedRoles: idList(b.excludedRoles)
  };
  return { ok: true, value };
}

/* ----------------------------------------------------------- shop item --*/

export function parseShopItem(body, { existing = null } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Give the item a name." };
  const description = String(b.description || "").replace(/\r/g, "").trim().slice(0, 200);
  // The Premium firewall applies to what administrators CREATE — backend,
  // before anything is stored, let alone fulfilable.
  const guard = assertNotPremiumReward(name, description);
  if (!guard.ok) return guard;
  const price = Math.floor(Number(b.price));
  if (!Number.isFinite(price) || price < 1 || price > COINS_BOUNDS.shopPrice[1]) {
    return { ok: false, error: `Price must be a whole number between 1 and ${COINS_BOUNDS.shopPrice[1].toLocaleString("en-US")} Coins.` };
  }
  const itemType = String(b.itemType || "");
  if (!SHOP_ITEM_TYPES.includes(itemType)) return { ok: false, error: "Item type must be a Discord role or a manual reward." };
  const roleId = itemType === "role" ? String(b.roleId || "").trim() : "";
  if (itemType === "role" && !SNOWFLAKE_OK(roleId)) return { ok: false, error: "Choose the Discord role this item grants." };
  let stock = null;
  if (b.stock !== null && b.stock !== undefined && b.stock !== "") {
    const s = Math.floor(Number(b.stock));
    if (!Number.isFinite(s) || s < 0 || s > COINS_BOUNDS.shopStock[1]) return { ok: false, error: "Stock must be 0 or a positive whole number (leave empty for unlimited)." };
    stock = s;
  }
  let purchaseLimit = null;
  if (b.purchaseLimit !== null && b.purchaseLimit !== undefined && b.purchaseLimit !== "") {
    const l = Math.floor(Number(b.purchaseLimit));
    if (!Number.isFinite(l) || l < 1 || l > COINS_BOUNDS.purchaseLimit[1]) return { ok: false, error: "Purchase limit must be between 1 and 10000 (leave empty for unlimited)." };
    purchaseLimit = l;
  }
  const base = existing || {};
  return {
    ok: true,
    value: {
      name,
      description,
      price,
      itemType,
      roleId,
      stock: stock === null ? (base.stock ?? null) : stock,
      purchaseLimit: purchaseLimit === null ? (base.purchaseLimit ?? null) : purchaseLimit,
      enabled: b.enabled !== false
    }
  };
}

/* --------------------------------------------------- admin adjustments --*/

export const COIN_ACTIONS = ["add", "remove", "set"];

export function parseCoinAction(body) {
  const b = body && typeof body === "object" ? body : {};
  const action = String(b.action || "");
  if (!COIN_ACTIONS.includes(action)) return { ok: false, error: "Unknown wallet action." };
  const userId = String(b.userId || "").trim();
  if (!SNOWFLAKE_OK(userId)) return { ok: false, error: "Choose a valid member." };
  const amount = Math.floor(Number(b.amount));
  if (!Number.isFinite(amount) || amount < 1 || amount > COINS_BOUNDS.adjustAmount[1]) {
    return { ok: false, error: "Amount must be a whole number between 1 and 1000000000." };
  }
  if (b.confirm !== true) {
    return { ok: false, error: "Confirmation is required to change a wallet balance.", code: "confirm_required" };
  }
  const reason = String(b.reason || "").replace(/\s+/g, " ").trim().slice(0, 120);
  return { ok: true, value: { action, userId, amount, reason } };
}

/** Human-readable amount with thousands separators (shared UI + embeds). */
export function fmtCoins(n) {
  return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString("en-US");
}

/** Milliseconds left on a cooldown that last fired at `lastAt`. */
export function cooldownRemainingMs(lastAt, cooldownSeconds, now = Date.now()) {
  const end = Number(lastAt || 0) + Number(cooldownSeconds || 0) * 1000;
  return Math.max(0, end - now);
}

/** "2h 13m" / "45s" style remaining time for Discord embeds. */
export function formatRemaining(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
