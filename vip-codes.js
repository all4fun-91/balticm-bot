/**
 * Pure VIP Codes helpers — format, generation, redeem eligibility.
 * Activation-only: codes never extend an active VIP subscription.
 * Subscription date math lives in admin-subscriptions.js (shared with Admin/Tebex).
 */

import {
  computeCodeActivation,
  isVipActive
} from "./admin-subscriptions.js";

export const VIP_CODE_PREFIX = "BM-VIP-";
export const VIP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const VIP_CODE_CUSTOM_MAX = 32;
export const VIP_CODE_ERROR = {
  invalid: "Invalid VIP code",
  expired: "Code expired",
  disabled: "Code disabled",
  maxUses: "Code usage limit reached",
  alreadyRedeemed: "This server has already redeemed this code",
  alreadyActive: "This server already has an active VIP subscription. Use EXTEND VIP to add more time.",
  duplicate: "This VIP code already exists.",
  invalidCustom: "Custom code must be 1–32 characters: A–Z, 0–9, hyphen, underscore (no spaces).",
  noPermission: "You do not have permission to manage this server."
};

/** Trim, uppercase, strip spaces. Keeps _ and - as distinct (custom codes). */
export function normalizeVipCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-");
}

export function isVipCodeFormat(code) {
  return /^BM-VIP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeVipCode(code));
}

/** Custom / auto code charset after normalize: A-Z 0-9 - _ , 1–32, no spaces. */
export function isValidCustomVipCode(code) {
  const n = normalizeVipCode(code);
  if (!n || n.length > VIP_CODE_CUSTOM_MAX) return false;
  return /^[A-Z0-9_-]+$/.test(n);
}

/** Accept auto BM-VIP-XXXX-XXXX or custom HALLOWEEN2026-style codes. */
export function isAcceptableVipCode(code) {
  const n = normalizeVipCode(code);
  if (!n) return false;
  return isVipCodeFormat(n) || isValidCustomVipCode(n);
}

/**
 * Tebex checkout coupons are not VIP codes — reject shapes that are neither
 * auto BM-VIP nor valid custom VIP charset (redeem looks up DB for the rest).
 */
export function isRejectedTebexCoupon(raw) {
  const code = normalizeVipCode(raw);
  if (!code) return false;
  if (isAcceptableVipCode(code)) return false;
  return true;
}

function randomChunk(getRandomValues, len = 4) {
  const alphabet = VIP_CODE_ALPHABET;
  const bytes = new Uint8Array(len);
  getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Cryptographically secure BM-VIP-XXXX-XXXX. */
export function generateVipCode(getRandomValues = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)) {
  if (typeof getRandomValues !== "function") {
    throw new Error("Secure random generator is required");
  }
  return `BM-VIP-${randomChunk(getRandomValues, 4)}-${randomChunk(getRandomValues, 4)}`;
}

/**
 * Validate + normalize a custom code for create. Returns { ok, code } or { ok:false, error }.
 */
export function parseCustomVipCode(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: VIP_CODE_ERROR.invalidCustom };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, error: VIP_CODE_ERROR.invalidCustom };
  }
  const code = normalizeVipCode(trimmed);
  if (!isValidCustomVipCode(code)) {
    return { ok: false, error: VIP_CODE_ERROR.invalidCustom };
  }
  return { ok: true, code };
}

/** Legacy type column — kept for old rows; redeem always treats as activation. */
export function normalizeCodeType(type) {
  const t = String(type || "").trim().toLowerCase();
  if (t === "activation" || t === "vip_activation" || t === "vip activation") return "activation";
  if (t === "extension" || t === "vip_extension" || t === "vip extension") return "extension";
  return "activation";
}

export function normalizeCodeStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "disabled" || s === "inactive") return "disabled";
  return "active";
}

export function parseCodeDurationDays(days, preset) {
  if (preset != null && preset !== "" && String(preset).toLowerCase() !== "custom") {
    const p = Number(preset);
    if ([7, 30, 90, 365].includes(p)) return p;
  }
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1 || n > 3650) return null;
  return n;
}

/**
 * Evaluate redeem eligibility before mutating subscription/uses.
 * Activation-only: never extends an active VIP. Ignores legacy type column.
 * Does not write — caller applies in one transaction.
 */
export function evaluateVipCodeRedeem({
  codeRow,
  premiumState,
  guildId,
  alreadyRedeemedGuild = false,
  now = new Date()
}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!codeRow || codeRow.deletedAt) {
    return { ok: false, error: VIP_CODE_ERROR.invalid, status: 400 };
  }
  const normalized = normalizeVipCode(codeRow.code || codeRow.codeNormalized);
  if (!normalized || !isAcceptableVipCode(normalized)) {
    return { ok: false, error: VIP_CODE_ERROR.invalid, status: 400 };
  }
  if (normalizeCodeStatus(codeRow.status) === "disabled") {
    return { ok: false, error: VIP_CODE_ERROR.disabled, status: 400 };
  }
  if (codeRow.expiresAt && Date.parse(codeRow.expiresAt) <= nowMs) {
    return { ok: false, error: VIP_CODE_ERROR.expired, status: 400 };
  }
  const maxUses = Math.max(1, Number(codeRow.maxUses) || 1);
  const usedCount = Math.max(0, Number(codeRow.usedCount) || 0);
  if (usedCount >= maxUses) {
    return { ok: false, error: VIP_CODE_ERROR.maxUses, status: 400 };
  }
  if (alreadyRedeemedGuild) {
    return { ok: false, error: VIP_CODE_ERROR.alreadyRedeemed, status: 409 };
  }
  if (!/^\d{16,22}$/.test(String(guildId || ""))) {
    return { ok: false, error: VIP_CODE_ERROR.noPermission, status: 403 };
  }

  const days = Math.max(1, Number(codeRow.durationDays) || 30);
  const computed = computeCodeActivation(premiumState, days, new Date(nowMs));
  if (computed.error) {
    return {
      ok: false,
      error: computed.error,
      code: computed.code,
      status: 409,
      premiumUnchanged: true,
      previousPremium: premiumState
    };
  }
  return {
    ok: true,
    type: "activation",
    days: computed.days,
    message: computed.message,
    value: computed.value,
    previousExpiresAt: computed.previousExpiresAt,
    resultingStartsAt: computed.startsAt,
    resultingExpiresAt: computed.expiresAt,
    wasActive: isVipActive(premiumState, nowMs)
  };
}

