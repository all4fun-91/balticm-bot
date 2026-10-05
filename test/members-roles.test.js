import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACCESS_CONFIGURE,
  ACCESS_OPERATE,
  requiredLevelForRequest,
  routeAccessKey
} from "../access-control.js";
import { decideMemberRoleChange, decideRoleMutation, highestRolePosition } from "../members-roles-access.js";
import { botRoleAccess, roleAssignBlock } from "../reaction-roles.js";
import {
  MEMBERS_ROLES_NO_PERMISSION_ERROR,
  MEMBERS_ROLES_TEMPORARY_ERROR,
  membersRolesErrorText
} from "../src/control-center-state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");

// ---------------------------------------------------------------------------
// Root cause regression: the role mutation routes must pass the session user
// into the handlers. They used to pass guildId in the user slot, so the worker
// called Discord with GET /guilds/undefined and Discord answered
// HTTP 400 {"message":"Invalid Form Body","code":50035,
// "errors":{"guild_id":{"_errors":[{"code":"NUMBER_TYPE_COERCE",
// "message":"Value \"undefined\" is not snowflake."}]}}}, which surfaced in the
// Control Center as HTTP 502 {"error":"Could not load Discord server"}.
// ---------------------------------------------------------------------------

test("role mutation routes pass the session user to every handler", () => {
  assert.match(workerSrc, /return createDiscordRole\(req,env,user,guildId\);/);
  assert.match(workerSrc, /deleteDiscordRole\(env,user,guildId,decodeURIComponent\(er\[1\]\)\)/);
  assert.match(workerSrc, /editDiscordRole\(req,env,user,guildId,decodeURIComponent\(er\[1\]\)\)/);
  assert.match(
    workerSrc,
    /changeMemberRole\(req,env,user,guildId,decodeURIComponent\(rm\[1\]\),decodeURIComponent\(rm\[2\]\),req\.method==="DELETE"\)/
  );
  // Handler signatures still line up with those call sites:
  assert.match(workerSrc, /async function createDiscordRole\(req,env,user,guildId\)/);
  assert.match(workerSrc, /async function deleteDiscordRole\(env,user,guildId,roleId\)/);
  assert.match(workerSrc, /async function editDiscordRole\(req,env,user,guildId,roleId\)/);
  assert.match(workerSrc, /async function changeMemberRole\(req,env,user,guildId,memberId,roleId,remove=false\)/);
  // A future argument slip must fail fast with a 400 instead of building a
  // malformed Discord URL:
  const ctxFn = workerSrc.match(/async function loadMembersRolesContext\(env,guildId,actorId,targetMemberId=""\)\{[\s\S]*?\n\}/);
  assert.ok(ctxFn, "loadMembersRolesContext present");
  assert.match(ctxFn[0], /if\(!isSnowflake\(guildId\)\)return\{error:"Invalid guild id",code:"invalid_id",status:400\};/);
  assert.match(ctxFn[0], /if\(!isSnowflake\(actorId\)\)return\{error:"Invalid member id",code:"invalid_id",status:400\};/);
  // The guild/roles/member lookups are all built from validated ids:
  assert.doesNotMatch(ctxFn[0], /guilds\/undefined/);
});

// ---------------------------------------------------------------------------
// Transient Discord lookup handling (known bursty 403, plus 429/5xx/network):
// retried, then reported as temporary — never as a permissions failure and
// never as a raw status passthrough. RBAC itself is untouched and fail-closed.
// ---------------------------------------------------------------------------

test("read-only Discord lookups retry transient failures and log them", () => {
  const transient = workerSrc.match(/function discordLookupTransient\(status\)\{[^\n]+\}/);
  assert.ok(transient, "transient classifier present");
  assert.match(transient[0], /s===0/, "network errors count as transient");
  assert.match(transient[0], /s===403/, "the known bursty 403 counts as transient");
  assert.match(transient[0], /s===429/);
  assert.match(transient[0], /s>=500/);
  assert.doesNotMatch(transient[0], /s===404/, "404 stays a definitive answer");

  const get = workerSrc.match(/async function discordGet\(url,headers,stage,guildId,component="members-roles"\)\{[\s\S]*?\n\}/);
  assert.ok(get, "discordGet retry helper present");
  assert.match(get[0], /DISCORD_LOOKUP_RETRY_DELAYS_MS/);
  assert.match(get[0], /attempt<DISCORD_LOOKUP_RETRY_DELAYS_MS\.length/, "bounded retries, no loops");
  assert.match(get[0], /if\(res&&res\.ok\)return res;/, "success returns immediately");
  assert.match(get[0], /event:willRetry\?"discord-lookup-retry":"discord-lookup-failed"/, "diagnostics are logged");
  assert.match(get[0], /if\(status!==404\)console\.log/);
});

