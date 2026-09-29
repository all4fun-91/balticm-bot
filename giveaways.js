import { repairMojibake } from "./discord-utf8.js";

export const GIVEAWAY_DISCORD_MAX_RETRIES = 4;
export const GIVEAWAY_DISCORD_MAX_WAIT_MS = 20000;
export const GIVEAWAY_CANCEL_SUPPORTED = false;

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const ABSOLUTE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase()) || "";
  const found = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  return found == null ? "" : String(headers[found] ?? "");
}

export function isValidTimeZone(timeZone) {
  const zone = String(timeZone || "").trim();
  if (!zone || zone.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour, minute: Number(parts.minute) };
}

function sameWall(parts, year, month, day, hour, minute) {
  return parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute;
}

export function zonedLocalToUtc(local, timeZone) {
  const match = String(local || "").trim().match(LOCAL_TIME);
  if (!match) return { ok: false, error: "Enter a valid end time" };
  if (!isValidTimeZone(timeZone)) return { ok: false, error: "Select a valid time zone" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return { ok: false, error: "Enter a valid end time" };
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return { ok: false, error: "Enter a valid end time" };
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let utc = wanted;
  for (let attempt = 0; attempt < 4; attempt++) {
    const seen = zonedParts(new Date(utc), timeZone);
    utc += wanted - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  }
  const hits = [];
  for (let delta = -3 * 60 * 60 * 1000; delta <= 3 * 60 * 60 * 1000; delta += 60 * 1000) {
    const instant = utc + delta;
    if (sameWall(zonedParts(new Date(instant), timeZone), year, month, day, hour, minute)) hits.push(instant);
  }
  if (!hits.length) return { ok: false, error: "That local time does not exist in the selected time zone." };
  return { ok: true, iso: new Date(Math.min(...hits)).toISOString() };
}

export function utcToZonedLocal(iso, timeZone) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !isValidTimeZone(timeZone)) return "";
  const parts = zonedParts(new Date(ms), timeZone);
  const pad = value => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function resolveGiveawayEnd({ endAt, timeZone, now = Date.now() }) {
  const raw = String(endAt || "").trim();
  const zone = String(timeZone || "").trim();
  if (!isValidTimeZone(zone)) return { ok: false, error: "Select a valid time zone" };
  let iso = "";
  if (ABSOLUTE_TIME.test(raw)) {
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) return { ok: false, error: "Enter a valid end time" };
    iso = new Date(ms).toISOString();
  } else {
    const converted = zonedLocalToUtc(raw.slice(0, 16), zone);
    if (!converted.ok) return converted;
    iso = converted.iso;
  }
  if (Date.parse(iso) <= now) return { ok: false, error: "End time must be in the future" };
  return { ok: true, iso, timeZone: zone };
}

export function channelBelongsToGuild(channel, guildId) {
  if (!channel) return "Could not access selected channel";
  if (String(channel.guild_id || "") !== String(guildId) || ![0, 5].includes(Number(channel.type))) return "Select a text channel from this server";
  return "";
}

export function invalidRoleSelection(roleIds, knownIds, rolesLoaded) {
  if (!rolesLoaded) return "Could not verify roles for this server";
  const known = new Set((knownIds || []).map(String));
  if ((roleIds || []).some(id => !known.has(String(id)))) return "One or more selected roles are invalid";
  return "";
}

export function eligibilityMessage(giveaway, roles) {
  const have = (roles || []).map(String);
  const required = (giveaway?.requiredRoles || []).map(String);
  const excluded = (giveaway?.excludedRoles || []).map(String);
  if (required.length) {
    const ok = giveaway.requiredRolesMode === "any" ? required.some(id => have.includes(id)) : required.every(id => have.includes(id));
    if (!ok) return giveaway.requiredRolesMode === "any" ? "You need at least one required role." : "Missing a required role.";
  }
  if (excluded.some(id => have.includes(id))) return "You have an excluded role.";
  return "";
}

