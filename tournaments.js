/**
 * Tournaments V1 — pure domain logic (no I/O, no Discord, no database).
 *
 * V1 ships Single Elimination only. The format field and validation are
 * table-driven so Group Stage / Double Elimination / Round Robin can be added
 * later without a destructive migration: new formats are additive enum values.
 */

export const TOURNAMENT_FORMAT = "single_elimination";
/** All formats the schema already accepts; only the first one is implemented. */
export const TOURNAMENT_FORMATS = ["single_elimination", "group_stage", "double_elimination", "round_robin"];
export const SUPPORTED_FORMATS = ["single_elimination"];
export const PARTICIPANT_TYPES = ["teams", "individuals"];
export const MAX_PARTICIPANTS_OPTIONS = [4, 8, 16, 32];
export const TOURNAMENT_STATUSES = ["DRAFT", "REGISTRATION", "UPCOMING", "LIVE", "FINISHED"];
export const MAX_SCORE = 999;
export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 1000;
export const MAX_BRANDING_NAME = 48;

/** Allowed status moves. FINISHED is only ever set automatically by a completed final. */
const STATUS_MOVES = {
  DRAFT: ["REGISTRATION", "UPCOMING"],
  REGISTRATION: ["UPCOMING", "DRAFT"],
  UPCOMING: ["LIVE", "REGISTRATION", "DRAFT"],
  LIVE: ["FINISHED", "UPCOMING"],
  FINISHED: []
};

export function canTransition(from, to) {
  const f = String(from || "").toUpperCase();
  const t = String(to || "").toUpperCase();
  if (!TOURNAMENT_STATUSES.includes(f) || !TOURNAMENT_STATUSES.includes(t)) return false;
  if (t === "FINISHED") return false; // set automatically when the final completes
  return (STATUS_MOVES[f] || []).includes(t);
}

const clean = (v) => String(v ?? "").trim();
const SNOWFLAKE = /^\d{16,22}$/;

function textError(value, label, { required = false, max = MAX_NAME } = {}) {
  const v = clean(value);
  if (!v) return required ? `${label} is required.` : null;
  if (v.length > max) return `${label} must be ${max} characters or fewer.`;
  return null;
}

function parseDate(value, label, { required = false } = {}) {
  const v = clean(value);
  if (!v) return required ? `${label} is required.` : null;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return `${label} must be a valid date and time.`;
  return null;
}

