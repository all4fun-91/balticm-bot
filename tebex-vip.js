/**
 * Pure helpers for Tebex VIP checkout / webhook grant decisions.
 * No secrets, no I/O — safe to unit-test.
 */

export const TEBEX_VIP_DAYS = 30;

export function resolveManageableGuildId(user, guildId) {
  const id = String(guildId || "").trim();
  if (!/^\d{16,22}$/.test(id)) return { error: "Valid Guild ID is required", status: 400 };
  const allowed = (user?.guilds || []).some(g => String(g.id) === id);
  if (!allowed) return { error: "Forbidden", status: 403 };
  return { guildId: id };
}

export function tebexPackageIdsFromSubject(subject) {
  const products = Array.isArray(subject?.products) ? subject.products : [];
  return products.map(p => String(p?.id ?? "")).filter(Boolean);
}

export function tebexCustomFromSubject(subject) {
  const bag = {};
  const merge = (obj) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
      if (v == null) continue;
      if (typeof v === "object") continue;
      bag[String(k)] = String(v);
    }
  };
  merge(subject?.custom);
  const products = Array.isArray(subject?.products) ? subject.products : [];
  for (const p of products) merge(p?.custom);
  return bag;
}

export function extractTebexVipPurchase(subject, expectedPackageId) {
  const custom = tebexCustomFromSubject(subject);
  const packageIds = tebexPackageIdsFromSubject(subject);
  const expected = String(expectedPackageId || "").trim();
  const packageMatched = !!expected && packageIds.some(id => id === expected);
  const packageId = packageMatched
    ? expected
    : (packageIds[0] || String(custom.package_id || custom.packageId || ""));
  const guildId = String(custom.guild_id || custom.guildId || "").trim();
  const discordUserId = String(custom.discord_user_id || custom.discordUserId || "").trim();
  const paymentId = String(subject?.transaction_id || subject?.id || "").trim();
  const amountRaw = subject?.price_paid?.amount ?? subject?.price?.amount;
  const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
  const currency = String(subject?.price_paid?.currency || subject?.price?.currency || "").trim();
  return {
    paymentId,
    guildId: /^\d{16,22}$/.test(guildId) ? guildId : "",
    discordUserId: /^\d{16,22}$/.test(discordUserId) ? discordUserId : "",
    packageId,
    packageIds,
    packageMatched,
    amount: Number.isFinite(amount) ? amount : null,
    currency,
    custom
  };
}

/**
 * Decide whether this payment should extend VIP.
 * Idempotent: same payment already granted (or later refunded/disputed after grant)
 * must never add 30 days twice. Refunds do not revoke VIP.
 */
export function decideTebexVipExtend({ existingStatus, packageMatched, guildId }) {
  const status = String(existingStatus || "").toLowerCase();
  if (["granted", "refunded", "dispute_opened", "dispute_lost"].includes(status)) {
    return { action: "skip_duplicate", reason: "already_granted" };
  }
  if (!packageMatched) {
    return { action: "record_only", reason: "package_mismatch" };
  }
  if (!guildId) {
    return { action: "record_only", reason: "missing_guild" };
  }
  return { action: "extend", days: TEBEX_VIP_DAYS };
}

export function mapTebexPaymentStatus(type) {
  const t = String(type || "");
  if (t === "payment.completed") return "completed";
  if (t === "payment.refunded") return "refunded";
  if (t === "payment.dispute.opened") return "dispute_opened";
  if (t === "payment.dispute.lost") return "dispute_lost";
  return "recorded";
}

export function shouldRevokeVipOnTebexType(type) {
  // Explicit product rule: refunds/disputes are recorded only — never revoke VIP.
  void type;
  return false;
}

/**
 * Map a Tebex Headless basket JSON into UI-safe totals.
 * Prices come only from Tebex fields — never invent discount math locally.
 */
export function summarizeTebexBasket(basket) {
  const b = basket?.data && typeof basket.data === "object" ? basket.data : (basket || {});
  const packages = Array.isArray(b.packages) ? b.packages : [];
  const first = packages[0] || {};
  const coupons = Array.isArray(b.coupons)
    ? b.coupons.map(c => String(c?.code || c || "").trim()).filter(Boolean)
    : [];
  let discount = null;
  if (typeof b.discount === "number" && Number.isFinite(b.discount)) {
    discount = b.discount;
  } else {
    let sum = 0;
    let any = false;
    for (const pkg of packages) {
      if (typeof pkg?.discount === "number" && Number.isFinite(pkg.discount)) {
        sum += pkg.discount;
        any = true;
      }
    }
    if (any) discount = sum;
  }
  const inBasketPrice = first?.in_basket?.price;
  const productPrice = typeof inBasketPrice === "number" && Number.isFinite(inBasketPrice)
    ? inBasketPrice
    : (typeof first?.base_price === "number" && Number.isFinite(first.base_price) ? first.base_price : null);
  const custom = b.custom && typeof b.custom === "object" ? b.custom : {};
  const productName = String(first?.name || "BalticM Bot VIP — 30 Days").trim() || "BalticM Bot VIP — 30 Days";
  const durationDays = parseVipDurationDaysFromPackage(productName, custom);
  return {
    ident: String(b.ident || "").trim(),
    productName,
    productPrice,
    durationDays,
    durationLabel: formatVipDurationLabel(durationDays),
    basePrice: typeof b.base_price === "number" && Number.isFinite(b.base_price) ? b.base_price : null,
    salesTax: typeof b.sales_tax === "number" && Number.isFinite(b.sales_tax) ? b.sales_tax : null,
    totalPrice: typeof b.total_price === "number" && Number.isFinite(b.total_price) ? b.total_price : null,
    currency: String(b.currency || "EUR").trim() || "EUR",
    discount,
    coupons,
    discordUserId: String(custom.discord_user_id || custom.discordUserId || "").trim(),
    guildId: String(custom.guild_id || custom.guildId || "").trim()
  };
}

/** Package duration for order summary — defaults to TEBEX_VIP_DAYS; parses 90/365 from name when present. */
export function parseVipDurationDaysFromPackage(productName, custom = {}) {
  const fromCustom = Number(custom.duration_days || custom.durationDays || custom.days);
  if (Number.isFinite(fromCustom) && fromCustom > 0) return Math.floor(fromCustom);
  const m = String(productName || "").match(/(\d+)\s*days?/i);
  if (m) return Math.max(1, parseInt(m[1], 10) || TEBEX_VIP_DAYS);
  return TEBEX_VIP_DAYS;
}

export function formatVipDurationLabel(days) {
  const d = Math.max(1, Number(days) || TEBEX_VIP_DAYS);
  return `${d} Day${d === 1 ? "" : "s"}`;
}

export function tebexApiErrorMessage(body, fallback = "Tebex request failed") {
  if (!body || typeof body !== "object") return String(fallback);
  const fromErrors = Array.isArray(body.errors)
    ? body.errors.map(e => (typeof e === "string" ? e : e?.detail || e?.message || "")).filter(Boolean).join("; ")
    : (body.errors && typeof body.errors === "object"
      ? Object.values(body.errors).flat().map(String).filter(Boolean).join("; ")
      : "");
  return String(body.detail || body.title || body.error || body.message || fromErrors || fallback);
}
