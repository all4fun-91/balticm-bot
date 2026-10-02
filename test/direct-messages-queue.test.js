import assert from "node:assert/strict";
import test from "node:test";
import { buildDmBatches, eligibleDmRecipientIds, runDmBatchQueue } from "../src/direct-messages-queue.js";

const ids = count => Array.from({ length: count }, (_, index) => String(100000000000000000n + BigInt(index)));
const apiResponse = body => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" }
});

test("client batches never exceed the backend limit", () => {
  const batches = buildDmBatches(ids(25));
  assert.deepEqual(batches.map(batch => batch.length), [10, 10, 5]);
});

test("recipient snapshot removes duplicates, invalid IDs and unsubscribed members", () => {
  const recipients = ids(3);
  assert.deepEqual(
    eligibleDmRecipientIds([recipients[0], recipients[1], recipients[0], "invalid", recipients[2]], new Set([recipients[1]])),
    [recipients[0], recipients[2]]
  );
});

test("bulk queue starts the first request and continues through multiple batches", async () => {
  const recipients = ids(25);
  const requestSizes = [];
  const progress = [];
  const result = await runDmBatchQueue({
    guildId: "884027552174317569",
    recipientIds: recipients,
    message: "test",
    fetchImpl: async (_url, init) => {
      const batch = JSON.parse(init.body).memberIds;
      requestSizes.push(batch.length);
      const failed = requestSizes.length === 1 ? 1 : 0;
      return apiResponse({
        sent: batch.length - failed,
        failed,
        otherError: failed,
        total: batch.length,
        results: batch.map((memberId, index) => ({ memberId, ok: !(failed && index === 0) }))
      });
    },
    onProgress: state => progress.push([state.processed, state.batch])
  });

  assert.deepEqual(requestSizes, [10, 10, 5]);
  assert.deepEqual(progress, [[0, 1], [10, 1], [10, 2], [20, 2], [20, 3], [25, 3]]);
  assert.equal(result.sent, 24);
  assert.equal(result.failed, 1);
  assert.equal(result.processed, 25);
});

test("first batch rejection preserves zero processed for an actionable error", async () => {
  await assert.rejects(
    runDmBatchQueue({
      guildId: "884027552174317569",
      recipientIds: ids(11),
      message: "test",
      fetchImpl: async () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    }),
    error => error.message === "Forbidden" && error.processed === 0 && error.total === 11
  );
});
