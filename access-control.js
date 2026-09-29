export const ACCESS_KEYS = [
  "dashboard",
  "servers",
  "premium",
  "direct_messages",
  "tickets",
  "members_roles",
  "moderation",
  "reaction_roles",
  "giveaways",
  "announcements",
  "voice_create",
  "music_bot",
  "streamers",
  "bot_status",
  "logs",
  "settings"
];

export const ACCESS_NONE = "none";
export const ACCESS_OPERATE = "operate";
export const ACCESS_CONFIGURE = "configure";

const RANK = { [ACCESS_NONE]: 0, [ACCESS_OPERATE]: 1, [ACCESS_CONFIGURE]: 2 };

export function normalizeAccessLevel(value) {
  if (value === true || value === 1 || value === "1" || value === "true") return ACCESS_OPERATE;
  const v = String(value || "").trim().toLowerCase();
  if (v === ACCESS_CONFIGURE || v === "config" || v === "full") return ACCESS_CONFIGURE;
  if (v === ACCESS_OPERATE || v === "ops" || v === "use") return ACCESS_OPERATE;
  return ACCESS_NONE;
}

export function levelMeets(have, need = ACCESS_OPERATE) {
  return (RANK[normalizeAccessLevel(have)] || 0) >= (RANK[normalizeAccessLevel(need)] || 0);
}

export function maxAccessLevel(...levels) {
  return levels.map(normalizeAccessLevel).sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0))[0] || ACCESS_NONE;
}

/** Legacy boolean/array permissions → per-key levels. Enabled keys become operate (not configure). */
export function migrateRolePermissions(rawPermissions) {
  const levels = Object.fromEntries(ACCESS_KEYS.map(k => [k, ACCESS_NONE]));
  if (Array.isArray(rawPermissions)) {
    for (const key of rawPermissions) {
      if (ACCESS_KEYS.includes(key)) levels[key] = ACCESS_OPERATE;
    }
    return levels;
  }
  if (rawPermissions && typeof rawPermissions === "object") {
    for (const key of ACCESS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(rawPermissions, key)) {
        const value = rawPermissions[key];
        if (value === false || value == null || value === "") levels[key] = ACCESS_NONE;
        else levels[key] = normalizeAccessLevel(value);
      }
    }
  }
  return levels;
}

export function normalizeAccessRole(role) {
  return {
    roleId: String(role?.roleId || ""),
    enabled: role?.enabled !== false,
    permissions: migrateRolePermissions(role?.levels || role?.permissions)
  };
}

export function normalizeAccessConfig(config) {
  const roles = Array.isArray(config?.roles)
    ? config.roles.map(normalizeAccessRole).filter(r => /^\d{16,22}$/.test(r.roleId)).slice(0, 50)
    : [];
  return { roles };
}

export function roleAccessLevel(role, key) {
  if (!role || role.enabled === false) return ACCESS_NONE;
  return normalizeAccessLevel(migrateRolePermissions(role.levels || role.permissions)[key]);
}

export function accessLevelFromRoles(roles, memberRoleIds, key) {
  const set = new Set((memberRoleIds || []).map(String));
  let best = ACCESS_NONE;
  for (const role of roles || []) {
    if (!set.has(String(role.roleId))) continue;
    best = maxAccessLevel(best, roleAccessLevel(role, key));
  }
  return best;
}

/** Discord member role IDs plus @everyone (guild id). Never uses client-supplied IDs. */
export function memberRoleIdsForAccess(guildId, memberRoleIds) {
  const ids = [...new Set((memberRoleIds || []).map(String).filter((id) => /^\d{16,22}$/.test(id)))];
  const gid = String(guildId || "");
  if (/^\d{16,22}$/.test(gid) && !ids.includes(gid)) ids.push(gid);
  return ids;
}

/**
 * Visibility for Control Center: bot must be in the guild and the user must be a member.
 * Owner / Discord Manage Guild / Administrator, or RBAC OPERATE|CONFIGURE on any module.
 * Does not use OAuth guild lists.
 */
