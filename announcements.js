import { repairMojibake } from "./discord-utf8.js";

export const ANNOUNCEMENT_DISCORD_MAX_RETRIES = 4;
export const ANNOUNCEMENT_DISCORD_MAX_WAIT_MS = 20000;
export const ANNOUNCEMENT_PUBLISH_LOCK_MS = 20000;
export const ANNOUNCEMENT_PERMISSION_ERROR = "BalticM needs View Channel, Send Messages, and Embed Links in that channel.";
export const ANNOUNCEMENT_FOLLOWERS_CHANNEL_ERROR = "Follower publishing requires a Discord Announcement channel.";
export const ANNOUNCEMENT_FOLLOWERS_PERMISSION_ERROR = "The announcement was published, but publishing to followers failed. BalticM needs Send Messages in that Announcement channel.";

const LIMITS = { title: 256, description: 4096, footer: 2048, embed: 6000, buttonLabel: 80, buttonUrl: 512, buttons: 5, emoji: 80, imageUrl: 2048 };

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

export function isHttpsUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

export function isRealMessageId(id) {
  return /^\d{16,22}$/.test(String(id || ""));
}

export function managedGuildAllowed(user, guildId) {
  return (user?.guilds || []).some(guild => String(guild.id) === String(guildId));
}

export function parseAnnouncementBody(body) {
  const source = body && typeof body === "object" ? body : {};
  const channelId = String(source.channelId || "").trim();
  const title = repairMojibake(String(source.title ?? "")).trim();
  const content = repairMojibake(String(source.content ?? "")).trim();
  const thumbnailUrl = String(source.thumbnailUrl || "").trim();
  const imageUrl = String(source.imageUrl || "").trim();
  const footer = repairMojibake(String(source.footer || "")).trim();
  if (!/^\d{16,22}$/.test(channelId)) return { ok: false, error: "Select a Discord channel" };
  if (!title && !content) return { ok: false, error: "Add a title or message" };
  if (title.length > LIMITS.title) return { ok: false, error: "Title is too long for Discord (maximum 256 characters)." };
  if (content.length > LIMITS.description) return { ok: false, error: "Message is too long for Discord (maximum 4096 characters)." };
  if (footer.length > LIMITS.footer) return { ok: false, error: "Footer is too long for Discord (maximum 2048 characters)." };
  if (title.length + content.length + footer.length > LIMITS.embed) return { ok: false, error: "Announcement text is too long for a Discord embed (maximum 6000 characters)." };
  if (thumbnailUrl && !isHttpsUrl(thumbnailUrl)) return { ok: false, error: "Thumbnail URL must use https://" };
  if (imageUrl && !isHttpsUrl(imageUrl)) return { ok: false, error: "Banner URL must use https://" };
  if (thumbnailUrl.length > LIMITS.imageUrl || imageUrl.length > LIMITS.imageUrl) return { ok: false, error: "Image URL is too long." };
  const incoming = Array.isArray(source.buttons) ? source.buttons : [];
  const filled = incoming.filter(button => String(button?.label || "").trim() || String(button?.url || "").trim() || String(button?.emoji || "").trim());
  if (filled.length > LIMITS.buttons) return { ok: false, error: "Discord allows at most 5 link buttons." };
  const buttons = [];
  for (const button of filled) {
    const label = repairMojibake(String(button.label || "")).trim();
    const url = String(button.url || "").trim();
    const emoji = repairMojibake(String(button.emoji || "")).trim();
    if (!label) return { ok: false, error: "Each link button needs a name." };
    if (label.length > LIMITS.buttonLabel) return { ok: false, error: "A button name is too long for Discord (maximum 80 characters)." };
    if (!isHttpsUrl(url)) return { ok: false, error: "Button URL must use https://" };
    if (url.length > LIMITS.buttonUrl) return { ok: false, error: "A button URL is too long for Discord (maximum 512 characters)." };
    if (emoji.length > LIMITS.emoji) return { ok: false, error: "A button emoji is too long." };
    buttons.push({ label, url, emoji });
  }
  const colorNumber = Number(source.color);
  const color = Math.max(0, Math.min(16777215, Number.isFinite(colorNumber) ? colorNumber : 7624695));
  return { ok: true, value: { channelId, title, content, thumbnailUrl, imageUrl, footer, color, buttons, crosspost: !!source.crosspost } };
}

