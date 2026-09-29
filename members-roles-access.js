import {
  ACCESS_CONFIGURE,
  ACCESS_OPERATE,
  levelMeets,
  memberHasAnyCapability,
  normalizeAccessLevel
} from "./access-control.js";
import { roleAssignBlock } from "./reaction-roles.js";

export function isSnowflake(id) {
  return /^\d{16,22}$/.test(String(id || ""));
}

/** Highest Discord role position among the member's roles (@everyone = guildId). */
export function highestRolePosition(guildRoles, memberRoleIds, guildId) {
  const ids = new Set((memberRoleIds || []).map(String));
  if (guildId) ids.add(String(guildId));
  let highest = 0;
  for (const role of guildRoles || []) {
    if (!ids.has(String(role.id))) continue;
    highest = Math.max(highest, Number(role.position) || 0);
  }
  return highest;
}

/** True when this Discord role ID is configured with any BalticM OPERATE/CONFIGURE capability. */
export function roleGrantsControlCenterAccess(accessConfigRoles, roleId) {
  const id = String(roleId || "");
  if (!id) return false;
  for (const role of accessConfigRoles || []) {
    if (String(role.roleId) !== id) continue;
    if (role.enabled === false) continue;
    if (memberHasAnyCapability([role], [id])) return true;
  }
  return false;
}

function deny(error, code = "forbidden") {
  return { ok: false, error, code };
}

/**
 * Server-side gate for assigning/removing a Discord role on a member.
 * OPERATE may only touch safe lower roles; never Control Center RBAC roles.
 */
export function decideMemberRoleChange({
  guildId,
  actorId,
  actorIsGuildOwner = false,
  actorRoleIds = [],
  actorAccessLevel = ACCESS_OPERATE,
  targetMemberId,
  targetIsGuildOwner = false,
  targetRoleIds = [],
  roleId,
  role = null,
  guildRoles = [],
  accessConfigRoles = [],
  botAccess = { highestPosition: 0, canManageRoles: false, administrator: false },
  remove = false
} = {}) {
  if (!isSnowflake(guildId) || !isSnowflake(targetMemberId) || !isSnowflake(roleId)) {
    return deny("Invalid guild, member, or role id", "invalid_id");
  }
  if (role?.guildId && String(role.guildId) !== String(guildId)) {
    return deny("Role does not belong to this server", "cross_guild");
  }
  if (String(roleId) === String(guildId)) {
    return deny("Cannot manage the @everyone role", "everyone");
  }
  if (targetIsGuildOwner) {
    return deny("Cannot manage the Discord Server Owner", "owner");
  }
  if (!role || String(role.id) !== String(roleId)) {
    return deny("Role could not be resolved", "missing_role");
  }
  if (role.managed) {
    return deny("Managed role cannot be assigned", "managed");
  }

  const actorHighest = actorIsGuildOwner
    ? Number.MAX_SAFE_INTEGER
    : highestRolePosition(guildRoles, actorRoleIds, guildId);
  const rolePos = Number(role.position) || 0;
  if (!actorIsGuildOwner && rolePos >= actorHighest) {
    return deny("Cannot manage equal or higher roles", "hierarchy");
  }

  // Discord-style member hierarchy: cannot manage members at/above your top role.
  if (!actorIsGuildOwner && String(targetMemberId) !== String(actorId)) {
    const targetHighest = highestRolePosition(guildRoles, targetRoleIds, guildId);
    if (targetHighest >= actorHighest) {
      return deny("Cannot manage members with equal or higher roles", "member_hierarchy");
    }
  }

  const level = normalizeAccessLevel(actorAccessLevel);
  const isOperateOnly = levelMeets(level, ACCESS_OPERATE) && !levelMeets(level, ACCESS_CONFIGURE);
  if (isOperateOnly && roleGrantsControlCenterAccess(accessConfigRoles, roleId)) {
    return deny(
      remove
        ? "Cannot remove a Control Center access role with Operate"
        : "Cannot assign a Control Center access role with Operate",
      "rbac_escalation"
    );
  }

  const botBlock = roleAssignBlock({
    role: { ...role, guildId },
    botHighestPosition: botAccess.highestPosition,
    canManageRoles: botAccess.canManageRoles,
    administrator: botAccess.administrator,
    guildId,
    accessKnown: true
  });
  if (botBlock) return deny(botBlock, "bot_hierarchy");

  return { ok: true, remove: !!remove };
}

/**
 * Server-side gate for create/edit/delete Discord roles (CONFIGURE).
 * Hierarchy and bot Manage Roles still apply.
 */
export function decideRoleMutation({
  action = "edit",
  guildId,
  actorIsGuildOwner = false,
  actorRoleIds = [],
  roleId = "",
  role = null,
  guildRoles = [],
  botAccess = { highestPosition: 0, canManageRoles: false, administrator: false },
  payload = null
} = {}) {
  if (!isSnowflake(guildId)) return deny("Invalid guild id", "invalid_id");
  if (!botAccess.canManageRoles && !botAccess.administrator) {
    return deny("Missing Manage Roles permission", "bot_hierarchy");
  }

  if (action === "create") {
    if (payload?.position != null) {
      const pos = Number(payload.position);
      const actorHighest = actorIsGuildOwner
        ? Number.MAX_SAFE_INTEGER
        : highestRolePosition(guildRoles, actorRoleIds, guildId);
      if (!actorIsGuildOwner && Number.isFinite(pos) && pos >= actorHighest) {
        return deny("Cannot create or place a role at equal or higher position", "hierarchy");
      }
      if (!botAccess.administrator && Number.isFinite(pos) && pos >= Number(botAccess.highestPosition)) {
        return deny("Bot role must be above the selected role", "bot_hierarchy");
      }
    }
    return { ok: true };
  }

  if (!isSnowflake(roleId)) return deny("Invalid role id", "invalid_id");
  if (String(roleId) === String(guildId)) return deny("Cannot modify the @everyone role", "everyone");
  if (!role || String(role.id) !== String(roleId)) return deny("Role could not be resolved", "missing_role");
  if (role.guildId && String(role.guildId) !== String(guildId)) {
    return deny("Role does not belong to this server", "cross_guild");
  }
  if (role.managed) return deny("Managed role cannot be modified", "managed");

  const actorHighest = actorIsGuildOwner
    ? Number.MAX_SAFE_INTEGER
    : highestRolePosition(guildRoles, actorRoleIds, guildId);
  const rolePos = Number(role.position) || 0;
  if (!actorIsGuildOwner && rolePos >= actorHighest) {
    return deny("Cannot manage equal or higher roles", "hierarchy");
  }

  if (payload && Object.prototype.hasOwnProperty.call(payload, "position")) {
    const pos = Number(payload.position);
    if (!Number.isFinite(pos)) return deny("Invalid role position", "invalid_position");
    if (!actorIsGuildOwner && pos >= actorHighest) {
      return deny("Cannot reorder a role to equal or higher position", "hierarchy");
    }
    if (!botAccess.administrator && pos >= Number(botAccess.highestPosition)) {
      return deny("Bot role must be above the selected role", "bot_hierarchy");
    }
  }

  const botBlock = roleAssignBlock({
    role: { ...role, guildId },
    botHighestPosition: botAccess.highestPosition,
    canManageRoles: botAccess.canManageRoles,
    administrator: botAccess.administrator,
    guildId,
    accessKnown: true
  });
  if (botBlock) return deny(botBlock, "bot_hierarchy");

  return { ok: true };
}
