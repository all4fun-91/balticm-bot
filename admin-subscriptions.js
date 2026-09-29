/** Pure VIP/subscription helpers shared by Admin Panel APIs and tests. */

export const MS_PER_VIP_DAY = 86400000;

export function normalizeVipDays(days, fallback = 30) {
  const n = Number(days);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(3650, Math.floor(n)));
}

/**
 * Shared expiry math for Admin grant/extend, Tebex webhook, and VIP Codes.
 * Returns ISO expiry = from + duration days (clamped via normalizeVipDays).
 */
export function addVipDurationDays(from, days) {
  const d = normalizeVipDays(days);
  const baseMs = from instanceof Date ? from.getTime() : Date.parse(from);
  const safeBase = Number.isFinite(baseMs) ? baseMs : Date.now();
  return {
    days: d,
    expiresAt: new Date(safeBase + d * MS_PER_VIP_DAY).toISOString()
  };
}

export function isVipActive(state, now = Date.now()) {
  if (!state || String(state.plan || "free") === "free") return false;
  const exp = state.expiresAt ? Date.parse(state.expiresAt) : NaN;
  if (!Number.isFinite(exp)) return true;
  return exp > now;
}

/** ACTIVE | EXPIRED | FREE — display status for Admin Subscriptions. */
export function subscriptionStatus(state, now = Date.now()) {
  const plan = String(state?.plan || "free").toLowerCase();
  const exp = state?.expiresAt ? Date.parse(state.expiresAt) : NaN;
  if (plan !== "free" && Number.isFinite(exp) && exp <= now) return "EXPIRED";
  if (plan !== "free" && isVipActive(state, now)) return "ACTIVE";
  if (plan !== "free" && !Number.isFinite(exp)) return "ACTIVE";
  return "FREE";
}

export function displayPlan(state, now = Date.now()) {
  return subscriptionStatus(state, now) === "ACTIVE" ? "VIP" : "FREE";
}

/**
 * FREE servers may DM at most one member per send.
 * VIP keeps bulk send (caller still enforces the hard batch cap).
 * Returns an error string, or null when allowed.
 */
export function dmRecipientLimitError(stateOrPremium, memberIds, now = Date.now()) {
  const premium = typeof stateOrPremium === "boolean"
    ? stateOrPremium
    : isVipActive(stateOrPremium, now);
  const n = Array.isArray(memberIds) ? memberIds.length : 0;
  if (!premium && n > 1) {
    return "FREE plan allows only one DM recipient at a time. VIP unlocks bulk send.";
  }
  return null;
}

export const VOICE_CREATE_FREE_MAX = 1;
export const VOICE_CREATE_VIP_MAX = 5;

/** FREE: 1 Voice Create channel. VIP: up to 5. */
export function voiceCreateMaxChannels(stateOrPremium, now = Date.now()) {
  const premium = typeof stateOrPremium === "boolean"
    ? stateOrPremium
    : isVipActive(stateOrPremium, now);
  return premium ? VOICE_CREATE_VIP_MAX : VOICE_CREATE_FREE_MAX;
}

/**
 * Block adding beyond plan limit. Existing over-limit setups are kept:
 * saving the same or fewer profiles is allowed; only increases past max are rejected.
 */
export function voiceCreateLimitError(stateOrPremium, nextCount, currentCount = 0, now = Date.now()) {
  const max = voiceCreateMaxChannels(stateOrPremium, now);
  const next = Math.max(0, Number(nextCount) || 0);
  const current = Math.max(0, Number(currentCount) || 0);
  if (next > max && next > current) {
    return `Plan limit is ${max} Voice Create channel${max === 1 ? "" : "s"}. Remove a setup before adding another, or upgrade to VIP for up to ${VOICE_CREATE_VIP_MAX}.`;
  }
  return null;
}

export const REACTION_ROLE_FREE_MAX = 4;

/** FREE: 4 reaction-role mappings guild-wide. VIP: no hard cap. */
export function reactionRoleMaxLinks(stateOrPremium, now = Date.now()) {
  const premium = typeof stateOrPremium === "boolean"
    ? stateOrPremium
    : isVipActive(stateOrPremium, now);
  return premium ? Infinity : REACTION_ROLE_FREE_MAX;
}

/**
 * Block adding past FREE's 4 mappings. VIP uncapped.
 * Existing over-limit mappings are kept; only increases past max are rejected.
 */
export function reactionRoleLimitError(stateOrPremium, nextCount, currentCount = 0, now = Date.now()) {
  const max = reactionRoleMaxLinks(stateOrPremium, now);
  if (!Number.isFinite(max)) return null;
  const next = Math.max(0, Number(nextCount) || 0);
  const current = Math.max(0, Number(currentCount) || 0);
  if (next > max && next > current) {
    return `FREE plan allows up to ${max} reaction roles. Remove a mapping or upgrade to VIP to add more.`;
  }
  return null;
}

export function remainingVipMs(state, now = Date.now()) {
  if (!isVipActive(state, now) || !state?.expiresAt) return 0;
  const exp = Date.parse(state.expiresAt);
  if (!Number.isFinite(exp)) return 0;
  return Math.max(0, exp - now);
}

