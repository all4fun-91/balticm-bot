/* BalticM Leveling V1 — pure shared helpers (no I/O, no Discord, no DOM).
   The worker (API, Discord listeners, /rank & /leaderboard) and the Control
   Center both import this file so XP bounds, level math, sanitisation and the
   merge-based command synchronisation behave identically everywhere. */

export const LEVELING_DEFAULTS = {
  enabled: false,
  messageXp: true,
  voiceXp: false,
  minXp: 15,
  maxXp: 25,
  messageCooldown: 60, // seconds between rewarded messages
  voiceXpAmount: 10,
  voiceInterval: 60, // seconds between rewarded voice ticks
  announceMode: "off", // off | same_channel | channel
  announceChannelId: "",
  announceMessage: "", // "" = default template
  announceCard: null, // V3 level-up card schema (null = legacy announcement)
  ignoredChannels: [],
  ignoredRoles: []
};

export const LEVELING_BOUNDS = {
  minXp: [1, 100],
  maxXp: [1, 200],
  messageCooldown: [10, 86400], // up to 24 hours (V3 interval dropdowns)
  voiceXpAmount: [1, 200],
  voiceInterval: [15, 86400]
};

export const FREE_REWARD_ROLE_LIMIT = 3;
export const REWARD_LEVEL_MAX = 1000;
export const ANNOUNCE_MODES = ["off", "same_channel", "channel"];
export const DEFAULT_ANNOUNCE_MESSAGE = "🎉 {user} reached Level {level}!";
export const ANNOUNCE_MESSAGE_MAX = 200;
/** Repeated identical content inside this window is never rewarded (anti-farm). */
export const MESSAGE_SPAM_WINDOW_MS = 10 * 60 * 1000;
export const XP_ACTION_MAX = 1000000;
export const ALLOWED_ANNOUNCE_PLACEHOLDERS = ["user", "username", "level", "server"];

const SNOWFLAKE = /^\d{16,22}$/;
export const isSnowflake = (v) => SNOWFLAKE.test(String(v || ""));

/* ---------------------------------------------------------------- levels --
   One shared XP → level progression used by the bot, API and Control Center.
   xpForLevel(1) = 0, then each level costs 100×level more than the previous
   (L2 = 100, L3 = 300, L4 = 600 … cumulative 50·(n−1)·n). Everything stays
   inside safe-integer range; XP is clamped non-negative before any maths. */

export function clampXp(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}

export function xpForLevel(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n) || n < 1) return 0;
  return 50 * (n - 1) * n;
}

export function levelForXp(xp) {
  const x = clampXp(xp);
  let n = Math.floor((1 + Math.sqrt(1 + (4 * x) / 50)) / 2); // closed-form seed
  if (!Number.isFinite(n) || n < 1) n = 1;
  // Correct any floating-point drift (bounded iterations, integer-safe).
  while (n < 1000000000 && xpForLevel(n + 1) <= x) n++;
  while (n > 1 && xpForLevel(n) > x) n--;
  return n;
}

export function levelProgress(xp) {
  const x = clampXp(xp);
  const level = levelForXp(x);
  const base = xpForLevel(level);
  const need = xpForLevel(level + 1) - base;
  return { level, into: x - base, need, ratio: need > 0 ? Math.min(1, (x - base) / need) : 1 };
}

/* ------------------------------------------------------------ anti-farm --
   Signature of a message for obvious-spam detection: normalised, truncated,
   never raw text. Empty signature (emoji-only messages) disables the
   same-signature rule for that message but the cooldown still applies. */

export function messageSignature(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 120);
}

/* --------------------------------------------------------- announcements --
   Custom content may never smuggle arbitrary Discord mentions: templates are
   sanitised at save time, user-supplied context is neutralised at render
   time, and the worker always sends with allowed_mentions restricted to the
   levelled-up user only. */

