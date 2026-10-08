/**
 * Tournaments V1 — D1 persistence.
 * Tables are created with CREATE TABLE IF NOT EXISTS (the pattern used across
 * this worker), so deploying is non-destructive and future formats/columns can
 * be added with additive migrations only.
 */

import { buildPremiumViewModel } from "./admin-subscriptions.js";

export async function ensureTournamentTables(env) {
  if (!env.BALTICM_DB) throw new Error("BALTICM_DB binding is not configured");
  const db = env.BALTICM_DB;
  // Same schema the worker's ensureBotConfigTable creates — brandings and the
  // existing premium plan share this one config table (CREATE IF NOT EXISTS is
  // a no-op when it already exists).
  await db.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    game TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    banner_url TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT 'single_elimination',
    participant_type TEXT NOT NULL DEFAULT 'individuals',
    max_participants INTEGER NOT NULL DEFAULT 8,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    start_at TEXT NOT NULL DEFAULT '',
    registration_open INTEGER NOT NULL DEFAULT 0,
    registration_deadline TEXT NOT NULL DEFAULT '',
    public_registration INTEGER NOT NULL DEFAULT 0,
    announce_channel_id TEXT NOT NULL DEFAULT '',
    public_slug TEXT NOT NULL,
    champion_id TEXT NOT NULL DEFAULT '',
    rounds INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_slug ON tournaments(public_slug)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_tournaments_guild ON tournaments(guild_id, created_at DESC)").run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS tournament_participants (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'player',
    name TEXT NOT NULL,
    seed INTEGER NOT NULL DEFAULT 0,
    captain_discord_id TEXT NOT NULL DEFAULT '',
    captain_name TEXT NOT NULL DEFAULT '',
    discord_id TEXT NOT NULL DEFAULT '',
    logo_url TEXT NOT NULL DEFAULT '',
    registered_by TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT ''
  )`).run();
  // Backward-compatible column evolution for databases created before V1.1 —
  // additive only, never destructive (duplicate-column errors are expected).
  try {
    await db.prepare("ALTER TABLE tournament_participants ADD COLUMN logo_url TEXT NOT NULL DEFAULT ''").run();
  } catch {
    /* column already present */
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_tournament_participants_t ON tournament_participants(tournament_id, seed)").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_participants_name ON tournament_participants(tournament_id, name)").run();
  // One registration per Discord account per tournament (partial index keeps
  // manually added participants without a registrant out of the constraint).
  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_participants_registrant ON tournament_participants(tournament_id, registered_by) WHERE registered_by <> ''"
  ).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS tournament_team_members (
    id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL,
    tournament_id TEXT NOT NULL,
    discord_id TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_tournament_team_members_p ON tournament_team_members(participant_id, position)").run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS tournament_matches (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    round_index INTEGER NOT NULL,
    slot_index INTEGER NOT NULL,
    participant_a TEXT NOT NULL DEFAULT '',
    participant_b TEXT NOT NULL DEFAULT '',
    winner_id TEXT NOT NULL DEFAULT '',
    score_a INTEGER NOT NULL DEFAULT 0,
    score_b INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING',
    scheduled_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  )`).run();
  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_matches_slot ON tournament_matches(tournament_id, round_index, slot_index)"
  ).run();

  // Announcement/lifecycle ledger: one row per event key. INSERT OR IGNORE is
  // the idempotency claim — a replayed action cannot post twice.
  await db.prepare(`CREATE TABLE IF NOT EXISTS tournament_events (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
  )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_events_key ON tournament_events(tournament_id, event_key)").run();
}

const nowIso = () => new Date().toISOString();
const id = () => globalThis.crypto.randomUUID();

const BOOL_FIELDS = ["registration_open", "public_registration"];
/** camelCase payloads (validateTournamentInput / API handlers) → column names. */
const FIELD_ALIASES = {
  bannerUrl: "banner_url",
  participantType: "participant_type",
  maxParticipants: "max_participants",
  startAt: "start_at",
  registrationDeadline: "registration_deadline",
  registrationOpen: "registration_open",
  publicRegistration: "public_registration",
  announceChannelId: "announce_channel_id",
  championId: "champion_id",
  publicSlug: "public_slug"
};
const TOURNAMENT_EDITABLE = {
  name: "name",
  game: "game",
  description: "description",
  banner_url: "banner_url",
  format: "format",
  participant_type: "participant_type",
  max_participants: "max_participants",
  status: "status",
  start_at: "start_at",
  registration_deadline: "registration_deadline",
  registration_open: "registration_open",
  public_registration: "public_registration",
  announce_channel_id: "announce_channel_id",
  champion_id: "champion_id",
  rounds: "rounds",
  public_slug: "public_slug"
};

/* ---------------------------------------------------------------- tournaments */

export async function listTournaments(env, guildId, { q = "", status = "" } = {}) {
  const rows = await env.BALTICM_DB.prepare(
    "SELECT * FROM tournaments WHERE guild_id=? ORDER BY created_at DESC LIMIT 500"
  )
    .bind(String(guildId))
    .all();
  let list = (rows.results || []).map(tournamentRow);
  const needle = String(q || "").trim().toLowerCase();
  if (needle) list = list.filter(t => (t.name + " " + t.game).toLowerCase().includes(needle));
  const st = String(status || "").trim().toUpperCase();
  if (st && st !== "ALL") list = list.filter(t => t.status === st);
  return list;
}

export function tournamentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    game: row.game || "",
    description: row.description || "",
    bannerUrl: row.banner_url || "",
    format: row.format || "single_elimination",
    participantType: row.participant_type || "individuals",
    maxParticipants: Number(row.max_participants) || 8,
    status: row.status || "DRAFT",
    startAt: row.start_at || "",
    registrationOpen: !!Number(row.registration_open),
    registrationDeadline: row.registration_deadline || "",
    publicRegistration: !!Number(row.public_registration),
    announceChannelId: row.announce_channel_id || "",
    publicSlug: row.public_slug || "",
    championId: row.champion_id || "",
    rounds: Number(row.rounds) || 0,
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

export async function getTournament(env, tournamentId) {
  const row = await env.BALTICM_DB.prepare("SELECT * FROM tournaments WHERE id=?")
    .bind(String(tournamentId))
    .first();
  return tournamentRow(row);
}

export async function getTournamentBySlug(env, slug) {
  const row = await env.BALTICM_DB.prepare("SELECT * FROM tournaments WHERE public_slug=?")
    .bind(String(slug))
    .first();
  return tournamentRow(row);
}

export async function insertTournament(env, tournament) {
  await env.BALTICM_DB.prepare(
    `INSERT INTO tournaments (id,guild_id,name,game,description,banner_url,format,participant_type,max_participants,status,start_at,registration_open,registration_deadline,public_registration,announce_channel_id,public_slug,champion_id,rounds,created_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      tournament.id,
      tournament.guildId,
      tournament.name,
      tournament.game,
      tournament.description,
      tournament.bannerUrl,
      tournament.format,
      tournament.participantType,
      tournament.maxParticipants,
      tournament.status,
      tournament.startAt,
      tournament.registrationOpen ? 1 : 0,
      tournament.registrationDeadline,
      tournament.publicRegistration ? 1 : 0,
      tournament.announceChannelId,
      tournament.publicSlug,
      tournament.championId,
      tournament.rounds,
      tournament.createdBy,
      tournament.createdAt,
      tournament.updatedAt
    )
    .run();
  return tournament;
}

