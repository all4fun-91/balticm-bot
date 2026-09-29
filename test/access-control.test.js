import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCESS_CONFIGURE,
  ACCESS_KEYS,
  ACCESS_NONE,
  ACCESS_OPERATE,
  accessLevelFromRoles,
  decideGuildVisibility,
  levelMeets,
  memberHasAnyCapability,
  memberHasDiscordGuildManager,
  memberRoleIdsForAccess,
  migrateRolePermissions,
  moduleAccessMap,
  normalizeAccessConfig,
  oauthGuildHasManageAccess,
  requiredLevelForRequest,
  routeAccessKey
} from "../access-control.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");

test("legacy enabled permissions migrate to operate, not configure", () => {
  const levels = migrateRolePermissions(["tickets", "music_bot", "settings"]);
  assert.equal(levels.tickets, ACCESS_OPERATE);
  assert.equal(levels.music_bot, ACCESS_OPERATE);
  assert.equal(levels.settings, ACCESS_OPERATE);
  assert.equal(levels.announcements, ACCESS_NONE);
  assert.equal(levels.dashboard, ACCESS_NONE);
});

test("boolean true migrates to operate; configure is explicit", () => {
  const levels = migrateRolePermissions({
    tickets: true,
    music_bot: "configure",
    announcements: false
  });
  assert.equal(levels.tickets, ACCESS_OPERATE);
  assert.equal(levels.music_bot, ACCESS_CONFIGURE);
  assert.equal(levels.announcements, ACCESS_NONE);
});

test("role name Admin does not grant access by itself", () => {
  const config = normalizeAccessConfig({
    roles: [{ roleId: "111111111111111111", enabled: true, permissions: { tickets: ACCESS_OPERATE } }]
  });
  // Member has a role literally named Admin elsewhere, but only role IDs matter.
  assert.equal(accessLevelFromRoles(config.roles, ["999999999999999999"], "tickets"), ACCESS_NONE);
  assert.equal(accessLevelFromRoles(config.roles, ["111111111111111111"], "tickets"), ACCESS_OPERATE);
  assert.equal(accessLevelFromRoles(config.roles, ["111111111111111111"], "settings"), ACCESS_NONE);
});

test("highest capability across member roles wins", () => {
  const roles = normalizeAccessConfig({
    roles: [
      { roleId: "111111111111111111", permissions: { tickets: ACCESS_OPERATE } },
      { roleId: "222222222222222222", permissions: { tickets: ACCESS_CONFIGURE } }
    ]
  }).roles;
  assert.equal(accessLevelFromRoles(roles, ["111111111111111111"], "tickets"), ACCESS_OPERATE);
  assert.equal(
    accessLevelFromRoles(roles, ["111111111111111111", "222222222222222222"], "tickets"),
    ACCESS_CONFIGURE
  );
});

test("operate cannot meet configure; configure includes operate", () => {
  assert.equal(levelMeets(ACCESS_OPERATE, ACCESS_OPERATE), true);
  assert.equal(levelMeets(ACCESS_OPERATE, ACCESS_CONFIGURE), false);
  assert.equal(levelMeets(ACCESS_CONFIGURE, ACCESS_OPERATE), true);
  assert.equal(levelMeets(ACCESS_NONE, ACCESS_OPERATE), false);
});

