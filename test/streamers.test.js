import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCESS_CONFIGURE,
  ACCESS_NONE,
  ACCESS_OPERATE,
  accessLevelFromRoles,
  levelMeets,
  normalizeAccessConfig,
  requiredLevelForRequest,
  routeAccessKey
} from "../access-control.js";
import {
  STREAMER_STATUS,
  applyLiveCheckToRow,
  buildLiveAnnouncementPayload,
  checkProviderLive,
  duplicateStreamerError,
  liveDetectionAvailable,
  normalizeStreamerIdentity,
  parseStreamerConfigBody,
  parseProfileStreamingBody,
  providerCapabilities,
  profileStreamingDuplicateError,
  shouldAnnounceLive,
  shouldDeleteLiveAnnouncement,
  shouldIncludeProfileAccountInGuild,
  shouldPauseAutoStreamerAutomation,
  shouldRemoveAutoGuildParticipation,
  autoStreamerRowsForGuilds,
  decideProfileStreamingMutation,
  decideStreamerStudioMutation,
  discordAnnouncementGone,
  streamerAnnouncementError,
  streamerPublicView,
  summarizeStreamerStats
} from "../streamers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workerSrc = readFileSync(join(root, "worker.js"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");
const ROLE = "111111111111111111";
const GUILD_A = "100000000000000001";
const GUILD_B = "200000000000000002";

test("RBAC NO ACCESS / OPERATE / CONFIGURE for streamers", () => {
  const none = normalizeAccessConfig({ roles: [{ roleId: ROLE, permissions: { streamers: ACCESS_NONE } }] }).roles;
  const operate = normalizeAccessConfig({ roles: [{ roleId: ROLE, permissions: { streamers: ACCESS_OPERATE } }] }).roles;
  const configure = normalizeAccessConfig({ roles: [{ roleId: ROLE, permissions: { streamers: ACCESS_CONFIGURE } }] }).roles;
  assert.equal(accessLevelFromRoles(none, [ROLE], "streamers"), ACCESS_NONE);
  assert.equal(accessLevelFromRoles(operate, [ROLE], "streamers"), ACCESS_OPERATE);
  assert.equal(accessLevelFromRoles(configure, [ROLE], "streamers"), ACCESS_CONFIGURE);
  assert.equal(levelMeets(ACCESS_NONE, ACCESS_OPERATE), false);
  assert.equal(levelMeets(ACCESS_OPERATE, ACCESS_OPERATE), true);
  assert.equal(levelMeets(ACCESS_OPERATE, ACCESS_CONFIGURE), false);
  assert.equal(levelMeets(ACCESS_CONFIGURE, ACCESS_CONFIGURE), true);
});

test("OPERATE cannot Add/Edit/Remove; CONFIGURE can manage streamer configuration", () => {
  assert.equal(requiredLevelForRequest("/api/streamers", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/streamers/refresh", "POST"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/streamers/x/check", "POST"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/streamers", "POST"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/streamers/x", "PUT"), ACCESS_CONFIGURE);
  assert.equal(requiredLevelForRequest("/api/streamers/x", "DELETE"), ACCESS_CONFIGURE);
  assert.equal(routeAccessKey("/api/streamers/x"), "streamers");
});

test("guild isolation and cross-guild ID attempts", () => {
  const guildA = normalizeAccessConfig({ roles: [{ roleId: ROLE, permissions: { streamers: ACCESS_CONFIGURE } }] }).roles;
  assert.equal(accessLevelFromRoles(guildA, [ROLE], "streamers"), ACCESS_CONFIGURE);
  assert.notEqual(GUILD_A, GUILD_B);
  assert.match(workerSrc, /SELECT \* FROM streamers WHERE guild_id=\?/);
  assert.match(workerSrc, /if\(body\.guildId&&String\(body\.guildId\)!==String\(guildId\)\)return json\(\{error:"Forbidden"\},403\)/);
  assert.match(workerSrc, /SELECT \* FROM streamers WHERE id=\? AND guild_id=\?/);
  assert.match(workerSrc, /DELETE FROM streamers WHERE id=\? AND guild_id=\?/);
});