export function entryGate({ guildId, giveaway, userId, bot, roles, now = Date.now() }) {
  if (!giveaway || String(giveaway.guildId) !== String(guildId)) return { ok: false, message: "This giveaway no longer exists." };
  if (!/^\d{16,22}$/.test(String(userId || ""))) return { ok: false, message: "This giveaway no longer exists." };
  if (giveaway.status !== "active" || Date.parse(giveaway.endAt) <= now) return { ok: false, message: "This giveaway has ended." };
  if (bot) return { ok: false, message: "Bots cannot enter giveaways." };
  const blocked = eligibilityMessage(giveaway, roles);
  if (blocked) return { ok: false, message: blocked };
  return { ok: true };
}

export const GIVEAWAY_ENTRY_ERROR = "Could not update your giveaway entry.";

export function entryStored(changes) {
  return Number(changes) > 0
    ? { created: true, message: "\u{1F389} You're entered in this giveaway!" }
    : { created: false, message: "\u{1F389} You're already entered in this giveaway." };
}

export function giveawayEntryDefer() {
  return { type: 5, data: { flags: 64 } };
}

export function openGiveawayEntry(waitUntil, follow) {
  const response = giveawayEntryDefer();
  const task = Promise.resolve().then(follow);
  if (typeof waitUntil === "function") waitUntil(task);
  return { response, task };
}

export async function completeGiveawayEntry({ acknowledged, load, insert, editOriginal, updateMessage }) {
  if (!acknowledged) throw new Error("Giveaway entry follow-up started before Discord was acknowledged");
  const edits = [];
  const edit = async content => {
    edits.push(content);
    await editOriginal(content);
  };
  try {
    const gate = entryGate(await load());
    if (!gate.ok) {
      await edit(gate.message);
      return { responseType: 5, edits, created: false };
    }
    let changes;
    try {
      changes = await insert();
    } catch {
      await edit(GIVEAWAY_ENTRY_ERROR);
      return { responseType: 5, edits, created: false, failed: true };
    }
    const stored = entryStored(changes);
    if (stored.created && updateMessage) {
      try { await updateMessage(); } catch { /* the entry is already stored */ }
    }
    await edit(stored.message);
    return { responseType: 5, edits, created: stored.created, failed: false };
  } catch {
    if (!edits.length) await edit(GIVEAWAY_ENTRY_ERROR);
    return { responseType: 5, edits, created: false, failed: true };
  }
}

export function entriesForGiveaway(entries, giveawayId, guildId) {
  return (entries || []).filter(entry => String(entry.giveawayId) === String(giveawayId) && String(entry.guildId) === String(guildId));
}

function cryptoRandomInt(modulus) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % modulus;
}

export function pickWinners(entryIds, count, randomInt = cryptoRandomInt) {
  const pool = [...new Set((entryIds || []).map(String).filter(Boolean))];
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1);
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  const winners = Math.max(0, Math.min(Number(count) || 0, pool.length));
  return pool.slice(0, winners);
}

export function startFinish(row, { reroll = false } = {}) {
  if (!row) return { ok: false, status: 404, error: "Giveaway not found" };
  if (reroll) {
    if (row.status !== "ended") return { ok: false, status: 400, error: "Only finished giveaways can be rerolled" };
    return { ok: true, mode: "reroll", row: { ...row, status: "ending" } };
  }
  if (row.status === "ended") {
    if (Number(row.needsDelivery)) return { ok: true, mode: "deliver", row };
    return { ok: false, status: 400, error: "Giveaway already ended" };
  }
  if (row.status === "ending") return { ok: true, mode: "resume", row };
  if (row.status === "active" || row.status === "draft") return { ok: true, mode: "draw", row: { ...row, status: "ending" } };
  return { ok: false, status: 400, error: "Giveaway cannot be ended" };
}

export function resumeDrawAllowed(row, nowMs) {
  if (!row || row.status !== "ending" || (row.winnerIds || []).length) return false;
  const updated = Date.parse(row.updatedAt || "");
  return Number.isFinite(updated) && nowMs - updated >= 15000;
}

export function commitDraw(row, entryIds, nowIso, { replace = false } = {}) {
  if (!row) return { ok: false, error: "Giveaway not found" };
  if (!replace && row.status === "ended") return { ok: true, drawn: false, row };
  if (!replace && row.status === "ending" && (row.winnerIds || []).length) return { ok: true, drawn: false, row };
  if (row.status !== "ending") return { ok: false, error: "Giveaway is not ready to draw" };
  const winnerIds = pickWinners(entryIds, row.winnerCount || 1);
  const winnerDm = Object.fromEntries(winnerIds.map(id => [id, "pending"]));
  return {
    ok: true,
    drawn: true,
    row: {
      ...row,
      status: "ended",
      winnerIds,
      winnerDm,
      needsDelivery: 1,
      announcementMessageId: "",
      endedAt: nowIso
    }
  };
}

