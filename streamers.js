import { repairMojibake } from "./discord-utf8.js";
import { channelBelongsToGuild } from "./giveaways.js";

export const STREAMERS_MODULE = "streamers";
export const STREAMERS_MAX_PER_GUILD = 50;
export const STREAMER_STATUS = { LIVE: "live", OFFLINE: "offline", UNKNOWN: "unknown" };
export const STREAM_PROVIDERS = ["twitch", "youtube", "kick", "tiktok"];
export const STREAMER_EMBED_COLOR = 0xe8892c;
export const STREAMERS_POLL_STALE_MS = 50000;
export const STREAMERS_FETCH_TIMEOUT_MS = 8000;
export const STREAMERS_PROVIDER_RETRIES = 2;
export const STREAMERS_DELETE_MAX_ATTEMPTS = 3;
export const STREAMER_SOURCE_OWNER = "owner";
export const STREAMER_SOURCE_AUTO = "auto";
export const STREAMER_SOURCE_SELF = "self";
export const STREAMER_SETTINGS_KEY = guildId => "streamers-settings:" + guildId;

export const STREAMER_CREDENTIALS = {
  twitch: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"],
  youtube: ["YOUTUBE_API_KEY"],
  kick: ["KICK_CLIENT_ID", "KICK_CLIENT_SECRET"],
  tiktok: []
};

export const STREAMERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS streamers (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_login TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  watch_url TEXT NOT NULL DEFAULT '',
  discord_member_id TEXT NOT NULL,
  announcement_channel_id TEXT NOT NULL,
  auto_announce INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  custom_message TEXT NOT NULL DEFAULT '',
  live_status TEXT NOT NULL DEFAULT 'unknown',
  stream_title TEXT NOT NULL DEFAULT '',
  stream_category TEXT NOT NULL DEFAULT '',
  viewer_count INTEGER,
  thumbnail_url TEXT NOT NULL DEFAULT '',
  profile_image_url TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  last_announced_session_id TEXT NOT NULL DEFAULT '',
  announcement_message_id TEXT NOT NULL DEFAULT '',
  announcement_delete_attempts INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'owner',
  last_checked_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(guild_id, provider, provider_user_id)
)`;
export const STREAMERS_ALTER_SQL = [
  "ALTER TABLE streamers ADD COLUMN announcement_message_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE streamers ADD COLUMN announcement_delete_attempts INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE streamers ADD COLUMN source TEXT NOT NULL DEFAULT 'owner'"
];

export const USER_STREAMING_ACCOUNTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS user_streaming_accounts (
  id TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_login TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  watch_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(discord_user_id, provider)
)`;

const SNOWFLAKE = /^\d{16,22}$/;

export function isStreamerSnowflake(id) {
  return SNOWFLAKE.test(String(id || ""));
}

export function providerList() {
  return STREAM_PROVIDERS.slice();
}

export function isKnownProvider(provider) {
  return STREAM_PROVIDERS.includes(String(provider || "").toLowerCase());
}

export function providerLiveDetectionKind(provider) {
  const p = String(provider || "").toLowerCase();
  if (p === "twitch") return "helix";
  if (p === "youtube") return "data_api";
  if (p === "kick") return "public_api";
  return "";
}

export function missingProviderCredentials(provider, env = {}) {
  const keys = STREAMER_CREDENTIALS[String(provider || "").toLowerCase()] || [];
  return keys.filter((key) => !String(env[key] || "").trim());
}

export function liveDetectionAvailable(provider, env = {}) {
  const p = String(provider || "").toLowerCase();
  if (!isKnownProvider(p)) return { available: false, reason: "Unknown streaming platform" };
  if (p === "tiktok") {
    return {
      available: false,
      reason: "Automatic LIVE detection unavailable",
      detail: "TikTok does not provide a reliable official LIVE status API for this integration."
    };
  }
  const missing = missingProviderCredentials(p, env);
  if (missing.length) {
    return {
      available: false,
      reason: "Automatic LIVE detection unavailable",
      detail: "Missing server credentials: " + missing.join(", ")
    };
  }
  return { available: true, reason: "" };
}

export function sanitizeAnnouncementText(value) {
  return repairMojibake(String(value ?? ""))
    .replace(/@everyone/gi, "")
    .replace(/@here/gi, "")
    .trim();
}

function stripUrl(value) {
  return String(value || "").trim();
}