test("provider normalization/validation", () => {
  assert.equal(normalizeStreamerIdentity("twitch", "https://www.twitch.tv/Example_User").providerUserId, "example_user");
  assert.equal(normalizeStreamerIdentity("kick", "https://kick.com/DemoKick").ok, true);
  assert.equal(normalizeStreamerIdentity("tiktok", "https://www.tiktok.com/@clip.daily").displayName, "@clip.daily");
  assert.equal(normalizeStreamerIdentity("youtube", "https://www.youtube.com/@BalticLive").ok, true);
  assert.equal(normalizeStreamerIdentity("twitch", "nope!").ok, false);
  assert.equal(normalizeStreamerIdentity("youtube", "https://www.youtube.com/watch?v=dQw4w9wgGcQ").ok, false);
});

test("duplicate streamer prevention", () => {
  const a = parseStreamerConfigBody({
    provider: "twitch",
    channel: "samecaster",
    discordMemberId: "111111111111111111",
    announcementChannelId: "222222222222222222"
  });
  const b = parseStreamerConfigBody({
    provider: "twitch",
    channel: "https://twitch.tv/SameCaster",
    discordMemberId: "111111111111111111",
    announcementChannelId: "222222222222222222"
  });
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.value.providerUserId, b.value.providerUserId);
  assert.match(duplicateStreamerError(), /already configured/i);
  assert.match(workerSrc, /provider=\? AND provider_user_id=\?/);
});

test("OFFLINE → LIVE transition announces once per session", () => {
  const row = { autoAnnounce: true, enabled: true, lastAnnouncedSessionId: "" };
  const live = { status: STREAMER_STATUS.LIVE, sessionId: "sess-1" };
  assert.equal(shouldAnnounceLive(row, live), true);
  assert.equal(shouldAnnounceLive({ ...row, lastAnnouncedSessionId: "sess-1" }, live), false);
  assert.equal(shouldAnnounceLive({ ...row, lastAnnouncedSessionId: "sess-1" }, { status: STREAMER_STATUS.LIVE, sessionId: "sess-2" }), true);
  assert.equal(shouldAnnounceLive(row, { status: STREAMER_STATUS.OFFLINE, sessionId: "" }), false);
});

test("same live session is not announced twice; new future session can announce again", () => {
  const first = shouldAnnounceLive({ autoAnnounce: true, enabled: true, lastAnnouncedSessionId: "" }, { status: "live", sessionId: "abc" });
  const again = shouldAnnounceLive({ autoAnnounce: true, enabled: true, lastAnnouncedSessionId: "abc" }, { status: "live", sessionId: "abc" });
  const next = shouldAnnounceLive({ autoAnnounce: true, enabled: true, lastAnnouncedSessionId: "abc" }, { status: "live", sessionId: "def" });
  assert.equal(first, true);
  assert.equal(again, false);
  assert.equal(next, true);
});

test("missing provider credentials keep detection unavailable", () => {
  const twitch = liveDetectionAvailable("twitch", {});
  const youtube = liveDetectionAvailable("youtube", {});
  const kick = liveDetectionAvailable("kick", {});
  assert.equal(twitch.available, false);
  assert.equal(youtube.available, false);
  assert.equal(kick.available, false);
  assert.match(twitch.detail, /TWITCH_CLIENT_ID/);
  const ready = liveDetectionAvailable("twitch", { TWITCH_CLIENT_ID: "id", TWITCH_CLIENT_SECRET: "secret" });
  assert.equal(ready.available, true);
});

test("provider failure isolation does not fake LIVE or OFFLINE", async () => {
  const failed = await checkProviderLive("twitch", { providerLogin: "x", watchUrl: "https://www.twitch.tv/x" }, { TWITCH_CLIENT_ID: "id", TWITCH_CLIENT_SECRET: "secret" }, async () => {
    throw new Error("network down");
  });
  assert.equal(failed.status, STREAMER_STATUS.UNKNOWN);
  assert.notEqual(failed.status, STREAMER_STATUS.LIVE);
  assert.notEqual(failed.status, STREAMER_STATUS.OFFLINE);
});

test("deleted announcement channel and Discord permission errors are mapped", () => {
  assert.match(workerSrc, /The Discord announcement channel no longer exists/);
  assert.match(streamerAnnouncementError(403, { code: 50013 }), /View Channel, Send Messages, and Embed Links/);
  assert.match(streamerAnnouncementError(404, { code: 10003 }), /no longer exists/);
});

