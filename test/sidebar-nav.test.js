import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESS_CONFIGURE, ACCESS_NONE, ACCESS_OPERATE, levelMeets } from "../access-control.js";
import {
  PAGE_ACCESS_KEY,
  canUseAccess,
  isValidAccessPayload
} from "../src/control-center-state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");

// The three pages reported in the bug. They must never be special-cased as
// always-visible, and they must never disappear while data is loading/unknown.
const REPORTED = ["Announcements", "Direct Messages", "Settings"];
const keyFor = page => (page === "Settings" ? "settings" : PAGE_ACCESS_KEY[page]);

test("unknown access levels are loading/transient state, never a denial", () => {
  // Not loaded yet (initial state / guild restoration):
  assert.equal(canUseAccess(null, "announcements"), true);
  assert.equal(canUseAccess(undefined, "direct_messages"), true);
  assert.equal(canUseAccess(null, "settings"), true);
  // Empty or partially-unknown payloads (failed/partial response):
  assert.equal(canUseAccess({}, "announcements"), true);
  assert.equal(canUseAccess({ announcements: null }, "announcements"), true);
  assert.equal(canUseAccess({ direct_messages: undefined }, "direct_messages"), true);
  assert.equal(canUseAccess({ settings: null }, "settings"), true);
});

test("explicit access levels keep being enforced", () => {
  assert.equal(canUseAccess({ announcements: ACCESS_NONE }, "announcements"), false);
  assert.equal(canUseAccess({ direct_messages: ACCESS_NONE }, "direct_messages"), false);
  assert.equal(canUseAccess({ settings: ACCESS_NONE }, "settings"), false);
  assert.equal(canUseAccess({ announcements: ACCESS_OPERATE }, "announcements"), true);
  assert.equal(canUseAccess({ announcements: ACCESS_OPERATE }, "announcements", ACCESS_CONFIGURE), false);
  assert.equal(canUseAccess({ announcements: ACCESS_CONFIGURE }, "announcements", ACCESS_CONFIGURE), true);
});

test("reported items stay visible through every refresh/loading race stage", () => {
  // Simulates: initial null state → wiped/empty response → transient unknown keys → authoritative data.
  const stages = [
    null,
    {},
    { announcements: null, direct_messages: null, settings: null },
    { announcements: ACCESS_OPERATE, direct_messages: ACCESS_OPERATE, settings: ACCESS_OPERATE }
  ];
  for (const perms of stages) {
    for (const page of REPORTED) {
      assert.equal(
        canUseAccess(perms, keyFor(page)),
        true,
        `${page} would disappear with permissions ${JSON.stringify(perms)}`
      );
    }
  }
  // Once authoritative data arrives, rules are enforced per key:
  const denied = { announcements: ACCESS_NONE, direct_messages: ACCESS_OPERATE, settings: ACCESS_OPERATE };
  assert.equal(canUseAccess(denied, "announcements"), false);
  assert.equal(canUseAccess(denied, "direct_messages"), true);
  assert.equal(canUseAccess(denied, "settings"), true);
});

test("unknown levels still fail closed for API enforcement", () => {
  // Server-side route guards use levelMeets directly: unknown must deny.
  assert.equal(levelMeets(null, ACCESS_OPERATE), false);
  assert.equal(levelMeets(undefined, ACCESS_OPERATE), false);
  assert.equal(levelMeets(null, ACCESS_CONFIGURE), false);
});

test("failed control-access responses are never applied as empty permissions", () => {
  assert.equal(isValidAccessPayload(null), false);
  assert.equal(isValidAccessPayload(undefined), false);
  assert.equal(isValidAccessPayload({}), false);
  assert.equal(isValidAccessPayload({ modules: {} }), false);
  assert.equal(isValidAccessPayload({ permissions: { dashboard: ACCESS_OPERATE }, modules: {} }), true);
  assert.equal(isValidAccessPayload({ permissions: {}, modules: {} }), true);

  // main.jsx only applies validated payloads, keeps last known state on failure:
  assert.match(
    mainSrc,
    /if\(isValidAccessPayload\(x\)\)\{setControlPermissions\(x\?\.permissions\|\|\{\}\);setFeatureModules\(x\?\.modules\|\|\{\}\)\}setAccessReady\(true\)/
  );
  assert.match(mainSrc, /\.catch\(\(\)=>\{if\(!live\)return;setAccessReady\(true\)\}\)/);
  assert.doesNotMatch(mainSrc, /setControlPermissions\(\{\}\)/);
  assert.doesNotMatch(mainSrc, /setFeatureModules\(\{\}\)/);
  // Starting a new access fetch does not wipe the last known valid state:
  assert.doesNotMatch(mainSrc, /setAccessReady\(false\);setControlPermissions/);
  assert.match(mainSrc, /let live=true;setAccessReady\(false\);/);
});

test("session hydration never hides nav items; rules stay data-driven", () => {
  // While /api/auth/me is still in flight, nav is shown and reconciled afterwards:
  assert.match(mainSrc, /const navAllowed=n=>\{if\(!authReady\)return true;/);
  assert.match(mainSrc, /setAuthReady\(true\)/);
  // Permission and feature-module rules remain enforced once data is ready:
  assert.match(mainSrc, /const k=PAGE_ACCESS_KEY\[n\];if\(k&&!canUseAccess\(controlPermissions,k\)\)return false;/);
  assert.match(mainSrc, /featureModules&&featureModules\[mk\]===false\)return false/);
  assert.match(mainSrc, /if\(n==="Settings"\)return !!user&&canUseAccess\(controlPermissions,"settings"\)/);
  // No hardcoded always-visible special cases for the reported items:
  assert.doesNotMatch(mainSrc, /navAllowed[^\n]*"Announcements"/);
  assert.doesNotMatch(mainSrc, /n==="Announcements"\)return true/);
  assert.doesNotMatch(mainSrc, /n==="Direct Messages"\)return true/);
});

test("worker reports transient Discord lookup failures as unknown, genuine misses as none", () => {
  const rbacFn = workerSrc.match(/async function controlAccessLevel\(env,user,guildId,key\)\{[\s\S]*?\n\}/);
  assert.ok(rbacFn, "controlAccessLevel present");
  // Transient failures (guild object fetch failed, member fetch rate-limit/5xx, exceptions) → null (unknown):
  assert.match(rbacFn[0], /if\(!wrap\)return null;/);
  assert.match(rbacFn[0], /if\(mr\.status===404\)return ACCESS_NONE;return null;/);
  assert.match(rbacFn[0], /catch\{return null\}/);
  // Genuine denials stay explicit:
  assert.match(rbacFn[0], /if\(wrap\.status===404\)return sessionGuild\?\.owner\?ACCESS_CONFIGURE:ACCESS_NONE;/);
  assert.doesNotMatch(rbacFn[0], /if\(!mr\.ok\)return ACCESS_NONE;/);
  assert.doesNotMatch(rbacFn[0], /guild-member:/);
  // Endpoint contract unchanged:
  assert.match(workerSrc, /permissions\[k\]=await controlAccessLevel/);
});