/** Allowlisted dynamic UPDATE — unknown keys are ignored, never interpolated raw. */
export async function updateTournament(env, tournamentId, fields) {
  const sets = [];
  const binds = [];
  for (const [key, column] of Object.entries(TOURNAMENT_EDITABLE)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key) && !Object.values(FIELD_ALIASES).includes(column)) continue;
    const alias = Object.keys(FIELD_ALIASES).find(k => FIELD_ALIASES[k] === column && Object.prototype.hasOwnProperty.call(fields, k));
    if (!Object.prototype.hasOwnProperty.call(fields, key) && !alias) continue;
    const value = fields[alias || key];
    sets.push(`${column}=?`);
    binds.push(BOOL_FIELDS.includes(column) ? (value ? 1 : 0) : typeof value === "number" ? value : String(value ?? ""));
  }
  if (!sets.length) return false;
  sets.push("updated_at=?");
  binds.push(nowIso());
  binds.push(String(tournamentId));
  await env.BALTICM_DB.prepare(`UPDATE tournaments SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();
  return true;
}

export async function deleteTournament(env, tournamentId) {
  const tid = String(tournamentId);
  await env.BALTICM_DB.batch([
    env.BALTICM_DB.prepare("DELETE FROM tournament_matches WHERE tournament_id=?").bind(tid),
    env.BALTICM_DB.prepare(
      "DELETE FROM tournament_team_members WHERE participant_id IN (SELECT id FROM tournament_participants WHERE tournament_id=?)"
    ).bind(tid),
    env.BALTICM_DB.prepare("DELETE FROM tournament_participants WHERE tournament_id=?").bind(tid),
    env.BALTICM_DB.prepare("DELETE FROM tournament_events WHERE tournament_id=?").bind(tid),
    env.BALTICM_DB.prepare("DELETE FROM tournaments WHERE id=?").bind(tid)
  ]);
  return true;
}

/* --------------------------------------------------------------- participants */

export function participantRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    guildId: row.guild_id,
    kind: row.kind || "player",
    name: row.name,
    seed: Number(row.seed) || 0,
    captainDiscordId: row.captain_discord_id || "",
    captainName: row.captain_name || "",
    discordId: row.discord_id || "",
    logoUrl: row.logo_url || "",
    registeredBy: row.registered_by || "",
    source: row.source || "manual",
    createdAt: row.created_at || ""
  };
}

export async function listParticipants(env, tournamentId) {
  const rows = await env.BALTICM_DB.prepare(
    "SELECT * FROM tournament_participants WHERE tournament_id=? ORDER BY seed ASC, created_at ASC, name ASC"
  )
    .bind(String(tournamentId))
    .all();
  const people = (rows.results || []).map(participantRow);
  const memberRows = await env.BALTICM_DB.prepare(
    "SELECT * FROM tournament_team_members WHERE tournament_id=? ORDER BY position ASC"
  )
    .bind(String(tournamentId))
    .all();
  const byParticipant = new Map();
  for (const m of memberRows.results || []) {
    const entry = { discordId: m.discord_id || "", displayName: m.display_name || "" };
    if (!byParticipant.has(m.participant_id)) byParticipant.set(m.participant_id, []);
    byParticipant.get(m.participant_id).push(entry);
  }
  for (const p of people) p.members = byParticipant.get(p.id) || [];
  return people;
}

export async function countParticipants(env, tournamentId) {
  const row = await env.BALTICM_DB.prepare("SELECT COUNT(*) AS n FROM tournament_participants WHERE tournament_id=?")
    .bind(String(tournamentId))
    .first();
  return Number(row?.n) || 0;
}

export async function findParticipantByRegistrant(env, tournamentId, discordId) {
  const row = await env.BALTICM_DB.prepare(
    "SELECT * FROM tournament_participants WHERE tournament_id=? AND registered_by=?"
  )
    .bind(String(tournamentId), String(discordId))
    .first();
  return participantRow(row);
}

export async function findParticipantByName(env, tournamentId, name) {
  const row = await env.BALTICM_DB.prepare(
    "SELECT * FROM tournament_participants WHERE tournament_id=? AND LOWER(name)=LOWER(?)"
  )
    .bind(String(tournamentId), String(name))
    .first();
  return participantRow(row);
}

/**
 * Is this Discord identity already part of the tournament — as registrant,
 * linked player, captain or team member? Used to prevent one account from
 * occupying multiple slots where identity is known.
 */
export async function findParticipantByMember(env, tournamentId, discordId) {
  const row = await env.BALTICM_DB.prepare(
    `SELECT * FROM tournament_participants
     WHERE tournament_id=? AND (
       registered_by=? OR discord_id=? OR captain_discord_id=? OR
       EXISTS(SELECT 1 FROM tournament_team_members m WHERE m.participant_id=tournament_participants.id AND m.discord_id=?)
     )`
  )
    .bind(String(tournamentId), String(discordId), String(discordId), String(discordId), String(discordId))
    .first();
  return participantRow(row);
}

export async function insertParticipant(env, p) {
  const row = {
    id: id(),
    tournamentId: String(p.tournamentId),
    guildId: String(p.guildId),
    kind: p.kind === "team" ? "team" : "player",
    name: String(p.name),
    seed: Number(p.seed) || 0,
    captainDiscordId: p.captainDiscordId || "",
    captainName: p.captainName || "",
    discordId: p.discordId || "",
    logoUrl: p.logoUrl || "",
    registeredBy: p.registeredBy || "",
    source: p.source === "public" ? "public" : "manual",
    createdAt: nowIso()
  };
  await env.BALTICM_DB.prepare(
    `INSERT INTO tournament_participants (id,tournament_id,guild_id,kind,name,seed,captain_discord_id,captain_name,discord_id,logo_url,registered_by,source,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      row.id,
      row.tournamentId,
      row.guildId,
      row.kind,
      row.name,
      row.seed,
      row.captainDiscordId,
      row.captainName,
      row.discordId,
      row.logoUrl,
      row.registeredBy,
      row.source,
      row.createdAt
    )
    .run();
  const members = Array.isArray(p.members) ? p.members : [];
  for (let i = 0; i < members.length; i++) {
    const m = members[i] || {};
    await env.BALTICM_DB.prepare(
      "INSERT INTO tournament_team_members (id,participant_id,tournament_id,discord_id,display_name,position) VALUES (?,?,?,?,?,?)"
    )
      .bind(id(), row.id, row.tournamentId, m.discordId || "", m.displayName || "", i)
      .run();
  }
  row.members = members;
  return row;
}