export function neutralizeMentions(text) {
  return String(text || "")
    .replace(/@everyone/gi, "")
    .replace(/@here/gi, "")
    .replace(/<@!?&?\d{16,22}>/g, "")
    .replace(/<#\d{16,22}>/g, "")
    .replace(/<!?\d{16,22}>/g, "");
}

/** Save-time sanitisation: strip mention-like text, drop unknown placeholders. */
export function sanitizeAnnounceMessage(text, maxLength = ANNOUNCE_MESSAGE_MAX) {
  let v = neutralizeMentions(String(text || ""));
  v = v.replace(/\{(?!user\}|username\}|level\}|server\})[^{}]*\}/g, "");
  // Whitespace is collapsed, but single newlines survive so the multiline
  // editor and the Discord message keep their line breaks.
  return v.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength);
}

/** Render the announcement content. Only the {user} mention survives. */
export function renderAnnounceMessage(template, { user, username, level, server } = {}) {
  const tpl = sanitizeAnnounceMessage(template || DEFAULT_ANNOUNCE_MESSAGE);
  const TOKEN = "\u0000USER\u0000";
  const out = tpl
    .replaceAll("{user}", TOKEN)
    .replaceAll("{username}", neutralizeMentions(String(username || "Member")).slice(0, 80) || "Member")
    .replaceAll("{level}", String(Math.max(1, Math.floor(Number(level) || 1))))
    .replaceAll("{server}", neutralizeMentions(String(server || "Server")).slice(0, 80) || "Server");
  const safe = neutralizeMentions(out.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
  const id = String(user || "").replace(/\D/g, "");
  return (id ? safe.replace(TOKEN, `<@${id}>`) : safe.replace(TOKEN, "")).slice(0, ANNOUNCE_MESSAGE_MAX);
}

/** Branded footer shown on FREE servers' level-up announcements. Premium
    servers never see it — the decision is made server-side from the real
    entitlement, never from a client flag. */
export const ANNOUNCE_BRANDING = "Powered by Bot.BalticM.eu • PLAY TOGETHER";

/** Celebratory embed that accompanies every level-up message: amber card,
    optional next-reward teaser, and the promotional footer for FREE servers
    only. Pure helper so the Control Center preview renders the same card. */
export function levelUpEmbed({ level, server, premium, nextReward, test = false } = {}) {
  const embed = { color: 0xe8892c, title: test ? "🧪 Test announcement" : `🎉 Level ${Math.max(1, Math.floor(Number(level) || 1))} unlocked!` };
  const lines = [];
  if (nextReward) lines.push(`Next reward: **Level ${Number(nextReward.level)}** → @${String(nextReward.roleName || "a role")}`);
  if (lines.length) embed.description = lines.join("\n");
  if (!premium) embed.footer = { text: ANNOUNCE_BRANDING };
  return embed;
}

/* ------------------------------------------------------------ V3 card --
   ONE schema for the level-up announcement embed. The Control Center
   preview and the real Discord payload are both rendered by
   renderLevelUpCard(), so what the administrator sees is exactly what the
   bot sends. Parsing is defensive (mentions stripped, unknown placeholders
   dropped, https-only images, bounded lengths) and a FREE guild can never
   store a custom card. Branding is decided AGAIN at render time from the
   real entitlement, so even a hand-edited card row cannot drop the
   promotional footer on a Free server. */

export const CARD_MODES = ["ready", "custom"];
export const CARD_TITLE_MAX = 256;
export const CARD_DESCRIPTION_MAX = 600;
export const CARD_EMOJI_MAX = 32;
export const CARD_FOOTER_MAX = 100;
export const CARD_IMAGE_MAX = 512;

export const READY_CARD_DESCRIPTION =
  "🎉 Congratulations, {user}!\n⭐ You reached Level {level}!\n🔥 Keep chatting, stay active and climb the ranks!";

export const DEFAULT_ANNOUNCE_CARD = {
  mode: "ready", // ready = built-in BalticM card, custom = admin-designed card
  title: "🏆 LEVEL UP!",
  description: READY_CARD_DESCRIPTION,
  color: "#e8892c",
  emoji: "", // optional line shown at the top of the embed description
  thumbnail: true, // member avatar, top-right
  serverIcon: true, // server icon in the footer
  footer: "", // custom footer text ("" = plan default; FREE always gets branding)
  showNextReward: true,
  image: "" // optional https:// image at the bottom of the embed
};

const UNKNOWN_PLACEHOLDER = /\{(?!user\}|username\}|level\}|server\})[^{}]*\}/g;

