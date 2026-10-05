import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HELP_COMMAND_DEFINITION,
  HELP_COMMAND_SYNC_INTERVAL_MS,
  helpCommandResponse,
  planHelpCommandSync
} from "../worker.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const musicSrc = readFileSync(join(root, "BalticM-Music-v1.7.4-kerit-direct.js"), "utf8");

function registrationBody() {
  const m = workerSrc.match(/async function ensureHelpCommandRegistered\(env\)\{[\s\S]*?\n\}/);
  assert.ok(m, "ensureHelpCommandRegistered present");
  return m[0];
}

// ---------------------------------------------------------------------------
// /help exists in the intended global command set, names stay unique
// ---------------------------------------------------------------------------

test("/help is part of the intended global command set with a unique name", () => {
  assert.equal(HELP_COMMAND_DEFINITION.name, "help");
  assert.equal(HELP_COMMAND_DEFINITION.type, 1, "global CHAT_INPUT command");
  assert.equal(HELP_COMMAND_DEFINITION.dm_permission, true);
  const intended = [HELP_COMMAND_DEFINITION.name];
  assert.equal(new Set(intended).size, intended.length, "command names are unique");
  assert.deepEqual(planHelpCommandSync([]), { action: "create" }, "missing /help is created");
});

// ---------------------------------------------------------------------------
// Repeated sync is idempotent and never creates duplicates
// ---------------------------------------------------------------------------

test("sync is idempotent: repeated plans never create duplicates", () => {
  const first = planHelpCommandSync([]);
  assert.equal(first.action, "create");
  const afterCreate = [
    { id: "100000000000000001", name: "help", description: HELP_COMMAND_DEFINITION.description, type: 1, options: [] }
  ];
  for (let i = 0; i < 3; i++) {
    assert.equal(planHelpCommandSync(afterCreate).action, "none", `run ${i + 1} is a no-op`);
  }
  // Music/other commands in the list never change the plan for /help:
  const mixed = [{ id: "200000000000000002", name: "loop", description: "Loop", type: 1 }, ...afterCreate];
  assert.equal(planHelpCommandSync(mixed).action, "none");
  // Definition drift updates the existing command instead of adding a second one:
  const drifted = [{ id: "100000000000000001", name: "help", description: "old text", type: 1 }];
  const plan = planHelpCommandSync(drifted);
  assert.equal(plan.action, "update");
  assert.equal(plan.id, "100000000000000001");
  // Accidental duplicates are detected, first copy kept:
  const dupes = [afterCreate[0], { id: "999999999999999999", name: "help", description: "x", type: 1 }];
  const dplan = planHelpCommandSync(dupes);
  assert.equal(dplan.action, "dedupe");
  assert.deepEqual(dplan.removeIds, ["999999999999999999"]);
  // Deterministic: same input, same output:
  assert.deepEqual(planHelpCommandSync(dupes), dplan);
});

// ---------------------------------------------------------------------------
// Main Bot sync cannot remove Music (or any other module's) commands
// ---------------------------------------------------------------------------