export async function updateParticipant(env, participantId, fields) {
  const sets = [];
  const binds = [];
  if (Object.prototype.hasOwnProperty.call(fields, "name")) {
    sets.push("name=?");
    binds.push(String(fields.name));
  }
  if (Object.prototype.hasOwnProperty.call(fields, "captainDiscordId")) {
    sets.push("captain_discord_id=?");
    binds.push(String(fields.captainDiscordId || ""));
  }
  if (Object.prototype.hasOwnProperty.call(fields, "captainName")) {
    sets.push("captain_name=?");
    binds.push(String(fields.captainName || ""));
  }
  if (Object.prototype.hasOwnProperty.call(fields, "discordId")) {
    sets.push("discord_id=?");
    binds.push(String(fields.discordId || ""));
  }
  if (Object.prototype.hasOwnProperty.call(fields, "logoUrl")) {
    sets.push("logo_url=?");
    binds.push(String(fields.logoUrl || ""));
  }
  if (!sets.length) return false;
  binds.push(String(participantId));
  await env.BALTICM_DB.prepare(`UPDATE tournament_participants SET ${sets.join(", ")} WHERE id=?`).bind(...binds).run();

  if (Object.prototype.hasOwnProperty.call(fields, "members") && Array.isArray(fields.members)) {
    await env.BALTICM_DB.batch([
      env.BALTICM_DB.prepare("DELETE FROM tournament_team_members WHERE participant_id=?").bind(String(participantId)),
      ...fields.members.map((m, i) =>
        env.BALTICM_DB.prepare(
          "INSERT INTO tournament_team_members (id,participant_id,tournament_id,discord_id,display_name,position) VALUES (?,?,?,?,?,?)"
        ).bind(id(), String(participantId), String(fields.tournamentId || ""), m.discordId || "", m.displayName || "", i)
      )
    ]);
  }
  return true;
}

