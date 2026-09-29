/**
 * Admin Logs helpers — map real stored rows to a safe viewer payload.
 * No secrets, no fabricated history.
 */

export const ADMIN_LOG_CATEGORIES = [
  "payment",
  "webhook",
  "vip_code",
  "vip",
  "admin",
  "support",
  "audit",
  "system",
  "error"
];

/** Categories that have no historical store in this codebase today. */
export const ADMIN_LOG_EMPTY_HISTORY = [
  {
    category: "system",
    message: "No system events are stored yet — nothing to show."
  },
  {
    category: "error",
    message: "No error history table exists yet — nothing to show."
  }
];

const SECRET_KEY_RE =
  /"(?:TEBEX_WEBHOOK_SECRET|TEBEX_PUBLIC_TOKEN|TEBEX_PRIVATE_KEY|webhookSecret|publicToken|privateKey|authorization|Authorization|X-Signature|rawBody|raw_body|signature|token|secret)"\s*:/i;

export function dashField(v) {
  const s = String(v ?? "").trim();
  return s || "—";
}

export function shortDetails(text, max = 120) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "—";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function makeLogRow({
  id,
  createdAt = "",
  category = "",
  action = "",
  actorDiscordId = "",
  guildId = "",
  guildLabel = "",
  reference = "",
  status = "",
  details = ""
} = {}) {
  return {
    id: String(id || ""),
    createdAt: String(createdAt || ""),
    category: String(category || ""),
    action: dashField(action),
    actorDiscordId: dashField(actorDiscordId),
    guildId: dashField(guildId),
    guildLabel: dashField(guildLabel),
    reference: dashField(reference),
    status: dashField(status),
    details: shortDetails(details)
  };
}

export function logRowFromPayment(row = {}) {
  const amount = row.amount;
  const currency = String(row.currency || "").trim();
  let details = "—";
  if (amount != null && amount !== "" && !Number.isNaN(Number(amount))) {
    const n = Number(amount);
    details = currency === "EUR" ? `€${n.toFixed(2)}` : `${currency || ""} ${n}`.trim();
  }
  const paymentId = String(row.paymentId || row.payment_id || "").trim();
  return makeLogRow({
    id: "pay:" + paymentId,
    createdAt: row.updatedAt || row.updated_at || row.createdAt || row.created_at || "",
    category: "payment",
    action: "payment." + String(row.status || "recorded"),
    actorDiscordId: row.discordUserId || row.discord_user_id || "",
    guildId: row.guildId || row.guild_id || "",
    reference: paymentId,
    status: row.status || "",
    details
  });
}

export function logRowFromWebhookEvent(row = {}) {
  const id = String(row.id || "").trim();
  return makeLogRow({
    id: "wh:" + id,
    createdAt: row.receivedAt || row.received_at || "",
    category: "webhook",
    action: row.type || "webhook",
    actorDiscordId: "",
    guildId: "",
    reference: row.paymentId || row.payment_id || id,
    status: row.handled || "",
    details: "—"
  });
}

export function logRowFromVipCodeCreate(row = {}) {
  const id = String(row.id || "").trim();
  const days = row.durationDays ?? row.duration_days;
  return makeLogRow({
    id: "vc:" + id,
    createdAt: row.createdAt || row.created_at || "",
    category: "vip_code",
    action: "code_created",
    actorDiscordId: row.createdBy || row.created_by || "",
    guildId: "",
    reference: row.code || id,
    status: row.status || "",
    details: days != null ? `${days} days` : "—"
  });
}

export function logRowFromVipCodeRedeem(row = {}) {
  const id = String(row.id || "").trim();
  const days = row.durationDays ?? row.duration_days;
  const guildName = String(row.guildName || row.guild_name || "").trim();
  return makeLogRow({
    id: "vr:" + id,
    createdAt: row.redeemedAt || row.redeemed_at || "",
    category: "vip_code",
    action: "code_redeemed",
    actorDiscordId: row.discordUserId || row.discord_user_id || "",
    guildId: row.guildId || row.guild_id || "",
    guildLabel: guildName,
    reference: row.code || row.codeId || row.code_id || id,
    status: row.result || "success",
    details: days != null ? `${days} days` : "—"
  });
}

