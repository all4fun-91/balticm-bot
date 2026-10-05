import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESS_CONFIGURE, requiredLevelForRequest, routeAccessKey } from "../access-control.js";
import {
  STREAMER_SUPPRESSED_PREFIX,
  isStreamerSuppressed,
  streamerSuppressedKey,
  streamerSuppressedPrefix,
  streamerSuppressionEntry,
  streamerSuppressionFromKeys
} from "../streamers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const uiSrc = readFileSync(join(root, "src/Streamers.jsx"), "utf8");

const GUILD = "884027552174317569";
const MEMBER = "293469802188636160";
const OTHER_GUILD = "999000111222333444";

test("suppression key matches the streamer-suppressed:<guildId>:<memberId>:<platform> format", () => {
  assert.equal(STREAMER_SUPPRESSED_PREFIX, "streamer-suppressed:");
  assert.equal(streamerSuppressedKey(GUILD, MEMBER, "twitch"), `streamer-suppressed:${GUILD}:${MEMBER}:twitch`);
  assert.equal(streamerSuppressedPrefix(GUILD), `streamer-suppressed:${GUILD}:`);
  assert.equal(streamerSuppressionEntry(MEMBER, "Kick"), `${MEMBER}:kick`);
  assert.equal(streamerSuppressedKey(GUILD, MEMBER, "TIKTOK"), `streamer-suppressed:${GUILD}:${MEMBER}:tiktok`);
});

test("suppression lookup is guild-scoped and platform-specific", () => {
  const own = streamerSuppressedKey(GUILD, MEMBER, "kick");
  const foreignGuild = streamerSuppressedKey(OTHER_GUILD, MEMBER, "kick");
  const otherMember = streamerSuppressedKey(GUILD, "111222333444555666", "kick");
  const prefix = streamerSuppressedPrefix(GUILD);
  const set = streamerSuppressionFromKeys([own, foreignGuild, otherMember, "streamers-settings:" + GUILD], prefix);
  // Only this guild's suppression keys are read (settings keys and other guilds excluded):
  assert.deepEqual([...set].sort(), [`${MEMBER}:kick`, "111222333444555666:kick"].sort());
  assert.equal(isStreamerSuppressed(set, MEMBER, "kick"), true);
  assert.equal(isStreamerSuppressed(set, MEMBER, "twitch"), false);
  assert.equal(isStreamerSuppressed(set, "666555444333222111", "kick"), false);
  assert.equal(isStreamerSuppressed(streamerSuppressionFromKeys([foreignGuild], prefix), MEMBER, "kick"), false);
  assert.equal(isStreamerSuppressed(null, MEMBER, "kick"), false);
  assert.equal(isStreamerSuppressed([`${MEMBER}:twitch`], MEMBER, "twitch"), true);
  assert.equal(isStreamerSuppressed({ [`${MEMBER}:tiktok`]: true }, MEMBER, "tiktok"), true);
});

test("delete → sync round trip: a deleted entry is suppressed for that guild only", () => {
  // What deleteStreamer writes:
  const written = [streamerSuppressedKey(GUILD, MEMBER, "twitch")];
  // What syncAutoStreamersForGuild reads for the same guild:
  const forGuild = streamerSuppressionFromKeys(written, streamerSuppressedPrefix(GUILD));
  assert.equal(isStreamerSuppressed(forGuild, MEMBER, "twitch"), true);
  // Another guild syncing the same member+platform is unaffected:
  const forOther = streamerSuppressionFromKeys(written, streamerSuppressedPrefix(OTHER_GUILD));
  assert.equal(isStreamerSuppressed(forOther, MEMBER, "twitch"), false);
});

test("deleteStreamer is guild-scoped, gated, and suppresses before deleting", () => {
  const fn = workerSrc.match(/async function deleteStreamer\(env,user,guildId,id\)\{[\s\S]*?\n\}/);
  assert.ok(fn, "deleteStreamer function present");
  const body = fn[0];
  assert.match(body, /streamerStudioGate\(env,user,guildId\)/);
  assert.match(body, /SELECT \* FROM streamers WHERE id=\? AND guild_id=\?/);
  assert.match(body, /DELETE FROM streamers WHERE id=\? AND guild_id=\?/);
  assert.match(body, /suppressStreamerDeletion\(env,guildId,memberId,provider\)/);
  // Suppression is written before the row delete (no partial delete on failure):
  assert.ok(body.indexOf("suppressStreamerDeletion") < body.indexOf("DELETE FROM streamers"));
  // AUTO rows are deletable (suppression replaces the old hard block):
  assert.doesNotMatch(body, /Premium auto streamers are linked from the member Profile/);
  assert.doesNotMatch(workerSrc, /Premium auto streamers are linked from the member Profile/);
});