test("Main Bot sync can only ever touch the help command", () => {
  const body = registrationBody();
  // Never a bulk overwrite of the global command list:
  assert.doesNotMatch(body, /method:"PUT"/);
  assert.doesNotMatch(workerSrc, /commands\.set\(/, "no discord.js-style bulk overwrite in the worker");
  assert.doesNotMatch(workerSrc, /application\.commands/);
  // The planner only ever matches the "help" command, so foreign command ids
  // can never enter a create/update/delete plan:
  const planSrc = workerSrc.match(/export function planHelpCommandSync\([\s\S]*?\n\}/);
  assert.ok(planSrc, "planner present");
  assert.match(planSrc[0], /String\(c\.name\)===definition\.name/);
  assert.match(planSrc[0], /if\(!matches\.length\)return\{action:"create"\};/);
  // A list containing only music commands plans a help CREATE and nothing else
  // (no ids of foreign commands, no update/delete actions):
  const musicOnly = [
    { id: "300000000000000003", name: "play", description: "Play", type: 1 },
    { id: "400000000000000004", name: "loop", description: "Loop", type: 1 },
    { id: "500000000000000005", name: "volume", description: "Volume", type: 1 }
  ];
  assert.deepEqual(planHelpCommandSync(musicOnly), { action: "create" });
  // The only DELETE site is the duplicate-help cleanup, plan-driven:
  const dedupe = body.match(/for\(const id of plan\.removeIds\)\{[\s\S]{0,400}/);
  assert.ok(dedupe, "dedupe loop present");
  assert.match(dedupe[0], /method:"DELETE"/);
  assert.equal((body.match(/method:"DELETE"/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// Music Bot sync cannot remove /help (merge instead of bulk overwrite)
// ---------------------------------------------------------------------------

test("Music Bot sync preserves commands it does not own", () => {
  // The dangerous primitive — guild.commands.set() replaces the whole guild
  // command list — must be gone from the current Music service:
  assert.doesNotMatch(musicSrc, /await guild\.commands\.set\(/);
  assert.doesNotMatch(musicSrc, /commands\.delete\(/, "music never deletes commands");
  // Merge-based sync: fetch, create missing, edit drifted:
  assert.match(musicSrc, /const existing = await guild\.commands\.fetch\(\);/);
  assert.match(musicSrc, /await guild\.commands\.create\(def\);/);
  assert.match(musicSrc, /await found\.edit\(def\);/);
  // Explicit preservation of foreign commands (this is what keeps /help alive
  // even if /help were ever registered guild-scoped):
  assert.match(musicSrc, /filter\(\(cmd\) => !musicNames\.has\(cmd\.name\)\)/);
  assert.match(musicSrc, /preserved foreign commands/);
  // Music does not define a competing help command:
  assert.doesNotMatch(musicSrc, /name:\s*["']help["']/);
});

// ---------------------------------------------------------------------------
// Deployment/startup sync is idempotent and visible
// ---------------------------------------------------------------------------

test("deployment/startup sync runs every cron tick, self-heals and logs every outcome", () => {
  assert.match(workerSrc, /pollAllStreamers\(env\),ensureHelpCommandRegistered\(env\)/, "cron wiring intact");
  assert.ok(HELP_COMMAND_SYNC_INTERVAL_MS <= 60000, "re-check interval may never exceed the 60s cron cadence");
  assert.match(workerSrc, /export const HELP_COMMAND_SYNC_INTERVAL_MS=60000;/);
  // Every outcome — including failures with stage/status — is logged:
  for (const evt of ['event:"present"', 'event:"created"', 'event:"updated"', 'event:"sync-failed"', 'duplicate-removed']) {
    assert.ok(workerSrc.includes(evt), `logged outcome: ${evt}`);
  }
  const body = registrationBody();
  // The throttle flag is only set AFTER a successful sync step, so a failed
  // create/update is retried on the very next tick instead of going silent:
  const flagSets = body.match(/helpCommandRegisteredAt=Date\.now\(\)/g) || [];
  assert.equal(flagSets.length, 4, "flag set only on present/created/updated/deduped");
  assert.match(body, /return fail\("create"/, "a failed create is logged, not swallowed");
  assert.match(body, /return fail\("list"/, "a failed list is logged, not swallowed");
  assert.doesNotMatch(body, /catch\{\}/, "no bare silent catch");
});

// ---------------------------------------------------------------------------
// /help response still contains Open Control Center with the exact URL
// ---------------------------------------------------------------------------

test("/help response keeps the Open Control Center button and exact URL", async () => {
  const res = helpCommandResponse();
  const body = await res.json();
  const button = body.data.components[0].components[0];
  assert.equal(button.label, "Open Control Center");
  assert.equal(button.url, "https://bot.balticm.eu");
  const field = body.data.embeds[0].fields.find(f => f.name.includes("Control Center"));
  assert.equal(field.value, "https://bot.balticm.eu");
  assert.ok(!/https:\/\/bot\.balticm\.eu\/[^" ]/.test(button.url), "no path appended to the Control Center URL");
});