export function announcementChannelFromDiscord(result) {
  if (!result || result.status === 0) return null;
  if (result.status === 403 || result.body?.code === 50013 || result.body?.code === 50001) return { forbidden: true };
  if (!result.ok) return null;
  return result.body || null;
}

export function channelDecision(channel, guildId, { crosspost = false } = {}) {
  if (!channel) return { ok: false, error: "Could not access selected channel" };
  if (channel.forbidden) return { ok: false, status: 403, error: ANNOUNCEMENT_PERMISSION_ERROR };
  const type = Number(channel.type);
  if (String(channel.guild_id || "") !== String(guildId) || ![0, 5].includes(type)) return { ok: false, error: "Select a text or announcement channel from this server" };
  if (crosspost && type !== 5) return { ok: true, news: false, followersError: ANNOUNCEMENT_FOLLOWERS_CHANNEL_ERROR };
  return { ok: true, news: type === 5, followersError: "" };
}

export function announcementSaveError(gate) {
  if (!gate?.ok) return gate?.error || "Could not access selected channel";
  return gate.followersError || "";
}

function buttonEmoji(raw) {
  const custom = String(raw || "").match(/^<(a?):([^\s:]+):(\d{16,22})>$/);
  if (custom) return { name: custom[2], id: custom[3], animated: custom[1] === "a" };
  if (!raw) return null;
  return { name: raw };
}

export function buildAnnouncementPayload(announcement) {
  const embed = { color: announcement.color || 7624695 };
  if (announcement.title) embed.title = repairMojibake(announcement.title);
  if (announcement.content) embed.description = repairMojibake(announcement.content);
  if (announcement.thumbnailUrl) embed.thumbnail = { url: announcement.thumbnailUrl };
  if (announcement.imageUrl) embed.image = { url: announcement.imageUrl };
  if (announcement.footer) embed.footer = { text: repairMojibake(announcement.footer) };
  const buttons = (announcement.buttons || []).map(button => {
    const component = { type: 2, style: 5, label: repairMojibake(button.label), url: button.url };
    const emoji = buttonEmoji(repairMojibake(button.emoji || ""));
    if (emoji) component.emoji = emoji;
    return component;
  });
  const payload = { embeds: [embed], allowed_mentions: { parse: [] } };
  if (buttons.length) payload.components = [{ type: 1, components: buttons }];
  return payload;
}

export function payloadWithoutBanner(payload) {
  const embed = { ...(payload?.embeds?.[0] || {}) };
  delete embed.image;
  delete embed.thumbnail;
  const next = { ...payload, embeds: [embed] };
  return next;
}

export function bannerRejected(result) {
  if (result?.status !== 400 || result?.body?.code !== 50035) return false;
  const text = JSON.stringify(result.body || {}).toLowerCase();
  return text.includes("image") || text.includes("thumbnail");
}

export function announcementDiscordError(status, body) {
  if (status === 403 || body?.code === 50013 || body?.code === 50001) return ANNOUNCEMENT_PERMISSION_ERROR;
  if (status === 404 || body?.code === 10003) return "The Discord channel or message no longer exists.";
  if (status === 429) return body?.message || "You are being rate limited.";
  return body?.message || "Could not publish announcement";
}

export function alreadyCrossposted(result) {
  const message = String(result?.body?.message || "");
  return result?.body?.code === 40033 || /already been crossposted/i.test(message);
}

export function announcementFollowersError(result) {
  if (result?.status === 403 || result?.body?.code === 50013 || result?.body?.code === 50001) return ANNOUNCEMENT_FOLLOWERS_PERMISSION_ERROR;
  return result?.body?.message || "The announcement was published, but publishing to followers failed.";
}

