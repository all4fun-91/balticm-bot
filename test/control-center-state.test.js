import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESS_NONE, ACCESS_OPERATE } from "../access-control.js";
import {
  PAGE_PATHS,
  SELECTED_GUILD_STORAGE_KEY,
  fallbackPageIfUnauthorized,
  pageAfterRefresh,
  pageFromPath,
  pathFromPage,
  pickAuthorizedGuildId,
  readStoredGuildId,
  writeStoredGuildId
} from "../src/control-center-state.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");
const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";
const user = { id: "u1" };
const bothGuilds = [{ id: GUILD_A, name: "Alpha" }, { id: GUILD_B, name: "Baltic | Mayhem" }];
const operateAll = Object.fromEntries(["dashboard","servers","premium","direct_messages","tickets","members_roles","moderation","reaction_roles","giveaways","announcements","voice_create","music_bot","streamers","bot_status","logs","settings"].map(k => [k, ACCESS_OPERATE]));
const modulesOn = Object.fromEntries(["direct_messages","tickets","members_roles","moderation","reaction_roles","giveaways","announcements","voice_create","music_bot","streamers"].map(k => [k, true]));

function memoryStore(start = {}) {
  const data = { ...start };
  return {
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); }
  };
}

test("refresh preserves current route and never auto-redirects an accessible route to Dashboard", () => {
  for (const [page, path] of Object.entries(PAGE_PATHS)) {
    const result = pageAfterRefresh({
      pathname: path,
      user,
      storedGuildId: GUILD_B,
      authorizedGuilds: bothGuilds,
      permissions: operateAll,
      modules: modulesOn,
      accessReady: true
    });
    assert.equal(pageFromPath(path) || "Dashboard", page);
    assert.equal(result.page, page);
    assert.equal(pathFromPage(page), path);
  }
  assert.equal(pageAfterRefresh({
    pathname: "/streamers",
    user,
    storedGuildId: GUILD_B,
    authorizedGuilds: bothGuilds,
    permissions: operateAll,
    modules: modulesOn
  }).page, "Streamers");
});

test("/profile /settings /streamers /reaction-roles survive refresh", () => {
  const base = { user, storedGuildId: GUILD_A, authorizedGuilds: bothGuilds, permissions: operateAll, modules: modulesOn };
  assert.equal(pageAfterRefresh({ ...base, pathname: "/profile" }).page, "Profile");
  assert.equal(pageAfterRefresh({ ...base, pathname: "/settings" }).page, "Settings");
  assert.equal(pageAfterRefresh({ ...base, pathname: "/streamers" }).page, "Streamers");
  assert.equal(pageAfterRefresh({ ...base, pathname: "/reaction-roles" }).page, "Reaction Roles");
  assert.equal(pageAfterRefresh({ ...base, pathname: "/music" }).page, "Music Bot");
});

test("selected Guild A and Guild B survive refresh; list order does not matter", () => {
  assert.equal(pickAuthorizedGuildId({ storedId: GUILD_A, authorizedGuilds: bothGuilds }), GUILD_A);
  assert.equal(pickAuthorizedGuildId({ storedId: GUILD_B, authorizedGuilds: bothGuilds }), GUILD_B);
  assert.equal(pickAuthorizedGuildId({ storedId: GUILD_B, authorizedGuilds: [...bothGuilds].reverse() }), GUILD_B);
  assert.equal(pickAuthorizedGuildId({ storedId: GUILD_A, authorizedGuilds: [{ id: GUILD_B }, { id: GUILD_A }] }), GUILD_A);
});

test("intentional server switch persists immediately and consecutive refreshes keep that guild", () => {
  const store = memoryStore({ [SELECTED_GUILD_STORAGE_KEY]: GUILD_A });
  writeStoredGuildId(GUILD_B, store);
  assert.equal(readStoredGuildId(store), GUILD_B);
  for (let i = 0; i < 5; i++) {
    const restored = pickAuthorizedGuildId({ storedId: readStoredGuildId(store), authorizedGuilds: bothGuilds });
    assert.equal(restored, GUILD_B);
    writeStoredGuildId(restored, store);
  }
});