/** Card text: mention-stripped, unknown placeholders removed, bounded. */
function cardText(value, max, { multiline = true } = {}) {
  let v = neutralizeMentions(String(value ?? ""));
  v = v.replace(UNKNOWN_PLACEHOLDER, "");
  if (!multiline) v = v.replace(/\n/g, " ");
  return v.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

/** Accent colour: only #rgb / #rrggbb survive; anything else → default. */
export function cardColor(value) {
  const v = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return ("#" + v.slice(1).toLowerCase()).replace(/([0-9a-f])/g, "$1$1");
  return DEFAULT_ANNOUNCE_CARD.color;
}

/** Image URL: full https:// URLs only — http:, javascript: etc. are dropped. */
function cardImage(value) {
  const v = String(value || "").trim().slice(0, CARD_IMAGE_MAX);
  if (!v) return "";
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") return "";
    return u.toString().slice(0, CARD_IMAGE_MAX);
  } catch { return ""; }
}

/** Sanitise an incoming card. Absent card → null (legacy path stays intact). */
export function parseAnnounceCard(value, { premium = false } = {}) {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Invalid level-up card." };
  const mode = CARD_MODES.includes(String(value.mode || "")) ? String(value.mode) : "ready";
  // Custom cards mirror the existing Premium rule for custom announcement text.
  if (mode === "custom" && !premium) return { ok: false, premiumRequired: ["announceCard"] };
  return {
    ok: true,
    value: {
      mode,
      title: cardText(value.title, CARD_TITLE_MAX, { multiline: false }),
      description: cardText(value.description, CARD_DESCRIPTION_MAX) || DEFAULT_ANNOUNCE_CARD.description,
      color: cardColor(value.color),
      emoji: cardText(value.emoji, CARD_EMOJI_MAX, { multiline: false }),
      thumbnail: value.thumbnail !== false,
      serverIcon: value.serverIcon !== false,
      footer: cardText(value.footer, CARD_FOOTER_MAX, { multiline: false }),
      showNextReward: value.showNextReward !== false,
      image: cardImage(value.image)
    }
  };
}

/** Fill the four allowed placeholders. {user} becomes the real mention only
    when a mention is safe (embed description), otherwise the display name. */
function fillTemplate(text, { user, username, level, server } = {}, { mention = false, max = CARD_DESCRIPTION_MAX } = {}) {
  const TOKEN = "\u0000USER\u0000";
  const id = String(user || "").replace(/\D/g, "");
  const name = neutralizeMentions(String(username || "Member")).slice(0, 80) || "Member";
  const lvl = String(Math.max(1, Math.floor(Number(level) || 1)));
  const srv = neutralizeMentions(String(server || "Server")).slice(0, 80) || "Server";
  const out = String(text || "")
    .replaceAll("{user}", TOKEN)
    .replaceAll("{username}", name)
    .replaceAll("{level}", lvl)
    .replaceAll("{server}", srv);
  const safe = neutralizeMentions(out.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
  return safe.split(TOKEN).join(mention && id ? `<@${id}>` : name).slice(0, max);
}

/**
 * THE shared card renderer — the Control Center preview calls this with
 * sample context, the worker calls it with the real event, and both get the
 * identical Discord embed object.
 *
 * `premium` must always come from the server-side entitlement: when false
 * the promotional footer is forced regardless of what the card asks for.
 */
export function renderLevelUpCard(card, { user, username, level, server, premium = false, nextReward = null, avatar = null, serverIcon = null } = {}) {
  const stored = card && typeof card === "object" ? card : {};
  // READY mode renders only the built-in BalticM card — custom fields stay
  // stored but can never leak into a ready-made announcement.
  const c = stored.mode === "custom" ? { ...DEFAULT_ANNOUNCE_CARD, ...stored } : DEFAULT_ANNOUNCE_CARD;
  const ctx = { user, username, level, server };
  const lines = [];
  const emoji = cardText(c.emoji, CARD_EMOJI_MAX, { multiline: false });
  if (emoji) lines.push(emoji);
  const description = fillTemplate(c.description, ctx, { mention: true, max: CARD_DESCRIPTION_MAX });
  if (description) lines.push(description);
  if (c.showNextReward && nextReward) {
    lines.push(`Next reward: **Level ${Number(nextReward.level)}** → @${neutralizeMentions(String(nextReward.roleName || "a role")).slice(0, 80)}`);
  }
  const embed = {};
  const title = fillTemplate(c.title, ctx, { mention: false, max: CARD_TITLE_MAX });
  if (title) embed.title = title;
  if (lines.length) embed.description = lines.join("\n");
  embed.color = parseInt(cardColor(c.color).slice(1), 16);
  embed.author = { name: neutralizeMentions(String(server || "Server")).slice(0, 256) || "Server" };
  if (c.thumbnail && avatar) embed.thumbnail = { url: String(avatar) };
  const image = cardImage(c.image);
  if (image) embed.image = { url: image };
  // Footer + branding: FREE always gets ANNOUNCE_BRANDING (forge-proof);
  // Premium gets its custom footer, else the server name when the server
  // icon is shown, else no footer at all.
  const icon = c.serverIcon && serverIcon ? String(serverIcon) : "";
  const footerText = !premium
    ? ANNOUNCE_BRANDING
    : cardText(c.footer, CARD_FOOTER_MAX, { multiline: false }) || (icon ? neutralizeMentions(String(server || "Server")).slice(0, CARD_FOOTER_MAX) : "");
  if (footerText) embed.footer = icon ? { text: footerText, icon_url: icon } : { text: footerText };
  return embed;
}

/* --------------------------------------------------------------- settings --
   Parses a full settings payload. Premium-only fields (voice XP, ignored
   roles/channels, custom announcement text) are reported so the API can
   answer 403 premium_required instead of silently rewriting them. */

function num(value, fallback, [min, max]) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function idList(value, max = 100) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v || "").trim()).filter(isSnowflake))].slice(0, max);
}