function httpsUrl(value, label) {
  const v = clean(value);
  if (!v) return null;
  let url;
  try {
    url = new URL(v);
  } catch {
    return `${label} must be a valid URL.`;
  }
  if (url.protocol !== "https:") return `${label} must use https://.`;
  if (v.length > 300) return `${label} must be 300 characters or fewer.`;
  return null;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const v = String(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

/**
 * Validate a create/update payload.
 * `partial: true` only validates the keys that are present (used by PATCH).
 */
export function validateTournamentInput(body, { partial = false } = {}) {
  const src = body && typeof body === "object" ? body : {};
  const present = (k) => Object.prototype.hasOwnProperty.call(src, k);
  if (!partial && !present("name")) return { ok: false, error: "Tournament name is required." };
  const value = {};
  const fail = (msg) => ({ ok: false, error: msg });

  if (!partial || present("name")) {
    const err = textError(src.name, "Tournament name", { required: true, max: MAX_NAME });
    if (err) return fail(err);
    value.name = clean(src.name);
  }
  if (!partial || present("game")) {
    const err = textError(src.game, "Game name", { required: true, max: MAX_NAME });
    if (err) return fail(err);
    value.game = clean(src.game);
  }
  if (present("description")) {
    const err = textError(src.description, "Description", { max: MAX_DESCRIPTION });
    if (err) return fail(err);
    value.description = clean(src.description);
  }
  if (present("bannerUrl")) {
    const err = httpsUrl(src.bannerUrl, "Banner image URL");
    if (err) return fail(err);
    value.bannerUrl = clean(src.bannerUrl);
  }
  if (present("format")) {
    const fmt = clean(src.format) || TOURNAMENT_FORMAT;
    if (!TOURNAMENT_FORMATS.includes(fmt)) return fail("Unknown tournament format.");
    if (!SUPPORTED_FORMATS.includes(fmt)) return fail("That format is not available yet. V1 supports Single Elimination.");
    value.format = fmt;
  }
  if (present("participantType")) {
    const t = clean(src.participantType).toLowerCase();
    if (!PARTICIPANT_TYPES.includes(t)) return fail("Participant type must be teams or individual players.");
    value.participantType = t;
  }
  if (present("maxParticipants")) {
    const n = Number(src.maxParticipants);
    if (!MAX_PARTICIPANTS_OPTIONS.includes(n)) return fail("Maximum participants must be 4, 8, 16 or 32.");
    value.maxParticipants = n;
  }
  if (!partial || present("startAt")) {
    const err = parseDate(src.startAt, "Start date/time", { required: true });
    if (err) return fail(err);
    value.startAt = new Date(Date.parse(src.startAt)).toISOString();
  }
  if (present("registrationDeadline")) {
    const err = parseDate(src.registrationDeadline, "Registration deadline");
    if (err) return fail(err);
    // The UI always sends this key; an empty value means "no deadline" and
    // must never reach toISOString (Date.parse("") is NaN → RangeError 500).
    value.registrationDeadline = clean(src.registrationDeadline)
      ? new Date(Date.parse(src.registrationDeadline)).toISOString()
      : "";
  }
  if (present("registrationOpen")) value.registrationOpen = bool(src.registrationOpen, false);
  if (present("publicRegistration")) value.publicRegistration = bool(src.publicRegistration, false);
  if (present("announceChannelId")) {
    const id = clean(src.announceChannelId);
    if (id && !SNOWFLAKE.test(id)) return fail("Announcement channel must be a Discord channel id.");
    value.announceChannelId = id;
  }
  if (present("status")) {
    const s = clean(src.status).toUpperCase();
    if (!TOURNAMENT_STATUSES.includes(s)) return fail("Unknown tournament status.");
    value.status = s;
  }
  if (partial && !Object.keys(value).length) return fail("No valid fields to update.");
  return { ok: true, value };
}

/** Manual/public participant payload. `tournament` supplies type + capacity rules. */
export function validateParticipantInput(body, tournament) {
  const src = body && typeof body === "object" ? body : {};
  const teams = String(tournament?.participantType || "") === "teams";
  const name = clean(teams ? src.teamName ?? src.name : src.name ?? src.teamName);
  if (!name) return { ok: false, error: teams ? "Team name is required." : "Participant name is required." };
  if (name.length > MAX_NAME) return { ok: false, error: `Name must be ${MAX_NAME} characters or fewer.` };

  const captainId = clean(src.captainDiscordId || src.captainId);
  if (captainId && !SNOWFLAKE.test(captainId)) return { ok: false, error: "Captain must be a Discord user id." };

  const logoErr = teams ? httpsUrl(src.logoUrl || src.logo, "Team logo URL") : null;
  if (logoErr) return { ok: false, error: logoErr };

  const members = [];
  const seenIds = new Set();
  const rawMembers = Array.isArray(src.members) ? src.members : [];
  if (rawMembers.length > 50) return { ok: false, error: "A team can have at most 50 members." };
  for (const raw of rawMembers) {
    const entry = raw && typeof raw === "object" ? raw : { displayName: clean(raw) };
    const discordId = clean(entry.discordId);
    const displayName = clean(entry.displayName || entry.name);
    if (discordId && !SNOWFLAKE.test(discordId)) return { ok: false, error: "Team members must use Discord user ids." };
    if (!discordId && !displayName) continue;
    if (discordId) {
      if (seenIds.has(discordId)) return { ok: false, error: "The same Discord user appears twice in this team." };
      seenIds.add(discordId);
    }
    members.push({ discordId, displayName: displayName.slice(0, MAX_NAME) });
  }
  return {
    ok: true,
    value: {
      name,
      logoUrl: teams ? clean(src.logoUrl || src.logo) : "",
      captainDiscordId: captainId,
      captainName: clean(src.captainName).slice(0, MAX_NAME),
      members
    }
  };
}

/* ------------------------------------------------------------------ bracket */

/** Smallest bracket (power of two, minimum 2) that fits `count` participants. */
export function bracketSizeFor(count) {
  const n = Math.max(2, Math.floor(Number(count) || 0));
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

/** Classic balanced seeding: 1v8/4v5/2v7/3v6 for 8 slots, etc. */
export function standardSeedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const len = order.length;
    const next = [];
    for (const seed of order) {
      next.push(seed);
      next.push(len * 2 + 1 - seed);
    }
    order = next;
  }
  return order.slice(0, size);
}

/** Round labels for 2/4/8/16/32/64 slot brackets. */
export function roundName(roundIndex, size) {
  const remaining = size / Math.pow(2, roundIndex);
  if (remaining === 2) return "Final";
  if (remaining === 4) return "Semifinals";
  if (remaining === 8) return size === 8 && roundIndex === 0 ? "Round 1" : "Quarterfinals";
  if (remaining === 16) return "Round of 16";
  if (remaining === 32) return "Round of 32";
  if (remaining === 64) return "Round of 64";
  return `Round of ${remaining}`;
}

export function totalRoundsFor(size) {
  return Math.log2(size);
}

export function nextMatchRef(roundIndex, slotIndex, rounds) {
  const r = Number(roundIndex);
  const s = Number(slotIndex);
  if (!Number.isInteger(r) || !Number.isInteger(s) || r + 1 >= rounds) return null;
  return { roundIndex: r + 1, slotIndex: Math.floor(s / 2), slot: s % 2 === 0 ? "participantA" : "participantB" };
}

export function findMatch(matches, roundIndex, slotIndex) {
  return (matches || []).find(m => Number(m.roundIndex) === Number(roundIndex) && Number(m.slotIndex) === Number(slotIndex)) || null;
}

/**
 * Build a single-elimination bracket from seeded participants.
 * BYEs are resolved immediately: a seeded participant paired with an empty slot
 * wins by default and advances.
 */
export function generateBracket(participants) {
  const list = (participants || [])
    .map(p => ({ id: String(p.id || ""), name: clean(p.name), seed: Number(p.seed) || 0 }))
    .filter(p => p.id)
    .sort((a, b) => a.seed - b.seed || a.name.localeCompare(b.name));
  if (list.length < 2) return { ok: false, error: "At least 2 participants are required to generate a bracket." };
  if (list.length > 64) return { ok: false, error: "A single-elimination bracket supports up to 64 participants." };

  const size = bracketSizeFor(list.length);
  const rounds = totalRoundsFor(size);
  const order = standardSeedOrder(size).map(n => list[n - 1] || null);

  const matches = [];
  for (let r = 0; r < rounds; r++) {
    const matchCount = size / Math.pow(2, r + 1);
    for (let s = 0; s < matchCount; s++) {
      matches.push({
        roundIndex: r,
        slotIndex: s,
        participantA: r === 0 ? order[2 * s]?.id || "" : "",
        participantB: r === 0 ? order[2 * s + 1]?.id || "" : "",
        winnerId: "",
        scoreA: 0,
        scoreB: 0,
        status: "PENDING",
        scheduledAt: ""
      });
    }
  }
  // First-round BYEs: exactly one participant present.
  for (const m of matches.filter(x => x.roundIndex === 0)) {
    if (m.participantA && !m.participantB) {
      m.status = "BYE";
      m.winnerId = m.participantA;
    } else if (!m.participantA && m.participantB) {
      m.status = "BYE";
      m.winnerId = m.participantB;
    }
  }
  return { ok: true, size, rounds, matches: propagateMatches(matches) };
}

/**
 * Walk rounds in order: recompute each match status and feed every known
 * winner into the next match. Safe to call repeatedly (idempotent).
 */
export function propagateMatches(input) {
  const matches = (input || []).map(m => ({ ...m }));
  matches.sort((a, b) => a.roundIndex - b.roundIndex || a.slotIndex - b.slotIndex);
  const rounds = matches.length ? Math.max(...matches.map(m => m.roundIndex)) + 1 : 0;
  for (const m of matches) {
    if (m.status === "BYE") {
      // keep the auto winner
    } else if (m.status === "COMPLETED" && m.winnerId) {
      // keep the recorded result
    } else if (m.participantA && m.participantB) {
      m.status = "READY";
      m.winnerId = "";
      m.scoreA = 0;
      m.scoreB = 0;
    } else {
      m.status = "PENDING";
      m.winnerId = "";
      m.scoreA = 0;
      m.scoreB = 0;
    }
    const ref = nextMatchRef(m.roundIndex, m.slotIndex, rounds);
    if (ref && m.winnerId) {
      const nm = findMatch(matches, ref.roundIndex, ref.slotIndex);
      if (nm) nm[ref.slot] = m.winnerId;
    }
  }
  return matches;
}

function clearDownstream(matches, from) {
  const rounds = Math.max(...matches.map(m => m.roundIndex)) + 1;
  let cur = from;
  let ref = nextMatchRef(cur.roundIndex, cur.slotIndex, rounds);
  while (ref) {
    const nm = findMatch(matches, ref.roundIndex, ref.slotIndex);
    if (!nm) return;
    const hadResult = !!nm.winnerId || nm.status === "COMPLETED" || nm.status === "BYE";
    nm[ref.slot] = "";
    if (hadResult) {
      nm.winnerId = "";
      nm.scoreA = 0;
      nm.scoreB = 0;
      nm.status = nm.participantA && nm.participantB ? "READY" : "PENDING";
    } else {
      // Nothing downstream depended on this slot yet.
      return;
    }
    cur = nm;
    ref = nextMatchRef(cur.roundIndex, cur.slotIndex, rounds);
  }
}

function asScore(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SCORE) return { error: `${label} must be a whole number between 0 and ${MAX_SCORE}.` };
  return { value: n };
}

