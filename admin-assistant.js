/**
 * BalticM Admin Assistant V1 — deterministic intent matcher + safe reply builders.
 * Read-only aggregation of real platform data. No LLM, no invented rows.
 */

import { isVipActive, subscriptionStatus } from "./admin-subscriptions.js";
import { buildTebexConfigStatus, formatTebexPaymentRow } from "./admin-tebex.js";

export const ASSISTANT_FALLBACK =
  "I can't answer that from BalticM platform data yet.";

export const ASSISTANT_INTENTS = [
  "platform_status",
  "recent_errors",
  "what_happened",
  "recent_payments",
  "active_vip",
  "vip_expiring",
  "vip_activity",
  "failed_webhooks",
  "support_overview"
];

const SECRET_PAYLOAD_RE =
  /"(?:TEBEX_WEBHOOK_SECRET|TEBEX_PUBLIC_TOKEN|TEBEX_PRIVATE_KEY|DISCORD_TOKEN|DISCORD_BOT_TOKEN|CLIENT_SECRET|BALTICM_ADMIN_DISCORD_IDS|webhookSecret|publicToken|privateKey|authorization|Authorization|X-Signature|token|secret)"\s*:/i;

/** Normalize user text for intent matching. */
export function normalizeAssistantQuery(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map quick-action labels and close paraphrases to a single intent.
 * Returns null when the question is not understood.
 */
export function matchAssistantIntent(text) {
  const q = normalizeAssistantQuery(text);
  if (!q) return null;

  // Quick action labels (exact-ish)
  if (q === "platform status" || q === "is everything online") return "platform_status";
  if (q === "recent errors" || q === "show recent errors") return "recent_errors";
  if (q === "recent payments" || q === "show latest tebex payments") return "recent_payments";
  if (q === "vip activity" || q === "show recent vip code redemptions") return "vip_activity";
  if (q === "support overview") return "support_overview";

  // Platform status
  if (
    /\b(everything|platform|services?|bots?)\b/.test(q) &&
    /\b(online|status|up|down|healthy|health)\b/.test(q)
  ) {
    return "platform_status";
  }
  if (/^(status|health)$/.test(q) || /is (the )?platform (ok|online|up)/.test(q)) {
    return "platform_status";
  }

  // Recent errors
  if (/\berrors?\b/.test(q) && /\b(recent|latest|show|list|any)\b/.test(q)) {
    return "recent_errors";
  }
  if (/^(errors?|show errors?)$/.test(q)) return "recent_errors";

  // What happened / recent changes
  if (
    /what (happened|changed)/.test(q) ||
    (/what changed recently/.test(q)) ||
    (/\b(today|recent(ly)?)\b/.test(q) &&
      /\b(happen|changed|activity|updates?|events?)\b/.test(q))
  ) {
    return "what_happened";
  }

  // Payments
  if (
    /\b(tebex\s+)?payments?\b/.test(q) &&
    /\b(recent|latest|show|list|last)\b/.test(q)
  ) {
    return "recent_payments";
  }
  if (/show (me )?(the )?(latest|recent) (tebex )?payments?/.test(q)) {
    return "recent_payments";
  }

  // Active VIP count
  if (
    /\b(active\s+)?vip\b/.test(q) &&
    /\b(how many|count|servers?|subscriptions?)\b/.test(q) &&
    !/\bexpir/.test(q) &&
    !/\bredeem|code|activity\b/.test(q)
  ) {
    return "active_vip";
  }
  if (/how many active vip/.test(q) || /active vip servers/.test(q)) {
    return "active_vip";
  }

  // VIP expiring soon
  if (/\bvip\b/.test(q) && /\bexpir/.test(q)) return "vip_expiring";
  if (/which .*expire/.test(q) && /\bvip|subscription/.test(q)) return "vip_expiring";

  // VIP activity / redemptions
  if (
    (/\bvip\b/.test(q) && /\b(activity|redemptions?|redeemed|codes?)\b/.test(q)) ||
    /recent vip/.test(q)
  ) {
    return "vip_activity";
  }

  // Failed webhooks
  if (/\bwebhook/.test(q) && /\b(fail|failed|error|broken)\b/.test(q)) {
    return "failed_webhooks";
  }
  if (/any failed webhooks/.test(q)) return "failed_webhooks";

  // Support
  if (
    /\b(support|tickets?|inbox)\b/.test(q) &&
    /\b(unanswered|open|waiting|overview|any)\b/.test(q)
  ) {
    return "support_overview";
  }
  if (/unanswered support/.test(q) || /support overview/.test(q)) {
    return "support_overview";
  }

  return null;
}

export function assistantPayloadHasNoSecrets(payload) {
  const text = JSON.stringify(payload || {});
  if (SECRET_PAYLOAD_RE.test(text)) return false;
  if (/sk_live|whsec_|Bot\s+[A-Za-z0-9._-]{20,}/i.test(text)) return false;
  return true;
}

function statusLabel(ok, known) {
  if (!known) return "unknown";
  return ok ? "OK" : "DOWN";
}

/** Build platform status cards from health services + D1 + Tebex env presence. */
export function buildPlatformStatusReply({
  healthServices = [],
  database = { status: "unknown" },
  env = {},
  checkedAt = ""
} = {}) {
  const byName = new Map(
    (Array.isArray(healthServices) ? healthServices : []).map((s) => [
      String(s.name || ""),
      s
    ])
  );
  const names = [
    "Main Bot",
    "Reaction Roles",
    "Music Bot",
    "Voice Create",
    "Bot Center"
  ];
  const cards = names.map((name) => {
    const s = byName.get(name);
    if (!s) {
      return { name, status: "unknown", detail: "Status not available" };
    }
    return {
      name,
      status: statusLabel(!!s.ok, true),
      detail: s.ok ? "Reachable" : `HTTP ${Number(s.status) || 0}`
    };
  });

  const dbKnown = database?.status === "ok" || database?.status === "error";
  cards.push({
    name: "D1",
    status: dbKnown
      ? database.status === "ok"
        ? "OK"
        : "DOWN"
      : "unknown",
    detail: dbKnown
      ? database.status === "ok"
        ? "Query ok"
        : String(database.message || "error").slice(0, 80)
      : "Status not available"
  });

  const tebex = buildTebexConfigStatus(env);
  cards.push({
    name: "Tebex",
    status: tebex.connected ? "Configured" : "Not configured",
    detail: tebex.connected
      ? "Public token, package id, and webhook secret present"
      : "Missing one or more required env values"
  });

  const unknownCount = cards.filter((c) => c.status === "unknown").length;
  const downCount = cards.filter(
    (c) => c.status === "DOWN" || c.status === "Not configured"
  ).length;
  let summary = "Platform status from live checks.";
  if (downCount === 0 && unknownCount === 0) summary = "All checked services look online.";
  else if (downCount > 0) summary = `${downCount} item(s) need attention.`;
  else if (unknownCount > 0) summary = `${unknownCount} service(s) reported as unknown.`;

  return {
    intent: "platform_status",
    reply: summary,
    cards,
    checkedAt: checkedAt || new Date().toISOString()
  };
}

export function buildRecentErrorsReply({ rows = [] } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return {
      intent: "recent_errors",
      reply: "There are no stored errors.",
      empty: true,
      rows: []
    };
  }
  return {
    intent: "recent_errors",
    reply: `Showing ${Math.min(list.length, 20)} recent error-related row(s).`,
    rows: list.slice(0, 20).map((r) => ({
      createdAt: String(r.createdAt || r.created_at || ""),
      source: String(r.source || r.category || ""),
      action: String(r.action || ""),
      guildId: String(r.guildId || r.guild_id || ""),
      details: String(r.details || "").slice(0, 160)
    }))
  };
}