export async function deleteParticipant(env, participantId) {
  await env.BALTICM_DB.batch([
    env.BALTICM_DB.prepare("DELETE FROM tournament_team_members WHERE participant_id=?").bind(String(participantId)),
    env.BALTICM_DB.prepare("DELETE FROM tournament_participants WHERE id=?").bind(String(participantId))
  ]);
  return true;
}

/** Persist the admin's seed order (array of participant ids, position = index + 1). */
export async function replaceSeeds(env, tournamentId, orderedIds) {
  const statements = orderedIds.map((pid, index) =>
    env.BALTICM_DB.prepare("UPDATE tournament_participants SET seed=? WHERE id=? AND tournament_id=?")
      .bind(index + 1, String(pid), String(tournamentId))
  );
  await env.BALTICM_DB.batch(statements);
}

/* ------------------------------------------------------------------- matches */

export function matchRow(row) {
  if (!row) return null;
  return {
    id: row.id || "",
    tournamentId: row.tournament_id,
    roundIndex: Number(row.round_index) || 0,
    slotIndex: Number(row.slot_index) || 0,
    participantA: row.participant_a || "",
    participantB: row.participant_b || "",
    winnerId: row.winner_id || "",
    scoreA: Number(row.score_a) || 0,
    scoreB: Number(row.score_b) || 0,
    status: row.status || "PENDING",
    scheduledAt: row.scheduled_at || ""
  };
}

