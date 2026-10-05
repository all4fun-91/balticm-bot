import assert from "node:assert/strict";
import test from "node:test";

import { adminNameGaps, applyAdminLogNames, applyAdminPaymentNames, buildAdminNameMaps } from "../admin-names.js";
import { logRowFromActivity, logRowFromSupportMessage, logRowFromVipCodeRedeem, makeLogRow } from "../admin-logs.js";

const USER = "293469802188636160";
const GUILD = "884027552174317569";
const OTHER_USER = "111111111111111111";
const OTHER_GUILD = "222222222222222222";

test("stored log sources carry readable actor names alongside the raw id", () => {
  const activity = logRowFromActivity({
    id: "a1",
    actorId: USER,
    actorName: "MiersBerzins ツ♡",
    action: "VIP extend",
    source: "ADMIN",
    guildId: GUILD
  });
  assert.equal(activity.actorLabel, "MiersBerzins ツ♡");
  assert.equal(activity.actorDiscordId, USER);

  const support = logRowFromSupportMessage({
    id: "m1",
    senderId: USER,
    senderName: "MiersBerzins ツ♡",
    threadId: "t1",
    guildId: GUILD,
    guildName: "Baltic | Mayhem"
  });
  assert.equal(support.actorLabel, "MiersBerzins ツ♡");
  assert.equal(support.guildLabel, "Baltic | Mayhem");

  const redeem = logRowFromVipCodeRedeem({
    id: "r1",
    discordUserId: USER,
    discordUsername: "MiersBerzins ツ♡",
    guildId: GUILD,
    guildName: "Baltic | Mayhem"
  });
  assert.equal(redeem.actorLabel, "MiersBerzins ツ♡");
  assert.equal(redeem.guildLabel, "Baltic | Mayhem");
});

test("name maps fill unresolved ids and unknown ids fall back to the raw id", () => {
  const maps = buildAdminNameMaps([{ id: USER, name: "MiersBerzins ツ♡" }], [{ id: GUILD, name: "Baltic | Mayhem" }]);
  const rows = [
    makeLogRow({ id: "x", actorDiscordId: USER, guildId: GUILD }),
    makeLogRow({ id: "y", actorDiscordId: OTHER_USER, guildId: OTHER_GUILD })
  ];
  applyAdminLogNames(rows, maps);
  assert.equal(rows[0].actorLabel, "MiersBerzins ツ♡");
  assert.equal(rows[0].guildLabel, "Baltic | Mayhem");
  // Graceful fallback: nothing resolved, raw id stays the value the UI shows.
  assert.equal(rows[1].actorLabel, "");
  assert.equal(rows[1].guildLabel, "");
  assert.equal(rows[1].actorDiscordId, OTHER_USER);
  assert.equal(rows[1].guildId, OTHER_GUILD);
});

test("only unresolved snowflakes are reported as lookup gaps", () => {
  const maps = buildAdminNameMaps([{ id: USER, name: "MiersBerzins ツ♡" }], [{ id: GUILD, name: "Baltic | Mayhem" }]);
  const rows = [
    makeLogRow({ id: "x", actorDiscordId: USER, guildId: GUILD }),
    makeLogRow({ id: "y", actorDiscordId: OTHER_USER, guildId: OTHER_GUILD }),
    makeLogRow({ id: "z" })
  ];
  applyAdminLogNames(rows, maps);
  assert.deepEqual(adminNameGaps(rows, "log"), { userIds: [OTHER_USER], guildIds: [OTHER_GUILD] });
});

test("tebex payment rows resolve user and server names", () => {
  const maps = buildAdminNameMaps([{ id: USER, name: "MiersBerzins ツ♡" }], [{ id: GUILD, name: "Baltic | Mayhem" }]);
  const rows = [{ discordUserId: USER, guildId: GUILD, discordUserName: "", guildName: "" }];
  applyAdminPaymentNames(rows, maps);
  assert.equal(rows[0].discordUserName, "MiersBerzins ツ♡");
  assert.equal(rows[0].guildName, "Baltic | Mayhem");
  assert.deepEqual(adminNameGaps(rows, "payment"), { userIds: [], guildIds: [] });
});