/** Only ADMIN / TEBEX activity_logs rows (VIP grant/extend/revoke and related). */
export function logRowFromActivity(row = {}) {
  const source = String(row.source || "").toUpperCase();
  const action = String(row.action || "");
  let category = "admin";
  if (source === "TEBEX") category = "payment";
  else if (/vip/i.test(action)) category = "vip";
  else if (source === "ADMIN") category = "admin";
  return makeLogRow({
    id: "al:" + String(row.id || ""),
    createdAt: row.createdAt || row.created_at || "",
    category,
    action: action || source || "activity",
    actorDiscordId: row.actorId || row.actor_id || "",
    guildId: row.guildId || row.guild_id || "",
    reference: row.target || "",
    status: source || "",
    details: row.details || ""
  });
}

export function logRowFromSupportMessage(row = {}) {
  const id = String(row.id || "").trim();
  const senderType = String(row.senderType || row.sender_type || "");
  const action = senderType === "staff" ? "staff_reply" : "customer_message";
  return makeLogRow({
    id: "sup:" + id,
    createdAt: row.createdAt || row.created_at || "",
    category: "support",
    action,
    actorDiscordId: row.senderId || row.sender_id || "",
    guildId: row.guildId || row.guild_id || "",
    guildLabel: row.guildName || row.guild_name || "",
    reference: row.threadId || row.thread_id || id,
    status: row.threadStatus || row.thread_status || "",
    details: shortDetails(row.message || "")
  });
}

export function logRowFromAudit(row = {}) {
  return makeLogRow({
    id: "aud:" + String(row.id || ""),
    createdAt: row.createdAt || row.created_at || "",
    category: row.category || "audit",
    action: row.action || "audit",
    actorDiscordId: row.actorDiscordId || row.actor_discord_id || "",
    guildId: row.guildId || row.guild_id || "",
    reference: row.reference || "",
    status: row.status || "",
    details: row.details || ""
  });
}

export function matchesAdminLogFilters(row, { q = "", category = "", status = "" } = {}) {
  const cat = String(category || "").trim().toLowerCase();
  if (cat && cat !== "all" && String(row.category || "").toLowerCase() !== cat) return false;
  const st = String(status || "").trim().toLowerCase();
  if (st && st !== "all") {
    const rs = String(row.status || "").toLowerCase();
    if (rs !== st && !rs.includes(st)) return false;
  }
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  const hay = [
    row.action,
    row.actorDiscordId,
    row.guildId,
    row.guildLabel,
    row.reference,
    row.status,
    row.details,
    row.category
  ]
    .map((x) => String(x || "").toLowerCase())
    .join(" ");
  return hay.includes(s);
}

export function mergeAdminLogRows(rows = [], filters = {}) {
  const list = (rows || []).filter((r) => matchesAdminLogFilters(r, filters));
  list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return list;
}

export function buildEmptyCategoryNotes(counts = {}) {
  const notes = [];
  for (const item of ADMIN_LOG_EMPTY_HISTORY) {
    notes.push(item);
  }
  if (!Number(counts.audit)) {
    notes.push({
      category: "audit",
      message: "admin_audit_log is ready for future events — no rows yet (not backfilled)."
    });
  }
  return notes;
}

export function adminLogsPayloadHasNoSecrets(payload) {
  const text = JSON.stringify(payload || {});
  if (SECRET_KEY_RE.test(text)) return false;
  if (/"rawBody"\s*:/i.test(text)) return false;
  if (/"signature"\s*:/i.test(text)) return false;
  return true;
}