test("UTF-8 / emoji in announcement payload", () => {
  const payload = buildLiveAnnouncementPayload({
    streamer: { provider: "twitch", customMessage: "Sveiki 🇱🇻 • Glück 🔥 • Привет" },
    memberName: "Āriņš",
    check: { title: "Nakts spēle 🎮", category: "Just Chatting", watchUrl: "https://www.twitch.tv/demo", viewerCount: 12 }
  });
  const text = JSON.stringify(payload);
  assert.match(text, /Āriņš/);
  assert.match(text, /🇱🇻/);
  assert.match(text, /Привет/);
  assert.match(text, /🎮/);
  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.equal(payload.components[0].components[0].label, "WATCH STREAM");
});

test("TikTok and other unsupported automatic detection never produce fake LIVE", async () => {
  const tiktok = await checkProviderLive("tiktok", { displayName: "@demo", watchUrl: "https://www.tiktok.com/@demo/live" }, {});
  assert.equal(tiktok.status, STREAMER_STATUS.UNKNOWN);
  assert.notEqual(tiktok.status, STREAMER_STATUS.LIVE);
  assert.notEqual(tiktok.status, STREAMER_STATUS.OFFLINE);
  const view = streamerPublicView({
    id: "1",
    guild_id: GUILD_A,
    provider: "tiktok",
    provider_user_id: "demo",
    provider_login: "demo",
    display_name: "@demo",
    profile_url: "",
    watch_url: "https://www.tiktok.com/@demo/live",
    discord_member_id: "1",
    announcement_channel_id: "2",
    auto_announce: 1,
    enabled: 1,
    custom_message: "",
    live_status: "offline",
    stream_title: "",
    stream_category: "",
    viewer_count: null,
    thumbnail_url: "",
    profile_image_url: "",
    session_id: "",
    last_announced_session_id: "",
    last_checked_at: "",
    last_error: "",
    created_at: "",
    updated_at: ""
  }, { env: {} });
  assert.equal(view.liveStatus, STREAMER_STATUS.UNKNOWN);
  assert.equal(view.liveDetectionAvailable, false);
});

test("applyLiveCheck keeps unknown distinct from offline", () => {
  const next = applyLiveCheckToRow({ displayName: "x", watchUrl: "https://www.twitch.tv/x" }, { status: "unknown", error: "rate limited" });
  assert.equal(next.liveStatus, "unknown");
  assert.equal(next.sessionId, "");
});

test("stats and capabilities", () => {
  const stats = summarizeStreamerStats([
    { liveStatus: "live", autoAnnounce: true },
    { liveStatus: "offline", autoAnnounce: false },
    { liveStatus: "unknown", autoAnnounce: true }
  ]);
  assert.equal(stats.managed, 3);
  assert.equal(stats.live, 1);
  assert.equal(stats.offline, 1);
  assert.equal(stats.unknown, 1);
  assert.equal(stats.announcements, 2);
  const caps = providerCapabilities({});
  assert.deepEqual(caps.map((p) => p.id), ["twitch", "youtube", "kick", "tiktok"]);
  assert.equal(caps.find((p) => p.id === "tiktok").liveDetectionAvailable, false);
});