export function parseLevelingSettings(body, { premium = false } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const value = {
    enabled: b.enabled === true,
    messageXp: b.messageXp !== false,
    voiceXp: b.voiceXp === true,
    minXp: num(b.minXp, LEVELING_DEFAULTS.minXp, LEVELING_BOUNDS.minXp),
    maxXp: num(b.maxXp, LEVELING_DEFAULTS.maxXp, LEVELING_BOUNDS.maxXp),
    messageCooldown: num(b.messageCooldown, LEVELING_DEFAULTS.messageCooldown, LEVELING_BOUNDS.messageCooldown),
    voiceXpAmount: num(b.voiceXpAmount, LEVELING_DEFAULTS.voiceXpAmount, LEVELING_BOUNDS.voiceXpAmount),
    voiceInterval: num(b.voiceInterval, LEVELING_DEFAULTS.voiceInterval, LEVELING_BOUNDS.voiceInterval),
    announceMode: ANNOUNCE_MODES.includes(String(b.announceMode || "")) ? String(b.announceMode) : "off",
    announceChannelId: "",
    announceMessage: "",
    ignoredChannels: idList(b.ignoredChannels),
    ignoredRoles: idList(b.ignoredRoles)
  };
  if (value.maxXp < value.minXp) return { ok: false, error: "Maximum XP must be greater than or equal to minimum XP." };
  if (value.announceMode === "channel") {
    if (!isSnowflake(b.announceChannelId)) return { ok: false, error: "Choose the Discord channel for level-up announcements." };
    value.announceChannelId = String(b.announceChannelId);
  }
  const customMessage = sanitizeAnnounceMessage(b.announceMessage);
  if (customMessage && customMessage !== DEFAULT_ANNOUNCE_MESSAGE) value.announceMessage = customMessage;

  // V3 card: optional and backward-compatible. When absent the legacy
  // announcement path keeps working, and the stored announceMessage is
  // never discarded just because a card exists.
  const cardParsed = parseAnnounceCard(b.announceCard, { premium });
  if (cardParsed.ok) value.announceCard = cardParsed.value;
  else if (!cardParsed.premiumRequired) return { ok: false, error: cardParsed.error };

  const violations = [];
  if (!cardParsed.ok && cardParsed.premiumRequired) violations.push(...cardParsed.premiumRequired);
  if (value.voiceXp && !premium) violations.push("voiceXp");
  if (value.ignoredChannels.length && !premium) violations.push("ignoredChannels");
  if (value.ignoredRoles.length && !premium) violations.push("ignoredRoles");
  if (value.announceMessage && !premium) violations.push("announceMessage");
  if (violations.length) return { ok: false, premiumRequired: violations };
  return { ok: true, value };
}