test("profile/Premium sync skips guild-suppressed member+platform pairs", () => {
  const fn = workerSrc.match(/async function syncAutoStreamersForGuild\(env,guildId,premium\)\{[\s\S]*?\n\}/);
  assert.ok(fn, "syncAutoStreamersForGuild function present");
  const body = fn[0];
  assert.match(body, /loadStreamerSuppressions\(env,guildId\)/);
  assert.match(body, /isStreamerSuppressed\(suppressed,account\.discord_user_id,account\.provider\)\)continue/);
  // Skip must happen before the upsert that would recreate the row:
  assert.ok(body.indexOf("isStreamerSuppressed") < body.indexOf("upsertAutoStreamerFromAccount"));
  // Helper functions exist:
  assert.match(workerSrc, /async function loadStreamerSuppressions\(env,guildId\)\{/);
  assert.match(workerSrc, /async function suppressStreamerDeletion\(env,guildId,memberId,platform\)\{/);
  assert.match(workerSrc, /async function clearStreamerSuppression\(env,guildId,memberId,platform\)\{/);
  assert.match(workerSrc, /SELECT key FROM bot_config WHERE key LIKE \?/);
});

test("explicitly re-adding/enabling a streamer clears its suppression", () => {
  const fn = workerSrc.match(/async function saveStreamer\(req,env,user,guildId,id=""\)\{[\s\S]*?\n\}/);
  assert.ok(fn, "saveStreamer function present");
  const clears = fn[0].match(/clearStreamerSuppression\(env,guildId,/g) || [];
  assert.ok(clears.length >= 2, "both save paths (auto edit + owner create/update) clear suppression");
});

test("DELETE route is wired behind session-guild and RBAC checks", () => {
  assert.match(workerSrc, /if\(!st\[2\]&&req\.method==="DELETE"\)return deleteStreamer\(env,user,guildId,id\)/);
  const routeLine = workerSrc.split("\n").find(l => l.includes('const st=p.match(/^\\/api\\/streamers\\/') );
  assert.ok(routeLine, "streamers id route present");
  assert.match(routeLine, /canManageGuild\(user,guildId\)/);
  assert.match(routeLine, /req\.method==="DELETE"/);
  assert.equal(routeAccessKey("/api/streamers/" + MEMBER), "streamers");
  assert.equal(requiredLevelForRequest("/api/streamers/" + MEMBER, "DELETE"), ACCESS_CONFIGURE);
});

test("UI shows Delete on every row and opens the exact confirmation modal", () => {
  // Delete button for all rows (no source gate), after Edit:
  assert.match(uiSrc, /<Pencil\/>Edit<\/button>\}\{canMutate&&<button type="button" className="danger" onClick=\{\(\)=>\{setDeleteError\(""\);setDeleteTarget\(s\)\}\}/);
  assert.doesNotMatch(uiSrc, /s\.source!=="auto"&&<button[^>]*>[\s\S]{0,80}Trash2\/>Remove/);
  // No native confirm for this flow:
  assert.doesNotMatch(uiSrc, /window\.confirm\("Remove this streamer configuration\?"\)/);
  // Modal copy:
  assert.match(uiSrc, />Remove streamer\?</);
  assert.match(uiSrc, /Remove \{deleteName\} from this server's streamer list\?/);
  for (const bullet of [
    "remove the streamer from this server",
    "stop automatic LIVE monitoring for this server",
    "stop future LIVE announcements for this server",
    "delete their Discord account",
    "delete their BalticM profile",
    "disconnect their personal Twitch/TikTok/Kick accounts globally",
    "affect the streamer on another Discord server"
  ]) assert.ok(uiSrc.includes(`<li>${bullet}</li>`), "bullet present: " + bullet);
  assert.match(uiSrc, />Cancel<\/button>/);
  assert.ok(uiSrc.includes('"Remove Streamer"'), "Remove Streamer button");
  assert.match(uiSrc, /className="danger" onClick=\{confirmDelete\}/);
});

test("UI removes the row optimistically and surfaces real errors", () => {
  const fn = uiSrc.match(/const confirmDelete=async\(\)=>\{[\s\S]*?finally\{setBusy\(""\)\}\};/);
  assert.ok(fn, "confirmDelete present");
  const body = fn[0];
  assert.match(body, /method:"DELETE"/);
  assert.match(body, /prev\.streamers\.filter\(s=>s\.id!==target\.id\)/);
  assert.match(body, /setToast\("Streamer removed"\)/);
  assert.doesNotMatch(body, /await load\(/, "no full page reload after delete");
  assert.doesNotMatch(body, /setNotice\(/);
  // Failure path keeps the row and shows the server error in the modal:
  assert.match(body, /catch\(err\)\{setDeleteError\(err\.message\)\}/);
  assert.match(uiSrc, /deleteError&&<div className="memberNotice streamerDeleteError">\{deleteError\}<\/div>/);
  // Cancel just closes the modal:
  const cancel = uiSrc.match(/const cancelDelete=\(\)=>\{[\s\S]*?\};/);
  assert.ok(cancel, "cancelDelete present");
  assert.doesNotMatch(cancel[0], /fetch\(/);
  assert.match(cancel[0], /setDeleteTarget\(null\)/);
  // Success toast:
  assert.match(uiSrc, /className="streamerToast" role="status">\{toast\}/);
});