export function buildWhatHappenedReply({ events = [], dayLabel = "today" } = {}) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) {
    return {
      intent: "what_happened",
      reply: `No stored platform activity for ${dayLabel}.`,
      empty: true,
      rows: []
    };
  }
  return {
    intent: "what_happened",
    reply: `${list.length} stored event(s) for ${dayLabel}.`,
    rows: list.slice(0, 25).map((e) => ({
      createdAt: String(e.createdAt || ""),
      kind: String(e.kind || ""),
      action: String(e.action || ""),
      reference: String(e.reference || ""),
      guildId: String(e.guildId || "")
    }))
  };
}

export function buildRecentPaymentsReply({ payments = [] } = {}) {
  const list = Array.isArray(payments) ? payments : [];
  if (!list.length) {
    return {
      intent: "recent_payments",
      reply: "No Tebex payments are stored yet.",
      empty: true,
      rows: []
    };
  }
  return {
    intent: "recent_payments",
    reply: `Latest ${Math.min(list.length, 15)} Tebex payment(s).`,
    rows: list.slice(0, 15).map((p) => {
      const row = formatTebexPaymentRow(p);
      return {
        date: row.updatedAt || row.createdAt || "",
        amount: row.amountLabel,
        status: row.status,
        reference: row.reference,
        guildId: row.guildId || "—"
      };
    })
  };
}

export function buildActiveVipReply({ premiumRows = [], now = Date.now() } = {}) {
  const active = (Array.isArray(premiumRows) ? premiumRows : []).filter((r) =>
    isVipActive(r.state || r, now)
  );
  return {
    intent: "active_vip",
    reply: `Active VIP servers: ${active.length}.`,
    count: active.length,
    rows: active.slice(0, 40).map((r) => ({
      guildId: String(r.guildId || ""),
      expiresAt: String((r.state || r).expiresAt || ""),
      source: String((r.state || r).source || "")
    }))
  };
}

const SOON_MS = 14 * 86400000;