/* --------------------------------------------------------------- rewards */

export function parseReward(body) {
  const level = Math.floor(Number(body && body.level));
  const roleId = String((body && body.roleId) || "").trim();
  if (!Number.isFinite(level) || level < 1 || level > REWARD_LEVEL_MAX) return { ok: false, error: `Reward level must be between 1 and ${REWARD_LEVEL_MAX}.` };
  if (!isSnowflake(roleId)) return { ok: false, error: "Choose a Discord role from the list." };
  return { ok: true, value: { level, roleId } };
}

/** FREE servers may configure up to three reward roles; Premium is unlimited. */
export function rewardLimitBlocked(count, premium) {
  return !premium && Number(count) >= FREE_REWARD_ROLE_LIMIT;
}

/* ----------------------------------------------------------- XP actions --
   Admin XP management. Reset (a dangerous action) requires an explicit
   confirmation flag so a forged or accidental call can never wipe data. */

export const XP_ACTIONS = ["add", "remove", "set", "reset"];

export function parseXpAction(body) {
  const b = body && typeof body === "object" ? body : {};
  const action = String(b.action || "");
  if (!XP_ACTIONS.includes(action)) return { ok: false, error: "Unknown XP action." };
  const userId = String(b.userId || "").trim();
  if (!isSnowflake(userId)) return { ok: false, error: "Choose a valid member." };
  let amount = 0;
  if (action !== "reset") {
    amount = Math.floor(Number(b.amount));
    if (!Number.isFinite(amount) || amount < 1 || amount > XP_ACTION_MAX) return { ok: false, error: "Amount must be a whole number between 1 and 1000000." };
  } else if (b.confirm !== true) {
    return { ok: false, error: "Confirmation is required to reset a member's XP.", code: "confirm_required" };
  }
  const reason = String(b.reason || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const targetName = String(b.targetName || "").replace(/\s+/g, " ").trim().slice(0, 80);
  return { ok: true, value: { action, userId, amount, reason, targetName } };
}

/* ------------------------------------------- merge-based command sync ----
   Same contract as planHelpCommandSync: deterministic, idempotent, and it
   only ever plans changes for ITS OWN command names (rank, leaderboard).
   Existing commands — /help included — are never deleted, replaced or
   bulk-overwritten. */

export const RANK_COMMAND_DEFINITION = {
  name: "rank",
  description: "Show a member's XP, level and server rank",
  type: 1,
  options: [{ type: 6, name: "user", description: "Member to look up", required: false }]
};
export const LEADERBOARD_COMMAND_DEFINITION = {
  name: "leaderboard",
  description: "Top 10 members by XP in this server",
  type: 1,
  options: []
};
export const LEVELING_COMMAND_DEFINITIONS = [RANK_COMMAND_DEFINITION, LEADERBOARD_COMMAND_DEFINITION];

const optionSignature = (options) =>
  (Array.isArray(options) ? options : [])
    .map((o) => `${Number(o.type) || 0}:${String(o.name || "")}:${o.required ? 1 : 0}`)
    .join("|");

export function planLevelingCommandSync(list, definitions = LEVELING_COMMAND_DEFINITIONS) {
  const commands = Array.isArray(list) ? list : [];
  return definitions.map((def) => {
    const matches = commands.filter((c) => String(c.name) === def.name && Number(c.type || 1) === 1);
    if (!matches.length) return { action: "create", name: def.name };
    const keep = matches[0];
    const removeIds = matches.slice(1).map((c) => String(c.id || "")).filter(Boolean);
    const drifted =
      String(keep.description || "") !== def.description ||
      optionSignature(keep.options) !== optionSignature(def.options);
    if (removeIds.length) return { action: "dedupe", name: def.name, keepId: String(keep.id || ""), removeIds };
    if (drifted) return { action: "update", name: def.name, id: String(keep.id || "") };
    return { action: "none", name: def.name, id: String(keep.id || "") };
  });
}