/**
 * Record (or correct) a match result. Winner must be one of the two participants
 * and must have the higher score. Corrections clear every downstream match the
 * old winner reached, so impossible downstream states cannot survive.
 * Replaying an identical result is a no-op (idempotent).
 */
export function applyResult(input, { roundIndex, slotIndex, winnerId, scoreA, scoreB }) {
  const matches = (input || []).map(m => ({ ...m }));
  const target = findMatch(matches, roundIndex, slotIndex);
  if (!target) return { ok: false, error: "Match not found." };
  if (target.status === "BYE") return { ok: false, error: "This match is a bye — the participant advances automatically." };
  if (!target.participantA || !target.participantB) return { ok: false, error: "Both participants must be known before recording a result." };

  const win = clean(winnerId);
  if (!win || (win !== target.participantA && win !== target.participantB)) {
    return { ok: false, error: "Winner must be one of the two participants in this match." };
  }
  const a = asScore(scoreA, "Score A");
  if (a.error) return { ok: false, error: a.error };
  const b = asScore(scoreB, "Score B");
  if (b.error) return { ok: false, error: b.error };
  if (a.value === b.value) return { ok: false, error: "A match cannot end in a draw — pick a winner." };
  const winnerIsA = win === target.participantA;
  if (winnerIsA ? a.value <= b.value : b.value <= a.value) {
    return { ok: false, error: "The winner's score must be higher than the loser's score." };
  }

  const alreadySame =
    target.status === "COMPLETED" && target.winnerId === win && Number(target.scoreA) === a.value && Number(target.scoreB) === b.value;
  if (alreadySame) return { ok: true, unchanged: true, matches, champion: championFrom(matches) };

  target.winnerId = win;
  target.scoreA = a.value;
  target.scoreB = b.value;
  target.status = "COMPLETED";
  clearDownstream(matches, target);
  const out = propagateMatches(matches);
  return { ok: true, matches: out, champion: championFrom(out) };
}