export function buildVipExpiringReply({
  premiumRows = [],
  now = Date.now(),
  withinMs = SOON_MS
} = {}) {
  const soon = (Array.isArray(premiumRows) ? premiumRows : [])
    .map((r) => {
      const state = r.state || r;
      const status = subscriptionStatus(state, now);
      if (status !== "ACTIVE") return null;
      const exp = state.expiresAt ? Date.parse(state.expiresAt) : NaN;
      if (!Number.isFinite(exp)) return null;
      const left = exp - now;
      if (left < 0 || left > withinMs) return null;
      return {
        guildId: String(r.guildId || ""),
        expiresAt: String(state.expiresAt || ""),
        daysLeft: Math.ceil(left / 86400000)
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)));

  if (!soon.length) {
    return {
      intent: "vip_expiring",
      reply: "No active VIP subscriptions expire within the next 14 days.",
      empty: true,
      rows: []
    };
  }
  return {
    intent: "vip_expiring",
    reply: `${soon.length} VIP subscription(s) expire within 14 days.`,
    rows: soon.slice(0, 40)
  };
}

export function buildVipActivityReply({ redemptions = [] } = {}) {
  const list = Array.isArray(redemptions) ? redemptions : [];
  if (!list.length) {
    return {
      intent: "vip_activity",
      reply: "No VIP code redemptions are stored yet.",
      empty: true,
      rows: []
    };
  }
  return {
    intent: "vip_activity",
    reply: `Latest ${Math.min(list.length, 20)} VIP code redemption(s).`,
    rows: list.slice(0, 20).map((r) => ({
      redeemedAt: String(r.redeemedAt || r.redeemed_at || ""),
      code: String(r.code || ""),
      guildId: String(r.guildId || r.guild_id || ""),
      guildName: String(r.guildName || r.guild_name || ""),
      durationDays: r.durationDays ?? r.duration_days ?? null,
      result: String(r.result || "")
    }))
  };
}

function isFailedWebhookHandled(handled) {
  const h = String(handled || "").toLowerCase();
  return (
    h.includes("fail") ||
    h.includes("error") ||
    h === "rejected" ||
    h === "invalid"
  );
}

export function buildFailedWebhooksReply({ events = [] } = {}) {
  const failed = (Array.isArray(events) ? events : []).filter((e) =>
    isFailedWebhookHandled(e.handled)
  );
  if (!failed.length) {
    return {
      intent: "failed_webhooks",
      reply: "No failed webhook events are stored.",
      empty: true,
      rows: []
    };
  }
  return {
    intent: "failed_webhooks",
    reply: `${failed.length} failed webhook event(s) found.`,
    rows: failed.slice(0, 20).map((e) => ({
      id: String(e.id || ""),
      type: String(e.type || ""),
      paymentId: String(e.paymentId || e.payment_id || ""),
      receivedAt: String(e.receivedAt || e.received_at || ""),
      handled: String(e.handled || "")
    }))
  };
}

export function buildSupportOverviewReply({ threads = [] } = {}) {
  const list = Array.isArray(threads) ? threads : [];
  const counts = {
    open: 0,
    waiting_staff: 0,
    waiting_customer: 0,
    closed: 0,
    other: 0,
    total: list.length,
    unansweredStaff: 0
  };
  for (const t of list) {
    const s = String(t.status || "").toLowerCase();
    if (s === "open") counts.open += 1;
    else if (s === "waiting_staff") counts.waiting_staff += 1;
    else if (s === "waiting_customer") counts.waiting_customer += 1;
    else if (s === "closed") counts.closed += 1;
    else counts.other += 1;
    if (s !== "closed" && Number(t.unreadStaff || 0) > 0) {
      counts.unansweredStaff += 1;
    }
  }
  const openLike = counts.open + counts.waiting_staff + counts.waiting_customer;
  return {
    intent: "support_overview",
    reply:
      openLike === 0
        ? "No open support conversations."
        : `Open/waiting conversations: ${openLike}. Waiting for staff: ${counts.waiting_staff}. Unread for staff: ${counts.unansweredStaff}.`,
    cards: [
      { name: "Open", status: String(counts.open), detail: "status=open" },
      {
        name: "Waiting staff",
        status: String(counts.waiting_staff),
        detail: "status=waiting_staff"
      },
      {
        name: "Waiting customer",
        status: String(counts.waiting_customer),
        detail: "status=waiting_customer"
      },
      { name: "Closed", status: String(counts.closed), detail: "status=closed" },
      {
        name: "Unread (staff)",
        status: String(counts.unansweredStaff),
        detail: "unread_staff > 0 on non-closed"
      }
    ],
    counts
  };
}

/**
 * Assemble the final assistant response for a matched intent using supplied data bags.
 * Pure — caller loads D1/health.
 */
export function buildAssistantResponse(intent, data = {}) {
  if (!intent) {
    return { intent: null, reply: ASSISTANT_FALLBACK };
  }
  switch (intent) {
    case "platform_status":
      return buildPlatformStatusReply(data);
    case "recent_errors":
      return buildRecentErrorsReply(data);
    case "what_happened":
      return buildWhatHappenedReply(data);
    case "recent_payments":
      return buildRecentPaymentsReply(data);
    case "active_vip":
      return buildActiveVipReply(data);
    case "vip_expiring":
      return buildVipExpiringReply(data);
    case "vip_activity":
      return buildVipActivityReply(data);
    case "failed_webhooks":
      return buildFailedWebhooksReply(data);
    case "support_overview":
      return buildSupportOverviewReply(data);
    default:
      return { intent: null, reply: ASSISTANT_FALLBACK };
  }
}
