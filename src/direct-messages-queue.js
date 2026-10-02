export const DM_CLIENT_BATCH_SIZE = 10;

export function eligibleDmRecipientIds(recipientIds, blockedIds = []) {
  const blocked = blockedIds instanceof Set ? blockedIds : new Set(blockedIds);
  return [...new Set((Array.isArray(recipientIds) ? recipientIds : [])
    .map(id => String(id || "").trim())
    .filter(id => /^\d{16,22}$/.test(id) && !blocked.has(id)))];
}

export function buildDmBatches(recipientIds, batchSize = DM_CLIENT_BATCH_SIZE) {
  const size = Number.isInteger(batchSize) && batchSize > 0
    ? Math.min(batchSize, DM_CLIENT_BATCH_SIZE)
    : DM_CLIENT_BATCH_SIZE;
  const batches = [];
  for (let index = 0; index < recipientIds.length; index += size) {
    batches.push(recipientIds.slice(index, index + size));
  }
  return batches;
}

async function readApiResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { error: `Direct Messages API returned an invalid response (${response.status})` }; }
}

export async function runDmBatchQueue({
  guildId,
  recipientIds,
  blockedIds = [],
  message,
  embed = false,
  bannerUrl = "",
  fetchImpl = fetch,
  onProgress = () => {}
}) {
  const eligibleIds = eligibleDmRecipientIds(recipientIds, blockedIds);
  if (!eligibleIds.length) throw new Error("Select at least one subscribed member");
  const batches = buildDmBatches(eligibleIds);
  const totals = {
    sent: 0,
    failed: 0,
    skipped: 0,
    processed: 0,
    dmUnavailable: 0,
    rateLimitedRetried: 0,
    retryExhausted: 0,
    otherError: 0,
    results: []
  };

  for (let index = 0; index < batches.length; index++) {
    onProgress({ ...totals, total: eligibleIds.length, batch: index + 1, batches: batches.length });
    const response = await fetchImpl("/api/direct-messages?guildId=" + encodeURIComponent(guildId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds: batches[index], message, embed, bannerUrl })
    });
    const data = await readApiResponse(response);
    if (!response.ok) {
      const error = new Error(data.error || `Could not send batch ${index + 1}`);
      error.processed = totals.processed;
      error.total = eligibleIds.length;
      throw error;
    }
    totals.sent += data.sent || 0;
    totals.failed += data.failed || 0;
    totals.skipped += data.skipped || 0;
    totals.dmUnavailable += data.dmUnavailable || 0;
    totals.rateLimitedRetried += data.rateLimitedRetried || 0;
    totals.retryExhausted += data.retryExhausted || 0;
    totals.otherError += data.otherError || 0;
    totals.processed += data.total || batches[index].length;
    totals.results.push(...(data.results || []));
    onProgress({ ...totals, total: eligibleIds.length, batch: index + 1, batches: batches.length });
  }

  return { ...totals, total: eligibleIds.length, batches: batches.length };
}
