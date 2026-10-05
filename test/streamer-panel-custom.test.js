import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESS_CONFIGURE, ACCESS_OPERATE, requiredLevelForRequest, routeAccessKey } from "../access-control.js";
import {
  STREAMER_PANEL_BRANDING,
  STREAMER_PANEL_BRANDING_LINKED,
  STREAMER_PANEL_BRANDING_URL,
  STREAMER_PANEL_CONFIG_KEY,
  STREAMER_EMBED_COLOR,
  buildStreamerPanelFooter,
  composeStreamerPanelDescription,
  decideStreamerStudioMutation,
  defaultStreamerPanelConfig,
  isStreamerPanelUrl,
  normalizeStreamerPanelConfig,
  parseStreamerPanelConfig,
  streamerPanelEmbed,
  streamerPanelPayload
} from "../streamers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const uiSrc = readFileSync(join(root, "src/Streamers.jsx"), "utf8");
const styleSrc = readFileSync(join(root, "src/style.css"), "utf8");

const env = { PUBLIC_APP_URL: "https://bot.balticm.eu" };
const custom = {
  title: "My Community Streamers",
  description: "Welcome to our community!",
  howItWorks: "Step one\nStep two",
  additionalText: "Join our events every Friday.",
  footerText: "Community Team",
  buttonLabel: "Join the fun",
  buttonUrl: "https://example.com/join",
  buttonEnabled: true,
  color: 0x3355ff
};