test("blank or id-shaped names are never treated as display names", () => {
  const maps = buildAdminNameMaps(
    [
      { id: USER, name: "" },
      { id: "", name: "Nobody" },
      { id: OTHER_USER, name: OTHER_USER }
    ],
    [{ id: OTHER_GUILD, name: OTHER_GUILD }]
  );
  assert.equal(maps.users.size, 0);
  assert.equal(maps.guilds.size, 0);
  assert.equal(buildAdminNameMaps([], [{ id: GUILD, name: "Baltic | Mayhem" }]).guilds.get(GUILD), "Baltic | Mayhem");
});

test("known snowflake references get a readable label, everything else stays raw", () => {
  const maps = buildAdminNameMaps([{ id: USER, name: "MiersBerzins ツ♡" }], [{ id: GUILD, name: "Baltic | Mayhem" }]);
  const rows = [
    makeLogRow({ id: "a", guildId: GUILD, reference: GUILD }),
    makeLogRow({ id: "b", guildId: GUILD, reference: USER }),
    makeLogRow({ id: "c", guildId: GUILD, reference: OTHER_GUILD }),
    makeLogRow({ id: "d", guildId: GUILD, reference: "tbx-123" })
  ];
  applyAdminLogNames(rows, maps);
  assert.equal(rows[0].referenceLabel, "Baltic | Mayhem");
  assert.equal(rows[1].referenceLabel, "MiersBerzins ツ♡");
  assert.equal(rows[2].referenceLabel, "", "unknown snowflake falls back to the raw id");
  assert.equal(rows[2].reference, OTHER_GUILD);
  assert.equal(rows[3].referenceLabel, "", "non-discord references are left untouched");
  assert.equal(rows[3].reference, "tbx-123");
});

test("remote name lookups are bounded, cached and fail soft", async () => {
  const { resolveAdminRemoteNames } = await import("../worker.js");
  const realFetch = globalThis.fetch;
  const calls = [];
  const R_USER = "313131313131313131";
  const R_GUILD = "646464646464646464";
  const FAIL_ID = "424242424242424242";
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes(FAIL_ID)) return { ok: false, status: 404, json: async () => ({}) };
    if (u.includes("/users/")) return { ok: true, json: async () => ({ global_name: "Remote User", username: "remote_user" }) };
    return { ok: true, json: async () => ({ name: "Remote Guild" }) };
  };
  try {
    const env = { DISCORD_BOT_TOKEN: "test-token" };
    const first = await resolveAdminRemoteNames(env, { userIds: [R_USER, FAIL_ID], guildIds: [R_GUILD] });
    assert.equal(first.users.get(R_USER), "Remote User");
    assert.equal(first.guilds.get(R_GUILD), "Remote Guild");
    assert.equal(first.users.has(FAIL_ID), false, "failed lookups must stay unresolved so the raw id shows");
    const afterFirst = calls.length;
    const second = await resolveAdminRemoteNames(env, { userIds: [R_USER], guildIds: [R_GUILD] });
    assert.equal(second.users.get(R_USER), "Remote User");
    assert.equal(calls.length, afterFirst, "resolved names must come from the TTL cache");
    const beforeBounded = calls.length;
    await resolveAdminRemoteNames(env, {
      userIds: Array.from({ length: 30 }, (_, i) => "7" + String(i).padStart(17, "0")),
      guildIds: Array.from({ length: 20 }, (_, i) => "8" + String(i).padStart(17, "0"))
    });
    assert.equal(calls.length - beforeBounded, 16, "remote lookups are capped per request");
    const beforeNoToken = calls.length;
    const offline = await resolveAdminRemoteNames({}, { userIds: ["9" + "1".repeat(17)] });
    assert.equal(calls.length, beforeNoToken, "without a bot token there is no Discord traffic");
    assert.equal(offline.users.size, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
