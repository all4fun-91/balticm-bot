import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESS_CONFIGURE, ACCESS_OPERATE, requiredLevelForRequest, routeAccessKey } from "../access-control.js";
import {
  STREAMER_PANEL_BRANDING,
  STREAMER_PANEL_BRANDING_LINKED,
  STREAMER_PANEL_KEY,
  STREAMER_EMBED_COLOR,
  defaultStreamerPanel,
  streamerPanelEmbed,
  streamerPanelManageUrl,
  streamerPanelPayload,
  streamerPanelSendableChannels
} from "../streamers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const uiSrc = readFileSync(join(root, "src/Streamers.jsx"), "utf8");

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const ADMINISTRATOR = 1n << 3n;
const ALL_THREE = String(VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS);

test("streamer panel embed matches the BalticM template without YouTube", () => {
  const embed = streamerPanelEmbed({ PUBLIC_APP_URL: "https://bot.balticm.eu" });
  assert.equal(embed.title, "🎥 BalticM Streamers");
  assert.equal(embed.color, STREAMER_EMBED_COLOR);
  // The fixed branding line renders exactly once: it lives in the description
  // (linked) and the footer never repeats it.
  assert.equal(embed.footer, undefined, "no footer is sent when there is no custom footer text");
  const payload = streamerPanelPayload({ PUBLIC_APP_URL: "https://bot.balticm.eu" });
  const rendered = JSON.stringify(payload).split(STREAMER_PANEL_BRANDING_LINKED).join(STREAMER_PANEL_BRANDING);
  assert.equal(rendered.split(STREAMER_PANEL_BRANDING).length - 1, 1, "branding line appears exactly once in the payload");
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
  assert.doesNotMatch(embed.title + embed.description + (embed.footer?.text || ""), /youtube/i);
});

test("manage button URL comes from project configuration, never a hardcoded host", () => {
  assert.equal(streamerPanelManageUrl({ PUBLIC_APP_URL: "https://bot.balticm.eu" }), "https://bot.balticm.eu/profile");
  assert.equal(streamerPanelManageUrl({ PUBLIC_APP_URL: "https://bot.balticm.eu/" }), "https://bot.balticm.eu/profile");
  assert.equal(streamerPanelManageUrl({}), "");
  const payload = streamerPanelPayload({ PUBLIC_APP_URL: "https://bot.balticm.eu" });
  assert.equal(payload.components[0].type, 1);
  const button = payload.components[0].components[0];
  assert.equal(button.type, 2, "Discord buttons are component type 2 (link style is 5)");
  assert.equal(button.style, 5);
  assert.equal(button.label, "🎥 Manage Streaming Accounts");
  assert.equal(button.url, "https://bot.balticm.eu/profile");
  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.equal(payload.embeds[0].title, "🎥 BalticM Streamers");
  assert.equal(streamerPanelPayload({}).components[0].components[0].url, "");
});

test("panel storage keys are scoped per guild and default to unpublished", () => {
  const guildA = "111111111111111111";
  const guildB = "222222222222222222";
  assert.equal(STREAMER_PANEL_KEY(guildA), "streamers-panel:" + guildA);
  assert.notEqual(STREAMER_PANEL_KEY(guildA), STREAMER_PANEL_KEY(guildB));
  const fresh = defaultStreamerPanel();
  assert.equal(fresh.channelId, "");
  assert.equal(fresh.messageId, "");
});

test("sendable channel filter keeps only channels where the bot can post", () => {
  const channels = [
    { id: "1", name: "general", type: 0, permission_overwrites: [] },
    { id: "2", name: "voice-lounge", type: 2, permission_overwrites: [] },
    { id: "3", name: "no-send", type: 0, permission_overwrites: [{ id: "guild", type: 0, allow: "0", deny: String(SEND_MESSAGES) }] },
    { id: "4", name: "announcements", type: 5, permission_overwrites: [] },
    { id: "5", name: "no-view", type: 0, permission_overwrites: [{ id: "guild", type: 0, allow: "0", deny: String(VIEW_CHANNEL) }] }
  ];
  const roles = [{ id: "guild", permissions: ALL_THREE }];
  const kept = streamerPanelSendableChannels(channels, { roles, memberRoleIds: [], memberId: "bot", everyoneId: "guild" });
  assert.deepEqual(kept.map(c => c.id), ["1", "4"]);
  const admin = streamerPanelSendableChannels(
    [channels[2]],
    { roles: [{ id: "guild", permissions: "0" }, { id: "r1", permissions: String(ADMINISTRATOR) }], memberRoleIds: ["r1"], memberId: "bot", everyoneId: "guild" }
  );
  assert.deepEqual(admin.map(c => c.id), ["3"]);
  assert.deepEqual(streamerPanelSendableChannels(channels, {}), []);
});

test("panel routes are guild-gated, configured-level, and wired into the worker", () => {
  assert.equal(routeAccessKey("/api/streamers/panel"), "streamers");
  assert.equal(requiredLevelForRequest("/api/streamers/panel", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/streamers/panel", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/streamers/panel", "PUT"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/streamers/panel", "DELETE"), ACCESS_CONFIGURE);
  assert.match(workerSrc, /if\(p==="\/api\/streamers\/panel"\)\{/);
  assert.match(workerSrc, /if\(p==="\/api\/streamers\/panel"\)\{[\s\S]{0,400}canManageGuild\(user,guildId\)/);
  for (const fn of ["publishStreamerPanel", "updateStreamerPanel", "deleteStreamerPanel"]) {
    assert.match(workerSrc, new RegExp(`async function ${fn}\\(`));
    assert.match(workerSrc, new RegExp(`async function ${fn}\\([\\s\\S]{0,300}streamerStudioGate\\(env,user,guildId\\)`));
  }
  assert.match(workerSrc, /id==="refresh"\|\|id==="self"\|\|id==="settings"\|\|id==="panel"/);
  assert.match(workerSrc, /writeBotConfig\(env,STREAMER_PANEL_KEY\(guildId\)/);
  assert.match(workerSrc, /readBotConfig\(env,STREAMER_PANEL_KEY\(guildId\)/);
});

test("the panel UI renders on the Streamers page without YouTube", () => {
  assert.match(uiSrc, /Streamer Info Panel/);
  assert.match(uiSrc, /\/api\/streamers\/panel\?guildId=/);
  assert.match(uiSrc, /Publish Panel/);
  assert.match(uiSrc, /Update Panel/);
  assert.match(uiSrc, /Delete Panel/);
  assert.match(uiSrc, /Not Published/);
  assert.match(uiSrc, /Manage Streaming Accounts/);
  const start = uiSrc.indexOf("streamerPanelCard");
  const end = uiSrc.indexOf("STREAMER_PANEL_BOT_PERMISSION_ERROR", start);
  assert.ok(start >= 0 && end > start, "panel card block not found");
  assert.doesNotMatch(uiSrc.slice(start, end), /youtube/i);
});