export function decideGuildVisibility({
  botInstalled,
  memberFound,
  guildId,
  guildName,
  guildIcon,
  guildOwnerId,
  userId,
  discordRoles,
  memberRoleIds,
  accessConfig
}) {
  if (!botInstalled || !memberFound) return null;
  const id = String(guildId || "");
  if (!/^\d{16,22}$/.test(id)) return null;
  const name = String(guildName || id);
  const icon = guildIcon ?? null;
  if (String(guildOwnerId) === String(userId)) {
    return { id, name, icon, owner: true, access: "owner" };
  }
  if (memberHasDiscordGuildManager(id, discordRoles || [], memberRoleIds || [])) {
    return { id, name, icon, owner: false, access: "manage" };
  }
  const roles = normalizeAccessConfig(accessConfig).roles;
  if (memberHasAnyCapability(roles, memberRoleIdsForAccess(id, memberRoleIds))) {
    return { id, name, icon, owner: false, access: "rbac" };
  }
  return null;
}

export function moduleAccessMap(accessConfig, memberRoleIds, guildId) {
  const roles = normalizeAccessConfig(accessConfig).roles;
  const ids = memberRoleIdsForAccess(guildId, memberRoleIds);
  return Object.fromEntries(ACCESS_KEYS.map((k) => [k, accessLevelFromRoles(roles, ids, k)]));
}

/** True when any BalticM RBAC V2 module is OPERATE or CONFIGURE for the member's Discord role IDs. */
export function memberHasAnyCapability(roles, memberRoleIds) {
  const set = new Set((memberRoleIds || []).map(String));
  for (const role of roles || []) {
    if (!set.has(String(role.roleId)) || role.enabled === false) continue;
    const levels = migrateRolePermissions(role.levels || role.permissions);
    for (const key of ACCESS_KEYS) {
      if (levelMeets(levels[key], ACCESS_OPERATE)) return true;
    }
  }
  return false;
}

/** Discord permission bits used for existing owner-level Control Center discovery. */
export const DISCORD_PERMISSION = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n
};

