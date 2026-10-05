import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredLevelForRequest, routeAccessKey } from "../access-control.js";
import {
  STREAMER_PANEL_ACCESS_UNKNOWN_ERROR,
  STREAMER_PANEL_BOT_PERMISSION_ERROR,
  STREAMER_PANEL_NO_PERMISSION_ERROR,
  streamerPanelErrorText
} from "../streamers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const uiSrc = readFileSync(join(root, "src/Streamers.jsx"), "utf8");

const FALLBACK = "Could not load the Streamer Info Panel";

// ---------------------------------------------------------------------------
// Client-side error copy: raw HTTP text is never shown
// ---------------------------------------------------------------------------

test("panel failures never surface raw Forbidden/403 text", () => {
  assert.equal(
    STREAMER_PANEL_BOT_PERMISSION_ERROR,
    "Bot permissions required — grant View Channel, Send Messages and Embed Links in the selected channel."
  );
  // Genuine RBAC denial gets clear, actionable text instead of "Forbidden":
  assert.equal(streamerPanelErrorText(403, { error: "Forbidden" }), STREAMER_PANEL_NO_PERMISSION_ERROR);
  assert.equal(
    streamerPanelErrorText(403, { error: "Forbidden", requiredPermission: "streamers", accessLevel: null }, FALLBACK),
    STREAMER_PANEL_NO_PERMISSION_ERROR
  );
  // Transient access-lookup failure: temporary error, never a permissions claim:
  const unknown = streamerPanelErrorText(503, { error: "ignored", accessUnknown: true }, FALLBACK);
  assert.equal(unknown, STREAMER_PANEL_ACCESS_UNKNOWN_ERROR);
  assert.doesNotMatch(unknown, /permission|channel|Forbidden/i);
  assert.equal(streamerPanelErrorText(403, { accessUnknown: true }, FALLBACK), STREAMER_PANEL_ACCESS_UNKNOWN_ERROR);
  // Already-actionable server messages (bot permissions, owner-only) pass through verbatim:
  assert.equal(
    streamerPanelErrorText(403, { error: STREAMER_PANEL_BOT_PERMISSION_ERROR }, FALLBACK),
    STREAMER_PANEL_BOT_PERMISSION_ERROR
  );
  // Session expiry and server failures:
  assert.equal(streamerPanelErrorText(401, { error: "Unauthorized" }, FALLBACK), "Your session has expired. Please sign in again.");
  assert.equal(streamerPanelErrorText(500, { error: "Could not load streamer panel" }, FALLBACK), FALLBACK);
  assert.equal(streamerPanelErrorText(0, {}, FALLBACK), FALLBACK);
  for (const [status, body] of [
    [403, { error: "Forbidden" }],
    [503, { accessUnknown: true }],
    [401, { error: "Unauthorized" }],
    [500, { error: "Internal Server Error" }]
  ]) {
    const text = streamerPanelErrorText(status, body, FALLBACK);
    assert.ok(!/Forbidden|Unauthorized/.test(text), `raw HTTP text leaked: ${text}`);
  }
});

// ---------------------------------------------------------------------------
// Server-side: transient unknown state is retried, then denied with a
// distinguishable error — RBAC itself is untouched and never fails open
// ---------------------------------------------------------------------------

test("worker retries transient access lookups, then fails closed with a retryable error", () => {
  const retry = workerSrc.match(/async function resolveAccessLevel\(env,user,guildId,key\)\{[\s\S]{0,600}/);
  assert.ok(retry, "resolveAccessLevel helper present");
  assert.match(retry[0], /controlAccessLevel\(env,user,guildId,key\)/);
  assert.match(retry[0], /level===null&&attempt</, "retries only while the state is unknown");
  const gate = workerSrc.match(/async function requireControlAccess\([\s\S]{0,700}/);
  assert.ok(gate, "requireControlAccess present");
  assert.match(gate[0], /resolveAccessLevel\(env,user,guildId,key\)/);
  assert.match(gate[0], /if\(levelMeets\(level,minLevel\)\)return null;/, "grant path unchanged");
  assert.match(gate[0], /level===null\)return json\(\{error:ACCESS_UNKNOWN_ERROR,accessUnknown:true/, "unknown is still denied");
  assert.match(gate[0], /\},503\)/, "unknown answers with a retryable status, not a raw 403");
  assert.match(
    gate[0],
    /return json\(\{error:"Forbidden",requiredPermission:key,requiredLevel:minLevel,accessLevel:level\},403\);/,
    "a genuine denial keeps the exact 403 contract"
  );
  assert.doesNotMatch(gate[0], /level===null\)return null;/, "unknown must never be treated as a grant");
  // The temporary wording shown by the client and the one sent by the worker match:
  const wording = workerSrc.match(/const ACCESS_UNKNOWN_ERROR="([^"]+)"/);
  assert.ok(wording, "worker declares the temporary access message");
  assert.equal(wording[1], STREAMER_PANEL_ACCESS_UNKNOWN_ERROR);
  // controlAccessLevel itself still reports transient failures as unknown only:
  const rbacFn = workerSrc.match(/async function controlAccessLevel\(env,user,guildId,key\)\{[\s\S]*?\n\}/);
  assert.ok(rbacFn, "controlAccessLevel present");
  assert.match(rbacFn[0], /if\(!wrap\)return null;/);
  assert.match(rbacFn[0], /if\(mr\.status===404\)return ACCESS_NONE;return null;/);
  assert.match(rbacFn[0], /catch\{return null\}/);
});