export function announcementRetryAfterMs(headers, body) {
  const seconds = [body?.retry_after, headerValue(headers, "retry-after"), headerValue(headers, "x-ratelimit-reset-after")]
    .map(finiteNumber)
    .find(value => value != null && value >= 0);
  return seconds == null ? null : Math.round(seconds * 1000);
}

export function announcementBucketPauseMs(headers) {
  if (headerValue(headers, "x-ratelimit-remaining") !== "0") return 0;
  const seconds = finiteNumber(headerValue(headers, "x-ratelimit-reset-after"));
  if (seconds == null || seconds <= 0) return 0;
  const waitMs = Math.round(seconds * 1000);
  return waitMs > ANNOUNCEMENT_DISCORD_MAX_WAIT_MS ? 0 : waitMs;
}

export function decideAnnouncementDiscord({ status, headers, body, attempt, maxRetries = ANNOUNCEMENT_DISCORD_MAX_RETRIES }) {
  if (status >= 200 && status < 300) return { done: true, retry: false, waitMs: 0 };
  if (status === 429) {
    const waitMs = announcementRetryAfterMs(headers, body);
    const retry = attempt + 1 < maxRetries && waitMs != null && waitMs <= ANNOUNCEMENT_DISCORD_MAX_WAIT_MS;
    return { done: false, retry, waitMs: retry ? waitMs : 0 };
  }
  return { done: false, retry: false, waitMs: 0 };
}

export async function runAnnouncementDiscord(send, { wait = async () => {}, maxRetries = ANNOUNCEMENT_DISCORD_MAX_RETRIES } = {}) {
  let pauseMs = 0;
  let last = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (pauseMs > 0) await wait(pauseMs);
    pauseMs = 0;
    last = await send(attempt);
    const decision = decideAnnouncementDiscord({ status: last?.status || 0, headers: last?.headers, body: last?.body, attempt, maxRetries });
    if (decision.done) return { ok: true, status: last.status, headers: last.headers, body: last.body, attempts: attempt + 1 };
    if (decision.retry) {
      pauseMs = decision.waitMs;
      continue;
    }
    return { ok: false, status: last?.status || 0, headers: last?.headers, body: last?.body, attempts: attempt + 1, error: announcementDiscordError(last?.status, last?.body) };
  }
  return { ok: false, status: last?.status || 429, headers: last?.headers, body: last?.body, attempts: maxRetries, error: announcementDiscordError(last?.status, last?.body) };
}

export function publishLockDecision(row, nowMs) {
  if (!row) return { action: "missing" };
  if (isRealMessageId(row.messageId)) return { action: "edit" };
  const updated = Date.parse(row.updatedAt || "");
  const fresh = row.status === "publishing" && Number.isFinite(updated) && nowMs - updated < ANNOUNCEMENT_PUBLISH_LOCK_MS;
  if (fresh) return { action: "busy" };
  return { action: "post" };
}

async function sendPrepared(send, method, row, payload) {
  let sent = await send({ method, channelId: row.channelId, messageId: row.messageId, payload });
  if (!sent?.ok && sent?.status !== 404 && bannerRejected(sent) && (payload.embeds?.[0]?.image || payload.embeds?.[0]?.thumbnail)) {
    sent = await send({ method, channelId: row.channelId, messageId: row.messageId, payload: payloadWithoutBanner(payload), bannerRetry: true });
    if (sent?.ok) sent = { ...sent, bannerSkipped: true };
  }
  return sent;
}