test("a transient failure is a retryable 503, never a raw error or a permissions claim", () => {
  const unavail = workerSrc.match(/function membersRolesUnavailable\(stage\)\{[^\n]+\}/);
  assert.ok(unavail);
  assert.match(unavail[0], /status:503/);
  assert.match(unavail[0], /retryable:true/);
  assert.match(unavail[0], /DISCORD_LOOKUP_ERROR/);

  const ctxFn = workerSrc.match(/async function loadMembersRolesContext\(env,guildId,actorId,targetMemberId=""\)\{[\s\S]*?\n\}/);
  assert.ok(ctxFn);
  // Definitive answers keep their exact contract:
  assert.match(ctxFn[0], /gr\.status===404\)return\{error:"Bot is not installed in this server",status:404/);
  assert.match(ctxFn[0], /actorMr\.status===404\)return\{error:"You are not a member of this server",status:403/);
  assert.match(ctxFn[0], /targetMr\.status===404\)return\{error:"Member could not be resolved in this server",status:403/);
  // Transient outcomes can never become those claims:
  assert.match(ctxFn[0], /discordLookupTransient\(actorMr\.status\)\?membersRolesUnavailable\("actor-member"\)/);
  assert.match(ctxFn[0], /discordLookupTransient\(gr\.status\)\)return membersRolesUnavailable\("guild"\)/);
  assert.match(ctxFn[0], /discordLookupTransient\(botMr\.status\)\?membersRolesUnavailable\("bot-member"\)/);
  assert.match(ctxFn[0], /discordLookupTransient\(targetMr\.status\)\?membersRolesUnavailable\("target-member"\)/);
  // A failed bot-member lookup must not silently become "bot has no roles":
  assert.match(ctxFn[0], /if\(!botMr\)return membersRolesUnavailable\("bot-member"\);/);
  assert.match(ctxFn[0], /botMr\.status===404\)return\{error:"Bot is not installed in this server",status:404/);
  // No raw Discord status ever leaks out of this function (the diagnostic
  // log may record it, the response may not):
  assert.doesNotMatch(ctxFn[0], /return\{[^}]*status:gr\.status/);
  assert.doesNotMatch(ctxFn[0], /return\{[^}]*status:rr\.status/);
  assert.doesNotMatch(ctxFn[0], /return\{[^}]*status:actorMr\.status/);
  // All four mutation handlers forward the retryable flag to the client:
  const forwarded = workerSrc.match(/json\(\{error:ctx\.error,code:ctx\.code,retryable:!!ctx\.retryable\},ctx\.status\|\|502\)/g) || [];
  assert.equal(forwarded.length, 4, "create/edit/delete/assign all forward retryable");
});

