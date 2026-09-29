/**
 * BalticM Owner Admin → Settings helpers.
 * Global read-only status only — no fake toggles, no secrets.
 */

import {
  REACTION_ROLE_FREE_MAX,
  VOICE_CREATE_VIP_MAX
} from "./admin-subscriptions.js";
import { TEBEX_VIP_DAYS } from "./tebex-vip.js";
import { buildTebexConfigStatus } from "./admin-tebex.js";

/** Settings that were requested but must not appear (runtime does not honor them). */
export const ADMIN_SETTINGS_SKIPPED = [
  {
    key: "maintenance_mode",
    reason: "No request path reads a maintenance flag — toggle would do nothing."
  },
  {
    key: "support_system_enabled",
    reason: "Support routes do not check a global enable flag — do not invent one."
  },
  {
    key: "public_premium_page_enabled",
    reason: "Public /premium has no enable flag — must not edit that page to add one."
  }
];

/** Real VIP plan constants from running code — display only, never editable here. */
export function buildPremiumLimitsReadonly() {
  return {
    defaultVipDurationDays: TEBEX_VIP_DAYS,
    freeReactionRolesLimit: REACTION_ROLE_FREE_MAX,
    vipReactionRolesLimit: "unlimited",
    vipVoiceCreateLimit: VOICE_CREATE_VIP_MAX,
    editable: false
  };
}

/**
 * Safe environment label — never account IDs or secrets.
 * Prefers explicit ENVIRONMENT / WRANGLER_ENV; otherwise "production".
 */
export function resolveEnvironmentLabel(env = {}) {
  const raw = String(env.ENVIRONMENT || env.WRANGLER_ENV || "").trim();
  if (raw) return raw.slice(0, 64);
  return "production";
}

/** Compact Discord/service status from /api/health-shaped service rows. */
export function summarizeHealthServices(services = []) {
  const list = Array.isArray(services) ? services : [];
  return {
    available: list.length > 0,
    ok: list.length > 0 && list.every((s) => !!s.ok),
    services: list.map((s) => ({
      name: String(s.name || ""),
      kind: String(s.kind || ""),
      ok: !!s.ok,
      status: Number(s.status) || 0
    }))
  };
}

/** Tebex configured yes/no from env presence — never token/secret values. */
export function buildTebexConfiguredStatus(env = {}) {
  const c = buildTebexConfigStatus(env);
  return {
    configured: !!c.connected,
    hasPublicToken: !!c.hasPublicToken,
    hasVipPackageId: !!c.hasVipPackageId,
    hasWebhookSecret: !!c.hasWebhookSecret
  };
}

const SECRET_PAYLOAD_RE =
  /"(?:TEBEX_WEBHOOK_SECRET|TEBEX_PUBLIC_TOKEN|TEBEX_PRIVATE_KEY|DISCORD_TOKEN|DISCORD_BOT_TOKEN|CLIENT_SECRET|OAUTH|webhookSecret|publicToken|privateKey|authorization|Authorization|token|secret)"\s*:/i;

export function adminSettingsPayloadHasNoSecrets(payload) {
  const text = JSON.stringify(payload || {});
  if (SECRET_PAYLOAD_RE.test(text)) return false;
  if (/sk_live|whsec_|Bot\s+[A-Za-z0-9._-]{20,}/i.test(text)) return false;
  return true;
}

/**
 * Assemble the GET /api/admin/settings body (caller supplies live DB/health pieces).
 */
export function buildAdminSettingsPayload({
  env = {},
  database = { status: "error" },
  healthServices = []
} = {}) {
  const premium = buildPremiumLimitsReadonly();
  const tebex = buildTebexConfiguredStatus(env);
  const discord = summarizeHealthServices(healthServices);
  return {
    ok: true,
    scope: "global_owner",
    editableKeys: [],
    skipped: ADMIN_SETTINGS_SKIPPED,
    general: {
      note: "No global toggles are live — runtime does not read maintenance/support/premium-page flags."
    },
    premium,
    system: {
      environment: resolveEnvironmentLabel(env),
      database: {
        status: database?.status === "ok" ? "ok" : "error",
        message: database?.message ? String(database.message).slice(0, 120) : ""
      },
      discord,
      tebex
    }
  };
}