test("approved audit API boundaries for configure vs operate", () => {
  assert.equal(requiredLevelForRequest("/api/tickets/types/support", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/tickets/types/support/publish", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/tickets/abc", "POST"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/tickets", "GET"), ACCESS_OPERATE);

  assert.equal(requiredLevelForRequest("/api/music/config", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/music/config", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/music/play", "POST"), ACCESS_OPERATE);

  assert.equal(requiredLevelForRequest("/api/voice-create", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/voice-create/rooms/1", "POST"), ACCESS_OPERATE);

  assert.equal(requiredLevelForRequest("/api/moderation/settings", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/moderation", "POST"), ACCESS_OPERATE);

  assert.equal(requiredLevelForRequest("/api/reaction-roles", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/reaction-roles", "POST"), ACCESS_CONFIGURE);

  assert.equal(requiredLevelForRequest("/api/announcements", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/announcements", "POST"), ACCESS_CONFIGURE);

  assert.equal(requiredLevelForRequest("/api/giveaways/1/end", "POST"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/giveaways/1/reroll", "POST"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/giveaways/1/publish", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/giveaways", "POST"), ACCESS_CONFIGURE);

  assert.equal(requiredLevelForRequest("/api/discord/roles", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/discord/members/1/roles/2", "PUT"), ACCESS_OPERATE);

  assert.equal(requiredLevelForRequest("/api/settings/access", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/settings/access", "POST"), ACCESS_CONFIGURE);

  assert.equal(requiredLevelForRequest("/api/streamers", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/streamers", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/streamers/abc", "PUT"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/streamers/abc", "DELETE"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/streamers/refresh", "POST"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/streamers/abc/check", "POST"), ACCESS_OPERATE);
});

test("route keys stay guild-module scoped", () => {
  assert.equal(routeAccessKey("/api/streamers"), "streamers");
  assert.equal(routeAccessKey("/api/streaming-accounts"), null);
  assert.equal(routeAccessKey("/api/profile/streaming/twitch/connect"), null);
  assert.equal(routeAccessKey("/api/streamers/self"), null);
  assert.equal(routeAccessKey("/api/tickets"), "tickets");
  assert.equal(routeAccessKey("/api/music/play"), "music_bot");
  assert.equal(routeAccessKey("/api/voice-create/rooms/x"), "voice_create");
  assert.equal(routeAccessKey("/api/settings/modules"), "settings");
  assert.equal(routeAccessKey("/api/admin/logs"), null);
  assert.equal(routeAccessKey("/api/support-chat"), null);
});

test("privilege escalation: operate role must not satisfy configure routes", () => {
  const roles = normalizeAccessConfig({
    roles: [{ roleId: "111111111111111111", permissions: Object.fromEntries(ACCESS_KEYS.map(k => [k, ACCESS_OPERATE])) }]
  }).roles;
  for (const key of ["tickets", "music_bot", "streamers", "voice_create", "moderation", "reaction_roles", "announcements", "giveaways", "members_roles", "settings"]) {
    const level = accessLevelFromRoles(roles, ["111111111111111111"], key);
    assert.equal(level, ACCESS_OPERATE);
    assert.equal(levelMeets(level, ACCESS_CONFIGURE), false, key);
  }
});

test("cross-guild isolation: access config is evaluated only for provided role ids", () => {
  const guildA = normalizeAccessConfig({
    roles: [{ roleId: "111111111111111111", permissions: { tickets: ACCESS_CONFIGURE } }]
  }).roles;
  const guildB = normalizeAccessConfig({
    roles: [{ roleId: "222222222222222222", permissions: { tickets: ACCESS_CONFIGURE } }]
  }).roles;
  // Member roles from guild A must not unlock guild B config.
  assert.equal(accessLevelFromRoles(guildB, ["111111111111111111"], "tickets"), ACCESS_NONE);
  assert.equal(accessLevelFromRoles(guildA, ["222222222222222222"], "tickets"), ACCESS_NONE);
  assert.equal(accessLevelFromRoles(guildA, ["111111111111111111"], "tickets"), ACCESS_CONFIGURE);
  assert.equal(accessLevelFromRoles(guildB, ["222222222222222222"], "tickets"), ACCESS_CONFIGURE);
});

test("worker enforces leveled control access and returns string levels", () => {
  assert.match(workerSrc, /from "\.\/access-control\.js"/);
  assert.match(workerSrc, /controlAccessLevel/);
  assert.match(workerSrc, /requiredLevelForRequest\(p,req\.method\)/);
  assert.match(workerSrc, /permissions\[k\]=await controlAccessLevel/);
  assert.match(workerSrc, /normalizeAccessConfig/);
  assert.match(workerSrc, /requiredLevel:minLevel/);
  assert.doesNotMatch(workerSrc, /role\.name\s*===\s*["']Admin["']/i);
  assert.doesNotMatch(workerSrc, /includes\(["']admin["']\)/i);
});

test("guild discovery includes RBAC OPERATE/CONFIGURE without Manage Guild", () => {
  assert.match(workerSrc, /refreshAccessibleGuilds/);
  assert.match(workerSrc, /listBotGuilds\(env\)/);
  assert.match(workerSrc, /decideGuildVisibility/);
  assert.match(workerSrc, /resolveGuildAccessEntry/);
  assert.match(workerSrc, /memberRoleIdsForAccess/);
  assert.match(workerSrc, /oauthGuildHasManageAccess/);
  assert.doesNotMatch(
    workerSrc,
    /gs\.filter\(g=>g\.owner\|\|\(BigInt\(g\.permissions\|\|"0"\)&32n\)===32n\)/
  );
  assert.match(workerSrc, /\/api\/auth\/me/);
  assert.match(workerSrc, /refreshAccessibleGuilds\(env,user\)/);
});

test("delegated moderation OPERATE grants visibility; all NO ACCESS does not", () => {
  const operateRole = normalizeAccessConfig({
    roles: [{ roleId: "111111111111111111", permissions: { moderation: ACCESS_OPERATE } }]
  }).roles;
  const noneRole = normalizeAccessConfig({
    roles: [{ roleId: "111111111111111111", permissions: Object.fromEntries(ACCESS_KEYS.map(k => [k, ACCESS_NONE])) }]
  }).roles;
  assert.equal(memberHasAnyCapability(operateRole, ["111111111111111111"]), true);
  assert.equal(accessLevelFromRoles(operateRole, ["111111111111111111"], "moderation"), ACCESS_OPERATE);
  assert.equal(levelMeets(ACCESS_OPERATE, ACCESS_CONFIGURE), false);
  assert.equal(requiredLevelForRequest("/api/moderation/settings", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/moderation", "POST"), ACCESS_OPERATE);
  assert.equal(memberHasAnyCapability(noneRole, ["111111111111111111"]), false);
});

test("role from another guild cannot grant visibility or module access", () => {
  const guildA = normalizeAccessConfig({
    roles: [{ roleId: "111111111111111111", permissions: { moderation: ACCESS_CONFIGURE } }]
  }).roles;
  const guildB = normalizeAccessConfig({
    roles: [{ roleId: "222222222222222222", permissions: { moderation: ACCESS_CONFIGURE } }]
  }).roles;
  assert.equal(memberHasAnyCapability(guildB, ["111111111111111111"]), false);
  assert.equal(memberHasAnyCapability(guildA, ["222222222222222222"]), false);
  assert.equal(accessLevelFromRoles(guildB, ["111111111111111111"], "moderation"), ACCESS_NONE);
});

test("oauth manage/owner detection and discord role permission bits", () => {
  assert.equal(oauthGuildHasManageAccess({ owner: true, permissions: "0" }), true);
  assert.equal(oauthGuildHasManageAccess({ owner: false, permissions: "32" }), true);
  assert.equal(oauthGuildHasManageAccess({ owner: false, permissions: "0" }), false);
  const guildId = "999999999999999999";
  const roles = [
    { id: guildId, permissions: "0" },
    { id: "111111111111111111", permissions: String(1n << 5n) }
  ];
  assert.equal(memberHasDiscordGuildManager(guildId, roles, ["111111111111111111"]), true);
  assert.equal(memberHasDiscordGuildManager(guildId, roles, ["333333333333333333"]), false);
});

test("UI uses capability levels and gates configure surfaces", () => {
  assert.match(mainSrc, /ACCESS_LEVEL_OPTIONS/);
  assert.match(mainSrc, /canConfigureModule/);
  assert.match(mainSrc, /setAccessLevel/);
  assert.match(mainSrc, /accessLevelSeg/);
  assert.match(mainSrc, /canConfigure=\{canConfigureModule\("tickets"\)\}/);
  assert.match(mainSrc, /canConfigure=\{canConfigureModule\("streamers"\)\}/);
  assert.match(mainSrc, /canConfigure=\{canConfigureModule\("music_bot"\)\}/);
  assert.match(mainSrc, /canConfigure=\{canConfigureModule\("voice_create"\)\}/);
  assert.match(mainSrc, /canConfigure=\{canConfigureModule\("moderation"\)\}/);
  assert.match(mainSrc, /canConfigure=\{canConfigureModule\("reaction_roles"\)\}/);
  assert.match(mainSrc, /canConfigure=\{canConfigureModule\("announcements"\)\}/);
  assert.match(mainSrc, /canConfigure=\{canConfigureModule\("giveaways"\)\}/);
  assert.match(mainSrc, /canConfigure=\{canConfigureModule\("members_roles"\)\}/);
  assert.match(mainSrc, /No Access, Operate or Configure/);
  assert.doesNotMatch(mainSrc, /toggleAccessPermission/);
});

const GUILD = "884027552174317569";
const STAFF_ROLE = "111111111111111111";
const OTHER_ROLE = "222222222222222222";
const USER = "333333333333333333";
const OWNER = "444444444444444444";

test("ordinary member + granted role → guild visible", () => {
  const accessConfig = {
    roles: [{ roleId: STAFF_ROLE, permissions: { music_bot: ACCESS_OPERATE } }]
  };
  const entry = decideGuildVisibility({
    botInstalled: true,
    memberFound: true,
    guildId: GUILD,
    guildName: "Baltic | Mayhem",
    guildIcon: "ico",
    guildOwnerId: OWNER,
    userId: USER,
    discordRoles: [{ id: GUILD, permissions: "0" }, { id: STAFF_ROLE, permissions: "0" }],
    memberRoleIds: [STAFF_ROLE],
    accessConfig
  });
  assert.equal(entry?.access, "rbac");
  assert.equal(entry?.id, GUILD);
  assert.equal(entry?.owner, false);
});

test("ordinary member + OPERATE Music Bot only → unrelated modules denied", () => {
  const accessConfig = {
    roles: [{ roleId: STAFF_ROLE, permissions: { music_bot: ACCESS_OPERATE } }]
  };
  const levels = moduleAccessMap(accessConfig, [STAFF_ROLE], GUILD);
  assert.equal(levels.music_bot, ACCESS_OPERATE);
  assert.equal(levels.moderation, ACCESS_NONE);
  assert.equal(levels.settings, ACCESS_NONE);
  assert.equal(levels.servers, ACCESS_NONE);
  assert.equal(levels.tickets, ACCESS_NONE);
  assert.equal(levelMeets(levels.music_bot, ACCESS_OPERATE), true);
  assert.equal(levelMeets(levels.music_bot, ACCESS_CONFIGURE), false);
  assert.equal(requiredLevelForRequest("/api/music/play", "POST"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/music/config", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/settings/access", "GET"), ACCESS_OPERATE);
  assert.equal(levelMeets(levels.settings, ACCESS_OPERATE), false);
});

test("ordinary member + multiple roles → highest capability per module", () => {
  const accessConfig = {
    roles: [
      { roleId: STAFF_ROLE, permissions: { music_bot: ACCESS_OPERATE, tickets: ACCESS_OPERATE } },
      { roleId: OTHER_ROLE, permissions: { music_bot: ACCESS_CONFIGURE } }
    ]
  };
  const levels = moduleAccessMap(accessConfig, [STAFF_ROLE, OTHER_ROLE], GUILD);
  assert.equal(levels.music_bot, ACCESS_CONFIGURE);
  assert.equal(levels.tickets, ACCESS_OPERATE);
  assert.equal(levels.moderation, ACCESS_NONE);
});

test("ordinary member without granted roles → guild not accessible", () => {
  const accessConfig = {
    roles: [{ roleId: STAFF_ROLE, permissions: { music_bot: ACCESS_OPERATE } }]
  };
  assert.equal(decideGuildVisibility({
    botInstalled: true,
    memberFound: true,
    guildId: GUILD,
    guildName: "Baltic | Mayhem",
    guildIcon: null,
    guildOwnerId: OWNER,
    userId: USER,
    discordRoles: [{ id: GUILD, permissions: "0" }],
    memberRoleIds: [OTHER_ROLE],
    accessConfig
  }), null);
});

test("removed role → access removed", () => {
  const accessConfig = {
    roles: [{ roleId: STAFF_ROLE, permissions: { music_bot: ACCESS_OPERATE } }]
  };
  const withRole = decideGuildVisibility({
    botInstalled: true, memberFound: true, guildId: GUILD, guildName: "G", guildIcon: null,
    guildOwnerId: OWNER, userId: USER, discordRoles: [], memberRoleIds: [STAFF_ROLE], accessConfig
  });
  const withoutRole = decideGuildVisibility({
    botInstalled: true, memberFound: true, guildId: GUILD, guildName: "G", guildIcon: null,
    guildOwnerId: OWNER, userId: USER, discordRoles: [], memberRoleIds: [], accessConfig
  });
  assert.equal(withRole?.access, "rbac");
  assert.equal(withoutRole, null);
});

test("user not in guild → access denied", () => {
  assert.equal(decideGuildVisibility({
    botInstalled: true,
    memberFound: false,
    guildId: GUILD,
    guildName: "G",
    guildIcon: null,
    guildOwnerId: OWNER,
    userId: USER,
    discordRoles: [],
    memberRoleIds: [STAFF_ROLE],
    accessConfig: { roles: [{ roleId: STAFF_ROLE, permissions: { music_bot: ACCESS_OPERATE } }] }
  }), null);
});

test("cross-guild role/RBAC IDs → denied", () => {
  const guildAConfig = { roles: [{ roleId: STAFF_ROLE, permissions: { music_bot: ACCESS_CONFIGURE } }] };
  const guildB = "999999999999999999";
  assert.equal(decideGuildVisibility({
    botInstalled: true, memberFound: true, guildId: guildB, guildName: "Other", guildIcon: null,
    guildOwnerId: OWNER, userId: USER, discordRoles: [], memberRoleIds: [STAFF_ROLE], accessConfig: { roles: [] }
  }), null);
  assert.equal(accessLevelFromRoles(normalizeAccessConfig({ roles: [{ roleId: OTHER_ROLE, permissions: { music_bot: ACCESS_CONFIGURE } }] }).roles, [STAFF_ROLE], "music_bot"), ACCESS_NONE);
  assert.equal(moduleAccessMap(guildAConfig, [STAFF_ROLE], GUILD).music_bot, ACCESS_CONFIGURE);
});

test("Server Owner remains unrestricted", () => {
  const entry = decideGuildVisibility({
    botInstalled: true,
    memberFound: true,
    guildId: GUILD,
    guildName: "Baltic | Mayhem",
    guildIcon: null,
    guildOwnerId: OWNER,
    userId: OWNER,
    discordRoles: [{ id: GUILD, permissions: "0" }],
    memberRoleIds: [],
    accessConfig: { roles: [] }
  });
  assert.equal(entry?.access, "owner");
  assert.equal(entry?.owner, true);
});

test("bot not installed → RBAC staff cannot see the guild", () => {
  assert.equal(decideGuildVisibility({
    botInstalled: false,
    memberFound: true,
    guildId: GUILD,
    guildName: "G",
    guildIcon: null,
    guildOwnerId: OWNER,
    userId: USER,
    discordRoles: [],
    memberRoleIds: [STAFF_ROLE],
    accessConfig: { roles: [{ roleId: STAFF_ROLE, permissions: { music_bot: ACCESS_OPERATE } }] }
  }), null);
});

test("@everyone guild id is included for RBAC matching", () => {
  const accessConfig = { roles: [{ roleId: GUILD, permissions: { tickets: ACCESS_OPERATE } }] };
  assert.equal(moduleAccessMap(accessConfig, [], GUILD).tickets, ACCESS_OPERATE);
  assert.ok(memberRoleIdsForAccess(GUILD, []).includes(GUILD));
});