test("Streamers APIs stay JSON and never fall through to SPA HTML", () => {
  assert.match(workerSrc, /if\(p\.startsWith\("\/api\/"\)\)\{try\{/);
  assert.match(workerSrc, /catch\(e\)\{return json\(\{error:"Request failed"\},500\)\}/);
  assert.match(workerSrc, /ids\.slice\(i,i\+chunkSize\)/);
  assert.match(workerSrc, /if\(p==="\/api\/streamers\/self"\)/);
  assert.match(workerSrc, /if\(p==="\/api\/streamers\/settings"\)/);
  assert.match(workerSrc, /if\(p==="\/api\/streamers\/refresh"&&req\.method==="POST"\)/);
  assert.match(workerSrc, /if\(!st\[2\]&&req\.method==="DELETE"\)return deleteStreamer[\s\S]*?return json\(\{error:"Method not allowed"\},405\);\}/);
  assert.match(workerSrc, /Could not load streamers/);
  const streamersUi = readFileSync(join(root, "src/Streamers.jsx"), "utf8");
  assert.match(streamersUi, /async function readApiJson/);
  assert.match(streamersUi, /application\/json/);
  assert.match(streamersUi, /trimmed\.startsWith\("<"\)/);
  assert.equal(streamersUi.includes("await r.json()"), false);
  assert.match(streamersUi, /\/api\/streamers\/refresh/);
});

test("worker polls streamers and UI mounts under STUDIO", () => {
  assert.match(workerSrc, /pollAllStreamers\(env\)/);
  assert.match(workerSrc, /"streamers"/);
  const stateSrc = readFileSync(join(root, "src/control-center-state.js"), "utf8");
  assert.match(mainSrc, /\["Streamers",Radio\]/);
  assert.match(stateSrc, /Streamers:\s*"streamers"/);
  assert.match(mainSrc, /pageFromPath\(/);
  assert.match(mainSrc, /pathFromPage\(/);
  const streamersUi = readFileSync(join(root, "src/Streamers.jsx"), "utf8");
  assert.match(streamersUi, /StreamerMemberSelect/);
  assert.match(streamersUi, /TicketOptionSelect id="st-platform"/);
  assert.match(streamersUi, /TicketOptionSelect id="st-channel"/);
  assert.match(streamersUi, /search flip/);
  assert.match(streamersUi, /StreamerSelfService/);
  assert.match(streamersUi, /AUTO — PREMIUM/);
  assert.match(streamersUi, /OWNER ADDED/);
  assert.match(streamersUi, /Connect \{label\}/);
  assert.match(streamersUi, /Connect to verify/);
  assert.match(streamersUi, /StreamingStatusBadge/);
  assert.match(streamersUi, /NOT CONNECTED/);
  assert.match(streamersUi, /<StreamingStatusBadge on>CONNECTED<\/StreamingStatusBadge>/);
  assert.match(streamersUi, /\/api\/profile\/streaming/);
  assert.match(mainSrc, /StreamerSelfService/);
  assert.match(workerSrc, /user_streaming_accounts/);
  assert.match(workerSrc, /syncAutoStreamersForGuild/);
});

test("NON-PREMIUM studio mutations are Discord Server Owner only", () => {
  assert.equal(decideStreamerStudioMutation({ isOwner: true, premium: false, canConfigure: false }).ok, true);
  assert.equal(decideStreamerStudioMutation({ isOwner: false, premium: false, canConfigure: true }).ok, false);
  assert.equal(decideStreamerStudioMutation({ isOwner: false, premium: true, canConfigure: true }).ok, true);
  assert.equal(decideStreamerStudioMutation({ isOwner: false, premium: true, canConfigure: false }).ok, false);
});

test("global Profile streaming accounts are one per platform per Discord user", () => {
  const actor = "333333333333333333";
  const ok = parseProfileStreamingBody({ provider: "twitch", channel: "mine" }, actor);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.discordUserId, actor);
  assert.equal(parseProfileStreamingBody({ provider: "twitch", channel: "mine", discordMemberId: "444444444444444444" }, actor).ok, false);
  assert.equal(parseProfileStreamingBody({ provider: "twitch", channel: "mine", discordMemberId: "444444444444444444" }, actor).status, 403);
  assert.equal(parseProfileStreamingBody({ provider: "youtube", channel: "@x", announcementChannelId: "222222222222222222" }, actor).ok, false);
  assert.equal(parseProfileStreamingBody({ provider: "kick", channel: "x", guildId: GUILD_A }, actor).ok, false);
  assert.equal(parseProfileStreamingBody({ provider: "youtube", channel: "@LiveOne" }, actor).ok, true);
  assert.equal(parseProfileStreamingBody({ provider: "tiktok", channel: "@clip.daily" }, actor).ok, true);
  assert.equal(parseProfileStreamingBody({ provider: "kick", channel: "kickuser" }, actor).ok, true);
  assert.equal(decideProfileStreamingMutation({ actorId: actor, targetUserId: actor }).ok, true);
  assert.equal(decideProfileStreamingMutation({ actorId: actor, targetUserId: "444444444444444444" }).ok, false);
  assert.match(profileStreamingDuplicateError(), /already have a streaming account/i);
});

test("Premium guilds auto-include Profile accounts; non-Premium does not", () => {
  const user = "333333333333333333";
  const accounts = [
    { discordUserId: user, provider: "twitch" },
    { discordUserId: user, provider: "youtube" },
    { discordUserId: user, provider: "tiktok" },
    { discordUserId: user, provider: "kick" }
  ];
  const rows = autoStreamerRowsForGuilds({
    accounts,
    guilds: [
      { id: GUILD_A, premium: true, memberIds: [user] },
      { id: GUILD_B, premium: true, memberIds: [user] },
      { id: "300000000000000003", premium: false, memberIds: [user] }
    ]
  });
  assert.equal(rows.filter((r) => r.guildId === GUILD_A).length, 4);
  assert.equal(rows.filter((r) => r.guildId === GUILD_B).length, 4);
  assert.equal(rows.filter((r) => r.guildId === "300000000000000003").length, 0);
  assert.equal(shouldIncludeProfileAccountInGuild({ premium: true, isMember: true, verified: false }), false);
  assert.equal(shouldIncludeProfileAccountInGuild({ premium: true, isMember: true, verified: true }), true);
  assert.equal(shouldIncludeProfileAccountInGuild({ premium: false, isMember: true }), false);
  assert.equal(shouldIncludeProfileAccountInGuild({ premium: true, isMember: false }), false);
  const duped = autoStreamerRowsForGuilds({
    accounts: accounts.concat(accounts),
    guilds: [{ id: GUILD_A, premium: true, memberIds: [user] }]
  });
  assert.equal(duped.length, 4);
});

test("Premium expiration pauses auto inclusion without deleting Profile links", () => {
  const autoRow = { source: "auto", enabled: 1 };
  const ownerRow = { source: "owner", enabled: 1 };
  assert.equal(shouldPauseAutoStreamerAutomation(autoRow, false), true);
  assert.equal(shouldPauseAutoStreamerAutomation(autoRow, true), false);
  assert.equal(shouldPauseAutoStreamerAutomation(ownerRow, false), false);
  assert.equal(shouldRemoveAutoGuildParticipation({ source: "auto", isMember: false }), true);
  assert.equal(shouldRemoveAutoGuildParticipation({ source: "auto", isMember: true }), false);
  assert.equal(shouldRemoveAutoGuildParticipation({ source: "owner", isMember: false }), false);
  assert.match(workerSrc, /DELETE FROM user_streaming_accounts WHERE discord_user_id/);
  assert.match(workerSrc, /source IN \('auto','self'\)/);
});

test("guild-specific LIVE announcement state stays isolated", () => {
  assert.match(workerSrc, /UPDATE streamers SET announcement_message_id=\?,announcement_delete_attempts=0,updated_at=\? WHERE id=\? AND guild_id=\?/);
  assert.match(workerSrc, /last_announced_session_id!=\?/);
  const a = shouldAnnounceLive({ autoAnnounce: true, enabled: true, lastAnnouncedSessionId: "sess-a" }, { status: "live", sessionId: "sess-a" });
  const b = shouldAnnounceLive({ autoAnnounce: true, enabled: true, lastAnnouncedSessionId: "" }, { status: "live", sessionId: "sess-a" });
  assert.equal(a, false);
  assert.equal(b, true);
});

test("LIVE → OFFLINE deletes announcement; UNKNOWN/timeout/429/credentials do not", () => {
  assert.equal(shouldDeleteLiveAnnouncement({ announcementMessageId: "9", nextStatus: "offline", liveDetection: true }), true);
  assert.equal(shouldDeleteLiveAnnouncement({ announcementMessageId: "9", nextStatus: "unknown", liveDetection: false }), false);
  assert.equal(shouldDeleteLiveAnnouncement({ announcementMessageId: "9", nextStatus: "offline", liveDetection: false }), false);
  assert.equal(shouldDeleteLiveAnnouncement({ announcementMessageId: "", nextStatus: "offline", liveDetection: true }), false);
  assert.equal(discordAnnouncementGone(404, { code: 10008 }), true);
  assert.equal(discordAnnouncementGone(403, {}), false);
  assert.match(workerSrc, /announcement_message_id/);
  assert.match(workerSrc, /last_announced_session_id!=\?/);
});