export async function listMatches(env, tournamentId) {
  const rows = await env.BALTICM_DB.prepare(
    "SELECT * FROM tournament_matches WHERE tournament_id=? ORDER BY round_index ASC, slot_index ASC"
  )
    .bind(String(tournamentId))
    .all();
  return (rows.results || []).map(r => matchRow(r));
}

/** Replace the whole bracket (generation/regeneration). Runs in one batch. */
export async function replaceMatches(env, tournamentId, matches) {
  const tid = String(tournamentId);
  const statements = [env.BALTICM_DB.prepare("DELETE FROM tournament_matches WHERE tournament_id=?").bind(tid)];
  for (const m of matches) {
    statements.push(
      env.BALTICM_DB.prepare(
        `INSERT INTO tournament_matches (id,tournament_id,round_index,slot_index,participant_a,participant_b,winner_id,score_a,score_b,status,scheduled_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id(),
        tid,
        Number(m.roundIndex),
        Number(m.slotIndex),
        m.participantA || "",
        m.participantB || "",
        m.winnerId || "",
        Number(m.scoreA) || 0,
        Number(m.scoreB) || 0,
        m.status || "PENDING",
        m.scheduledAt || "",
        nowIso()
      )
    );
  }
  await env.BALTICM_DB.batch(statements);
  return listMatches(env, tournamentId);
}

/**
 * Persist match state after a result. Written as one batched upsert so a
 * partial write can never leave a half-advanced bracket.
 */
export async function saveMatches(env, tournamentId, matches) {
  const tid = String(tournamentId);
  const statements = (matches || []).map(m =>
    env.BALTICM_DB.prepare(
      `INSERT INTO tournament_matches (id,tournament_id,round_index,slot_index,participant_a,participant_b,winner_id,score_a,score_b,status,scheduled_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(tournament_id,round_index,slot_index) DO UPDATE SET
         participant_a=excluded.participant_a,
         participant_b=excluded.participant_b,
         winner_id=excluded.winner_id,
         score_a=excluded.score_a,
         score_b=excluded.score_b,
         status=excluded.status,
         scheduled_at=excluded.scheduled_at,
         updated_at=excluded.updated_at`
    ).bind(
      m.id || id(),
      tid,
      Number(m.roundIndex),
      Number(m.slotIndex),
      m.participantA || "",
      m.participantB || "",
      m.winnerId || "",
      Number(m.scoreA) || 0,
      Number(m.scoreB) || 0,
      m.status || "PENDING",
      m.scheduledAt || "",
      nowIso()
    )
  );
  if (statements.length) await env.BALTICM_DB.batch(statements);
  return true;
}

/* ---------------------------------------------------------------- branding */

/**
 * Guild Tournament branding lives in the existing bot_config table under a
 * dedicated key (same pattern as premium-plan:<guildId>) — no second config
 * system, natural per-guild isolation, additive only.
 */
const brandingKey = (guildId) => `tournament-branding:${guildId}`;
const premiumKey = (guildId) => `premium-plan:${guildId}`;

/** Stored configuration — returned regardless of Premium state (expiry never deletes it). */
export async function readTournamentBranding(env, guildId) {
  if (!guildId) return { name: "", logoUrl: "" };
  try {
    const row = await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key=?")
      .bind(brandingKey(guildId))
      .first();
    if (!row?.value) return { name: "", logoUrl: "" };
    const v = JSON.parse(row.value);
    return { name: String(v.name || "").slice(0, 120), logoUrl: String(v.logoUrl || "").slice(0, 300) };
  } catch {
    return { name: "", logoUrl: "" };
  }
}

export async function writeTournamentBranding(env, guildId, value) {
  const payload = JSON.stringify({ name: String(value?.name || ""), logoUrl: String(value?.logoUrl || "") });
  await env.BALTICM_DB.prepare(
    "INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
  )
    .bind(brandingKey(guildId), payload, new Date().toISOString())
    .run();
  return { name: String(value?.name || ""), logoUrl: String(value?.logoUrl || "") };
}

/**
 * Is Premium currently active for this guild? Reads the SAME premium-plan row
 * and applies the SAME buildPremiumViewModel logic the rest of the Control
 * Center uses — this is a reader, not a second Premium implementation.
 */
export async function guildPremiumActive(env, guildId) {
  if (!guildId) return false;
  try {
    const row = await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key=?")
      .bind(premiumKey(guildId))
      .first();
    if (!row?.value) return false;
    const v = JSON.parse(row.value);
    const state = {
      plan: String(v.plan || "free"),
      source: String(v.source || ""),
      startsAt: String(v.startsAt || ""),
      expiresAt: String(v.expiresAt || ""),
      revokedAt: v.revokedAt ? String(v.revokedAt) : undefined,
      code: v.code ? String(v.code) : undefined
    };
    return !!buildPremiumViewModel(state, Date.now()).premium;
  } catch {
    return false;
  }
}

/**
 * Effective public/Discord branding: custom identity only while Premium is
 * active AND a name is configured; otherwise BalticM defaults. Stored config
 * is never modified here — expiry simply stops applying it.
 */
/* Guild icon as the FREE visual fallback. The icon hash is cached in the same
   bot_config table (10 min TTL) so public-page loads never hammer Discord; a
   failed lookup caches the miss briefly and the caller falls back gracefully. */
const GUILD_ICON_TTL_MS = 10 * 60 * 1000;
const guildIconKey = (guildId) => `guild-icon:${guildId}`;

function guildIconCdn(guildId, hash) {
  const gid = String(guildId || "");
  const h = String(hash || "");
  if (!/^\d{16,22}$/.test(gid) || !h) return "";
  const ext = h.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${gid}/${h}.${ext}?size=64`;
}

/** Best-effort resolved logo of the active Discord guild (cached, never throws). */
export async function guildIconUrl(env, guildId) {
  const gid = String(guildId || "");
  if (!gid) return "";
  try {
    const row = await env.BALTICM_DB.prepare("SELECT value, updated_at AS updatedAt FROM bot_config WHERE key=?")
      .bind(guildIconKey(gid)).first();
    const at = row ? Date.parse(row.updatedAt || "") : 0;
    if (row && Number.isFinite(at) && Date.now() - at < GUILD_ICON_TTL_MS) {
      try { return guildIconCdn(gid, JSON.parse(row.value).icon); } catch { return ""; }
    }
  } catch {}
  let hash = "";
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${gid}`, {
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN || ""}` }
    });
    if (res && res.ok) {
      const g = await res.json();
      hash = String(g?.icon || "");
    }
  } catch {}
  try {
    await env.BALTICM_DB.prepare(
      "INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
    ).bind(guildIconKey(gid), JSON.stringify({ icon: hash }), new Date().toISOString()).run();
  } catch {}
  return guildIconCdn(gid, hash);
}