/** True when oauth guild permissions include Administrator or Manage Guild. */
export function oauthGuildHasManageAccess(guild) {
  if (guild?.owner) return true;
  try {
    const perms = BigInt(guild?.permissions || "0");
    if ((perms & DISCORD_PERMISSION.ADMINISTRATOR) === DISCORD_PERMISSION.ADMINISTRATOR) return true;
    if ((perms & DISCORD_PERMISSION.MANAGE_GUILD) === DISCORD_PERMISSION.MANAGE_GUILD) return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * Compute whether a member's Discord roles grant Manage Guild / Administrator.
 * Uses guild + Discord role IDs only (@everyone = guildId).
 */
export function memberHasDiscordGuildManager(guildId, guildRoles, memberRoleIds) {
  const ids = new Set((memberRoleIds || []).map(String));
  if (guildId) ids.add(String(guildId));
  let perms = 0n;
  for (const role of guildRoles || []) {
    if (!ids.has(String(role.id))) continue;
    try {
      perms |= BigInt(role.permissions || "0");
    } catch {
      /* ignore invalid */
    }
  }
  if ((perms & DISCORD_PERMISSION.ADMINISTRATOR) === DISCORD_PERMISSION.ADMINISTRATOR) return true;
  if ((perms & DISCORD_PERMISSION.MANAGE_GUILD) === DISCORD_PERMISSION.MANAGE_GUILD) return true;
  return false;
}

export function emptyAccessLevels() {
  return Object.fromEntries(ACCESS_KEYS.map(k => [k, ACCESS_NONE]));
}

export function defaultOperateLevels() {
  return Object.fromEntries(ACCESS_KEYS.map(k => [k, ACCESS_OPERATE]));
}

export function countAccessLevels(permissions) {
  const levels = migrateRolePermissions(permissions);
  let operate = 0;
  let configure = 0;
  for (const key of ACCESS_KEYS) {
    if (levels[key] === ACCESS_CONFIGURE) configure++;
    else if (levels[key] === ACCESS_OPERATE) operate++;
  }
  return { operate, configure, total: operate + configure };
}

export function routeAccessKey(path) {
  const p = String(path || "");
  if (p.startsWith("/api/profile/streaming")) return null;
  if (p.startsWith("/api/streaming-accounts")) return null;
  if (p.startsWith("/api/streamers/self")) return null;
  if (p.startsWith("/api/streamers")) return "streamers";
  if (p.startsWith("/api/music")) return "music_bot";
  if (p.startsWith("/api/voice-create")) return "voice_create";
  if (p.startsWith("/api/tickets")) return "tickets";
  if (p.startsWith("/api/moderation")) return "moderation";
  if (p.startsWith("/api/discord/roles") || /^\/api\/discord\/members\/[^/]+\/roles\//.test(p)) return "members_roles";
  if (p.startsWith("/api/reaction-roles")) return "reaction_roles";
  if (p.startsWith("/api/giveaways")) return "giveaways";
  if (p.startsWith("/api/announcements")) return "announcements";
  if (p.startsWith("/api/direct-messages")) return "direct_messages";
  if (p.startsWith("/api/logs")) return "logs";
  if (p.startsWith("/api/status")) return "bot_status";
  if (p.startsWith("/api/premium")) return "premium";
  if (p.startsWith("/api/settings")) return "settings";
  return null;
}

/** Minimum capability required for a Control Center API request (approved audit map). */
export function requiredLevelForRequest(path, method = "GET") {
  const p = String(path || "");
  const m = String(method || "GET").toUpperCase();

  if (p === "/api/tickets/config" && m === "POST") return ACCESS_CONFIGURE;
  if (p === "/api/tickets/publish" && m === "POST") return ACCESS_CONFIGURE;
  if (/^\/api\/tickets\/types\/(support|report)$/.test(p) && m === "POST") return ACCESS_CONFIGURE;
  if (/^\/api\/tickets\/types\/(support|report)\/publish$/.test(p) && m === "POST") return ACCESS_CONFIGURE;

  if (p.startsWith("/api/profile/streaming")) return ACCESS_NONE;
  if (p.startsWith("/api/streaming-accounts")) return ACCESS_NONE;
  if (p.startsWith("/api/streamers/self")) return ACCESS_NONE;
  if (p.startsWith("/api/streamers")) {
    if (m === "GET") return ACCESS_OPERATE;
    if (/\/(refresh|check)$/.test(p) && m === "POST") return ACCESS_OPERATE;
    return ACCESS_CONFIGURE;
  }

  if (p === "/api/music/config" && m === "POST") return ACCESS_CONFIGURE;

  if (p === "/api/voice-create" && m === "POST") return ACCESS_CONFIGURE;

  if (p === "/api/moderation/settings" && m === "POST") return ACCESS_CONFIGURE;

  if (p.startsWith("/api/reaction-roles") && !p.startsWith("/api/reaction-roles/service/")) {
    if (m === "GET") return ACCESS_OPERATE;
    return ACCESS_CONFIGURE;
  }

  if (p.startsWith("/api/announcements")) {
    if (m === "GET") return ACCESS_OPERATE;
    return ACCESS_CONFIGURE;
  }

  if (p.startsWith("/api/giveaways")) {
    if (m === "GET") return ACCESS_OPERATE;
    if (/\/(end|reroll)$/.test(p) && m === "POST") return ACCESS_OPERATE;
    return ACCESS_CONFIGURE;
  }

  if (p.startsWith("/api/discord/roles")) {
    if (m === "GET") return ACCESS_OPERATE;
    return ACCESS_CONFIGURE;
  }
  if (/^\/api\/discord\/members\/[^/]+\/roles\//.test(p)) return ACCESS_OPERATE;

  if (p.startsWith("/api/direct-messages")) return ACCESS_OPERATE;
  if (p.startsWith("/api/logs")) return ACCESS_OPERATE;
  if (p.startsWith("/api/status")) return ACCESS_OPERATE;
  if (p.startsWith("/api/premium")) return ACCESS_OPERATE;

  if (p.startsWith("/api/settings")) {
    if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") return ACCESS_CONFIGURE;
    return ACCESS_OPERATE;
  }

  return ACCESS_OPERATE;
}

export function accessLevelLabel(level) {
  const v = normalizeAccessLevel(level);
  if (v === ACCESS_CONFIGURE) return "Configure";
  if (v === ACCESS_OPERATE) return "Operate";
  return "No Access";
}
