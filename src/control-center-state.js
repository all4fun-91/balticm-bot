import { ACCESS_OPERATE, levelMeets } from "../access-control.js";

export const SELECTED_GUILD_STORAGE_KEY = "balticm-selected-guild";

export const FEATURE_MODULE_BY_PAGE = {
  "Direct Messages": "direct_messages",
  Tickets: "tickets",
  "Members & Roles": "members_roles",
  Moderation: "moderation",
  "Reaction Roles": "reaction_roles",
  Giveaways: "giveaways",
  Announcements: "announcements",
  "Voice Create": "voice_create",
  "Music Bot": "music_bot",
  Streamers: "streamers"
};

export const PAGE_ACCESS_KEY = {
  Dashboard: "dashboard",
  Servers: "servers",
  Premium: "premium",
  "Direct Messages": "direct_messages",
  Tickets: "tickets",
  "Members & Roles": "members_roles",
  Moderation: "moderation",
  "Reaction Roles": "reaction_roles",
  Giveaways: "giveaways",
  Announcements: "announcements",
  "Voice Create": "voice_create",
  "Music Bot": "music_bot",
  Streamers: "streamers",
  "Bot Status": "bot_status",
  Logs: "logs",
  Settings: "settings"
};

export const PAGE_PATHS = {
  Dashboard: "/",
  "Bot Status": "/bot-status",
  Servers: "/servers",
  Premium: "/premium",
  "Members & Roles": "/members-roles",
  Moderation: "/moderation",
  Tickets: "/tickets",
  Announcements: "/announcements",
  Giveaways: "/giveaways",
  "Direct Messages": "/direct-messages",
  "Reaction Roles": "/reaction-roles",
  "Voice Create": "/voice-create",
  "Music Bot": "/music",
  Streamers: "/streamers",
  Logs: "/logs",
  Settings: "/settings",
  Profile: "/profile",
  Privacy: "/privacy",
  Terms: "/terms"
};

export const PUBLIC_PAGES = ["Privacy", "Terms"];
export const SUPPORT_DISCORD_URL = "https://discord.gg/yMJ7HzCMfc";

const PATH_TO_PAGE = {
  "/": "Dashboard",
  "/dashboard": "Dashboard",
  ...Object.fromEntries(Object.entries(PAGE_PATHS).filter(([, path]) => path !== "/").map(([page, path]) => [path, page]))
};

export function canUseAccess(perms, key, min = ACCESS_OPERATE) {
  if (!perms) return true;
  const level = perms[key];
  // null/undefined level = unknown (still loading or a transient lookup failure):
  // never treat it as a denial. Explicit levels ("none"/"operate"/"configure") are enforced.
  if (level == null) return true;
  return levelMeets(level, min);
}

export function isValidAccessPayload(payload) {
  return !!(payload && payload.permissions && typeof payload.permissions === "object");
}

export function normalizePath(pathname) {
  return String(pathname || "").replace(/\/+$/, "") || "/";
}

export function pageFromPath(pathname) {
  return PATH_TO_PAGE[normalizePath(pathname)] || "";
}

export function pathFromPage(page) {
  return PAGE_PATHS[page] || "/";
}

export function readStoredGuildId(storage) {
  try {
    const store = storage || globalThis.localStorage;
    return String(store?.getItem?.(SELECTED_GUILD_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeStoredGuildId(id, storage) {
  const value = String(id || "").trim();
  if (!value) return "";
  try {
    const store = storage || globalThis.localStorage;
    store?.setItem?.(SELECTED_GUILD_STORAGE_KEY, value);
  } catch {}
  return value;
}

export function pickAuthorizedGuildId({ storedId, authorizedGuilds } = {}) {
  const ids = (Array.isArray(authorizedGuilds) ? authorizedGuilds : [])
    .map(g => String(g?.id || "").trim())
    .filter(Boolean);
  const stored = String(storedId || "").trim();
  if (stored && ids.includes(stored)) return stored;
  return ids[0] || "";
}

export function isPublicPage(page) {
  return PUBLIC_PAGES.includes(page);
}

export function fallbackPageIfUnauthorized(page, { user, permissions, modules, accessReady = true } = {}) {
  if (!accessReady) return page;
  const name = page || "Dashboard";
  if (isPublicPage(name)) return name;
  if (name === "Profile") return user ? "Profile" : "Dashboard";
  if (!user && (name === "Logs" || name === "Settings")) return "Dashboard";
  if (name === "Settings") return user && canUseAccess(permissions, "settings") ? "Settings" : "Dashboard";
  const accessKey = PAGE_ACCESS_KEY[name];
  if (accessKey && permissions && !canUseAccess(permissions, accessKey)) return "Dashboard";
  const moduleKey = FEATURE_MODULE_BY_PAGE[name];
  if (moduleKey && modules && modules[moduleKey] === false) return "Dashboard";
  return name;
}

export function pageAfterRefresh({ pathname, user, storedGuildId, authorizedGuilds, permissions, modules, accessReady = true } = {}) {
  const fromPath = pageFromPath(pathname) || "Dashboard";
  return {
    page: fallbackPageIfUnauthorized(fromPath, { user, permissions, modules, accessReady }),
    guildId: pickAuthorizedGuildId({ storedId: storedGuildId, authorizedGuilds })
  };
}

export const MEMBERS_ROLES_NO_PERMISSION_ERROR = "You do not have permission to manage members and roles in this server.";
export const MEMBERS_ROLES_TEMPORARY_ERROR = "Discord is temporarily unavailable. Please try again in a moment.";

/**
 * Turn a Members & Roles API failure into user-facing text.
 * - `retryable` / `accessUnknown` (transient Discord lookup failure) is always
 *   reported as temporary — never as missing permissions.
 * - A raw RBAC denial ("Forbidden") never renders; a real hierarchy/bot
 *   permission message from the worker passes through because it is actionable.
 * - Server-side 5xx messages for this feature are curated, so they pass too.
 */
export function membersRolesErrorText(status, body, fallback) {
  const code = Number(status) || 0;
  const data = body && typeof body === "object" ? body : {};
  const raw = String(data.error || "").trim();
  const fb = String(fallback || "The request could not be completed");
  let text;
  if (data.retryable || data.accessUnknown) text = raw || MEMBERS_ROLES_TEMPORARY_ERROR;
  else if (code === 401) text = "Your session has expired. Please sign in again.";
  else if (code === 403) text = raw && raw !== "Forbidden" ? raw : MEMBERS_ROLES_NO_PERMISSION_ERROR;
  else if (code === 503) text = raw || MEMBERS_ROLES_TEMPORARY_ERROR;
  else text = raw || fb;
  if (text === "Forbidden" || text === "Unauthorized") return MEMBERS_ROLES_NO_PERMISSION_ERROR;
  return text;
}