/**
 * ONE shared resolved branding model for every surface (admin preview, public
 * page header, Discord announcements):
 *   logo priority: premium custom logo → active Discord guild icon → BalticM default ("").
 *   Name override stays Premium-only; the guild icon fallback is free.
 */
export async function effectiveTournamentBranding(env, guildId) {
  const [stored, premium] = await Promise.all([readTournamentBranding(env, guildId), guildPremiumActive(env, guildId)]);
  const custom = !!(premium && stored.name);
  let logoUrl = "";
  let logoSource = "";
  if (custom && stored.logoUrl) {
    logoUrl = stored.logoUrl;
    logoSource = "custom";
  } else {
    const icon = await guildIconUrl(env, guildId);
    if (icon) {
      logoUrl = icon;
      logoSource = "guild";
    }
  }
  return { custom, name: custom ? stored.name : "", logoUrl, logoSource, stored, premium };
}

/* -------------------------------------------------------- announcement ledger */

/** Claim an event key. Returns true only for the first claim (idempotency). */
export async function claimTournamentEvent(env, tournamentId, eventKey) {
  try {
    const res = await env.BALTICM_DB.prepare(
      "INSERT OR IGNORE INTO tournament_events (id,tournament_id,event_key,message_id,created_at) VALUES (?,?,?,'',?)"
    )
      .bind(id(), String(tournamentId), String(eventKey), nowIso())
      .run();
    return Number(res?.meta?.changes || 0) > 0;
  } catch {
    return false;
  }
}

/** Give the claim back when the Discord send failed, so a retry can post. */
export async function releaseTournamentEvent(env, tournamentId, eventKey) {
  try {
    await env.BALTICM_DB.prepare("DELETE FROM tournament_events WHERE tournament_id=? AND event_key=?")
      .bind(String(tournamentId), String(eventKey))
      .run();
  } catch {}
}