export function normalizeTwitchLogin(input) {
  const raw = stripUrl(input);
  if (!raw) return { ok: false, error: "Enter a Twitch channel name or URL" };
  let login = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      if (host !== "twitch.tv" && host !== "m.twitch.tv") return { ok: false, error: "Use a twitch.tv channel URL" };
      login = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
    }
  } catch {
    return { ok: false, error: "Invalid Twitch URL" };
  }
  login = login.replace(/^@/, "").split("?")[0].toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(login)) return { ok: false, error: "Enter a valid Twitch username" };
  return {
    ok: true,
    provider: "twitch",
    providerUserId: login,
    providerLogin: login,
    displayName: login,
    profileUrl: "https://www.twitch.tv/" + login,
    watchUrl: "https://www.twitch.tv/" + login
  };
}

export function normalizeYoutubeInput(input) {
  const raw = stripUrl(input);
  if (!raw) return { ok: false, error: "Enter a YouTube channel URL, handle, or channel ID" };
  let handle = "";
  let channelId = "";
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return { ok: false, error: "Use a YouTube channel URL" };
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "channel" && parts[1]) channelId = parts[1];
      else if (parts[0] === "c" && parts[1]) handle = parts[1];
      else if (parts[0] === "user" && parts[1]) handle = parts[1];
      else if (parts[0] && parts[0].startsWith("@")) handle = parts[0];
      else if (parts[0] === "watch" || host === "youtu.be") return { ok: false, error: "Use a YouTube channel or @handle, not a single video URL" };
      else if (parts[0]) handle = parts[0].startsWith("@") ? parts[0] : "@" + parts[0];
    } else if (/^UC[\w-]{20,}$/.test(raw)) {
      channelId = raw;
    } else {
      handle = raw.startsWith("@") ? raw : "@" + raw.replace(/^@/, "");
    }
  } catch {
    return { ok: false, error: "Invalid YouTube URL" };
  }
  handle = handle.replace(/\s+/g, "");
  if (channelId) {
    if (!/^UC[\w-]{20,}$/.test(channelId)) return { ok: false, error: "Enter a valid YouTube channel ID" };
    return {
      ok: true,
      provider: "youtube",
      providerUserId: channelId,
      providerLogin: channelId,
      displayName: channelId,
      profileUrl: "https://www.youtube.com/channel/" + channelId,
      watchUrl: "https://www.youtube.com/channel/" + channelId + "/live"
    };
  }
  const name = handle.replace(/^@/, "");
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(name)) return { ok: false, error: "Enter a valid YouTube handle" };
  const at = "@" + name;
  return {
    ok: true,
    provider: "youtube",
    providerUserId: at.toLowerCase(),
    providerLogin: at,
    displayName: at,
    profileUrl: "https://www.youtube.com/" + at,
    watchUrl: "https://www.youtube.com/" + at + "/live"
  };
}

export function normalizeKickSlug(input) {
  const raw = stripUrl(input);
  if (!raw) return { ok: false, error: "Enter a Kick channel name or URL" };
  let slug = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      if (host !== "kick.com") return { ok: false, error: "Use a kick.com channel URL" };
      slug = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
    }
  } catch {
    return { ok: false, error: "Invalid Kick URL" };
  }
  slug = slug.replace(/^@/, "").split("?")[0].toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(slug)) return { ok: false, error: "Enter a valid Kick username" };
  return {
    ok: true,
    provider: "kick",
    providerUserId: slug,
    providerLogin: slug,
    displayName: slug,
    profileUrl: "https://kick.com/" + slug,
    watchUrl: "https://kick.com/" + slug
  };
}

export function normalizeTiktokUser(input) {
  const raw = stripUrl(input);
  if (!raw) return { ok: false, error: "Enter a TikTok username or profile URL" };
  let user = raw;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      if (!["tiktok.com", "vm.tiktok.com", "m.tiktok.com"].includes(host)) return { ok: false, error: "Use a tiktok.com profile URL" };
      const parts = url.pathname.split("/").filter(Boolean);
      user = parts.find((p) => p.startsWith("@")) || parts[0] || "";
    }
  } catch {
    return { ok: false, error: "Invalid TikTok URL" };
  }
  user = user.replace(/^@/, "").split("?")[0];
  if (!/^[A-Za-z0-9._]{2,24}$/.test(user)) return { ok: false, error: "Enter a valid TikTok username" };
  const handle = user;
  return {
    ok: true,
    provider: "tiktok",
    providerUserId: handle.toLowerCase(),
    providerLogin: handle,
    displayName: "@" + handle,
    profileUrl: "https://www.tiktok.com/@" + handle,
    watchUrl: "https://www.tiktok.com/@" + handle + "/live"
  };
}

