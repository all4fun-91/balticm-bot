import assert from "node:assert/strict";
import test from "node:test";
import {
  DM_RESULT,
  discordBucketDelayMs,
  discordRequestWithRetry,
  sendDiscordDirectMessage,
  summarizeDmResults
} from "../direct-messages.js";

const jsonResponse = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...headers }
});

test("429 respects retry_after and reports a recovered rate limit", async () => {
  const waits = [];
  const responses = [
    jsonResponse(429, { message: "rate limited", retry_after: 1.25 }),
    jsonResponse(200, { id: "dm-channel" })
  ];
  const result = await discordRequestWithRetry("https://discord.test", {}, {
    fetchImpl: async () => responses.shift(),
    sleep: async ms => waits.push(ms)
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.rateLimitedRetried, true);
  assert.deepEqual(waits, [1250]);
});

test("Discord code 50007 is classified as DM unavailable", async () => {
  const responses = [
    jsonResponse(200, { id: "dm-channel" }),
    jsonResponse(403, { code: 50007, message: "Cannot send messages to this user" })
  ];
  const request = (url, init, options) => discordRequestWithRetry(url, init, {
    ...options,
    fetchImpl: async () => responses.shift(),
    sleep: async () => {}
  });
  const result = await sendDiscordDirectMessage({
    memberId: "123456789012345678",
    guildId: "987654321098765432",
    message: "hello",
    embed: false,
    bannerUrl: "",
    headers: { Authorization: "Bot test" },
    request
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, DM_RESULT.UNAVAILABLE);
  assert.equal(result.status, 403);
  assert.equal(result.code, 50007);
  assert.equal(result.stage, "send_message");
});

test("persistent 429 becomes retry exhausted instead of a permanent DM failure", async () => {
  const waits = [];
  const result = await discordRequestWithRetry("https://discord.test", {}, {
    fetchImpl: async () => jsonResponse(429, { retry_after: 0.5, global: true }),
    sleep: async ms => waits.push(ms),
    maxRateLimitRetries: 2
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification, DM_RESULT.RETRY_EXHAUSTED);
  assert.equal(result.status, 429);
  assert.equal(result.attempts, 3);
  assert.equal(result.globalRateLimit, true);
  assert.deepEqual(waits, [500, 500]);
});

test("Discord 5xx retries are bounded", async () => {
  const waits = [];
  const result = await discordRequestWithRetry("https://discord.test", {}, {
    fetchImpl: async () => jsonResponse(503, { message: "unavailable" }),
    sleep: async ms => waits.push(ms),
    maxTransientRetries: 1
  });

  assert.equal(result.classification, DM_RESULT.RETRY_EXHAUSTED);
  assert.equal(result.status, 503);
  assert.equal(result.attempts, 2);
  assert.deepEqual(waits, [500]);
});

test("other Discord errors remain distinguishable", async () => {
  const result = await discordRequestWithRetry("https://discord.test", {}, {
    fetchImpl: async () => jsonResponse(403, { code: 50013, message: "Missing Permissions" }),
    sleep: async () => {}
  });

  assert.equal(result.classification, DM_RESULT.OTHER_ERROR);
  assert.equal(result.code, 50013);
});

test("summary keeps final outcomes separate from recovered 429s", () => {
  const summary = summarizeDmResults([
    { status: DM_RESULT.SENT, rateLimitedRetried: true },
    { status: DM_RESULT.UNAVAILABLE },
    { status: DM_RESULT.RETRY_EXHAUSTED },
    { status: DM_RESULT.OTHER_ERROR },
    { status: "skipped", skipped: true }
  ]);

  assert.deepEqual(summary, {
    sent: 1,
    dmUnavailable: 1,
    rateLimitedRetried: 1,
    retryExhausted: 1,
    otherError: 1,
    skipped: 1,
    total: 5
  });
});

test("successful bucket exhaustion uses Discord reset-after before continuing", () => {
  assert.equal(discordBucketDelayMs({ remaining: "0", resetAfter: "0.75" }), 750);
  assert.equal(discordBucketDelayMs({ remaining: "1", resetAfter: "5" }), 0);
});