export function formatRemainingVip(state, now = Date.now()) {
  const ms = remainingVipMs(state, now);
  if (!ms) return "";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/**
 * Grant VIP when there is no active VIP. Starts from now.
 * If already active, returns { error, code: "already_active" }.
 */
export function computeGrantVip(current, days, now = new Date()) {
  const nowMs = now.getTime();
  if (isVipActive(current, nowMs)) {
    return { error: "Server already has active VIP. Use Extend VIP.", code: "already_active" };
  }
  const startsAt = now.toISOString();
  const { days: d, expiresAt } = addVipDurationDays(now, days);
  return {
    value: {
      plan: "vip",
      source: "admin_grant",
      startsAt,
      expiresAt
    },
    days: d,
    startsAt,
    expiresAt
  };
}

/**
 * Extend VIP: if active, add onto expiry; if expired/free, start from now.
 */
export function computeExtendVip(current, days, now = new Date()) {
  const nowMs = now.getTime();
  const active = isVipActive(current, nowMs);
  const base = active && current?.expiresAt && Date.parse(current.expiresAt) > nowMs
    ? new Date(Date.parse(current.expiresAt))
    : now;
  const startsAt = active && current?.startsAt ? String(current.startsAt) : now.toISOString();
  const { days: d, expiresAt } = addVipDurationDays(base, days);
  return {
    value: {
      plan: "vip",
      source: "admin_extend",
      startsAt,
      expiresAt
    },
    days: d,
    startsAt,
    expiresAt,
    extendedFrom: active ? "expiry" : "now"
  };
}

/**
 * VIP Code activation: FREE/expired only. Does not change an ACTIVE subscription.
 * Writes the same premium-plan shape via callers using writePremiumPlan.
 */
export function computeCodeActivation(current, days, now = new Date()) {
  const nowMs = now.getTime();
  if (isVipActive(current, nowMs)) {
    return {
      error: "This server already has an active VIP subscription. Use EXTEND VIP to add more time.",
      code: "already_active"
    };
  }
  const granted = computeGrantVip(current, days, now);
  return {
    value: { ...granted.value, source: "vip_code" },
    days: granted.days,
    startsAt: granted.startsAt,
    expiresAt: granted.expiresAt,
    previousExpiresAt: current?.expiresAt ? String(current.expiresAt) : "",
    message: `VIP activated for ${granted.days} days.`
  };
}

/**
 * VIP Code extension: ACTIVE only — add duration onto existing end (same math as computeExtendVip).
 * FREE/expired must use an Activation code.
 */
export function computeCodeExtension(current, days, now = new Date()) {
  const nowMs = now.getTime();
  if (!isVipActive(current, nowMs)) {
    return {
      error: "This code requires an active VIP subscription.",
      code: "requires_active"
    };
  }
  const extended = computeExtendVip(current, days, now);
  return {
    value: { ...extended.value, source: "vip_code" },
    days: extended.days,
    startsAt: extended.startsAt,
    expiresAt: extended.expiresAt,
    previousExpiresAt: current?.expiresAt ? String(current.expiresAt) : "",
    message: `VIP extended by ${extended.days} days.`
  };
}

/** Revoke VIP immediately — FREE plan only; does not touch other bot_config keys. */
export function computeRevokeVip(current, now = new Date()) {
  return {
    value: {
      plan: "free",
      source: "admin_revoke",
      startsAt: current?.startsAt ? String(current.startsAt) : "",
      expiresAt: current?.expiresAt ? String(current.expiresAt) : "",
      revokedAt: now.toISOString()
    }
  };
}

export function matchesSubscriptionSearch(row, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const name = String(row?.guildName || "").toLowerCase();
  const id = String(row?.guildId || "").toLowerCase();
  return name.includes(q) || id.includes(q);
}

export function buildSubscriptionRow({ guildId, guildName = "", ownerId = "", ownerName = "", icon = null, state, now = Date.now() }) {
  const status = subscriptionStatus(state, now);
  const plan = displayPlan(state, now);
  return {
    guildId: String(guildId),
    guildName: guildName || "",
    ownerId: ownerId || "",
    ownerName: ownerName || "",
    icon: icon || null,
    plan,
    status,
    startsAt: state?.startsAt || "",
    expiresAt: state?.expiresAt || "",
    remaining: formatRemainingVip(state, now),
    source: state?.source || ""
  };
}

/**
 * Control Center Premium page view-model from the same D1 premium-plan state
 * Admin Subscriptions grant/extend/revoke write. One VIP source of truth.
 */
export function buildPremiumViewModel(state, now = Date.now()) {
  const status = subscriptionStatus(state, now);
  const premium = isVipActive(state, now);
  return {
    plan: premium ? "vip" : "free",
    displayPlan: displayPlan(state, now),
    premium,
    status,
    source: status === "EXPIRED" ? "expired" : String(state?.source || ""),
    startsAt: state?.startsAt || "",
    expiresAt: state?.expiresAt || "",
    remaining: formatRemainingVip(state, now)
  };
}