test("access settings, guild state and member list never leak a raw Discord status", () => {
  const accessState = workerSrc.match(/async function accessSettingsState\(env,guildId\)\{[\s\S]{0,1500}/);
  assert.ok(accessState, "accessSettingsState present");
  assert.match(accessState[0], /discordGet\(/);
  assert.match(accessState[0], /discordLookupTransient\(gr\.status\)\)return \{error:DISCORD_LOOKUP_ERROR,status:503,retryable:true\}/);
  assert.match(accessState[0], /gr\.status===404\)return \{error:"Bot is not installed in this server",status:404\}/);
  assert.doesNotMatch(accessState[0], /status:gr\.status/, "raw Discord status must not become the API status");

  const guildState = workerSrc.match(/async function discordGuild\(env,id\)\{[\s\S]{0,900}/);
  assert.ok(guildState, "discordGuild present");
  assert.match(guildState[0], /discordGet\(/);
  assert.match(guildState[0], /discordLookupTransient\(g\.status\)\)return json\(\{error:DISCORD_LOOKUP_ERROR,retryable:true\},503\)/);
  assert.match(guildState[0], /error:"Could not load Discord server"/);
  assert.doesNotMatch(guildState[0], /Discord guild request failed/);

  const members = workerSrc.match(/async function discordMembers\(env,guildId\)\{[\s\S]{0,700}/);
  assert.ok(members, "discordMembers present");
  assert.match(members[0], /discordGet\(/);
  assert.match(members[0], /error:DISCORD_LOOKUP_ERROR,retryable:true\},503\)/);
  assert.doesNotMatch(members[0], /Discord members request failed/);
});

test("member role changes resolve the access level with retries and stay fail-closed", () => {
  const change = workerSrc.match(/async function changeMemberRole\(req,env,user,guildId,memberId,roleId,remove=false\)\{[\s\S]{0,1800}/);
  assert.ok(change, "changeMemberRole present");
  assert.match(change[0], /resolveAccessLevel\(env,user,guildId,"members_roles"\)/);
  assert.match(change[0], /actorAccessLevel===null\)return json\(\{error:ACCESS_UNKNOWN_ERROR,accessUnknown:true,requiredPermission:"members_roles"\},503\)/);
  assert.doesNotMatch(change[0], /await controlAccessLevel\(env,user,guildId,"members_roles"\)/, "unknown state is retried before use");
  // The RBAC escalation guard is still applied to every assignment:
  assert.match(change[0], /decideMemberRoleChange\(\{/);
  assert.match(change[0], /accessConfigRoles:ctx\.accessConfig\?\.roles\|\|\[\]/);
  // RBAC gating for the routes themselves is unchanged:
  assert.equal(routeAccessKey("/api/discord/roles"), "members_roles");
  assert.equal(routeAccessKey("/api/discord/members/123456789012345678/roles/223456789012345678"), "members_roles");
  assert.equal(requiredLevelForRequest("/api/discord/roles", "POST"), ACCESS_CONFIGURE, "create role still needs Configure");
  assert.equal(requiredLevelForRequest("/api/discord/roles", "DELETE"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/discord/members/123456789012345678/roles/223456789012345678", "PUT"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/discord/members", "GET"), ACCESS_OPERATE);
});

test("Discord mutation failures are mapped to useful text, never raw blips", () => {
  const mut = workerSrc.match(/function membersRolesDiscordError\(status,data,fallback\)\{[\s\S]*?\n\}/);
  assert.ok(mut, "membersRolesDiscordError present");
  assert.match(mut[0], /s===429\|\|s>=500\)return\{error:DISCORD_LOOKUP_ERROR,status:503,retryable:true\}/, "rate limits and 5xx are temporary");
  assert.match(mut[0], /s===403\|\|Number\(data&&data\.code\)===50013/, "Discord 403/50013 is a bot-permission answer");
  assert.match(mut[0], /Manage Roles/);
  const callSites = workerSrc.match(/membersRolesDiscordError\(r\.status,data,/g) || [];
  assert.equal(callSites.length, 4, "create, edit, delete and assign all map Discord failures");
  // The old raw passthrough is gone from this feature:
  const handlers = ["Role creation failed", "Role deletion failed"];
  for (const label of handlers) {
    assert.doesNotMatch(workerSrc, new RegExp(`error:data\\.message\\|\\|"${label}"`));
  }
});

// ---------------------------------------------------------------------------
// Role hierarchy: Discord enforces hierarchy against the bot's highest role
// regardless of Administrator, and so do we. Roles at or above the bot's top
// role can never be created, edited, deleted or assigned.
// ---------------------------------------------------------------------------

const GUILD = "884027552174317569";
const roleTiny = { id: "555555555555555555", position: 1, managed: false };
const roleLow = { id: "111111111111111111", position: 5, managed: false };
const roleEqual = { id: "222222222222222222", position: 10, managed: false };
const roleHigh = { id: "333333333333333333", position: 11, managed: false };
const roleActor = { id: "444444444444444444", position: 3, managed: false };
const roleManaged = { id: "666666666666666666", position: 4, managed: true };
const guildRoles = [{ id: GUILD, position: 0 }, roleTiny, roleLow, roleEqual, roleHigh, roleActor, roleManaged];
const botAdmin = { highestPosition: 10, canManageRoles: true, administrator: true };
const botPlain = { highestPosition: 10, canManageRoles: true, administrator: false };
const botNoManage = { highestPosition: 10, canManageRoles: false, administrator: false };

test("roles at or above the bot's highest role are never managed, even with Administrator", () => {
  // Direct block helper (shared with Reaction Roles):
  assert.equal(
    roleAssignBlock({ role: roleEqual, botHighestPosition: 10, canManageRoles: true, administrator: true, guildId: GUILD }),
    "Bot role must be above the selected role"
  );
  assert.equal(
    roleAssignBlock({ role: roleHigh, botHighestPosition: 10, canManageRoles: true, administrator: true, guildId: GUILD }),
    "Bot role must be above the selected role"
  );
  assert.equal(
    roleAssignBlock({ role: roleLow, botHighestPosition: 10, canManageRoles: true, administrator: true, guildId: GUILD }),
    "",
    "a role below the bot's top role is manageable"
  );
  assert.equal(
    roleAssignBlock({ role: roleLow, botHighestPosition: 10, canManageRoles: false, administrator: false, guildId: GUILD }),
    "Missing Manage Roles permission"
  );

  for (const botAccess of [botAdmin, botPlain]) {
    const equal = decideRoleMutation({
      action: "edit", guildId: GUILD, actorIsGuildOwner: true, actorRoleIds: [],
      roleId: roleEqual.id, role: roleEqual, guildRoles, botAccess, payload: { name: "Renamed" }
    });
    assert.equal(equal.ok, false, `role equal to bot top must be denied (admin=${botAccess.administrator})`);
    assert.equal(equal.code, "bot_hierarchy");

    const above = decideRoleMutation({
      action: "edit", guildId: GUILD, actorIsGuildOwner: true, actorRoleIds: [],
      roleId: roleHigh.id, role: roleHigh, guildRoles, botAccess, payload: { name: "Renamed" }
    });
    assert.equal(above.ok, false);
    assert.equal(above.code, "bot_hierarchy");

    const removed = decideRoleMutation({
      action: "delete", guildId: GUILD, actorIsGuildOwner: true, actorRoleIds: [],
      roleId: roleEqual.id, role: roleEqual, guildRoles, botAccess
    });
    assert.equal(removed.ok, false);
    assert.equal(removed.code, "bot_hierarchy");

    const placed = decideRoleMutation({
      action: "create", guildId: GUILD, actorIsGuildOwner: true, actorRoleIds: [],
      guildRoles, botAccess, payload: { position: 10 }
    });
    assert.equal(placed.ok, false, "placing a new role at the bot's top must be denied");
    assert.equal(placed.code, "bot_hierarchy");
  }

  const allowed = decideRoleMutation({
    action: "edit", guildId: GUILD, actorIsGuildOwner: true, actorRoleIds: [],
    roleId: roleLow.id, role: roleLow, guildRoles, botAccess: botAdmin, payload: { name: "Renamed" }
  });
  assert.equal(allowed.ok, true, "a role below the bot's top role is editable");

  const created = decideRoleMutation({
    action: "create", guildId: GUILD, actorIsGuildOwner: true, actorRoleIds: [],
    guildRoles, botAccess: botAdmin, payload: { name: "BalticM Test" }
  });
  assert.equal(created.ok, true, "creating without an explicit position stays allowed");

  const noManage = decideRoleMutation({
    action: "create", guildId: GUILD, actorIsGuildOwner: true, actorRoleIds: [],
    guildRoles, botAccess: botNoManage, payload: { name: "BalticM Test" }
  });
  assert.equal(noManage.ok, false, "bot without Manage Roles cannot create roles");
  assert.equal(noManage.error, "Missing Manage Roles permission");
});

test("actor and target hierarchy limits still apply to member role changes", () => {
  assert.equal(highestRolePosition(guildRoles, [roleActor.id], GUILD), 3);

  const ownerAssign = decideMemberRoleChange({
    guildId: GUILD, actorId: "999999999999999999", actorIsGuildOwner: true, actorRoleIds: [],
    actorAccessLevel: ACCESS_CONFIGURE, targetMemberId: "888888888888888888",
    targetIsGuildOwner: false, targetRoleIds: [], roleId: roleLow.id, role: roleLow,
    guildRoles, accessConfigRoles: [], botAccess: botAdmin, remove: false
  });
  assert.equal(ownerAssign.ok, true);

  const hierarchy = decideMemberRoleChange({
    guildId: GUILD, actorId: "999999999999999999", actorIsGuildOwner: false, actorRoleIds: [roleActor.id],
    actorAccessLevel: ACCESS_CONFIGURE, targetMemberId: "888888888888888888",
    targetIsGuildOwner: false, targetRoleIds: [], roleId: roleLow.id, role: roleLow,
    guildRoles, accessConfigRoles: [], botAccess: botAdmin, remove: false
  });
  assert.equal(hierarchy.ok, false, "cannot touch a role above your own top role");
  assert.equal(hierarchy.code, "hierarchy");

  const memberHierarchy = decideMemberRoleChange({
    guildId: GUILD, actorId: "999999999999999999", actorIsGuildOwner: false, actorRoleIds: [roleActor.id],
    actorAccessLevel: ACCESS_CONFIGURE, targetMemberId: "888888888888888888",
    targetIsGuildOwner: false, targetRoleIds: [roleEqual.id], roleId: roleTiny.id, role: roleTiny,
    guildRoles, accessConfigRoles: [], botAccess: botAdmin, remove: false
  });
  assert.equal(memberHierarchy.ok, false, "cannot touch members ranked at or above you");
  assert.equal(memberHierarchy.code, "member_hierarchy");

  const botBlock = decideMemberRoleChange({
    guildId: GUILD, actorId: "999999999999999999", actorIsGuildOwner: true, actorRoleIds: [],
    actorAccessLevel: ACCESS_CONFIGURE, targetMemberId: "888888888888888888",
    targetIsGuildOwner: false, targetRoleIds: [], roleId: roleEqual.id, role: roleEqual,
    guildRoles, accessConfigRoles: [], botAccess: botAdmin, remove: false
  });
  assert.equal(botBlock.ok, false, "assigning a role at the bot's top is blocked");
  assert.equal(botBlock.code, "bot_hierarchy");

  const owner = decideMemberRoleChange({
    guildId: GUILD, actorId: "999999999999999999", actorIsGuildOwner: true, actorRoleIds: [],
    actorAccessLevel: ACCESS_CONFIGURE, targetMemberId: "884027552174317569",
    targetIsGuildOwner: true, targetRoleIds: [], roleId: roleLow.id, role: roleLow,
    guildRoles, accessConfigRoles: [], botAccess: botAdmin, remove: false
  });
  assert.equal(owner.ok, false);
  assert.equal(owner.code, "owner");

  const managed = decideMemberRoleChange({
    guildId: GUILD, actorId: "999999999999999999", actorIsGuildOwner: true, actorRoleIds: [],
    actorAccessLevel: ACCESS_CONFIGURE, targetMemberId: "888888888888888888",
    targetIsGuildOwner: false, targetRoleIds: [], roleId: roleManaged.id, role: roleManaged,
    guildRoles, accessConfigRoles: [], botAccess: botAdmin, remove: false
  });
  assert.equal(managed.ok, false);
  assert.equal(managed.code, "managed");

  // Operate-level actors cannot grant Control Center access roles:
  const rbacRole = { ...roleLow };
  const accessConfigRoles = [{ roleId: rbacRole.id, enabled: true, permissions: { members_roles: "configure" } }];
  const escalation = decideMemberRoleChange({
    guildId: GUILD, actorId: "999999999999999999", actorIsGuildOwner: false, actorRoleIds: [roleEqual.id],
    actorAccessLevel: ACCESS_OPERATE, targetMemberId: "888888888888888888",
    targetIsGuildOwner: false, targetRoleIds: [], roleId: rbacRole.id, role: rbacRole,
    guildRoles, accessConfigRoles, botAccess: botAdmin, remove: false
  });
  assert.equal(escalation.ok, false, "RBAC escalation guard is unchanged");
  assert.equal(escalation.code, "rbac_escalation");

  const configureAssign = decideMemberRoleChange({
    guildId: GUILD, actorId: "999999999999999999", actorIsGuildOwner: false, actorRoleIds: [roleActor.id],
    actorAccessLevel: ACCESS_CONFIGURE, targetMemberId: "888888888888888888",
    targetIsGuildOwner: false, targetRoleIds: [], roleId: roleTiny.id, role: roleTiny,
    guildRoles, accessConfigRoles, botAccess: botAdmin, remove: false
  });
  assert.equal(configureAssign.ok, true, "Configure level may assign safe lower roles");
});

test("bot capability detection exposes Manage Roles and the bot's top position", () => {
  const manageRolesBit = String(1n << 28n);
  const adminBit = String(1n << 3n);
  const plain = botRoleAccess(
    [{ id: "777777777777777777", permissions: manageRolesBit, position: 7 }, { id: GUILD, permissions: "0", position: 0 }],
    ["777777777777777777"],
    GUILD
  );
  assert.equal(plain.canManageRoles, true);
  assert.equal(plain.administrator, false);
  assert.equal(plain.highestPosition, 7);

  const admin = botRoleAccess(
    [{ id: "777777777777777777", permissions: adminBit, position: 7 }],
    ["777777777777777777"],
    GUILD
  );
  assert.equal(admin.administrator, true);
  assert.equal(admin.canManageRoles, true);
  assert.equal(admin.highestPosition, 7);
});

// ---------------------------------------------------------------------------
// Client: raw HTTP text never reaches the Members & Roles page
// ---------------------------------------------------------------------------

test("membersRolesErrorText maps every failure to useful text", () => {
  assert.equal(
    MEMBERS_ROLES_NO_PERMISSION_ERROR,
    "You do not have permission to manage members and roles in this server."
  );
  // Genuine RBAC denial never renders the raw word "Forbidden":
  assert.equal(membersRolesErrorText(403, { error: "Forbidden" }, "fallback"), MEMBERS_ROLES_NO_PERMISSION_ERROR);
  assert.equal(membersRolesErrorText(403, {}, "fallback"), MEMBERS_ROLES_NO_PERMISSION_ERROR);
  // Temporary lookup failures read as temporary, not as permissions:
  const temporary = "Discord is temporarily unavailable. Please try again in a moment.";
  assert.equal(membersRolesErrorText(503, { error: temporary, retryable: true }, "fallback"), temporary);
  assert.equal(membersRolesErrorText(503, { accessUnknown: true }, "fallback"), MEMBERS_ROLES_TEMPORARY_ERROR);
  assert.equal(membersRolesErrorText(503, {}, "fallback"), MEMBERS_ROLES_TEMPORARY_ERROR);
  // Meaningful worker messages pass through verbatim:
  assert.equal(
    membersRolesErrorText(502, { error: "Could not load Discord server" }, "fallback"),
    "Could not load Discord server"
  );
  assert.equal(membersRolesErrorText(403, { error: "Cannot manage equal or higher roles" }, "fallback"), "Cannot manage equal or higher roles");
  assert.equal(
    membersRolesErrorText(403, { error: "Discord refused the change — the bot needs Manage Roles and the role must be below its top role." }, "fallback"),
    "Discord refused the change — the bot needs Manage Roles and the role must be below its top role."
  );
  assert.equal(membersRolesErrorText(401, { error: "Unauthorized" }, "fallback"), "Your session has expired. Please sign in again.");
  assert.equal(membersRolesErrorText(0, {}, "Could not load members"), "Could not load members");
  for (const [status, body] of [
    [403, { error: "Forbidden" }],
    [401, { error: "Unauthorized" }],
    [503, { accessUnknown: true }],
    [500, { error: "Internal Server Error" }]
  ]) {
    const text = membersRolesErrorText(status, body, "fallback");
    assert.ok(!/Forbidden|Unauthorized/.test(text), `raw HTTP text leaked: ${text}`);
  }
});

test("Members & Roles UI routes every failure through the mapper", () => {
  assert.ok(mainSrc.includes("membersRolesErrorText, normalizePath,"), "mapper is imported");
  const start = mainSrc.indexOf("function MembersRoles(");
  assert.ok(start >= 0, "MembersRoles component present");
  const end = mainSrc.indexOf("\nfunction ", start);
  const block = mainSrc.slice(start, end > 0 ? end : undefined);
  const calls = block.match(/membersRolesErrorText\(/g) || [];
  assert.ok(calls.length >= 6, `load, create, edit, delete, assign and guild-state failures are mapped (found ${calls.length})`);
  // Raw server error text is never thrown at the user from this page:
  assert.doesNotMatch(block, /x\.error\|\|/);
  assert.doesNotMatch(block, /throw new Error\(x\.error/);
  // The page-level guild load failure is surfaced with mapped text:
  assert.match(block, /guild&&guild\.error&&guild\.status\)setNotice\(membersRolesErrorText\(guild\.status/);
  // The guild fetch stores the server's message + retryable flag for that:
  assert.match(mainSrc, /return\{error:true,status:r\.status,message:String\(x\.error\|\|""\),retryable:!!x\.retryable\}/);
});
