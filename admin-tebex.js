/** Admin Tebex dashboard helpers — no secrets, no Discord fan-out. */

export const TEBEX_VIP_PACKAGE_NAME = "BalticM Bot VIP — 30 Days";
export const TEBEX_VIP_DISPLAY_PRICE = "€7.99";

/** Booleans + safe package id only. Never include token/secret values. */
export function buildTebexConfigStatus(env = {}) {
  const hasPublicToken = !!String(env.TEBEX_PUBLIC_TOKEN || "").trim();
  const packageId = String(env.TEBEX_VIP_PACKAGE_ID || "").trim();
  const hasVipPackageId = !!packageId;
  const hasWebhookSecret = !!String(env.TEBEX_WEBHOOK_SECRET || "").trim();
  const connected = hasPublicToken && hasVipPackageId && hasWebhookSecret;
  return {
    connected,
    statusLabel: connected ? "Connected" : "Configuration issue",
    hasPublicToken,
    hasVipPackageId,
    hasWebhookSecret,
    packageId: packageId || "",
    packageName: TEBEX_VIP_PACKAGE_NAME,
    price: TEBEX_VIP_DISPLAY_PRICE
  };
}

/** Derive webhook card from real payment/event rows (not a fake healthy). */
export function buildTebexWebhookCard({ lastEvent = null, lastPayment = null } = {}) {
  const eventAt = lastEvent?.receivedAt || lastEvent?.received_at || "";
  const paymentAt = lastPayment?.updatedAt || lastPayment?.updated_at || lastPayment?.createdAt || lastPayment?.created_at || "";
  if (!eventAt && !paymentAt) {
    return {
      eventsStored: !!lastEvent || false,
      hasActivity: false,
      label: "No webhooks received yet",
      lastReceivedAt: "",
      lastType: "",
      lastStatus: "",
      lastReference: ""
    };
  }
  if (eventAt && (!paymentAt || String(eventAt) >= String(paymentAt))) {
    return {
      eventsStored: true,
      hasActivity: true,
      label: String(lastEvent?.handled || lastEvent?.type || "Received"),
      lastReceivedAt: eventAt,
      lastType: String(lastEvent?.type || ""),
      lastStatus: String(lastEvent?.handled || ""),
      lastReference: String(lastEvent?.paymentId || lastEvent?.payment_id || lastEvent?.id || "")
    };
  }
  return {
    eventsStored: !!lastEvent,
    hasActivity: true,
    label: String(lastPayment?.status || "Payment recorded"),
    lastReceivedAt: paymentAt,
    lastType: "payment",
    lastStatus: String(lastPayment?.status || ""),
    lastReference: String(lastPayment?.paymentId || lastPayment?.payment_id || lastPayment?.basketIdent || lastPayment?.basket_ident || "")
  };
}

export function formatTebexPaymentRow(row = {}, packageName = TEBEX_VIP_PACKAGE_NAME) {
  const amount = row.amount;
  const currency = String(row.currency || "").trim();
  let amountLabel = "—";
  if (amount != null && amount !== "" && !Number.isNaN(Number(amount))) {
    const n = Number(amount);
    amountLabel = currency ? `${currency === "EUR" ? "€" : currency + " "}${n.toFixed(2)}` : String(n);
  }
  const paymentId = String(row.paymentId || row.payment_id || "").trim();
  const basketIdent = String(row.basketIdent || row.basket_ident || "").trim();
  return {
    paymentId,
    eventId: String(row.eventId || row.event_id || ""),
    discordUserId: String(row.discordUserId || row.discord_user_id || ""),
    guildId: String(row.guildId || row.guild_id || ""),
    guildName: "",
    packageId: String(row.packageId || row.package_id || ""),
    packageName,
    amount: amount == null ? null : Number(amount),
    currency,
    amountLabel,
    coupon: "",
    reference: paymentId || basketIdent || "—",
    basketIdent,
    status: String(row.status || ""),
    createdAt: String(row.createdAt || row.created_at || ""),
    updatedAt: String(row.updatedAt || row.updated_at || "")
  };
}

export function formatTebexWebhookEventRow(row = {}) {
  return {
    id: String(row.id || ""),
    type: String(row.type || ""),
    paymentId: String(row.paymentId || row.payment_id || ""),
    receivedAt: String(row.receivedAt || row.received_at || ""),
    handled: String(row.handled || "")
  };
}

/** Client-side style filter helper (also usable server-side). */
export function matchesTebexPaymentSearch(row, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  const hay = [
    row.discordUserId,
    row.guildId,
    row.guildName,
    row.paymentId,
    row.basketIdent,
    row.reference,
    row.eventId,
    row.status
  ]
    .map((x) => String(x || "").toLowerCase())
    .join(" ");
  return hay.includes(s);
}

const SECRET_KEYS = [
  "TEBEX_WEBHOOK_SECRET",
  "TEBEX_PUBLIC_TOKEN",
  "TEBEX_PRIVATE_KEY",
  "webhookSecret",
  "publicToken",
  "privateKey",
  "secret",
  "token"
];

/** Assert admin JSON never leaks secret field names/values at top level keys we care about. */
export function tebexAdminPayloadHasNoSecrets(payload) {
  const text = JSON.stringify(payload || {});
  for (const k of SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload || {}, k)) return false;
    // Values must never appear; keys like hasWebhookSecret (boolean flag) are ok — only raw secret names as values.
  }
  if (/"TEBEX_WEBHOOK_SECRET"\s*:/.test(text)) return false;
  if (/"TEBEX_PUBLIC_TOKEN"\s*:/.test(text)) return false;
  if (/"TEBEX_PRIVATE_KEY"\s*:/.test(text)) return false;
  if (/"webhookSecret"\s*:/.test(text)) return false;
  if (/"publicToken"\s*:/.test(text)) return false;
  if (/"privateKey"\s*:/.test(text)) return false;
  return true;
}