test("inaccessible or removed stored guild safely falls back; unauthorized id is rejected", () => {
  assert.equal(pickAuthorizedGuildId({ storedId: GUILD_B, authorizedGuilds: [{ id: GUILD_A }] }), GUILD_A);
  assert.equal(pickAuthorizedGuildId({ storedId: "999", authorizedGuilds: bothGuilds }), GUILD_A);
  assert.equal(pickAuthorizedGuildId({ storedId: GUILD_B, authorizedGuilds: [] }), "");
});

test("RBAC-inaccessible route safely falls back only after access is ready", () => {
  const noneStreamers = { ...operateAll, streamers: ACCESS_NONE };
  assert.equal(fallbackPageIfUnauthorized("Streamers", { user, permissions: noneStreamers, modules: modulesOn, accessReady: false }), "Streamers");
  assert.equal(fallbackPageIfUnauthorized("Streamers", { user, permissions: noneStreamers, modules: modulesOn, accessReady: true }), "Dashboard");
  const modulesOff = { ...modulesOn, reaction_roles: false };
  assert.equal(fallbackPageIfUnauthorized("Reaction Roles", { user, permissions: operateAll, modules: modulesOff, accessReady: true }), "Dashboard");
  assert.equal(fallbackPageIfUnauthorized("Settings", { user, permissions: operateAll, modules: modulesOn, accessReady: true }), "Settings");
});

test("app wires global path and guild restore instead of first-guild overwrite", () => {
  assert.match(mainSrc, /from "\.\/control-center-state\.js"/);
  assert.match(mainSrc, /pageFromPath\(/);
  assert.match(mainSrc, /pathFromPage\(/);
  assert.match(mainSrc, /pickAuthorizedGuildId\(/);
  assert.match(mainSrc, /writeStoredGuildId\(/);
  assert.match(mainSrc, /accessReady/);
  assert.match(mainSrc, /fallbackPageIfUnauthorized\(/);
  assert.doesNotMatch(mainSrc, /p==="\/premium"\?"Premium":p==="\/streamers"\?"Streamers":"Dashboard"/);
  assert.doesNotMatch(mainSrc, /if\(!selectedGuild\|\|!allowed\.some\(g=>g\.id===selectedGuild\)\)\{if\(allowed\[0\]\?\.id\)setSelectedGuild\(allowed\[0\]\.id\)/);
  assert.match(mainSrc, /setGuild\(null\)/);
  assert.match(mainSrc, /\[user,selectedGuild\]/);
  assert.doesNotMatch(mainSrc, /find\(g=>g\.id===selectedGuild\)\|\|user\.guilds/);
});

test("/privacy and /terms stay public without login, guild, or dashboard redirect", () => {
  const loggedOut = { user: null, storedGuildId: "", authorizedGuilds: [], permissions: {}, modules: {}, accessReady: true };
  assert.equal(pageFromPath("/privacy"), "Privacy");
  assert.equal(pageFromPath("/terms"), "Terms");
  assert.equal(pathFromPage("Privacy"), "/privacy");
  assert.equal(pathFromPage("Terms"), "/terms");
  assert.equal(pageAfterRefresh({ ...loggedOut, pathname: "/privacy" }).page, "Privacy");
  assert.equal(pageAfterRefresh({ ...loggedOut, pathname: "/terms" }).page, "Terms");
  assert.equal(fallbackPageIfUnauthorized("Privacy", { user: null, accessReady: true }), "Privacy");
  assert.equal(fallbackPageIfUnauthorized("Terms", { user: null, permissions: {}, modules: {}, accessReady: true }), "Terms");
  assert.match(mainSrc, /href="\/privacy"/);
  assert.match(mainSrc, /href="\/terms"/);
  assert.match(mainSrc, /Privacy Policy/);
  assert.match(mainSrc, /Terms of Service/);
  assert.match(mainSrc, /isPublicPage\(page\)\?<LegalPages/);
});
