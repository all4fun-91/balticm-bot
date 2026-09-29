const CUSTOM_FULL = /^<(a?):([A-Za-z0-9_]{2,32}):(\d{16,22})>$/;
const CUSTOM_API = /^([A-Za-z0-9_]{2,32}):(\d{16,22})$/;
const COLON_NAME = /^:([A-Za-z0-9_]{2,32}):$/;
const BARE_NAME = /^[A-Za-z0-9_]{2,32}$/;
const UNICODE_EMOJI = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\uFE0E|\p{Emoji_Modifier})*(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\uFE0E|\p{Emoji_Modifier})*)*)$/u;

import { repairMojibake } from "./discord-utf8.js";

const ADMINISTRATOR = 1n << 3n;
const MANAGE_ROLES = 1n << 28n;

export { repairMojibake };

export function unicodeKey(value) {
  return String(value || "").replace(/\uFE0F/g, "");
}

export function isUnicodeEmoji(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 64) return false;
  if (/[A-Za-z0-9]/.test(text.replace(/[#*0-9]\uFE0F?\u20E3/u, ""))) return false;
  return UNICODE_EMOJI.test(text);
}

export function parseEventEmoji(raw) {
  if (raw && typeof raw === "object") {
    return { id: raw.id ? String(raw.id) : "", name: String(raw.name || ""), animated: !!raw.animated };
  }
  const text = String(raw || "").trim();
  const full = text.match(CUSTOM_FULL);
  if (full) return { id: full[3], name: full[2], animated: full[1] === "a" };
  const api = text.match(CUSTOM_API);
  if (api) return { id: api[2], name: api[1], animated: false };
  return { id: "", name: text, animated: false };
}

function fail(error) {
  return { ok: false, error };
}

function customFromGuild(emoji, extra = {}) {
  const id = String(emoji.id);
  const name = String(emoji.name || "emoji");
  const animated = !!emoji.animated;
  return {
    ok: true,
    type: "custom",
    id,
    name,
    animated,
    display: `<${animated ? "a" : ""}:${name}:${id}>`,
    api: `${name}:${id}`,
    key: `id:${id}`,
    migrated: !!extra.migrated
  };
}

function unicodeResult(value) {
  return {
    ok: true,
    type: "unicode",
    id: "",
    name: value,
    animated: false,
    display: value,
    api: value,
    key: `unicode:${unicodeKey(value)}`,
    migrated: false
  };
}

function guildEmoji(list, id, guildId) {
  return (list || []).find(emoji => String(emoji.id) === String(id) && (!emoji.guildId || !guildId || String(emoji.guildId) === String(guildId)));
}

function acceptCustomId(id, name, animated, list, options) {
  const known = guildEmoji(list, id, options.guildId);
  if (known) return customFromGuild(known, { migrated: !!options.migrated });
  if (options.requireGuildList || ((options.emojiListAvailable !== false) && list.length)) {
    return fail("Custom emoji is not from this server");
  }
  if (options.trustStoredId) return customFromGuild({ id, name: name || "emoji", animated: !!animated });
  if (options.emojiListAvailable === false) return fail("BalticM Bot could not load this server's custom emoji");
  return fail("Custom emoji is not from this server");
}

export function classifyReactionEmoji(raw, guildEmojis = [], options = {}) {
  const list = Array.isArray(guildEmojis) ? guildEmojis : [];
  const hintedId = String(options.emojiId || "").trim();
  if (/^\d{16,22}$/.test(hintedId)) return acceptCustomId(hintedId, options.emojiName, options.animated, list, options);
  const text = String(raw || "").trim();
  const full = text.match(CUSTOM_FULL);
  if (full) return acceptCustomId(full[3], full[2], full[1] === "a", list, options);
  const api = text.match(CUSTOM_API);
  if (api) return acceptCustomId(api[2], api[1], false, list, options);
  if (isUnicodeEmoji(text)) return unicodeResult(text);
  if (options.migrateNames && (COLON_NAME.test(text) || BARE_NAME.test(text))) {
    if (options.emojiListAvailable === false) return fail("BalticM Bot could not load this server's custom emoji");
    const name = text.replace(/^:/, "").replace(/:$/, "");
    const matches = list.filter(emoji => String(emoji.name) === name && (!emoji.guildId || !options.guildId || String(emoji.guildId) === String(options.guildId)));
    if (matches.length === 1) return customFromGuild(matches[0], { migrated: true });
    if (matches.length > 1) return fail("This emoji name matches more than one emoji in this server. Choose the emoji again.");
    return fail("This mapping needs a real Unicode emoji or a server emoji. Plain text cannot be used as a reaction.");
  }
  return fail("Enter a Unicode emoji or choose a server emoji. Plain text such as LV is not a Discord reaction.");
}

export function resolveStoredEmoji(raw, guildEmojis = [], extra = {}) {
  return classifyReactionEmoji(raw, guildEmojis, {
    migrateNames: true,
    trustStoredId: true,
    requireGuildList: false,
    ...extra
  });
}

export function annotateLink(row, guildEmojis = [], options = {}) {
  const resolved = resolveStoredEmoji(row?.emoji, guildEmojis, {
    emojiId: row?.emojiId || row?.emoji_id || "",
    emojiName: row?.emojiName || row?.emoji_name || "",
    animated: !!(row?.animated || row?.emojiAnimated || row?.emoji_animated),
    emojiListAvailable: options.emojiListAvailable !== false,
    guildId: row?.guildId || options.guildId || ""
  });
  return {
    id: row?.id || "",
    panelId: row?.panelId || "",
    guildId: row?.guildId || options.guildId || "",
    roleId: String(row?.roleId || row?.role_id || ""),
    label: repairMojibake(row?.label || ""),
    emoji: resolved.ok ? resolved.display : String(row?.emoji || ""),
    emojiId: resolved.ok ? resolved.id : String(row?.emojiId || row?.emoji_id || ""),
    emojiName: resolved.ok ? resolved.name : String(row?.emojiName || row?.emoji_name || ""),
    animated: resolved.ok ? !!resolved.animated : false,
    valid: !!resolved.ok,
    migrated: !!resolved.migrated,
    emojiError: resolved.ok ? "" : resolved.error,
    api: resolved.ok ? resolved.api : "",
    key: resolved.ok ? resolved.key : "",
    type: resolved.ok ? resolved.type : "",
    display: resolved.ok ? resolved.display : String(row?.emoji || "")
  };
}

export function annotatePanel(panel, guildEmojis = [], options = {}) {
  const guildId = panel?.guildId || options.guildId || "";
  return {
    ...panel,
    title: panel?.title || "",
    description: repairMojibake(panel?.description || ""),
    messageId: panel?.messageId || "",
    channelId: panel?.channelId || "",
    guildId,
    links: (panel?.links || []).map(link => annotateLink({ ...link, guildId: link.guildId || guildId }, guildEmojis, options))
  };
}

export function prepareReactionLinks(rawLinks, guildEmojis = [], options = {}) {
  const errors = [];
  const links = [];
  const seen = new Set();
  (Array.isArray(rawLinks) ? rawLinks : []).forEach(raw => {
    const roleId = String(raw?.roleId || "").trim();
    const emoji = String(raw?.emoji || "").trim();
    const emojiId = String(raw?.emojiId || "").trim();
    const hasEmoji = !!(emoji || emojiId);
    const hasRole = /^\d{16,22}$/.test(roleId);
    if (!hasEmoji && !hasRole) return;
    if (hasEmoji && !hasRole) return;
    if (!hasEmoji && hasRole) {
      errors.push("Enter a Unicode emoji or choose a server emoji. Plain text such as LV is not a Discord reaction.");
      return;
    }
    const classified = classifyReactionEmoji(emoji, guildEmojis, {
      ...options,
      migrateNames: false,
      emojiId,
      emojiName: raw?.emojiName,
      animated: raw?.animated
    });
    if (!classified.ok) {
      errors.push(classified.error);
      return;
    }
    if (seen.has(classified.key)) {
      errors.push("Each reaction can only be used once on a panel.");
      return;
    }
    seen.add(classified.key);
    links.push({
      rowId: /^[0-9a-f-]{36}$/i.test(String(raw?.id || "")) ? String(raw.id) : "",
      emoji: classified.display,
      emojiId: classified.id,
      emojiName: classified.name,
      animated: classified.animated ? 1 : 0,
      roleId,
      label: repairMojibake(String(raw?.label || "")).trim().slice(0, 100),
      api: classified.api,
      key: classified.key,
      type: classified.type,
      display: classified.display,
      valid: true
    });
  });
  return { links, errors };
}

export function mappingMatchesEvent(link, eventEmoji, guildId) {
  if (!link || link.valid === false) return false;
  if (link.guildId && guildId && String(link.guildId) !== String(guildId)) return false;
  const event = parseEventEmoji(eventEmoji);
  const display = String(link.emoji || "").match(CUSTOM_FULL);
  const id = String(link.emojiId || (display ? display[3] : ""));
  if (id) return !!event.id && String(event.id) === id;
  if (link.type && link.type !== "unicode") return false;
  if (!isUnicodeEmoji(link.emoji)) return false;
  if (event.id) return false;
  return unicodeKey(event.name) === unicodeKey(link.emoji);
}

export function planRoleChange({ action, memberRoleIds, roleId }) {
  const has = (memberRoleIds || []).map(String).includes(String(roleId));
  if (action === "add") return has ? { apply: false, reason: "already-present" } : { apply: true, method: "PUT", roleId: String(roleId) };
  if (action === "remove") return has ? { apply: true, method: "DELETE", roleId: String(roleId) } : { apply: false, reason: "already-absent" };
  return { apply: false, reason: "ignored" };
}

export function shouldIgnoreReactor({ userId, botUserId, bot }) {
  if (bot) return true;
  if (botUserId && userId && String(userId) === String(botUserId)) return true;
  return false;
}

export function botRoleAccess(roles, memberRoleIds, guildId) {
  const ids = new Set((memberRoleIds || []).map(String));
  if (guildId) ids.add(String(guildId));
  const mine = (roles || []).filter(role => ids.has(String(role.id)));
  let perms = 0n;
  let highest = 0;
  for (const role of mine) {
    try { perms |= BigInt(role.permissions || 0); } catch { /* ignore malformed permission bits */ }
    highest = Math.max(highest, Number(role.position) || 0);
  }
  const administrator = (perms & ADMINISTRATOR) === ADMINISTRATOR;
  return { highestPosition: highest, canManageRoles: administrator || (perms & MANAGE_ROLES) === MANAGE_ROLES, administrator };
}

export function roleAssignBlock({ role, botHighestPosition, canManageRoles, administrator, guildId, accessKnown = true }) {
  if (!role) return "Role could not be resolved";
  if (guildId && role.guildId && String(role.guildId) !== String(guildId)) return "Role could not be resolved";
  if (guildId && String(role.id) === String(guildId)) return "Role could not be resolved";
  if (role.managed) return "Managed role cannot be assigned";
  if (accessKnown === false) return "";
  if (!canManageRoles) return "Missing Manage Roles permission";
  if (!administrator && Number(role.position) >= Number(botHighestPosition)) return "Bot role must be above the selected role";
  return "";
}

export function reactionPanelEmbedDescription(panel, links) {
  const intro = repairMojibake(panel?.description || "").replaceAll(String(panel?.thumbnailUrl || ""), "").trim();
  const rows = (links || []).map(link => {
    const emoji = link.display || link.emoji;
    const label = repairMojibake(link.label || "").trim();
    const role = `<@&${link.roleId}>`;
    return label ? `${emoji} ${role} \u2014 ${label}` : `${emoji} ${role}`;
  });
  return [intro, rows.join("\n\n")].filter(Boolean).join("\n\n").slice(0, 4096);
}

export function reactionIdentity(emoji) {
  if (!emoji) return "";
  if (emoji.id || emoji.emojiId) return `id:${emoji.id || emoji.emojiId}`;
  const name = emoji.name || emoji.emoji || emoji.api || "";
  if (!name) return "";
  return `unicode:${unicodeKey(name)}`;
}

export function discordReactionApi(emoji) {
  if (!emoji) return "";
  if (emoji.api) return String(emoji.api);
  if (emoji.id || emoji.emojiId) return `${emoji.name || emoji.emojiName || "emoji"}:${emoji.id || emoji.emojiId}`;
  return String(emoji.name || emoji.emoji || "");
}

export const REACTION_MUTATION_MAX_RETRIES = 4;
export const REACTION_MUTATION_MAX_WAIT_MS = 20000;

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase()) || "";
  const found = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  return found == null ? "" : String(headers[found] ?? "");
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function discordRetryAfterMs(headers, body) {
  const seconds = [body?.retry_after, headerValue(headers, "retry-after"), headerValue(headers, "x-ratelimit-reset-after")]
    .map(finiteNumber)
    .find(value => value != null && value >= 0);
  return seconds == null ? null : Math.round(seconds * 1000);
}

export function reactionBucketPauseMs(headers) {
  if (headerValue(headers, "x-ratelimit-remaining") !== "0") return 0;
  const seconds = finiteNumber(headerValue(headers, "x-ratelimit-reset-after"));
  if (seconds == null || seconds <= 0) return 0;
  const waitMs = Math.round(seconds * 1000);
  return waitMs > REACTION_MUTATION_MAX_WAIT_MS ? 0 : waitMs;
}

export function decideReactionMutation({ status, headers, body, attempt, maxRetries = REACTION_MUTATION_MAX_RETRIES }) {
  if (status >= 200 && status < 300) return { done: true, retry: false, waitMs: 0, reason: "" };
  if (status === 429) {
    const waitMs = discordRetryAfterMs(headers, body);
    const retry = attempt + 1 < maxRetries && waitMs != null && waitMs <= REACTION_MUTATION_MAX_WAIT_MS;
    return { done: false, retry, waitMs: retry ? waitMs : 0, reason: body?.message || "You are being rate limited." };
  }
  return { done: false, retry: false, waitMs: 0, reason: body?.message || "Discord rejected the reaction" };
}

export function messageEmbedUnchanged(message, payload) {
  const current = message?.embeds?.[0] || {};
  const next = payload?.embeds?.[0] || {};
  return String(current.title || "") === String(next.title || "")
    && String(current.description || "") === String(next.description || "")
    && String(current.thumbnail?.url || "") === String(next.thumbnail?.url || "")
    && Number(current.color || 0) === Number(next.color || 0);
}

export function discordSyncNeeded(message, payload, links) {
  if (!message) return true;
  if (!messageEmbedUnchanged(message, payload)) return true;
  const plan = reactionSyncPlan(message.reactions || [], links);
  return plan.add.length > 0 || plan.remove.length > 0;
}

export function reactionMutationList(plan) {
  const operations = [];
  for (const reaction of plan?.remove || []) {
    const api = discordReactionApi(reaction.emoji || {});
    operations.push({ id: `remove:${reactionIdentity(reaction.emoji || {})}`, method: "DELETE", api, kind: "remove", mappingId: "" });
  }
  for (const link of plan?.add || []) {
    const api = discordReactionApi(link);
    const identity = link.emojiId ? `id:${link.emojiId}` : `unicode:${unicodeKey(link.display || link.emoji || "")}`;
    operations.push({ id: `add:${identity}`, method: "PUT", api, kind: "add", mappingId: link.id || "", emojiId: link.emojiId || "" });
  }
  return operations;
}

export function unfinishedReactionOps(operations, completed) {
  const done = new Set((completed || []).map(operation => operation.id));
  return (operations || []).filter(operation => !done.has(operation.id));
}

export async function runReactionMutations(operations, options) {
  const maxRetries = options?.maxRetries ?? REACTION_MUTATION_MAX_RETRIES;
  const wait = options.wait;
  const send = options.send;
  const completed = [];
  const failed = [];
  let pauseMs = 0;
  for (const operation of operations || []) {
    if (pauseMs > 0) await wait(pauseMs);
    pauseMs = 0;
    let attempt = 0;
    let settled = false;
    while (attempt < maxRetries) {
      const result = await send(operation, attempt);
      const decision = decideReactionMutation({
        status: result?.status || 0,
        headers: result?.headers,
        body: result?.body,
        attempt,
        maxRetries
      });
      if (decision.done) {
        completed.push(operation);
        pauseMs = reactionBucketPauseMs(result.headers);
        settled = true;
        break;
      }
      if (decision.retry) {
        await wait(decision.waitMs);
        attempt += 1;
        continue;
      }
      failed.push({ ...operation, status: result?.status || 0, reason: decision.reason });
      settled = true;
      break;
    }
    if (!settled) failed.push({ ...operation, status: 429, reason: "You are being rate limited." });
  }
  return { completed, failed };
}

export function reactionSyncPlan(currentReactions, wantedLinks) {
  const wanted = new Map();
  for (const link of wantedLinks || []) {
    const identity = link.emojiId ? `id:${link.emojiId}` : `unicode:${unicodeKey(link.display || link.emoji || "")}`;
    if (identity !== "unicode:") wanted.set(identity, link);
  }
  const present = new Set();
  const remove = [];
  for (const reaction of currentReactions || []) {
    if (!reaction?.me) continue;
    const identity = reactionIdentity(reaction.emoji || {});
    if (!identity) continue;
    present.add(identity);
    if (!wanted.has(identity)) remove.push(reaction);
  }
  const add = [];
  for (const [identity, link] of wanted) if (!present.has(identity)) add.push(link);
  return { add, remove };
}

export function emojiImageUrl(emoji) {
  const id = String(emoji?.id || emoji?.emojiId || "");
  if (!/^\d{16,22}$/.test(id)) return "";
  return `https://cdn.discordapp.com/emojis/${id}.${emoji.animated || emoji.emojiAnimated ? "gif" : "png"}`;
}

export function emojisForGuild(emojis, guildId) {
  return (emojis || []).filter(emoji => !emoji.guildId || String(emoji.guildId) === String(guildId));
}

export function formatReactionFailure(failure) {
  const emoji = failure?.emoji || failure?.emojiId || "emoji";
  const reason = failure?.reason || "Discord rejected the reaction";
  return `Could not update Discord reaction ${emoji} for panel ${failure?.panelId || "unknown"}: ${reason}`;
}
