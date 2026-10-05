import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { helpCommandResponse } from "../worker.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");

test("/help executes and returns the exact BalticM embed with a link button", async () => {
  const res = helpCommandResponse();
  assert.ok(res && typeof res.json === "function", "returns a Response");
  const body = await res.json();
  assert.equal(body.type, 4, "CHANNEL_MESSAGE_WITH_SOURCE, immediately visible");
  assert.equal(body.data.flags, undefined, "not ephemeral — visible normally");
  const embed = body.data.embeds[0];
  assert.equal(embed.title, "🛟 BalticM.eu — Help Center");
  assert.equal(embed.description, "Manage your Discord server with BalticM Control Center.");
  assert.equal(embed.footer.text, "BalticM.eu • PLAY TOGETHER • MANAGE SMARTER");
  assert.deepEqual(embed.fields, [
    { name: "🎵 Music", value: "/play, /join, /volume, /loop" },
    { name: "🎫 Tickets", value: "Support and ticket management" },
    { name: "🎁 Giveaways", value: "Create and manage giveaways" },
    { name: "📡 Streamers", value: "Twitch, TikTok & Kick LIVE alerts" },
    { name: "🛡️ Moderation", value: "Server management and moderation tools" },
    { name: "🎭 Reaction Roles", value: "Self-assignable Discord roles" },
    { name: "🌐 Control Center", value: "https://bot.balticm.eu" }
  ]);
  const row = body.data.components[0];
  assert.equal(row.type, 1, "action row");
  assert.deepEqual(row.components[0], { type: 2, style: 5, label: "Open Control Center", url: "https://bot.balticm.eu" });
});

test("/help is answered before the external-bot forward (no deferral, no double reply)", () => {
  const pingIdx = workerSrc.indexOf('if(interaction?.type===1)return json({type:1});');
  const helpIdx = workerSrc.indexOf('if(interaction?.type===2&&String(interaction?.data?.name||"")==="help")return helpCommandResponse();');
  const forwardIdx = workerSrc.indexOf('ctx.waitUntil(fetch("https://balticm.eu/discord-bot"');
  assert.ok(pingIdx > 0 && helpIdx > pingIdx, "help branch after ping handling");
  assert.ok(helpIdx < forwardIdx, "help branch before the external forward");
  // Not deferred and not routed through the music deferral list:
  assert.doesNotMatch(workerSrc, /data\?\.name==="help"\)\)return json\(\{type:5/);
});

test("/help is registered as a GLOBAL command without touching existing commands", () => {
  assert.match(workerSrc, /const HELP_COMMAND_DEFINITION=\{name:"help",description:"[^"]+",type:1,dm_permission:true\}/);
  const regFn = workerSrc.match(/async function ensureHelpCommandRegistered\(env\)\{[\s\S]*?\n\}/);
  assert.ok(regFn, "registration helper present");
  const body = regFn[0];
  // Global scope endpoints only (no guild id anywhere) and a create-or-patch flow:
  assert.match(body, /applications\/\$`?\{?appId\}?`?\/commands/);
  assert.match(body, /oauth2\/applications\/@me/);
  assert.match(body, /method:"POST"/, "creates /help when missing");
  assert.match(body, /method:"PATCH"/, "updates only the help command when its definition drifts");
  // Never a bulk overwrite — existing global commands stay registered, and
  // DELETE exists only to drop accidental duplicate "help" rows:
  assert.doesNotMatch(body, /method:"PUT"/);
  const dedupeLoop = body.match(/for\(const id of plan\.removeIds\)\{[\s\S]{0,400}/);
  assert.ok(dedupeLoop, "dedupe loop present");
  assert.match(dedupeLoop[0], /method:"DELETE"/, "the only DELETE is scoped to duplicate help ids");
  assert.equal((body.match(/method:"DELETE"/g) || []).length, 1, "exactly one DELETE site");
  assert.match(body, /for\(const id of plan\.removeIds\)/, "deletes are plan-driven");
  // Registered by the every-minute cron, throttled to at most one check per
  // minute so a removed /help is restored within a single cron tick (the old
  // 6-hour blind spot is exactly how /help stayed gone):
  assert.match(workerSrc, /pollAllStreamers\(env\),ensureHelpCommandRegistered\(env\)/);
  assert.match(workerSrc, /export const HELP_COMMAND_SYNC_INTERVAL_MS=60000;/);
  assert.match(body, /HELP_COMMAND_SYNC_INTERVAL_MS/);
  assert.doesNotMatch(body, /6\*60\*60\*1000/, "the 6h blind spot is gone");
  assert.match(body, /component:"help-command"/, "emits verification logs");
  // Every failure stage is logged instead of returning silently:
  assert.match(body, /event:"sync-failed"/);
});

test("existing slash-command dispatch is untouched", () => {
  // Music command deferral list:
  assert.match(workerSrc, /interaction\?\.type===2&&\["play","join","disconnect","pause","resume","skip","stop","queue","nowplaying","np","volume","remove","clear","shuffle","loop"\]\.includes\(interaction\?\.data\?\.name\)\)return json\(\{type:5/);
  // Component interactions (tickets, giveaways, DM opt in/out) still routed:
  for (const id of ["ticket_create:", "ticket_close:", "giveaway_enter:", "dm_unsubscribe:", "dm_subscribe:"]) {
    assert.ok(workerSrc.includes(`customId.startsWith("${id}")`), "component branch intact: " + id);
  }
  // External bot forward preserved for everything else:
  assert.ok(workerSrc.includes('ctx.waitUntil(fetch("https://balticm.eu/discord-bot"'));
  // Music/tickets/streamers/moderation/reaction-roles implementation files untouched by this change:
  assert.doesNotMatch(workerSrc, /name:"help"[\s\S]{0,400}playCommand/);
});
