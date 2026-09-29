/** Pure helpers for Control Center General settings (VIP vs FREE branding). */

export const FREE_BOT_NICKNAME = "BalticM.Eu";
export const FREE_BOT_AVATAR_URL =
  "https://media.balticm.eu/media/site/1789353600524-63dc7873-b363-4d93-a68c-4451208f096d.png";
export const FREE_BOT_INITIALS = "BM";
export const MAX_BOT_AVATAR_BYTES = 2 * 1024 * 1024;
/** Discord guild avatar size after center-crop (square). */
export const BOT_AVATAR_SIZE = 512;
export const BOT_AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

export const BOT_APP_DESCRIPTION =
  "BalticM Control Center — https://bot.balticm.eu\n\nManage moderation, tickets, reaction roles, giveaways, announcements, voice & music. Slash commands for this bot appear on this profile.";

/**
 * Discord guild nickname shown as "Nickname | Initials".
 * Empty initials → nickname only (no pipe). Discord nick max length is 32.
 */
export function formatDiscordBotNick(nickname, initials) {
  const nick = String(nickname || "").trim();
  const init = String(initials || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);
  if (!nick) return "";
  if (!init) return nick.slice(0, 32);
  const sep = " | ";
  const maxNickLen = Math.max(1, 32 - sep.length - init.length);
  return `${nick.slice(0, maxNickLen)}${sep}${init}`;
}

/**
 * Resolve nickname / avatar URL / initials from premium state + requested body.
 * FREE is forced to BalticM branding regardless of client input.
 * VIP may clear initials (empty → Discord nick is nickname only).
 */
export function resolveGeneralBranding(premium, requested = {}) {
  const isVip = !!premium;
  const nick = String(requested.botNickname || "").trim().slice(0, 32);
  const avatarUrl = String(requested.botAvatarUrl || "").trim().slice(0, 500);
  const initials = String(requested.botInitials || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);
  const timezone = String(requested.timezone || "Europe/Berlin").slice(0, 64);
  return {
    botNickname: isVip ? nick || FREE_BOT_NICKNAME : FREE_BOT_NICKNAME,
    botAvatarUrl: isVip ? avatarUrl || FREE_BOT_AVATAR_URL : FREE_BOT_AVATAR_URL,
    botInitials: isVip ? initials : FREE_BOT_INITIALS,
    timezone: timezone || "Europe/Berlin",
    allowCustomAvatar: isVip,
    allowCustomNickname: isVip,
    allowCustomInitials: isVip
  };
}

/**
 * Single Discord guild-nickname builder for FREE/VIP Save, grant, extend, revoke, and expiry.
 * FREE → always BalticM.Eu | BM. VIP empty initials → nickname only (no |).
 */
export function discordBotNickForPlan(premium, config = {}) {
  const branding = resolveGeneralBranding(!!premium, config);
  return formatDiscordBotNick(branding.botNickname, branding.botInitials);
}

/** FREE Discord server nickname: BalticM.Eu | BM */
export const FREE_DISCORD_BOT_NICK = discordBotNickForPlan(false, {});

/** Guild-member avatar CDN URL (per-server bot image). */
export function guildMemberAvatarUrl(guildId, userId, avatarHash) {
  if (!guildId || !userId || !avatarHash) return "";
  const ext = String(avatarHash).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${avatarHash}.${ext}?size=128`;
}

/**
 * Validate a Discord-style data URI. Returns { ok, mime, byteLength, error? }.
 */
export function validateBotAvatarDataUri(dataUri, maxBytes = MAX_BOT_AVATAR_BYTES) {
  const raw = String(dataUri || "");
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw);
  if (!m) return { ok: false, error: "Avatar must be a png, jpg, webp, or gif data URI." };
  const mime = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
  if (!BOT_AVATAR_MIME.has(mime) && mime !== "image/jpeg") {
    return { ok: false, error: "Unsupported avatar image type." };
  }
  const b64 = m[2].replace(/\s+/g, "");
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor((b64.length * 3) / 4) - pad;
  if (byteLength <= 0) return { ok: false, error: "Avatar image is empty." };
  if (byteLength > maxBytes) {
    return {
      ok: false,
      error: `Avatar is too large (${Math.ceil(byteLength / 1024)} KB). Max is ${Math.floor(maxBytes / 1024)} KB.`
    };
  }
  return { ok: true, mime, byteLength, dataUri: `data:${mime};base64,${b64}` };
}

/** True when URL looks like a safe https image URL we may fetch server-side. */
export function isHttpsImageUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:";
  } catch {
    return false;
  }
}
