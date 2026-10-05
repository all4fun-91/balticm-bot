import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const uiSrc = readFileSync(join(root, "src/Streamers.jsx"), "utf8");

const stateFn = workerSrc.match(/async function streamersState\(env,guildId,user,ctx\)\{[\s\S]*?\n\}/);
const syncFn = workerSrc.match(/async function syncAutoStreamersForGuild\(env,guildId,premium\)\{[\s\S]*?\n\}/);
const ensureFn = workerSrc.match(/async function ensureStreamersTable\(env\)\{[\s\S]*?\n\}/);

test("initial state request fetches everything concurrently instead of sequentially", () => {
  assert.ok(stateFn, "streamersState present");
  const body = stateFn[0];
  assert.match(body, /const \[gate,channels,members,r,settings,profileAccounts\]=await Promise\.all\(/);
  // One Discord members fetch only (sync's own fetch is outside this function):
  assert.equal((body.match(/listGuildMembersBrief/g) || []).length, 1);
  // Studio gate (premium + owner + access level) computed once, concurrently:
  assert.equal((body.match(/streamerStudioGate/g) || []).length, 1);
  assert.equal((body.match(/isDiscordGuildOwner/g) || []).length, 0);
  // Profile accounts chain off the members fetch rather than adding serial time:
  assert.match(body, /membersP\.then\(members=>loadProfileAccountsForMembers/);
});

test("Premium sync never blocks the stored row list (background waitUntil)", () => {
  const body = stateFn[0];
  assert.doesNotMatch(body, /await syncAutoStreamersForGuild/, "sync is not awaited in the response path");
  assert.match(body, /const syncP=syncAutoStreamersForGuild\(env,guildId,true\)\.catch\(\(\)=>\{\}\)/);
  assert.match(body, /ctx\.waitUntil\(syncP\)/);
  // Response still renders stored rows with correct premium filtering:
  assert.match(body, /if\(!premium&&source===STREAMER_SOURCE_AUTO\)continue;/);
  // Sync itself keeps the guild-scoped suppression gate:
  assert.ok(syncFn, "syncAutoStreamersForGuild present");
  assert.match(syncFn[0], /isStreamerSuppressed\(suppressed,account\.discord_user_id,account\.provider\)\)continue/);
  assert.match(syncFn[0], /removeAutoGuildStreamer/);
});

test("ensureStreamersTable DDL runs once per isolate, not on every request", () => {
  assert.ok(ensureFn, "ensureStreamersTable present");
  assert.match(workerSrc, /let streamersTablesEnsured=false;\r?\nasync function ensureStreamersTable\(env\)\{/);
  assert.match(ensureFn[0], /if\(streamersTablesEnsured\)return;/);
  assert.match(ensureFn[0], /streamersTablesEnsured=true;/);
});

test("all streamers call sites pass ctx for background sync scheduling", () => {
  assert.match(workerSrc, /req\.method==="GET"\)return streamersState\(env,guildId,user,ctx\)/);
  assert.match(workerSrc, /return streamersState\(env,guildId,undefined,ctx\)/);
  assert.match(workerSrc, /return refreshStreamer\(env,guildId,"",ctx\)/);
  assert.match(workerSrc, /return refreshStreamer\(env,guildId,id,ctx\)/);
  assert.match(workerSrc, /async function refreshStreamer\(env,guildId,id,ctx\)\{/);
  assert.match(workerSrc, /async function streamersState\(env,guildId,user,ctx\)\{/);
});

test("no performance instrumentation is left in the worker", () => {
  assert.doesNotMatch(workerSrc, /streamers-perf/);
  assert.doesNotMatch(workerSrc, /sync-perf/);
});

test("Discord member/channel/owner lookups are cached with background revalidation", () => {
  assert.match(workerSrc, /async function cachedDiscordList\(key,loader\)\{/);
  assert.match(workerSrc, /const DISCORD_LIST_TTL_MS=60000;/);
  // Cached callers, guild-scoped keys:
  const membersFn = workerSrc.match(/async function listGuildMembersBrief\(env,guildId\)\{[\s\S]*?\n\}/);
  const channelsFn = workerSrc.match(/async function listGuildTextChannels\(env,guildId\)\{[\s\S]*?\n\}/);
  const ownerFn = workerSrc.match(/async function isDiscordGuildOwner\(env,user,guildId\)\{[\s\S]*?\n\}/);
  assert.ok(membersFn && channelsFn && ownerFn);
  assert.match(membersFn[0], /cachedDiscordList\("members:"\+guildId/);
  assert.match(channelsFn[0], /cachedDiscordList\("channels:"\+guildId/);
  // Guild object (owner + RBAC) and roles share guild-scoped caches; per-user member lookups stay uncached:
  assert.match(ownerFn[0], /loadCachedGuildWrap\(env,guildId\)/);
  assert.match(workerSrc, /cachedDiscordList\("guild-obj:"\+guildId/);
  assert.match(workerSrc, /cachedDiscordList\("guild-roles:"\+guildId/);
  const rbacFn = workerSrc.match(/async function controlAccessLevel\(env,user,guildId,key\)\{[\s\S]*?\n\}/);
  assert.ok(rbacFn);
  assert.doesNotMatch(rbacFn[0], /guild-member:/, "permission member lookups are never cached");
  assert.match(workerSrc, /let botConfigTableEnsured=false;/);
  assert.match(workerSrc, /if\(botConfigTableEnsured\)return;/);
  // Stale values are served while a single background refresh runs:
  assert.match(workerSrc, /if\(Date\.now\(\)-hit\.ts<DISCORD_LIST_TTL_MS\)return hit\.v;/);
  assert.match(workerSrc, /loader\(\)\.then\(v=>\{if\(v&&\(!Array\.isArray\(v\)\|\|v\.length\)\)discordListCache\.set/);
  // Empty/failed responses are never cached (protects AUTO rows from a wiped member list):
  assert.match(workerSrc, /const v=await loader\(\);\r?\n if\(v&&\(!Array\.isArray\(v\)\|\|v\.length\)\)discordListCache\.set\(key,\{ts:Date\.now\(\),v\}\);/);
});

test("auth/me guild refresh is briefly cached so page boot does not re-run N Discord lookups", () => {
  const refreshFn = workerSrc.match(/async function refreshAccessibleGuilds\(env,user\)\{[\s\S]*?\n\}/);
  assert.ok(refreshFn, "refreshAccessibleGuilds present");
  assert.match(refreshFn[0], /cachedDiscordList\("guilds-access:"\+String\(user\?\.id\|\|""\)/);
  // Definition + exactly one consumer (the auth/me hook):
  assert.equal((workerSrc.match(/refreshAccessibleGuilds\(env,user\)/g) || []).length, 2);
  assert.match(workerSrc, /if\(p==="\/api\/auth\/me"\)return handleAuthMe\(req,env,\{refreshGuilds:user=>refreshAccessibleGuilds\(env,user\)\}\);/);
  // Stale list is served while one background refresh runs (inside cachedDiscordList):
  assert.match(workerSrc, /hit\.ts=Date\.now\(\);/);
});

test("sync is a no-op when the Discord member list cannot be loaded", () => {
  assert.ok(syncFn);
  assert.match(syncFn[0], /const members=await listGuildMembersBrief\(env,guildId\);\r?\n if\(!members\.length\)return;/);
});

test("UI shows rows as soon as BalticM data arrives; loading state is initial-only", () => {
  // Loading screen only when there are no rows yet (initial fetch for this guild):
  assert.match(uiSrc, /loading&&!data\.streamers\.length\?</);
  // Switching servers clears the previous guild's rows (no cross-guild bleed):
  assert.match(uiSrc, /useEffect\(\(\)=>\{setNotice\(""\);setFormOpen\(false\);setEditingId\(""\);setPanel\(null\);setData\(prev=>\(\{\.\.\.prev,streamers:\[\],stats:\{managed:0,live:0,offline:0,announcements:0\}\}\)\);load\(\)\},\[selectedGuild\]\)/);
  // Per-row refresh indicator instead of a whole-list loading screen:
  assert.match(uiSrc, /busy==="chk-"\+s\.id\?"Checking\\u2026":"Check"/);
  // Background refill only once per guild, only when a premium guild has no rows:
  assert.match(uiSrc, /guildAutoRefilled\.current=false\},\[selectedGuild\]\)/);
  assert.match(uiSrc, /if\(guildAutoRefilled\.current\|\|loading\|\|!selectedGuild\|\|!data\.premium\|\|data\.streamers\.length>0\)return/);
  // No automatic platform status checks on page load (rate-limit safety):
  assert.doesNotMatch(uiSrc, /useEffect\([^)]*\)\s*=>\s*\{[^}]*\/api\/streamers\/refresh/);
});