export function dueGiveaways(rows, nowIso) {
  return (rows || []).filter(row => (row.status === "active" && String(row.endAt) <= nowIso) || (row.status === "ended" && Number(row.needsDelivery) === 1) || row.status === "ending");
}

export function nextDelivery(row) {
  if (!row || !Number(row.needsDelivery)) return { announcement: false, dms: [] };
  return {
    announcement: !row.announcementMessageId,
    dms: (row.winnerIds || []).filter(id => {
      const state = row.winnerDm?.[id];
      return !state || state === "pending";
    })
  };
}

export function withAnnouncementClaim(row) {
  if (!row || row.announcementMessageId) return { claimed: false, row };
  return { claimed: true, row: { ...row, announcementMessageId: "sending" } };
}

export function withAnnouncementResult(row, messageId) {
  return { ...row, announcementMessageId: messageId || "failed" };
}

export function withDmClaim(row, userId) {
  if (!claimFollowUpAllowed(row?.winnerIds, userId)) return { claimed: false, row };
  const state = row?.winnerDm?.[userId];
  if (state && state !== "pending") return { claimed: false, row };
  return { claimed: true, row: { ...row, winnerDm: { ...(row.winnerDm || {}), [userId]: "sending" } } };
}

export function withDmResult(row, userId, status) {
  return { ...row, winnerDm: { ...(row.winnerDm || {}), [userId]: status === "sent" ? "sent" : "failed" } };
}

export function deliveryDone(row) {
  if (!row?.announcementMessageId || row.announcementMessageId === "sending") return false;
  return (row.winnerIds || []).every(id => row.winnerDm?.[id] === "sent" || row.winnerDm?.[id] === "failed");
}

export function claimFollowUpAllowed(winnerIds, userId) {
  return (winnerIds || []).map(String).includes(String(userId));
}

export function giveawayDiscordError(status, body) {
  if (status === 429) return body?.message || "You are being rate limited.";
  if (status === 403 || body?.code === 50013) return "BalticM needs View Channel, Send Messages, and Embed Links in that channel.";
  if (status === 404) return "The Discord channel or message no longer exists.";
  return body?.message || "Discord request failed";
}

export function discordRetryAfterMs(headers, body) {
  const seconds = [body?.retry_after, headerValue(headers, "retry-after"), headerValue(headers, "x-ratelimit-reset-after")]
    .map(finiteNumber)
    .find(value => value != null && value >= 0);
  return seconds == null ? null : Math.round(seconds * 1000);
}

export function giveawayBucketPauseMs(headers) {
  if (headerValue(headers, "x-ratelimit-remaining") !== "0") return 0;
  const seconds = finiteNumber(headerValue(headers, "x-ratelimit-reset-after"));
  if (seconds == null || seconds <= 0) return 0;
  const waitMs = Math.round(seconds * 1000);
  return waitMs > GIVEAWAY_DISCORD_MAX_WAIT_MS ? 0 : waitMs;
}

export function decideGiveawayDiscord({ status, headers, body, attempt, maxRetries = GIVEAWAY_DISCORD_MAX_RETRIES }) {
  if (status >= 200 && status < 300) return { done: true, retry: false, waitMs: 0, reason: "" };
  if (status === 429) {
    const waitMs = discordRetryAfterMs(headers, body);
    const retry = attempt + 1 < maxRetries && waitMs != null && waitMs <= GIVEAWAY_DISCORD_MAX_WAIT_MS;
    return { done: false, retry, waitMs: retry ? waitMs : 0, reason: body?.message || "You are being rate limited." };
  }
  return { done: false, retry: false, waitMs: 0, reason: giveawayDiscordError(status, body) };
}