export async function runAnnouncementPublish({ guildId, id, load, claimPost, claimReplace, releasePost, commitMessage, commitFollowers, getChannel, send, crosspost, remove, wait = async () => {} }) {
  let claimed = false;
  let committed = false;
  try {
    let row = await load();
    if (!row || String(row.guildId || guildId) !== String(guildId) || String(row.id || id) !== String(id)) return { ok: false, status: 404, error: "Announcement not found" };
    const checked = parseAnnouncementBody(row);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };
    row = { ...row, ...checked.value };
    const channel = await getChannel(row.channelId);
    const gate = channelDecision(channel, guildId, { crosspost: !!row.crossposted });
    if (!gate.ok) return { ok: false, status: gate.status || 400, error: gate.error };
    let mode = "edit";
    if (!isRealMessageId(row.messageId)) {
      claimed = await claimPost();
      if (!claimed) {
        row = await load();
        if (!row || !isRealMessageId(row.messageId)) return { ok: false, status: 409, error: "This announcement is already being published." };
        mode = "edit";
      } else mode = "post";
    }
    const payload = buildAnnouncementPayload(row);
    let sent = await sendPrepared(send, mode === "edit" ? "PATCH" : "POST", row, payload);
    if (mode === "edit" && sent?.status === 404) {
      const replaced = await claimReplace(row.messageId);
      if (!replaced) {
        const again = await load();
        if (again && isRealMessageId(again.messageId) && again.messageId !== row.messageId) {
          return { ok: true, status: 200, messageId: again.messageId, channelId: again.channelId, guildId, crossposted: again.followersStatus === "published", crosspostError: "", suppressedDuplicate: true };
        }
        return { ok: false, status: 409, error: "This announcement is already being published." };
      }
      claimed = true;
      mode = "post";
      row = { ...row, messageId: "", followersStatus: "" };
      sent = await sendPrepared(send, "POST", row, payload);
    }
    if (!sent?.ok) {
      if (claimed) await releasePost();
      const status = sent?.status === 403 || sent?.body?.code === 50013 || sent?.body?.code === 50001 ? 403 : 502;
      return { ok: false, status, error: announcementDiscordError(sent?.status, sent?.body) };
    }
    const messageId = String(sent.body?.id || (mode === "edit" ? row.messageId : ""));
    if (!isRealMessageId(messageId)) {
      if (claimed) await releasePost();
      return { ok: false, status: 502, error: "Discord did not return a message id." };
    }
    if (mode === "post") {
      const stored = await commitMessage(messageId, false);
      if (!stored) {
        await remove({ channelId: row.channelId, messageId });
        const winner = await load();
        if (winner && isRealMessageId(winner.messageId)) {
          return { ok: true, status: 200, messageId: winner.messageId, channelId: winner.channelId || row.channelId, guildId, crossposted: winner.followersStatus === "published", crosspostError: "", suppressedDuplicate: true };
        }
        return { ok: false, status: 409, error: "This announcement is already being published." };
      }
    } else await commitMessage(messageId, true);
    committed = true;
    let crossposted = false;
    let crosspostError = "";
    const alreadyFollowed = mode === "edit" && row.followersStatus === "published";
    if (row.crossposted && !alreadyFollowed) {
      if (!gate.news) {
        crosspostError = gate.followersError || ANNOUNCEMENT_FOLLOWERS_CHANNEL_ERROR;
        await commitFollowers("failed");
      } else {
        const pauseMs = announcementBucketPauseMs(sent.headers);
        if (pauseMs > 0) await wait(pauseMs);
        let posted;
        try {
          posted = await crosspost({ channelId: row.channelId, messageId, guildId });
        } catch {
          posted = { ok: false, status: 0, body: { message: "The announcement was published, but publishing to followers failed." } };
        }
        if (posted?.ok || alreadyCrossposted(posted)) {
          crossposted = true;
          await commitFollowers("published");
        } else {
          crosspostError = announcementFollowersError(posted);
          await commitFollowers("failed");
        }
      }
    }
    return { ok: true, status: 200, messageId, channelId: row.channelId, guildId, crossposted, crosspostError, bannerSkipped: !!sent.bannerSkipped };
  } catch {
    if (claimed && !committed) await releasePost().catch(() => {});
    return { ok: false, status: 502, error: "Could not publish announcement" };
  }
}