const fn = name => {
  const m = workerSrc.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} present`);
  return m[0];
};

// ---------------------------------------------------------------------------
// Default template
// ---------------------------------------------------------------------------

test("default template is the existing BalticM content and publishes with no configuration", () => {
  const defaults = defaultStreamerPanelConfig();
  const parsed = parseStreamerPanelConfig({});
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, defaults);
  const embed = streamerPanelEmbed(env);
  const lines = [
    "Streaming on Twitch, TikTok or Kick?",
    "Connect your streaming accounts to your BalticM profile and let BalticM handle the rest automatically.",
    "How it works",
    "🔗 Connect your streaming account",
    "🟢 BalticM detects when you go live",
    "📢 Your stream is automatically posted in the configured stream channel",
    "🔴 When your stream ends, BalticM automatically updates the live notification",
    "No commands. No manual stream posts.",
    "Connect once and BalticM takes care of the rest.",
    "Your connected streaming accounts can be managed anytime from your BalticM profile."
  ];
  for (const line of lines) assert.ok(embed.description.includes(line), `missing: ${line}`);
  assert.equal(embed.title, "🎥 BalticM Streamers");
  assert.equal(embed.color, STREAMER_EMBED_COLOR);
  const payload = streamerPanelPayload(env);
  assert.equal(payload.components[0].components[0].label, "🎥 Manage Streaming Accounts");
  assert.equal(payload.components[0].components[0].url, "https://bot.balticm.eu/profile");
});

test("explicitly cleared fields stay cleared while absent fields fall back to the default template", () => {
  const cleared = parseStreamerPanelConfig({ title: "T", description: "", howItWorks: "", additionalText: "", footerText: "", buttonLabel: "Go", buttonUrl: "" });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.value.description, "");
  assert.equal(composeStreamerPanelDescription(cleared.value), "");
  const partial = parseStreamerPanelConfig({ title: "Only a title" });
  assert.equal(partial.ok, true);
  assert.equal(partial.value.description, defaultStreamerPanelConfig().description);
  assert.equal(partial.value.buttonLabel, defaultStreamerPanelConfig().buttonLabel);
});

// ---------------------------------------------------------------------------
// Free + Premium availability, existing RBAC preserved
// ---------------------------------------------------------------------------

test("Free guild owner and Premium RBAC manager can customize; existing rules unchanged", () => {
  // Free server: the Discord Server Owner manages the panel (existing gate).
  assert.equal(decideStreamerStudioMutation({ isOwner: true, premium: false, canConfigure: false }).ok, true);
  // Premium server: Configure-level RBAC also passes (existing gate).
  assert.equal(decideStreamerStudioMutation({ isOwner: false, premium: true, canConfigure: true }).ok, true);
  // Existing restriction preserved: non-owner without Premium is denied.
  assert.equal(decideStreamerStudioMutation({ isOwner: false, premium: false, canConfigure: true }).ok, false);
  assert.equal(decideStreamerStudioMutation({ isOwner: false, premium: true, canConfigure: false }).ok, false);
});

test("panel config handlers use the existing streamers gate with no premium gate of their own", () => {
  for (const name of ["saveStreamerPanelConfig", "resetStreamerPanelConfig", "publishStreamerPanel", "updateStreamerPanel", "deleteStreamerPanel"]) {
    const body = fn(name);
    assert.match(body, /streamerStudioGate\(env,user,guildId\)/, name);
    assert.match(body, /if\(!gate\.ok\)return json\(\{error:gate\.error\},gate\.status\|\|403\)/, name);
    assert.doesNotMatch(body, /premiumPlanState|shouldPauseAutoStreamerAutomation/, `${name} has no premium gate`);
  }
  // The panel feature itself is never premium-gated at the route level.
  assert.equal(routeAccessKey("/api/streamers/panel/config"), "streamers");
  assert.equal(requiredLevelForRequest("/api/streamers/panel/config", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/streamers/panel/config", "DELETE"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/streamers/panel", "GET"), ACCESS_OPERATE);
});

// ---------------------------------------------------------------------------
// Persistence + guild isolation
// ---------------------------------------------------------------------------

test("customization is stored per guild in durable server-side config", () => {
  assert.equal(STREAMER_PANEL_CONFIG_KEY("111111111111111111"), "streamer-panel-config:111111111111111111");
  assert.notEqual(STREAMER_PANEL_CONFIG_KEY("111111111111111111"), STREAMER_PANEL_CONFIG_KEY("222222222222222222"));
  assert.match(workerSrc, /readBotConfig\(env,STREAMER_PANEL_CONFIG_KEY\(guildId\)/);
  assert.equal((workerSrc.match(/writeBotConfig\(env,STREAMER_PANEL_CONFIG_KEY\(guildId\)/g) || []).length, 2);
  assert.match(fn("loadStreamerPanelConfig"), /defaultStreamerPanelConfig\(\)/);
  // Published message tracking (guild/channel/message ids) stays per guild:
  assert.match(workerSrc, /writeBotConfig\(env,STREAMER_PANEL_KEY\(guildId\)/);
  assert.match(workerSrc, /writeStreamerPanel\(env,guildId,\{channelId,messageId:String\(sent\.id\)\}\)/);
});

test("cross-guild attack via guild_id in the body is rejected; route guild comes from the query", () => {
  const save = fn("saveStreamerPanelConfig");
  assert.match(save, /if\(body\.guildId&&String\(body\.guildId\)!==String\(guildId\)\)return json\(\{error:"Forbidden"\},403\)/);
  assert.match(
    workerSrc,
    /if\(p==="\/api\/streamers\/panel\/config"\)\{\s*const guildId=u\.searchParams\.get\("guildId"\);[\s\S]{0,200}canManageGuild\(user,guildId\)/
  );
  // Both handlers are guildId-parameterized (no body-provided guild for writes):
  assert.match(save, /saveStreamerPanelConfig\(req,env,user,guildId\)/);
  assert.match(fn("resetStreamerPanelConfig"), /resetStreamerPanelConfig\(env,user,guildId\)/);
});

test("unauthorized edit/save/reset/publish/update are denied", () => {
  for (const name of ["saveStreamerPanelConfig", "resetStreamerPanelConfig", "publishStreamerPanel", "updateStreamerPanel", "deleteStreamerPanel"]) {
    const m = workerSrc.match(new RegExp(`async function ${name}\\([\\s\\S]{0,300}streamerStudioGate\\(env,user,guildId\\)`));
    assert.ok(m, `${name} gates within the first statements`);
  }
  // Session guild membership check on both panel routes:
  assert.match(workerSrc, /if\(p==="\/api\/streamers\/panel\/config"\)\{[\s\S]{0,300}canManageGuild\(user,guildId\)/);
  assert.match(workerSrc, /if\(p==="\/api\/streamers\/panel"\)\{[\s\S]{0,300}canManageGuild\(user,guildId\)/);
  // Cross-cutting RBAC + feature-module enforcement still runs for these routes:
  assert.equal(routeAccessKey("/api/streamers/panel/config"), "streamers");
});

// ---------------------------------------------------------------------------
// Customization behavior (title/description/content/footer/color/button)
// ---------------------------------------------------------------------------

test("custom title, description, content, footer and accent color reach the Discord payload", () => {
  const parsed = parseStreamerPanelConfig(custom);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, normalizeStreamerPanelConfig(custom));
  const embed = streamerPanelEmbed(env, parsed.value);
  assert.equal(embed.title, "My Community Streamers");
  assert.ok(embed.description.includes("Welcome to our community!"));
  assert.ok(embed.description.includes("How it works"));
  assert.ok(embed.description.includes("Step one"));
  assert.ok(embed.description.includes("Join our events every Friday."));
  assert.equal(embed.color, 0x3355ff);
  assert.equal(embed.footer.text, "Community Team", "custom footer text only — branding is not appended");
  const parsedHex = parseStreamerPanelConfig({ ...custom, color: "#3355ff" });
  assert.equal(parsedHex.ok, true);
  assert.equal(parsedHex.value.color, 0x3355ff);
});

test("custom button label, URL and disabled state reach the Discord payload", () => {
  const parsed = parseStreamerPanelConfig(custom);
  const button = streamerPanelPayload(env, parsed.value).components[0].components[0];
  assert.equal(button.label, "Join the fun");
  assert.equal(button.url, "https://example.com/join");
  assert.equal(button.disabled, undefined, "enabled buttons carry no disabled flag");
  const off = parseStreamerPanelConfig({ ...custom, buttonEnabled: false });
  assert.equal(off.ok, true);
  const offButton = streamerPanelPayload(env, off.value).components[0].components[0];
  assert.equal(offButton.disabled, true);
  assert.equal(offButton.label, "Join the fun");
  // Empty custom URL falls back to the default manage URL:
  const fallback = parseStreamerPanelConfig({ ...custom, buttonUrl: "" });
  const fbButton = streamerPanelPayload(env, fallback.value).components[0].components[0];
  assert.equal(fbButton.url, "https://bot.balticm.eu/profile");
});

test("invalid URLs and out-of-range content are rejected server-side", () => {
  assert.equal(isStreamerPanelUrl("https://bot.balticm.eu/x"), true);
  assert.equal(isStreamerPanelUrl("http://example.com"), true);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "notaurl", "ftp://files.example.com", "http//missing.example"]) {
    const r = parseStreamerPanelConfig({ ...custom, buttonUrl: bad });
    assert.equal(r.ok, false, `must reject ${bad}`);
    assert.equal(isStreamerPanelUrl(bad), false);
  }
  assert.equal(parseStreamerPanelConfig({ ...custom, title: "" }).ok, false);
  assert.equal(parseStreamerPanelConfig({ ...custom, title: "x".repeat(257) }).ok, false);
  assert.equal(parseStreamerPanelConfig({ ...custom, description: "x".repeat(4001) }).ok, false);
  assert.equal(parseStreamerPanelConfig({ ...custom, footerText: "x".repeat(1501) }).ok, false);
  assert.equal(parseStreamerPanelConfig({ ...custom, buttonLabel: "x".repeat(81) }).ok, false);
  assert.equal(parseStreamerPanelConfig({ ...custom, buttonLabel: "   " }).ok, false);
  assert.equal(parseStreamerPanelConfig({ ...custom, color: "not-a-color" }).ok, false);
  assert.equal(parseStreamerPanelConfig({ ...custom, color: 0x1000000 }).ok, false);
  // Composed Discord total limit (description + how-it-works + additional text):
  const huge = parseStreamerPanelConfig({ ...custom, description: "x".repeat(4000), howItWorks: "y".repeat(2000) });
  assert.equal(huge.ok, false);
  assert.match(huge.error, /4096/);
});

// ---------------------------------------------------------------------------
// Fixed Bot.BalticM.eu branding
// ---------------------------------------------------------------------------

test("fixed Bot.BalticM.eu branding renders exactly once: linked in the description, never repeated in the footer", () => {
  assert.equal(STREAMER_PANEL_BRANDING, "Powered by Bot.BalticM.eu • PLAY TOGETHER");
  assert.equal(STREAMER_PANEL_BRANDING_URL, "https://bot.balticm.eu");
  for (const cfg of [defaultStreamerPanelConfig(), normalizeStreamerPanelConfig(custom), normalizeStreamerPanelConfig({ ...custom, footerText: "", buttonEnabled: false })]) {
    const embed = streamerPanelEmbed(env, cfg);
    assert.ok(embed.description.includes(STREAMER_PANEL_BRANDING_LINKED), "description always carries the linked branding");
    assert.ok(embed.description.includes(`](${STREAMER_PANEL_BRANDING_URL})`), "Bot.BalticM.eu points at https://bot.balticm.eu");
    const footerText = embed.footer ? embed.footer.text : "";
    assert.ok(!footerText.includes(STREAMER_PANEL_BRANDING), "footer never repeats the branding line");
    const rendered = (embed.description + "\n" + footerText).split(STREAMER_PANEL_BRANDING_LINKED).join(STREAMER_PANEL_BRANDING);
    assert.equal(rendered.split(STREAMER_PANEL_BRANDING).length - 1, 1, "branding line renders exactly once");
  }
  // Custom footer text is used verbatim; the branding line is never appended to it.
  assert.equal(
    buildStreamerPanelFooter({ ...defaultStreamerPanelConfig(), footerText: "Community Team" }),
    "Community Team"
  );
  assert.equal(buildStreamerPanelFooter({ ...defaultStreamerPanelConfig(), footerText: "" }), "");
});

test("branding cannot be overridden through API requests", () => {
  const hijack = parseStreamerPanelConfig({
    ...defaultStreamerPanelConfig(),
    footerText: "Owned by Evil Corp",
    branding: "Powered by Evil",
    footer: { text: "hijacked" },
    description: "Please ignore the footer"
  });
  assert.equal(hijack.ok, true);
  assert.equal(hijack.value.branding, undefined, "unknown branding fields are dropped");
  assert.equal(hijack.value.footer, undefined, "unknown footer objects are dropped");
  assert.equal(buildStreamerPanelFooter(hijack.value), "Owned by Evil Corp");
  const embed = streamerPanelEmbed(env, hijack.value);
  assert.equal(embed.footer.text, "Owned by Evil Corp");
  assert.ok(embed.description.includes(STREAMER_PANEL_BRANDING_LINKED));
  // Custom footer text never smuggles in a second branding line:
  const mimic = parseStreamerPanelConfig({ ...defaultStreamerPanelConfig(), footerText: "Powered by Evil • PLAY TOGETHER" });
  assert.equal(buildStreamerPanelFooter(mimic.value), "Powered by Evil • PLAY TOGETHER");
  assert.ok(!buildStreamerPanelFooter(mimic.value).includes(STREAMER_PANEL_BRANDING));
});

// ---------------------------------------------------------------------------
// Save / reset / publish / update behavior
// ---------------------------------------------------------------------------

test("reset to default restores the template without touching the published message", () => {
  const reset = fn("resetStreamerPanelConfig");
  assert.match(reset, /defaultStreamerPanelConfig\(\)/);
  assert.match(reset, /writeBotConfig\(env,STREAMER_PANEL_CONFIG_KEY\(guildId\),config\)/);
  assert.doesNotMatch(reset, /STREAMER_PANEL_KEY\(guildId\)/, "reset never clears published-message tracking");
  const resetUi = uiSrc.match(/resetPanelConfig=async\(\)=>\{[\s\S]{0,400}/);
  assert.ok(resetUi);
  assert.match(resetUi[0], /window\.confirm\("Reset the Streamer Info Panel to the default template\?/);
  // Resetting only affects customizable fields — branding lives in the description:
  const defaults = defaultStreamerPanelConfig();
  assert.equal(buildStreamerPanelFooter(defaults), "");
});

test("publish sends the saved customization; duplicate panels and deleted messages are handled", () => {
  const publish = fn("publishStreamerPanel");
  assert.match(publish, /loadStreamerPanelConfig\(env,guildId\)/);
  assert.match(publish, /streamerPanelPayload\(env,config\)/);
  assert.match(publish, /already published in this server\. Use Update Panel\./, "no duplicate panels while the message exists");
  const update = fn("updateStreamerPanel");
  assert.match(update, /loadStreamerPanelConfig\(env,guildId\)/);
  assert.match(update, /streamerPanelPayload\(env,config\)/);
  assert.match(update, /discordAnnouncementGone/, "deleted/missing Discord message is detected");
  assert.match(update, /writeStreamerPanel\(env,guildId,defaultStreamerPanel\(\)\)/, "stale message tracking is cleared");
  assert.match(update, /Publish the panel again/, "recovery path is surfaced to the user");
});

test("state endpoint returns the saved config so refresh/navigation restore it", () => {
  assert.match(workerSrc, /async function streamerPanelState\([\s\S]{0,400}loadStreamerPanelConfig\(env,guildId\)/);
  assert.match(workerSrc, /config,\r?\n\s*defaults:defaultStreamerPanelConfig\(\),/);
  assert.match(workerSrc, /embed:streamerPanelEmbed\(env,config\)/);
});

// ---------------------------------------------------------------------------
// UI: edit/save/reset/publish wiring, live preview, no YouTube regressions
// ---------------------------------------------------------------------------

test("Streamers UI offers Edit Panel, live preview, Save, Reset and dirty-change guards", () => {
  assert.match(uiSrc, /Edit Panel/);
  assert.match(uiSrc, /Reset to default/);
  assert.match(uiSrc, /\/api\/streamers\/panel\/config\?guildId=/);
  assert.match(uiSrc, /setPanelDraft\(normalizeStreamerPanelConfig\(x\.config\)\)/);
  assert.match(uiSrc, /Save your changes before publishing\./, "unsaved changes are never silently discarded");
  assert.match(uiSrc, /Discard unsaved panel changes\?/);
  assert.match(uiSrc, /useEffect\(\(\)=>\{setPanelDraft\(null\);setPanelEditing\(false\);setPanelDirty\(false\)\},\[selectedGuild\]\)/);
  // Live preview composes from the draft immediately:
  assert.match(uiSrc, /composeStreamerPanelDescription\(draft\)/);
  assert.match(uiSrc, /buildStreamerPanelFooter\(draft\)/);
  assert.match(uiSrc, /borderLeftColor:previewColor/);
  assert.match(uiSrc, /STREAMER_PANEL_BRANDING_URL/);
  assert.match(uiSrc, />Bot\.BalticM\.eu<\/a>/);
  // Discord-compatible limits are enforced in the editor inputs:
  for (const max of [256, 4000, 2000, 1500, 80, 512]) assert.ok(uiSrc.includes(`maxLength={${max}}`), `maxLength={${max}}`);
  // Panel card block stays free of YouTube references:
  const start = uiSrc.indexOf("streamerPanelCard");
  const end = uiSrc.indexOf("STREAMER_PANEL_BOT_PERMISSION_ERROR", start);
  assert.ok(start >= 0 && end > start, "panel card block found");
  assert.doesNotMatch(uiSrc.slice(start, end), /youtube/i);
});

test("mobile layout: panel, editor and controls collapse without horizontal overflow", () => {
  // Preview and controls go full-width / single column on small screens:
  assert.match(styleSrc, /@media\(max-width:767px\)\{\.streamersPage \.streamerPanelCard \.panelEmbed\{max-width:100%\}/);
  assert.match(styleSrc, /\.streamersPage \.streamersForm \.voiceConfigGrid\{grid-template-columns:minmax\(0,1fr\)\}/);
  // Editor stacks vertically and every flexible track allows shrinking to 0:
  assert.match(styleSrc, /\.panelEditor\{display:flex;flex-direction:column;gap:14px;min-width:0\}/);
  assert.match(styleSrc, /\.panelEmbed\{[^}]*max-width:560px;min-width:0/);
  assert.match(styleSrc, /\.panelEmbedDesc\{[^}]*white-space:pre-line;overflow-wrap:anywhere/);
  assert.match(styleSrc, /\.panelColorInput\{width:100%/);
  assert.match(styleSrc, /\.panelHeadActions\{display:flex;align-items:center;gap:10px;flex-wrap:wrap\}/);
});