export function normalizeStreamerIdentity(provider, input) {
  const p = String(provider || "").toLowerCase();
  if (p === "twitch") return normalizeTwitchLogin(input);
  if (p === "youtube") return normalizeYoutubeInput(input);
  if (p === "kick") return normalizeKickSlug(input);
  if (p === "tiktok") return normalizeTiktokUser(input);
  return { ok: false, error: "Select a streaming platform" };
}

export function normalizeStreamerSource(source) {
  const s = String(source || "").toLowerCase();
  if (s === STREAMER_SOURCE_AUTO || s === STREAMER_SOURCE_SELF) return STREAMER_SOURCE_AUTO;
  return STREAMER_SOURCE_OWNER;
}

export function parseProfileStreamingBody(body, actorId) {
  const source = body && typeof body === "object" ? body : {};
  if (source.discordMemberId && String(source.discordMemberId) !== String(actorId)) {
    return { ok: false, error: "You can only manage your own streaming accounts.", status: 403 };
  }
  if (source.memberId && String(source.memberId) !== String(actorId)) {
    return { ok: false, error: "You can only manage your own streaming accounts.", status: 403 };
  }
  if (source.discordUserId && String(source.discordUserId) !== String(actorId)) {
    return { ok: false, error: "You can only manage your own streaming accounts.", status: 403 };
  }
  if (source.announcementChannelId || source.channelId) {
    return { ok: false, error: "Members cannot choose the Discord announcement channel.", status: 403 };
  }
  if (source.announcementMessageId || source.messageId) {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  if (source.source || source.guildId) {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  const provider = String(source.provider || "").trim().toLowerCase();
  const identity = normalizeStreamerIdentity(provider, source.channel || source.profile || source.input);
  if (!identity.ok) return identity;
  if (!isStreamerSnowflake(actorId)) return { ok: false, error: "Unauthorized", status: 401 };
  return {
    ok: true,
    value: {
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      providerLogin: identity.providerLogin,
      displayName: identity.displayName,
      profileUrl: identity.profileUrl,
      watchUrl: identity.watchUrl,
      discordUserId: String(actorId)
    }
  };
}

export function decideStreamerStudioMutation({ isOwner, premium, canConfigure }) {
  if (isOwner) return { ok: true, reason: "owner" };
  if (!premium) {
    return {
      ok: false,
      status: 403,
      error: "Only the Discord Server Owner can manage streamers on a non-Premium server."
    };
  }
  if (canConfigure) return { ok: true, reason: "configure" };
  return { ok: false, status: 403, error: "Forbidden" };
}

export function decideProfileStreamingMutation({ actorId, targetUserId }) {
  if (!isStreamerSnowflake(actorId)) return { ok: false, status: 401, error: "Unauthorized" };
  if (String(actorId || "") !== String(targetUserId || actorId)) {
    return { ok: false, status: 403, error: "You can only manage your own streaming accounts." };
  }
  return { ok: true };
}

export function profileStreamingDuplicateError() {
  return "You already have a streaming account for this platform.";
}

export function shouldIncludeProfileAccountInGuild({ premium, isMember, verified = true }) {
  return !!premium && !!isMember && verified !== false;
}

export function shouldPauseAutoStreamerAutomation(row, premium) {
  return normalizeStreamerSource(row?.source) === STREAMER_SOURCE_AUTO && !premium;
}

export function shouldRemoveAutoGuildParticipation({ source, isMember }) {
  return normalizeStreamerSource(source) === STREAMER_SOURCE_AUTO && !isMember;
}

export function autoStreamerRowsForGuilds({ accounts, guilds }) {
  const list = [];
  for (const guild of Array.isArray(guilds) ? guilds : []) {
    for (const account of Array.isArray(accounts) ? accounts : []) {
      const memberIds = guild.memberIds || [];
      const isMember = memberIds.includes(String(account.discordUserId || account.discord_user_id || ""));
      const verified = account.verified !== false && account.verified !== 0;
      if (!shouldIncludeProfileAccountInGuild({ premium: !!guild.premium, isMember, verified })) continue;
      list.push({
        guildId: String(guild.id),
        discordMemberId: String(account.discordUserId || account.discord_user_id),
        provider: String(account.provider)
      });
    }
  }
  return dedupeAutoStreamerRows(list);
}

export function dedupeAutoStreamerRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = [row.guildId, row.discordMemberId, row.provider].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function mapProfileAccountRow(row) {
  if (!row) return null;
  const verified = Number(row.verified) === 1;
  return {
    id: row.id,
    discordUserId: row.discord_user_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    providerLogin: row.provider_login,
    displayName: row.display_name,
    profileUrl: row.profile_url,
    watchUrl: row.watch_url,
    profileImageUrl: row.profile_image_url || "",
    verified,
    verification: verified ? "oauth" : "legacy",
    connectedAt: row.connected_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function shouldDeleteLiveAnnouncement({ announcementMessageId, nextStatus, liveDetection }) {
  if (!String(announcementMessageId || "").trim()) return false;
  if (nextStatus !== STREAMER_STATUS.OFFLINE) return false;
  if (liveDetection !== true) return false;
  return true;
}

export function discordAnnouncementGone(status, body) {
  const code = Number(body?.code);
  return Number(status) === 404 || code === 10008 || code === 10003;
}

export function defaultStreamerSettings() {
  return { announcementChannelId: "", autoAnnounce: true };
}

export function parseStreamerSettingsBody(body) {
  const source = body && typeof body === "object" ? body : {};
  const announcementChannelId = String(source.announcementChannelId || "").trim();
  if (announcementChannelId && !isStreamerSnowflake(announcementChannelId)) {
    return { ok: false, error: "Select a Discord announcement channel" };
  }
  return {
    ok: true,
    value: {
      announcementChannelId,
      autoAnnounce: source.autoAnnounce !== false && source.autoAnnounce !== 0 && source.autoAnnounce !== "0"
    }
  };
}

export function parseStreamerConfigBody(body) {
  const source = body && typeof body === "object" ? body : {};
  const provider = String(source.provider || "").trim().toLowerCase();
  const identity = normalizeStreamerIdentity(provider, source.channel || source.profile || source.input);
  if (!identity.ok) return identity;
  const discordMemberId = String(source.discordMemberId || source.memberId || "").trim();
  const announcementChannelId = String(source.announcementChannelId || source.channelId || "").trim();
  if (!isStreamerSnowflake(discordMemberId)) return { ok: false, error: "Select a Discord member" };
  if (!isStreamerSnowflake(announcementChannelId)) return { ok: false, error: "Select an announcement channel" };
  const customMessage = sanitizeAnnouncementText(source.customMessage || "").slice(0, 1000);
  return {
    ok: true,
    value: {
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      providerLogin: identity.providerLogin,
      displayName: identity.displayName,
      profileUrl: identity.profileUrl,
      watchUrl: identity.watchUrl,
      discordMemberId,
      announcementChannelId,
      autoAnnounce: source.autoAnnounce !== false && source.autoAnnounce !== 0 && source.autoAnnounce !== "0",
      enabled: source.enabled !== false && source.enabled !== 0 && source.enabled !== "0",
      customMessage
    }
  };
}

export function shouldAnnounceLive(row, next) {
  if (!row || !next) return false;
  const auto = row.autoAnnounce === true || Number(row.auto_announce) === 1;
  const enabled = row.enabled !== false && Number(row.enabled) !== 0;
  if (!auto || !enabled) return false;
  if (next.status !== STREAMER_STATUS.LIVE) return false;
  const sessionId = String(next.sessionId || "").trim();
  if (!sessionId) return false;
  const announced = String(row.lastAnnouncedSessionId || row.last_announced_session_id || "").trim();
  return announced !== sessionId;
}

export function applyLiveCheckToRow(row, check) {
  const now = check.checkedAt || new Date().toISOString();
  const status = check.status === STREAMER_STATUS.LIVE || check.status === STREAMER_STATUS.OFFLINE || check.status === STREAMER_STATUS.UNKNOWN
    ? check.status
    : STREAMER_STATUS.UNKNOWN;
  const live = status === STREAMER_STATUS.LIVE;
  return {
    liveStatus: status,
    streamTitle: live ? String(check.title || "") : "",
    streamCategory: live ? String(check.category || "") : "",
    viewerCount: live && Number.isFinite(Number(check.viewerCount)) ? Number(check.viewerCount) : null,
    thumbnailUrl: live ? String(check.thumbnailUrl || "") : "",
    profileImageUrl: String(check.profileImageUrl || row.profileImageUrl || row.profile_image_url || ""),
    sessionId: live ? String(check.sessionId || "") : "",
    watchUrl: String(check.watchUrl || row.watchUrl || row.watch_url || ""),
    displayName: String(check.displayName || row.displayName || row.display_name || ""),
    lastCheckedAt: now,
    lastError: String(check.error || "")
  };
}

export function buildLiveAnnouncementPayload({ streamer, memberName, check }) {
  const platform = String(streamer.provider || "").replace(/^\w/, (c) => c.toUpperCase());
  const name = sanitizeAnnouncementText(memberName || streamer.displayName || streamer.display_name || "Streamer") || "Streamer";
  const custom = sanitizeAnnouncementText(streamer.customMessage || streamer.custom_message || "");
  const title = sanitizeAnnouncementText(check?.title || streamer.streamTitle || streamer.stream_title || "");
  const category = sanitizeAnnouncementText(check?.category || streamer.streamCategory || streamer.stream_category || "");
  const watchUrl = String(check?.watchUrl || streamer.watchUrl || streamer.watch_url || "");
  const lines = [`${name} is now live!`];
  if (custom) lines.push("", custom);
  const fields = [{ name: "Platform", value: platform, inline: true }];
  if (title) fields.push({ name: "Title", value: title.slice(0, 256), inline: false });
  if (category) fields.push({ name: "Category", value: category.slice(0, 256), inline: true });
  const viewers = check?.viewerCount;
  if (Number.isFinite(Number(viewers))) fields.push({ name: "Viewers", value: String(Number(viewers)), inline: true });
  const embed = {
    title: "🔴 LIVE NOW",
    description: lines.join("\n").slice(0, 4096),
    color: STREAMER_EMBED_COLOR,
    fields,
    footer: { text: "BalticM.eu • PLAY TOGETHER" }
  };
  const thumb = check?.profileImageUrl || streamer.profileImageUrl || streamer.profile_image_url;
  const image = check?.thumbnailUrl || streamer.thumbnailUrl || streamer.thumbnail_url;
  if (thumb && /^https:\/\//i.test(thumb)) embed.thumbnail = { url: thumb };
  if (image && /^https:\/\//i.test(image)) embed.image = { url: image };
  const payload = { embeds: [embed], allowed_mentions: { parse: [] } };
  if (watchUrl && /^https:\/\//i.test(watchUrl)) {
    payload.components = [{ type: 1, components: [{ type: 2, style: 5, label: "WATCH STREAM", url: watchUrl }] }];
  }
  return payload;
}

export function duplicateStreamerError() {
  return "This streamer is already configured for that platform on this server.";
}

export function mapStreamerRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    providerLogin: row.provider_login,
    displayName: row.display_name,
    profileUrl: row.profile_url,
    watchUrl: row.watch_url,
    discordMemberId: row.discord_member_id,
    announcementChannelId: row.announcement_channel_id,
    autoAnnounce: Number(row.auto_announce) === 1,
    enabled: Number(row.enabled) === 1,
    customMessage: row.custom_message || "",
    liveStatus: row.live_status || STREAMER_STATUS.UNKNOWN,
    streamTitle: row.stream_title || "",
    streamCategory: row.stream_category || "",
    viewerCount: row.viewer_count == null ? null : Number(row.viewer_count),
    thumbnailUrl: row.thumbnail_url || "",
    profileImageUrl: row.profile_image_url || "",
    sessionId: row.session_id || "",
    lastAnnouncedSessionId: row.last_announced_session_id || "",
    announcementMessageId: row.announcement_message_id || "",
    announcementDeleteAttempts: Number(row.announcement_delete_attempts) || 0,
    source: normalizeStreamerSource(row.source),
    lastCheckedAt: row.last_checked_at || "",
    lastError: row.last_error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function streamerPublicView(row, extras = {}) {
  const mapped = typeof row.providerUserId === "string" ? row : mapStreamerRow(row);
  if (!mapped) return null;
  const detection = extras.detection || liveDetectionAvailable(mapped.provider, extras.env || {});
  let status = mapped.liveStatus;
  if (!detection.available && status === STREAMER_STATUS.OFFLINE) status = STREAMER_STATUS.UNKNOWN;
  if (!detection.available && status === STREAMER_STATUS.LIVE) status = STREAMER_STATUS.UNKNOWN;
  return {
    ...mapped,
    liveStatus: status,
    liveDetectionAvailable: detection.available,
    liveDetectionReason: detection.reason || "",
    member: extras.member || null,
    announcementChannelName: extras.channelName || "",
    memberMissing: !!extras.memberMissing,
    source: normalizeStreamerSource(mapped.source)
  };
}

export function summarizeStreamerStats(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let live = 0;
  let offline = 0;
  let unknown = 0;
  let announcements = 0;
  for (const row of list) {
    const status = row.liveStatus || row.live_status;
    if (status === STREAMER_STATUS.LIVE) live += 1;
    else if (status === STREAMER_STATUS.OFFLINE) offline += 1;
    else unknown += 1;
    if (row.autoAnnounce === true || Number(row.auto_announce) === 1) announcements += 1;
  }
  return { managed: list.length, live, offline, unknown, announcements };
}

export function discordChannelAllowed(channel, guildId) {
  if (!channel) return { ok: false, error: "Could not access selected channel" };
  if (channel.forbidden) return { ok: false, status: 403, error: "BalticM needs View Channel, Send Messages, and Embed Links in that channel." };
  const type = Number(channel.type);
  const belong = channelBelongsToGuild(channel, guildId);
  if (belong) return { ok: false, error: belong };
  if (![0, 5].includes(type)) return { ok: false, error: "Select a text or announcement channel from this server" };
  return { ok: true, name: channel.name || "" };
}

export function streamerAnnouncementError(status, body) {
  if (status === 403 || body?.code === 50013 || body?.code === 50001) {
    return "BalticM needs View Channel, Send Messages, and Embed Links in that channel.";
  }
  if (status === 404 || body?.code === 10003) return "The Discord announcement channel no longer exists.";
  if (status === 429) return body?.message || "Discord rate limited the announcement.";
  return body?.message || "Could not send LIVE announcement";
}

async function fetchJson(url, options, httpFetch, timeoutMs = STREAMERS_FETCH_TIMEOUT_MS) {
  const run = httpFetch || fetch;
  const ctrl = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(timeoutMs) } : {};
  const res = await run(url, { ...options, ...ctrl });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, headers: res.headers };
}

async function withRetries(fn, retries = STREAMERS_PROVIDER_RETRIES) {
  let last;
  for (let i = 0; i <= retries; i += 1) {
    try {
      last = await fn(i);
      if (last && last.retry === false) return last;
      if (last && last.ok) return last;
      if (last && last.status && last.status < 500 && last.status !== 429) return last;
    } catch (error) {
      last = { ok: false, error: String(error.message || error), status: 0 };
    }
  }
  return last || { ok: false, error: "Provider request failed" };
}

const tokenCache = { twitch: { value: "", exp: 0 }, kick: { value: "", exp: 0 } };

export function resetStreamerTokenCache() {
  tokenCache.twitch = { value: "", exp: 0 };
  tokenCache.kick = { value: "", exp: 0 };
}

export async function twitchAppToken(env, httpFetch) {
  const now = Date.now();
  if (tokenCache.twitch.value && tokenCache.twitch.exp > now + 30000) return { ok: true, token: tokenCache.twitch.value };
  const id = String(env.TWITCH_CLIENT_ID || "").trim();
  const secret = String(env.TWITCH_CLIENT_SECRET || "").trim();
  if (!id || !secret) return { ok: false, error: "Missing TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET" };
  const res = await fetchJson(
    "https://id.twitch.tv/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }).toString()
    },
    httpFetch
  );
  const token = res.body?.access_token;
  if (!res.ok || !token) return { ok: false, error: "Twitch authentication failed", status: res.status };
  tokenCache.twitch = { value: token, exp: now + Math.max(60, Number(res.body.expires_in) || 3600) * 1000 };
  return { ok: true, token };
}

export async function kickAppToken(env, httpFetch) {
  const now = Date.now();
  if (tokenCache.kick.value && tokenCache.kick.exp > now + 30000) return { ok: true, token: tokenCache.kick.value };
  const id = String(env.KICK_CLIENT_ID || "").trim();
  const secret = String(env.KICK_CLIENT_SECRET || "").trim();
  if (!id || !secret) return { ok: false, error: "Missing KICK_CLIENT_ID / KICK_CLIENT_SECRET" };
  const res = await fetchJson(
    "https://id.kick.com/oauth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }).toString()
    },
    httpFetch
  );
  const token = res.body?.access_token;
  if (!res.ok || !token) return { ok: false, error: "Kick authentication failed", status: res.status };
  tokenCache.kick = { value: token, exp: now + Math.max(60, Number(res.body.expires_in) || 3600) * 1000 };
  return { ok: true, token };
}

function unknownResult(error, extras = {}) {
  return { status: STREAMER_STATUS.UNKNOWN, liveDetection: false, error: String(error || "Automatic LIVE detection unavailable"), ...extras };
}

export async function checkTwitchLive(identity, env, httpFetch) {
  const detection = liveDetectionAvailable("twitch", env);
  if (!detection.available) return unknownResult(detection.detail || detection.reason);
  const token = await twitchAppToken(env, httpFetch);
  if (!token.ok) return unknownResult(token.error);
  const twitchId = String(identity.providerUserId || "").trim();
  const login = String(identity.providerLogin || "").replace(/^@/, "").toLowerCase();
  const byId = /^\d+$/.test(twitchId);
  const res = await withRetries(() =>
    fetchJson(
      "https://api.twitch.tv/helix/streams?" + (byId ? "user_id=" + encodeURIComponent(twitchId) : "user_login=" + encodeURIComponent(login || twitchId.toLowerCase())),
      { headers: { "Client-ID": String(env.TWITCH_CLIENT_ID), Authorization: "Bearer " + token.token } },
      httpFetch
    )
  );
  if (res.status === 429) return unknownResult("Twitch rate limited the status check");
  if (!res.ok) return unknownResult(res.body?.message || "Twitch status check failed");
  const stream = Array.isArray(res.body?.data) ? res.body.data[0] : null;
  if (!stream) {
    return { status: STREAMER_STATUS.OFFLINE, liveDetection: true, sessionId: "", title: "", category: "", viewerCount: null, watchUrl: identity.watchUrl };
  }
  if (String(stream.type || "live") !== "live") {
    return { status: STREAMER_STATUS.OFFLINE, liveDetection: true, sessionId: "", watchUrl: identity.watchUrl };
  }
  return {
    status: STREAMER_STATUS.LIVE,
    liveDetection: true,
    sessionId: String(stream.id || ""),
    title: String(stream.title || ""),
    category: String(stream.game_name || stream.game_id || ""),
    viewerCount: Number.isFinite(Number(stream.viewer_count)) ? Number(stream.viewer_count) : null,
    thumbnailUrl: String(stream.thumbnail_url || "").replace("{width}", "1280").replace("{height}", "720"),
    displayName: String(stream.user_name || identity.displayName || login),
    watchUrl: identity.watchUrl || ("https://www.twitch.tv/" + (stream.user_login || login || twitchId))
  };
}

async function resolveYoutubeChannelId(identity, env, httpFetch) {
  const login = String(identity.providerLogin || identity.providerUserId || "");
  if (/^UC[\w-]{20,}$/.test(login)) return { ok: true, channelId: login, displayName: identity.displayName };
  const handle = login.replace(/^@/, "");
  const res = await fetchJson(
    "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&forHandle=" + encodeURIComponent(handle) + "&key=" + encodeURIComponent(env.YOUTUBE_API_KEY),
    {},
    httpFetch
  );
  const item = res.body?.items?.[0];
  if (!res.ok || !item?.id) return { ok: false, error: res.status === 403 ? "YouTube API credentials were rejected" : "YouTube channel was not found" };
  return { ok: true, channelId: item.id, displayName: item.snippet?.title || identity.displayName, profileImageUrl: item.snippet?.thumbnails?.default?.url || "" };
}

export async function checkYoutubeLive(identity, env, httpFetch) {
  const detection = liveDetectionAvailable("youtube", env);
  if (!detection.available) return unknownResult(detection.detail || detection.reason);
  const resolved = await resolveYoutubeChannelId(identity, env, httpFetch);
  if (!resolved.ok) return unknownResult(resolved.error);
  const search = await withRetries(() =>
    fetchJson(
      "https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=" +
        encodeURIComponent(resolved.channelId) +
        "&eventType=live&type=video&maxResults=1&key=" +
        encodeURIComponent(env.YOUTUBE_API_KEY),
      {},
      httpFetch
    )
  );
  if (search.status === 429 || search.body?.error?.errors?.[0]?.reason === "quotaExceeded") {
    return unknownResult("YouTube API quota or rate limit reached");
  }
  if (!search.ok) return unknownResult(search.body?.error?.message || "YouTube status check failed");
  const item = search.body?.items?.[0];
  const videoId = item?.id?.videoId;
  if (!videoId) {
    return {
      status: STREAMER_STATUS.OFFLINE,
      liveDetection: true,
      sessionId: "",
      displayName: resolved.displayName,
      profileImageUrl: resolved.profileImageUrl,
      watchUrl: "https://www.youtube.com/channel/" + resolved.channelId
    };
  }
  const details = await fetchJson(
    "https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails,statistics&id=" +
      encodeURIComponent(videoId) +
      "&key=" +
      encodeURIComponent(env.YOUTUBE_API_KEY),
    {},
    httpFetch
  );
  const video = details.body?.items?.[0];
  const concurrent = video?.liveStreamingDetails?.concurrentViewers;
  return {
    status: STREAMER_STATUS.LIVE,
    liveDetection: true,
    sessionId: String(videoId),
    title: String(video?.snippet?.title || item.snippet?.title || ""),
    category: String(video?.snippet?.categoryId || ""),
    viewerCount: Number.isFinite(Number(concurrent)) ? Number(concurrent) : null,
    thumbnailUrl: String(video?.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.high?.url || ""),
    profileImageUrl: resolved.profileImageUrl,
    displayName: resolved.displayName,
    watchUrl: "https://www.youtube.com/watch?v=" + videoId
  };
}

export async function checkKickLive(identity, env, httpFetch) {
  const detection = liveDetectionAvailable("kick", env);
  if (!detection.available) return unknownResult(detection.detail || detection.reason);
  const token = await kickAppToken(env, httpFetch);
  if (!token.ok) return unknownResult(token.error);
  const slug = String(identity.providerLogin || identity.providerUserId || "").toLowerCase();
  const res = await withRetries(() =>
    fetchJson(
      "https://api.kick.com/public/v1/channels?slug=" + encodeURIComponent(slug),
      { headers: { Authorization: "Bearer " + token.token, Accept: "application/json" } },
      httpFetch
    )
  );
  if (res.status === 429) return unknownResult("Kick rate limited the status check");
  if (!res.ok) return unknownResult(res.body?.message || "Kick status check failed");
  const channel = Array.isArray(res.body?.data) ? res.body.data[0] : res.body?.data || res.body;
  if (!channel) return unknownResult("Kick channel was not found");
  const stream = channel.stream || channel.livestream || {};
  const isLive = stream.is_live === true || stream.isLive === true || channel.is_live === true;
  if (!isLive) {
    return { status: STREAMER_STATUS.OFFLINE, liveDetection: true, sessionId: "", watchUrl: identity.watchUrl, displayName: channel.slug || slug };
  }
  const sessionId = String(stream.id || stream.session_id || stream.started_at || "");
  if (!sessionId) return unknownResult("Kick live session id was missing");
  return {
    status: STREAMER_STATUS.LIVE,
    liveDetection: true,
    sessionId,
    title: String(stream.title || channel.stream_title || ""),
    category: String(stream.category?.name || stream.category_name || ""),
    viewerCount: Number.isFinite(Number(stream.viewer_count ?? stream.viewerCount)) ? Number(stream.viewer_count ?? stream.viewerCount) : null,
    thumbnailUrl: String(stream.thumbnail || stream.thumbnail_url || ""),
    profileImageUrl: String(channel.banner_picture || channel.profile_picture || ""),
    displayName: String(channel.slug || slug),
    watchUrl: "https://kick.com/" + slug
  };
}

export async function checkTiktokLive(identity) {
  return {
    ...unknownResult("TikTok does not provide a reliable official LIVE status API for this integration."),
    watchUrl: identity.watchUrl,
    displayName: identity.displayName
  };
}

export async function checkProviderLive(provider, identity, env, httpFetch) {
  const p = String(provider || "").toLowerCase();
  try {
    if (p === "twitch") return await checkTwitchLive(identity, env, httpFetch);
    if (p === "youtube") return await checkYoutubeLive(identity, env, httpFetch);
    if (p === "kick") return await checkKickLive(identity, env, httpFetch);
    if (p === "tiktok") return await checkTiktokLive(identity);
    return unknownResult("Unknown streaming platform");
  } catch (error) {
    return unknownResult(String(error.message || error));
  }
}

export function providerCapabilities(env = {}) {
  return STREAM_PROVIDERS.map((id) => {
    const detection = liveDetectionAvailable(id, env);
    return {
      id,
      label: id === "youtube" ? "YouTube" : id === "tiktok" ? "TikTok" : id[0].toUpperCase() + id.slice(1),
      liveDetectionAvailable: detection.available,
      liveDetectionReason: detection.reason || "",
      liveDetectionDetail: detection.detail || "",
      credentialKeys: STREAMER_CREDENTIALS[id] || []
    };
  });
}

export function isolationGuildId(requested, sessionGuildId) {
  const a = String(requested || "");
  const b = String(sessionGuildId || "");
  if (!isStreamerSnowflake(a) || !isStreamerSnowflake(b) || a !== b) return "";
  return a;
}
