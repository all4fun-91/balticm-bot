export const DM_BATCH_SIZE = 10;
export const DM_RESULT = Object.freeze({
  SENT: "sent",
  UNAVAILABLE: "dm_unavailable",
  RETRY_EXHAUSTED: "retry_exhausted",
  OTHER_ERROR: "other_error"
});

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RETRY_AFTER_MS = 120_000;
const sleepDefault = ms => new Promise(resolve => setTimeout(resolve, ms));

function responseHeaders(headers) {
  return {
    retryAfter: headers?.get?.("retry-after") || "",
    remaining: headers?.get?.("x-ratelimit-remaining") || "",
    resetAfter: headers?.get?.("x-ratelimit-reset-after") || "",
    global: headers?.get?.("x-ratelimit-global") || ""
  };
}

async function responseBody(response) {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; }
}

function secondsToMs(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 0;
}

export function discordRetryAfterMs(headers, body = {}) {
  return secondsToMs(body.retry_after)
    || secondsToMs(headers?.retryAfter)
    || secondsToMs(headers?.resetAfter)
    || 1000;
}

export function discordBucketDelayMs(headers) {
  return String(headers?.remaining) === "0" ? secondsToMs(headers?.resetAfter) : 0;
}

async function timedFetch(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Discord request timeout"), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function discordRequestWithRetry(url, init, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || sleepDefault;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRateLimitRetries = options.maxRateLimitRetries ?? 3;
  const maxTransientRetries = options.maxTransientRetries ?? 2;
  let rateLimitRetries = 0;
  let transientRetries = 0;
  let attempts = 0;
  let rateLimitedRetried = false;

  while (true) {
    attempts++;
    let response;
    try {
      response = await timedFetch(fetchImpl, url, init, timeoutMs);
    } catch (error) {
      if (transientRetries < maxTransientRetries) {
        await sleep(500 * (2 ** transientRetries));
        transientRetries++;
        continue;
      }
      return {
        ok: false,
        classification: DM_RESULT.RETRY_EXHAUSTED,
        status: 0,
        code: null,
        message: error?.name === "AbortError" ? "Discord request timed out" : "Discord network request failed",
        attempts,
        rateLimitedRetried,
        retryAfterMs: 0,
        headers: {}
      };
    }

    const headers = responseHeaders(response.headers);
    const body = await responseBody(response);

    if (response.status === 429) {
      const retryAfterMs = discordRetryAfterMs(headers, body);
      if (rateLimitRetries >= maxRateLimitRetries || retryAfterMs > MAX_RETRY_AFTER_MS) {
        return {
          ok: false,
          classification: DM_RESULT.RETRY_EXHAUSTED,
          status: response.status,
          code: body.code ?? null,
          message: body.message || "Discord rate limit retry exhausted",
          attempts,
          rateLimitedRetried,
          retryAfterMs,
          globalRateLimit: !!body.global || headers.global === "true",
          headers
        };
      }
      rateLimitRetries++;
      rateLimitedRetried = true;
      await sleep(retryAfterMs);
      continue;
    }

    if (response.status >= 500 && response.status <= 599) {
      if (transientRetries < maxTransientRetries) {
        await sleep(500 * (2 ** transientRetries));
        transientRetries++;
        continue;
      }
      return {
        ok: false,
        classification: DM_RESULT.RETRY_EXHAUSTED,
        status: response.status,
        code: body.code ?? null,
        message: body.message || "Discord server error retry exhausted",
        attempts,
        rateLimitedRetried,
        retryAfterMs: 0,
        headers
      };
    }

    if (!response.ok) {
      const unavailable = Number(body.code) === 50007;
      return {
        ok: false,
        classification: unavailable ? DM_RESULT.UNAVAILABLE : DM_RESULT.OTHER_ERROR,
        status: response.status,
        code: body.code ?? null,
        message: body.message || `Discord API error ${response.status}`,
        attempts,
        rateLimitedRetried,
        retryAfterMs: 0,
        headers
      };
    }

    return {
      ok: true,
      classification: DM_RESULT.SENT,
      status: response.status,
      code: null,
      message: "",
      body,
      attempts,
      rateLimitedRetried,
      retryAfterMs: 0,
      headers,
      bucketDelayMs: discordBucketDelayMs(headers)
    };
  }
}

export async function sendDiscordDirectMessage({ memberId, guildId, message, embed, bannerUrl, headers, request = discordRequestWithRetry, requestOptions = {} }) {
  const channel = await request("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers,
    body: JSON.stringify({ recipient_id: memberId })
  }, requestOptions);
  if (!channel.ok) return { ...channel, stage: "create_dm_channel" };
  const channelId = channel.body?.id;
  if (!channelId) return { ok: false, classification: DM_RESULT.OTHER_ERROR, status: channel.status, code: null, message: "Discord did not return a DM channel", attempts: channel.attempts, rateLimitedRetried: channel.rateLimitedRetried, retryAfterMs: 0, stage: "create_dm_channel", headers: channel.headers };

  const payload = embed
    ? { embeds: [{ description: message, color: 0x7457ff }], components: [{ type: 1, components: [{ type: 2, style: 2, label: "Unsubscribe from news", custom_id: `dm_unsubscribe:${guildId}` }] }] }
    : { content: message, components: [{ type: 1, components: [{ type: 2, style: 2, label: "Unsubscribe from news", custom_id: `dm_unsubscribe:${guildId}` }] }] };
  if (embed && bannerUrl) payload.embeds[0].image = { url: bannerUrl };

  const sent = await request(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  }, requestOptions);
  return { ...sent, stage: "send_message", attempts: channel.attempts + sent.attempts, rateLimitedRetried: channel.rateLimitedRetried || sent.rateLimitedRetried, bucketDelayMs: Math.max(channel.bucketDelayMs || 0, sent.bucketDelayMs || 0) };
}

export function summarizeDmResults(results) {
  const summary = { sent: 0, dmUnavailable: 0, rateLimitedRetried: 0, retryExhausted: 0, otherError: 0, skipped: 0, total: results.length };
  for (const result of results) {
    if (result.status === DM_RESULT.SENT) summary.sent++;
    else if (result.status === DM_RESULT.UNAVAILABLE) summary.dmUnavailable++;
    else if (result.status === DM_RESULT.RETRY_EXHAUSTED) summary.retryExhausted++;
    else if (result.skipped) summary.skipped++;
    else summary.otherError++;
    if (result.rateLimitedRetried) summary.rateLimitedRetried++;
  }
  return summary;
}