/** Winner id of the final match when it is completed, otherwise "". */
export function championFrom(matches) {
  if (!Array.isArray(matches) || !matches.length) return "";
  const final = matches.reduce((a, b) => (b.roundIndex > a.roundIndex ? b : a));
  return final && final.status === "COMPLETED" && final.winnerId ? final.winnerId : "";
}

export function isCompleted(match) {
  return !!match && (match.status === "COMPLETED" || match.status === "BYE");
}

/** Public slug: readable base + collision-safe random suffix. Never a database id. */
export function slugify(name) {
  const base = clean(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48)
    .replace(/^-|-$/g, "");
  return base || "tournament";
}

export function randomSlugSuffix() {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/* --------------------------------------------------------------- branding */

/**
 * Validate guild Tournament branding (Premium-only is enforced at the API
 * layer — this is pure input hygiene). An all-empty payload clears the stored
 * configuration back to standard BalticM branding.
 */
export function validateBrandingInput(body) {
  const src = body && typeof body === "object" ? body : {};
  const name = String(src.name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const logoRaw = String(src.logoUrl ?? src.logo ?? "").trim();
  if (!name && !logoRaw) return { ok: true, value: { name: "", logoUrl: "" } }; // reset
  if (!name) return { ok: false, error: "Branding name is required." };
  if (name.length > MAX_BRANDING_NAME) {
    return { ok: false, error: `Branding name must be ${MAX_BRANDING_NAME} characters or fewer.` };
  }
  let logoUrl = "";
  if (logoRaw) {
    const err = httpsUrl(logoRaw, "Branding logo URL");
    if (err) return { ok: false, error: err };
    logoUrl = logoRaw;
  }
  return { ok: true, value: { name, logoUrl } };
}

/* ------------------------------------------------------------- announcements */

export const ANNOUNCEMENT_FOOTER = "Powered by Bot.BalticM.eu • PLAY TOGETHER";
const EMBED_COLORS = {
  created: 0x7657ff,
  registration_opened: 0x34d399,
  started: 0xf59e0b,
  bracket_ready: 0xf59e0b,
  match_ready: 0x60a5fa,
  match_result: 0x7657ff,
  winner: 0xfacc15
};
/** Link-button CTA per lifecycle kind (Discord style 5 — no handler needed). */
const CTA_LABEL = {
  created: "View Tournament",
  registration_opened: "Register / View Tournament",
  started: "View Bracket",
  bracket_ready: "View Bracket",
  match_ready: "View Tournament",
  match_result: "View Tournament",
  winner: "View Tournament"
};

const fmtDate = (v) => {
  const s = clean(v);
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toUTCString();
};
const field = (name, value, inline = true) => (clean(value) ? { name, value: clean(value).slice(0, 1024), inline } : null);

/**
 * Options for the Announcement channel selector (Create + Settings).
 * The user never types a Discord id: options carry the channel_id values and
 * human-readable `# name` labels for the ACTIVE guild's suitable channels
 * (text + announcement). "No announcement channel" ("") is a valid choice, and
 * a saved id that no longer resolves (deleted/hidden channel) is kept as a
 * clearly-marked unavailable option so settings never crash or lose it.
 */
export function announceChannelOptions(channels, savedId = "") {
  const list = Array.isArray(channels) ? channels : [];
  const canSend = (c) => {
    const raw = c?.permissions ?? c?.permissions_new;
    if (raw === undefined || raw === null || raw === "") return true;
    let bits;
    try { bits = BigInt(raw); } catch { return true; }
    return (bits & (2048n | 8n)) !== 0n; // SEND_MESSAGES | ADMINISTRATOR
  };
  const usable = list.filter(
    (c) => (c?.type === 0 || c?.type === 5) && canSend(c) && /^\d{16,22}$/.test(String(c?.id || ""))
  );
  const options = [
    { value: "", label: "No announcement channel" },
    ...usable.map((c) => ({ value: String(c.id), label: `# ${String(c.name || "unknown-channel")}` }))
  ];
  const saved = String(savedId || "").trim();
  if (saved && !usable.some((c) => String(c.id) === saved)) {
    options.push({ value: saved, label: `⚠️ Unavailable channel (${saved})` });
  }
  return options;
}

/**
 * Build the Discord embed for a lifecycle event. Announcements are only ever
 * triggered by explicit actions (create, open registration, start, bracket
 * generation, recorded result) — never by page loads.
 * `names` maps participant ids to display names.
 * `branding` is the EFFECTIVE branding already premium-resolved by the caller
 * ({custom,name,logoUrl}); free/expired guilds fall back to BalticM identity.
 * `url` is the public Tournament page — embeds link straight to it.
 */
export function buildAnnouncement(kind, {
  tournament,
  match,
  names = {},
  winnerId = "",
  scoreA = 0,
  scoreB = 0,
  isFinal = false,
  branding = null,
  url = "",
  counts = null,
  roundLabel = "",
  roster = null,
  logoUrl = ""
} = {}) {
  const t = tournament || {};
  const name = clean(t.name) || "Tournament";
  const game = clean(t.game);
  const who = (id) => clean(names[id]) || "Unknown participant";
  const isTeams = String(t.participantType || "") === "teams";
  const publicUrl = clean(url);
  const count = counts && Number.isFinite(Number(counts.count)) ? Number(counts.count) : null;
  const max = counts && Number.isFinite(Number(counts.max)) ? Number(counts.max) : null;
  const unit = count === 1 ? (isTeams ? "team" : "player") : isTeams ? "teams" : "players";
  const brandCustom = !!(branding && branding.custom && clean(branding.name));
  const brandName = brandCustom ? clean(branding.name) : "BALTICM";
  // Resolved logo (premium custom → Discord guild icon → none); the name
  // override stays premium-only, the icon fallback does not.
  const brandLogo = clean(branding && branding.logoUrl);
  const typeLabel = isTeams ? "Teams" : "Individual players";
  const entrants = count !== null && max !== null ? `${count} / ${max} ${unit}` : "";
  let title = "";
  let description = "";
  const fields = [];
  let thumb = "";

  if (kind === "created") {
    title = `🏆 New tournament: ${name}`;
    description = [game && `Game: ${game}`, t.startAt && `Starts: ${fmtDate(t.startAt)}`, "Format: Single Elimination"]
      .filter(Boolean)
      .join("\n");
    fields.push(field("Type", typeLabel));
  } else if (kind === "registration_opened") {
    title = `📝 Registration open — ${name}`;
    description = `Join now — registration for ${name}${game ? ` (${game})` : ""} is open.`;
    fields.push(field("Game", game));
    fields.push(field("Format", "Single Elimination"));
    fields.push(field("Type", typeLabel));
    fields.push(field("Starts", fmtDate(t.startAt)));
    fields.push(field("Registration closes", fmtDate(t.registrationDeadline)));
    fields.push(field("Entrants", entrants));
  } else if (kind === "started") {
    title = `🚀 Tournament started — ${name}`;
    description = Number(t.rounds) > 0
      ? `The bracket is ready — good luck to every ${unit}!`
      : `${name} is now live. Good luck to every ${unit}!`;
    fields.push(field("Game", game));
    fields.push(field("Entrants", entrants));
    fields.push(field("Format", "Single Elimination"));
  } else if (kind === "bracket_ready") {
    title = `⚔️ Bracket ready — ${name}`;
    description = `The single-elimination bracket is ready with ${Number(t.rounds) || 0} round${Number(t.rounds) === 1 ? "" : "s"}${count !== null ? ` for ${count} ${unit}` : ""}. Good luck to everyone!`;
    fields.push(field("Game", game));
    fields.push(field("Entrants", entrants));
    fields.push(field("Format", "Single Elimination"));
  } else if (kind === "match_ready") {
    const a = who(match?.participantA);
    const b = who(match?.participantB);
    title = `⚔️ Upcoming match — ${name}`;
    description = `${a} vs ${b}${roundLabel || match ? `\n${roundLabel || roundLabelFor(match)}` : ""}`;
  } else if (kind === "match_result") {
    const a = who(match?.participantA);
    const b = who(match?.participantB);
    const winner = who(winnerId);
    title = "🏆 Tournament Result";
    // Bracket order first (competitor A, score, competitor B), then the winner.
    description = `${a} ${scoreA} — ${scoreB} ${b}`;
    description += isFinal ? `\n${winner} wins the tournament.` : `\n${winner} advances to the next round.`;
    fields.push(field("Round", roundLabel || (match ? roundLabelFor(match) : "")));
    fields.push(field("Tournament", name));
  } else if (kind === "winner") {
    const champ = who(winnerId);
    const winIsA = match && winnerId === match.participantA;
    title = "🏆 TOURNAMENT CHAMPION";
    description = `${champ} wins ${name}!`;
    fields.push(field("Game", game));
    if (match && match.participantA && match.participantB) {
      fields.push(field("Final score", winIsA ? `${scoreA} — ${scoreB}` : `${scoreB} — ${scoreA}`));
    }
    fields.push(field("Format", `Single Elimination • ${typeLabel}`));
    const rosterNames = Array.isArray(roster)
      ? (() => {
          const unique = roster.map(clean).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
          const joined = unique.join(" • ");
          return joined.length > 1024 ? `${joined.slice(0, 1021)}…` : joined;
        })()
      : "";
    fields.push(field("Roster", rosterNames));
    thumb = logoUrl;
  } else {
    return null;
  }

  const embed = {
    title,
    description,
    color: EMBED_COLORS[kind] || 0x7657ff,
    // Branding follows the same premium rules as the public page; the footer
    // keeps BalticM attribution on every message, free or premium.
    author: { name: `${brandName} TOURNAMENTS`.slice(0, 64), ...(brandLogo ? { icon_url: brandLogo } : {}) },
    footer: { text: ANNOUNCEMENT_FOOTER }
  };
  if (publicUrl) embed.url = publicUrl;
  const usableFields = fields.filter(Boolean).slice(0, 10);
  if (usableFields.length) embed.fields = usableFields;
  if (thumb && /^https:\/\//i.test(clean(thumb))) embed.thumbnail = { url: clean(thumb).slice(0, 300) };

  const payload = { embeds: [embed] };
  if (publicUrl && CTA_LABEL[kind]) {
    payload.components = [{ type: 1, components: [{ type: 2, style: 5, label: CTA_LABEL[kind], url: publicUrl }] }];
  }
  return payload;
}

function roundLabelFor(match) {
  if (match && clean(match.roundLabel)) return clean(match.roundLabel);
  return `Round ${Number(match.roundIndex) + 1} · Match ${Number(match.slotIndex) + 1}`;
}