test("streamer studio gate reports temporary access failures instead of raw Forbidden", () => {
  const gate = workerSrc.match(/async function streamerStudioGate\(env,user,guildId\)\{[\s\S]{0,900}/);
  assert.ok(gate, "streamerStudioGate present");
  assert.match(gate[0], /resolveAccessLevel\(env,user,guildId,"streamers"\)/);
  assert.match(gate[0], /decision\.error==="Forbidden"&&level===null/, "raw Forbidden only survives a known denial");
  assert.match(gate[0], /status:503,error:ACCESS_UNKNOWN_ERROR,accessUnknown:true/);
  assert.match(gate[0], /return \{\.\.\.decision,isOwner,premium:!!premiumState\.premium,premiumState,accessLevel:level\};/);
});

test("panel and streamers state share one access contract, so the panel cannot 403 on its own", () => {
  assert.equal(routeAccessKey("/api/streamers/panel"), routeAccessKey("/api/streamers"));
  assert.equal(
    requiredLevelForRequest("/api/streamers/panel", "GET"),
    requiredLevelForRequest("/api/streamers", "GET"),
    "same key and level: both requests are gated by the same retried check"
  );
  assert.match(
    workerSrc,
    /const denied=await requireControlAccess\(env,user,guildIdForAccess,routeKey,minLevel\)/,
    "every gated route goes through the retrying gate"
  );
  const panelRoute = workerSrc.indexOf('if(p==="/api/streamers/panel"){');
  assert.ok(panelRoute >= 0, "panel route present");
  assert.ok(
    workerSrc.slice(panelRoute, panelRoute + 300).includes("canManageGuild(user,guildId)"),
    "panel route keeps its guild ownership check"
  );
});

test("panel publish/update report missing bot permissions with the required message", () => {
  const publish = workerSrc.match(/async function publishStreamerPanel[\s\S]*?\nasync function /);
  const update = workerSrc.match(/async function updateStreamerPanel[\s\S]*?\nasync function /);
  assert.ok(publish && update, "panel publish/update present");
  for (const body of [publish[0], update[0]]) {
    assert.match(body, /STREAMER_PANEL_BOT_PERMISSION_ERROR/);
    assert.doesNotMatch(body, /BalticM needs View Channel/);
  }
  assert.match(workerSrc, /  STREAMER_PANEL_BOT_PERMISSION_ERROR,\r?\n/, "worker imports the shared message");
});

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

test("Streamers UI maps every panel failure to actionable text", () => {
  assert.ok(uiSrc.includes("streamerPanelErrorText } from \"../streamers.js\""), "mapping helper is imported");
  const loadPanel = uiSrc.match(/const loadPanel=async\(\)=>\{[\s\S]{0,700}/);
  assert.ok(loadPanel);
  assert.match(loadPanel[0], /streamerPanelErrorText\(r,x,"Could not load the Streamer Info Panel"\)/);
  assert.doesNotMatch(loadPanel[0], /x\.error\|\|/, "raw server error text is never thrown to the panel");
  const act = uiSrc.match(/const panelAct=async action=>\{[\s\S]{0,1100}/);
  assert.ok(act);
  assert.match(act[0], /setPanelNotice\(streamerPanelErrorText\(r,x,"Could not update the Streamer Info Panel"\)/);
  assert.doesNotMatch(act[0], /setPanelNotice\(x\.error/);
  const save = uiSrc.match(/const savePanelConfig=async\(\)=>\{[\s\S]{0,800}/);
  assert.ok(save);
  assert.match(save[0], /streamerPanelErrorText\(r,x,"Could not save the Streamer Info Panel"\)/);
  const reset = uiSrc.match(/const resetPanelConfig=async\(\)=>\{[\s\S]{0,800}/);
  assert.ok(reset);
  assert.match(reset[0], /streamerPanelErrorText\(r,x,"Could not reset the Streamer Info Panel"\)/);
  // The panel error slot renders exactly that mapped text:
  assert.match(uiSrc, /\{panel\.error\?<small className="streamersHint">\{panel\.error\}<\/small>/);
  // The list notice is mapped too, with a message that fits that surface:
  assert.match(uiSrc, /streamerPanelErrorText\(r,x,"Could not load streamers","You do not have permission to manage Streamers for this server\."\)/);
  // No literal raw-status text anywhere in this page:
  assert.doesNotMatch(uiSrc, /Forbidden/);
  // Bot permissions case renders the required message:
  assert.ok(uiSrc.includes("STREAMER_PANEL_BOT_PERMISSION_ERROR"));
});

test("an unreadable channel list is temporary, never a missing-permissions claim", () => {
  const list = workerSrc.match(/async function listGuildSendableChannels\(env,guildId\)\{[\s\S]{0,400}/);
  assert.ok(list);
  assert.match(list[0], /if\(!r\.ok\)return r\.status===404\?\[\]:null;/, "a failed lookup is unknown, not an empty channel list");
  const state = workerSrc.match(/async function streamerPanelState\(env,guildId\)\{[\s\S]{0,900}/);
  assert.ok(state);
  assert.match(state[0], /const sendable=Array\.isArray\(channels\)\?channels:\[\];/);
  assert.match(state[0], /channels:Array\.isArray\(channels\)\?channels:null/, "unknown is surfaced to the client");
  assert.match(state[0], /sendable\.find\(/, "a null channel list never breaks the state response");
  // The hint claims missing bot permissions only when the list really is empty:
  assert.match(uiSrc, /\{panel\.channels===null\?STREAMER_PANEL_ACCESS_UNKNOWN_ERROR:STREAMER_PANEL_BOT_PERMISSION_ERROR\}/);
});