export async function runDiscordAttempt(send, { wait = async () => {}, maxRetries = GIVEAWAY_DISCORD_MAX_RETRIES } = {}) {
  let pauseMs = 0;
  let last = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (pauseMs > 0) await wait(pauseMs);
    pauseMs = 0;
    last = await send(attempt);
    const decision = decideGiveawayDiscord({ status: last?.status || 0, headers: last?.headers, body: last?.body, attempt, maxRetries });
    if (decision.done) return { ok: true, result: last, attempts: attempt + 1 };
    if (decision.retry) {
      pauseMs = decision.waitMs;
      continue;
    }
    return { ok: false, result: last, attempts: attempt + 1, error: decision.reason };
  }
  return { ok: false, result: last, attempts: maxRetries, error: last?.body?.message || "You are being rate limited." };
}

export async function runDiscordSequence(items, options) {
  const wait = options?.wait || (async () => {});
  const completed = [];
  const failed = [];
  let pauseMs = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  for (const item of items || []) {
    if (pauseMs > 0) await wait(pauseMs);
    pauseMs = 0;
    inFlight = 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const outcome = await runDiscordAttempt(attempt => options.send(item, attempt), { wait, maxRetries: options.maxRetries });
    inFlight = 0;
    if (outcome.ok) {
      completed.push(item);
      pauseMs = giveawayBucketPauseMs(outcome.result?.headers);
    } else failed.push({ item, status: outcome.result?.status || 0, error: outcome.error });
  }
  return { completed, failed, maxInFlight };
}

export function buildGiveawayMessage({ giveaway, entryCount, premium }) {
  const endUnix = Math.floor(Date.parse(giveaway.endAt) / 1000);
  const prize = repairMojibake(giveaway.prize || "");
  const description = repairMojibake(giveaway.description || "Enter for a chance to win!");
  const lines = [
    description,
    `**Winners:** ${giveaway.winnerCount}`,
    Number.isFinite(endUnix) ? `**Ends:** <t:${endUnix}:F> \u2022 <t:${endUnix}:R>` : "",
    giveaway.requiredRoles?.length ? `**Required roles (${giveaway.requiredRolesMode === "any" ? "ANY" : "ALL"}):** ${giveaway.requiredRoles.map(id => `<@&${id}>`).join(", ")}` : "",
    giveaway.excludedRoles?.length ? `**Excluded roles:** ${giveaway.excludedRoles.map(id => `<@&${id}>`).join(", ")}` : "",
    `**Entries:** ${entryCount}`
  ].filter(Boolean);
  const embed = { title: `\u{1F389} GIVEAWAY \u2014 ${prize}`, description: lines.join("\n"), color: 0x7457ff };
  if (giveaway.logoUrl) embed.thumbnail = { url: giveaway.logoUrl };
  if (!premium) embed.footer = { text: "BalticM.eu Giveaway" };
  return {
    embeds: [embed],
    components: giveaway.status === "ended" ? [] : [{ type: 1, components: [{ type: 2, style: 3, label: "Enter Giveaway", emoji: { name: "\u{1F389}" }, custom_id: `giveaway_enter:${giveaway.id}` }] }],
    allowed_mentions: { parse: [] }
  };
}

export function winnerAnnouncement({ winners, prize, logoUrl, premium }) {
  const prizeText = repairMojibake(prize || "");
  const embed = winners.length
    ? { title: `\u{1F389} Giveaway Winner${winners.length > 1 ? "s" : ""}`, description: `Congratulations ${winners.map(id => `<@${id}>`).join(", ")}!\n\n\u{1F381} **Prize:** ${prizeText}`, color: 0x7457ff }
    : { title: "\u{1F389} Giveaway Ended", description: `**${prizeText}** ended with no eligible entries.`, color: 0x7457ff };
  if (logoUrl) embed.thumbnail = { url: logoUrl };
  if (!premium) embed.footer = { text: "BalticM.eu Giveaway" };
  return { embeds: [embed], allowed_mentions: { users: winners } };
}

export function winnerDirectMessage({ prize, logoUrl }) {
  const prizeText = repairMojibake(prize || "");
  const embed = {
    title: "\u{1F389} You won a giveaway!",
    description: `Congratulations! You won **${prizeText}**.\n\nPlease contact the server staff to receive your prize.`,
    color: 0x7457ff,
    footer: { text: "BalticM.eu Giveaway" }
  };
  if (logoUrl) embed.thumbnail = { url: logoUrl };
  return { embeds: [embed] };
}

export function publishActivates(outcome) {
  return !!outcome?.ok && !!outcome?.result?.body?.id;
}