/**
 * In-memory redeem store for unit tests (mirrors D1 race rules).
 * One transaction: claim use + record guild redemption + apply plan.
 */
export function createVipCodeTestStore() {
  const codes = new Map();
  const redemptions = [];
  const plans = new Map();
  let lock = Promise.resolve();

  const withLock = (fn) => {
    const run = lock.then(fn, fn);
    lock = run.then(() => {}, () => {});
    return run;
  };

  return {
    codes,
    redemptions,
    plans,
    putCode(row) {
      const code = normalizeVipCode(row.code);
      if (!isAcceptableVipCode(code)) {
        throw new Error(VIP_CODE_ERROR.invalidCustom);
      }
      if (codes.has(code) && !codes.get(code).deletedAt) {
        throw new Error(VIP_CODE_ERROR.duplicate);
      }
      codes.set(code, {
        id: row.id || crypto.randomUUID(),
        code,
        codeNormalized: code,
        type: "activation",
        durationDays: Number(row.durationDays) || 30,
        maxUses: Math.max(1, Number(row.maxUses ?? row.maxRedemptions) || 1),
        usedCount: Math.max(0, Number(row.usedCount) || 0),
        status: normalizeCodeStatus(row.status),
        expiresAt: row.expiresAt || null,
        deletedAt: row.deletedAt || null,
        createdAt: row.createdAt || new Date().toISOString()
      });
      return codes.get(code);
    },
    createCode({ mode = "generate", customCode = "", durationDays = 30, maxUses = 1, status = "active", expiresAt = null } = {}) {
      let code;
      if (String(mode).toLowerCase() === "custom") {
        const parsed = parseCustomVipCode(customCode);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        if (codes.has(parsed.code) && !codes.get(parsed.code).deletedAt) {
          return { ok: false, error: VIP_CODE_ERROR.duplicate };
        }
        code = parsed.code;
      } else {
        for (let i = 0; i < 8; i++) {
          const candidate = generateVipCode();
          if (!codes.has(candidate) || codes.get(candidate).deletedAt) {
            code = candidate;
            break;
          }
        }
        if (!code) return { ok: false, error: "Could not allocate a unique VIP code" };
      }
      const row = this.putCode({ code, durationDays, maxUses, status, expiresAt });
      return { ok: true, code: row };
    },
    setPlan(guildId, state) {
      plans.set(String(guildId), { ...(state || { plan: "free" }) });
    },
    getPlan(guildId) {
      return plans.get(String(guildId)) || { plan: "free", source: "", startsAt: "", expiresAt: "" };
    },
    softDelete(code) {
      const row = codes.get(normalizeVipCode(code));
      if (row) row.deletedAt = new Date().toISOString();
    },
    setStatus(code, status) {
      const row = codes.get(normalizeVipCode(code));
      if (row) row.status = normalizeCodeStatus(status);
    },
    async redeem({ code, guildId, guildName = "", userId = "u1", username = "User", now = new Date() }) {
      return withLock(async () => {
        const normalized = normalizeVipCode(code);
        if (!normalized || isRejectedTebexCoupon(normalized) || !isAcceptableVipCode(normalized)) {
          return { ok: false, error: VIP_CODE_ERROR.invalid, status: 400 };
        }
        const row = codes.get(normalized);
        const already = redemptions.some(
          r => r.codeId === row?.id && String(r.guildId) === String(guildId) && r.result === "success"
        );
        const evaluated = evaluateVipCodeRedeem({
          codeRow: row,
          premiumState: this.getPlan(guildId),
          guildId,
          alreadyRedeemedGuild: already,
          now
        });
        if (!evaluated.ok) return evaluated;

        // Atomic claim of last use
        if (row.usedCount >= row.maxUses) {
          return { ok: false, error: VIP_CODE_ERROR.maxUses, status: 400 };
        }
        row.usedCount += 1;
        const prev = this.getPlan(guildId);
        this.setPlan(guildId, evaluated.value);
        const history = {
          id: crypto.randomUUID(),
          codeId: row.id,
          code: row.code,
          discordUserId: String(userId),
          discordUsername: String(username || ""),
          guildId: String(guildId),
          guildName: String(guildName || ""),
          redeemedAt: now.toISOString(),
          durationDays: evaluated.days,
          previousExpiresAt: evaluated.previousExpiresAt || prev.expiresAt || "",
          resultingStartsAt: evaluated.resultingStartsAt,
          resultingExpiresAt: evaluated.resultingExpiresAt,
          result: "success"
        };
        redemptions.push(history);
        return {
          ok: true,
          message: evaluated.message,
          expiresAt: evaluated.resultingExpiresAt,
          startsAt: evaluated.resultingStartsAt,
          days: evaluated.days,
          type: "activation",
          plan: evaluated.value,
          history
        };
      });
    }
  };
}
