/**
 * Tournaments V1 — HTTP handlers.
 *
 * Security model (same as every other Control Center module):
 *  - session auth + RBAC are enforced centrally by the worker dispatcher
 *    (routeAccessKey / requireControlAccess) before these run;
 *  - every management handler additionally verifies the logged-in user is in
 *    the guild (worker's canManageGuild rule) and that the stored tournament's
 *    guild_id matches the requested guild — a forged guild id or a foreign
 *    tournament id resolves to 403/404, never to data;
 *  - public routes are read-only except for the authenticated registration
 *    action, which is tied to the Discord account behind the session.
 */

import {
  applyResult,
  buildAnnouncement,
  canTransition,
  generateBracket,
  randomSlugSuffix,
  roundName,
  slugify,
  TOURNAMENT_STATUSES,
  validateBrandingInput,
  validateParticipantInput,
  validateTournamentInput
} from "./tournaments.js";
import {
  claimTournamentEvent,
  countParticipants,
  deleteParticipant,
  deleteTournament,
  effectiveTournamentBranding,
  ensureTournamentTables,
  findParticipantByMember,
  findParticipantByName,
  findParticipantByRegistrant,
  getTournament,
  getTournamentBySlug,
  guildPremiumActive,
  insertParticipant,
  insertTournament,
  listMatches,
  listParticipants,
  listTournaments,
  readTournamentBranding,
  releaseTournamentEvent,
  replaceMatches,
  replaceSeeds,
  saveMatches,
  updateParticipant,
  updateTournament,
  writeTournamentBranding
} from "./tournaments-db.js";

const SNOWFLAKE = /^\d{16,22}$/;
const OPEN_REGISTRATION_STATUSES = ["REGISTRATION", "UPCOMING"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/** Mirrors worker canManageGuild: the session's own Discord guild list only. */
function memberOfGuild(user, guildId) {
  return (user?.guilds || []).some(g => String(g.id) === String(guildId));
}

async function bodyOf(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function guildParam(u) {
  return String(u.searchParams.get("guildId") || "").trim();
}

function denyGuild(guildId) {
  if (!SNOWFLAKE.test(String(guildId || ""))) return json({ error: "guildId is required" }, 400);
  return null;
}

/**
 * Load a tournament only after proving the caller may manage it.
 * Cross-guild and IDOR attempts both return 404 (existence is not leaked).
 */
async function scopedTournament(env, user, guildId, tournamentId) {
  const bad = denyGuild(guildId);
  if (bad) return { error: bad };
  if (!memberOfGuild(user, guildId)) return { error: json({ error: "Forbidden" }, 403) };
  const tournament = await getTournament(env, tournamentId);
  if (!tournament) return { error: json({ error: "Tournament not found" }, 404) };
  if (String(tournament.guildId) !== String(guildId)) return { error: json({ error: "Tournament not found" }, 404) };
  return { tournament };
}

function roundLabels(rounds) {
  const size = Math.pow(2, Number(rounds) || 0);
  return Array.from({ length: Number(rounds) || 0 }, (_, r) => roundName(r, size));
}

function nameMap(participants) {
  return Object.fromEntries((participants || []).map(p => [p.id, p.name]));
}

function safeParticipant(p) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    seed: p.seed,
    captainName: p.captainName || "",
    discordId: p.discordId || "",
    logoUrl: p.logoUrl || "",
    registeredBy: p.registeredBy || "",
    source: p.source,
    members: (p.members || []).map(m => ({ discordId: m.discordId || "", displayName: m.displayName || "" })),
    createdAt: p.createdAt || ""
  };
}

/** Every Discord identity a payload claims — captain/registrant, linked player and members. */
function identitiesIn(body, value) {
  const ids = [];
  for (const raw of [body?.captainDiscordId, body?.captainId, body?.discordId, value?.captainDiscordId]) {
    if (SNOWFLAKE.test(String(raw || ""))) ids.push(String(raw));
  }
  for (const m of value?.members || []) if (m.discordId) ids.push(m.discordId);
  return [...new Set(ids)];
}

/** Reject an identity that already occupies a slot in this tournament (409). */
async function identityClash(env, tournamentId, body, value, { excludeParticipantId = "" } = {}) {
  for (const id of identitiesIn(body, value)) {
    const clash = await findParticipantByMember(env, tournamentId, id);
    if (clash && clash.id !== excludeParticipantId) {
      return json({ error: "That Discord user is already part of this tournament." }, 409);
    }
  }
  return null;
}

function registrationState(tournament, participantCount, now = Date.now()) {
  const open = !!tournament.registrationOpen;
  const publicOpen = !!tournament.publicRegistration;
  const statusOk = OPEN_REGISTRATION_STATUSES.includes(tournament.status);
  const deadlineOk = !tournament.registrationDeadline || Date.parse(tournament.registrationDeadline) > now;
  const hasRoom = participantCount < Number(tournament.maxParticipants);
  let reason = "";
  if (!publicOpen) reason = "Public registration is disabled for this tournament.";
  else if (!open) reason = "Registration is closed.";
  else if (!statusOk) reason = "Registration is not open right now.";
  else if (!deadlineOk) reason = "The registration deadline has passed.";
  else if (!hasRoom) reason = "This tournament is full.";
  return { open: !reason, reason, participantCount, maxParticipants: tournament.maxParticipants, deadline: tournament.registrationDeadline || "" };
}

/* ------------------------------------------------------- announcements (bot) */

/** Absolute public URL for a tournament page (same canonical origin the worker uses). */
function publicTournamentUrl(env, tournament) {
  const base = String(env?.PUBLIC_APP_URL || "").trim().replace(/\/$/, "") || "https://bot.balticm.eu";
  const slug = String(tournament?.publicSlug || "");
  return slug ? `${base}/tournaments/${encodeURIComponent(slug)}` : base;
}

/**
 * Post one lifecycle announcement to the configured channel.
 * Idempotency: the event key is claimed with INSERT OR IGNORE before sending,
 * so a replayed action can never post twice; a failed send releases the claim.
 * Keys are scoped to the actual event/result state (score, winner, champion,
 * bracket size) — never to page loads. GET handlers never call this.
 * Branding follows the premium rules of the public page, resolved server-side.
 * Best effort — an announcement problem never fails the admin action.
 */
export async function announceTournamentEvent(env, tournament, kind, { key = "", match = null, names = {}, winnerId = "", scoreA = 0, scoreB = 0, isFinal = false, roundLabel = "", roster = null, logoUrl = "" } = {}) {
  const eventKey = key || kind;
  try {
    if (!tournament?.announceChannelId || !env.DISCORD_BOT_TOKEN) return { skipped: true };
    const claimed = await claimTournamentEvent(env, tournament.id, eventKey);
    if (!claimed) return { skipped: true, duplicate: true };
    const branding = await effectiveTournamentBranding(env, tournament.guildId);
    let counts = null;
    if (["created", "registration_opened", "started", "bracket_ready"].includes(kind)) {
      try {
        counts = { count: await countParticipants(env, tournament.id), max: Number(tournament.maxParticipants) || 0 };
      } catch { counts = null; }
    }
    const payload = buildAnnouncement(kind, {
      tournament, match, names, winnerId, scoreA, scoreB, isFinal,
      branding, url: publicTournamentUrl(env, tournament), counts, roundLabel, roster, logoUrl
    });
    if (!payload) { await releaseTournamentEvent(env, tournament.id, eventKey); return { skipped: true }; }
    const headers = { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" };
    const channelRes = await fetch(`https://discord.com/api/v10/channels/${tournament.announceChannelId}`, {
      headers: { Authorization: headers.Authorization }
    });
    if (!channelRes.ok) throw new Error(`channel lookup failed (${channelRes.status})`);
    const channel = await channelRes.json();
    if (String(channel.guild_id || "") !== String(tournament.guildId)) throw new Error("announcement channel belongs to another server");
    const res = await fetch(`https://discord.com/api/v10/channels/${tournament.announceChannelId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`message send failed (${res.status})`);
    return { ok: true };
  } catch (e) {
    await releaseTournamentEvent(env, tournament?.id || "", eventKey);
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ------------------------------------------------------------ management API */

export async function tournamentsList(req, env, user) {
  await ensureTournamentTables(env);
  const u = new URL(req.url);
  const guildId = guildParam(u);
  const bad = denyGuild(guildId);
  if (bad) return bad;
  if (!memberOfGuild(user, guildId)) return json({ error: "Forbidden" }, 403);

  const [tournaments, counts] = await Promise.all([
    listTournaments(env, guildId, { q: u.searchParams.get("q") || "", status: u.searchParams.get("status") || "" }),
    env.BALTICM_DB.prepare(
      "SELECT tournament_id AS id, COUNT(*) AS n FROM tournament_participants WHERE guild_id=? GROUP BY tournament_id"
    )
      .bind(String(guildId))
      .all()
  ]);
  const byTournament = new Map((counts.results || []).map(r => [r.id, Number(r.n) || 0]));
  return json({
    tournaments: tournaments.map(t => ({ ...t, participantCount: byTournament.get(t.id) || 0 })),
    total: tournaments.length
  });
}

export async function tournamentCreate(req, env, user) {
  await ensureTournamentTables(env);
  const u = new URL(req.url);
  const guildId = guildParam(u);
  const bad = denyGuild(guildId);
  if (bad) return bad;
  if (!memberOfGuild(user, guildId)) return json({ error: "Forbidden" }, 403);

  const parsed = validateTournamentInput(await bodyOf(req));
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  // Plan limits — enforced server-side against the existing Premium
  // entitlement source (never trusted from the browser): free servers may
  // only run Individual tournaments with 4 participants; Teams and 8/16/32
  // are Premium-only. Omitted maxParticipants defaults to 8 below, so the
  // effective value is checked here too.
  const effType = parsed.value.participantType || "individuals";
  const effMax = parsed.value.maxParticipants || 8;
  if ((effType === "teams" || effMax > 4) && !(await guildPremiumActive(env, guildId))) {
    return json(
      { error: "Team tournaments and 8–32 participant tournaments require an active Premium subscription for this server.", code: "premium_required" },
      403
    );
  }

  const now = new Date().toISOString();
  let slug = "";
  for (let attempt = 0; attempt < 4 && !slug; attempt++) {
    const candidate = `${slugify(parsed.value.name)}-${randomSlugSuffix()}`;
    const existing = await getTournamentBySlug(env, candidate);
    if (!existing) slug = candidate;
  }
  if (!slug) return json({ error: "Could not generate a public link. Please try again." }, 500);

  const registrationOpen = parsed.value.registrationOpen === true;
  const tournament = {
    id: globalThis.crypto.randomUUID(),
    guildId: String(guildId),
    name: parsed.value.name,
    game: parsed.value.game,
    description: parsed.value.description || "",
    bannerUrl: parsed.value.bannerUrl || "",
    format: parsed.value.format || "single_elimination",
    participantType: parsed.value.participantType || "individuals",
    maxParticipants: parsed.value.maxParticipants || 8,
    status: registrationOpen ? "REGISTRATION" : "DRAFT",
    startAt: parsed.value.startAt,
    registrationOpen,
    registrationDeadline: parsed.value.registrationDeadline || "",
    publicRegistration: parsed.value.publicRegistration === true,
    announceChannelId: parsed.value.announceChannelId || "",
    publicSlug: slug,
    championId: "",
    rounds: 0,
    createdBy: String(user?.id || ""),
    createdAt: now,
    updatedAt: now
  };
  try {
    await insertTournament(env, tournament);
  } catch (e) {
    return json({ error: "Could not create the tournament. Please try again." }, 500);
  }
  await announceTournamentEvent(env, tournament, "created", { key: "created" });
  return json({ tournament }, 201);
}

export async function tournamentDetail(req, env, user, tournamentId) {
  await ensureTournamentTables(env);
  const u = new URL(req.url);
  const scoped = await scopedTournament(env, user, guildParam(u), tournamentId);
  if (scoped.error) return scoped.error;
  const tournament = scoped.tournament;
  const [participants, matches] = await Promise.all([listParticipants(env, tournament.id), listMatches(env, tournament.id)]);
  return json({
    tournament: { ...tournament, participantCount: participants.length },
    participants: participants.map(safeParticipant),
    matches,
    names: nameMap(participants),
    roundLabels: roundLabels(tournament.rounds || (matches.length ? Math.max(...matches.map(m => m.roundIndex)) + 1 : 0))
  });
}

export async function tournamentUpdate(req, env, user, tournamentId) {
  await ensureTournamentTables(env);
  const u = new URL(req.url);
  const scoped = await scopedTournament(env, user, guildParam(u), tournamentId);
  if (scoped.error) return scoped.error;
  const tournament = scoped.tournament;
  const parsed = validateTournamentInput(await bodyOf(req), { partial: true });
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  // Plan limits on EDIT: only when the request actually changes participant
  // type or maximum participants (same-value and unrelated settings edits
  // keep working without Premium). Expired Premium never auto-downgrades or
  // corrupts an existing tournament — only Premium-only *changes* are blocked.
  const wantType = parsed.value.participantType;
  const wantMax = parsed.value.maxParticipants;
  const changesType = wantType !== undefined && String(wantType) !== String(tournament.participantType || "");
  const changesMax = wantMax !== undefined && Number(wantMax) !== Number(tournament.maxParticipants);
  if (((changesType && wantType === "teams") || (changesMax && Number(wantMax) > 4)) &&
      !(await guildPremiumActive(env, tournament.guildId))) {
    return json(
      { error: "Team tournaments and 8–32 participant tournaments require an active Premium subscription for this server.", code: "premium_required" },
      403
    );
  }

  const fields = { ...parsed.value };
  if (fields.status && fields.status !== tournament.status) {
    if (fields.status === "FINISHED") {
      return json({ error: "The tournament is marked FINISHED automatically when the final is completed." }, 400);
    }
    if (!canTransition(tournament.status, fields.status)) {
      return json({ error: `Cannot move a ${tournament.status} tournament to ${fields.status}.` }, 400);
    }
  } else if (fields.status === tournament.status) {
    delete fields.status;
  }

  const openingRegistration =
    Object.prototype.hasOwnProperty.call(fields, "registrationOpen") &&
    fields.registrationOpen === true &&
    tournament.registrationOpen === false;
  const starting = Object.prototype.hasOwnProperty.call(fields, "status") && fields.status === "LIVE";

  await updateTournament(env, tournament.id, fields);
  const updated = await getTournament(env, tournament.id);

  if (openingRegistration) {
    await announceTournamentEvent(env, updated, "registration_opened", { key: `registration_opened:${updated.updatedAt}` });
  }
  if (starting) {
    await announceTournamentEvent(env, updated, "started", { key: `started:${updated.updatedAt}` });
  }
  return json({ tournament: updated });
}

export async function tournamentDelete(env, user, guildId, tournamentId) {
  await ensureTournamentTables(env);
  const scoped = await scopedTournament(env, user, guildId, tournamentId);
  if (scoped.error) return scoped.error;
  await deleteTournament(env, scoped.tournament.id);
  return json({ ok: true });
}

export async function participantCreate(req, env, user, guildId, tournamentId) {
  await ensureTournamentTables(env);
  const scoped = await scopedTournament(env, user, guildId, tournamentId);
  if (scoped.error) return scoped.error;
  const tournament = scoped.tournament;
  if (tournament.status === "FINISHED") return json({ error: "This tournament is finished." }, 409);

  const body = await bodyOf(req);
  const parsed = validateParticipantInput(body, tournament);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const count = await countParticipants(env, tournament.id);
  if (count >= Number(tournament.maxParticipants)) {
    return json({ error: `Maximum of ${tournament.maxParticipants} participants reached.` }, 409);
  }
  const clash = await findParticipantByName(env, tournament.id, parsed.value.name);
  if (clash) return json({ error: `"${parsed.value.name}" is already in this tournament.` }, 409);
  const taken = await identityClash(env, tournament.id, body, parsed.value);
  if (taken) return taken;

  const discordId = SNOWFLAKE.test(String(body.discordId || "")) ? String(body.discordId) : "";
  const participant = await insertParticipant(env, {
    tournamentId: tournament.id,
    guildId: tournament.guildId,
    kind: tournament.participantType === "teams" ? "team" : "player",
    name: parsed.value.name,
    seed: count + 1,
    captainDiscordId: parsed.value.captainDiscordId || discordId,
    captainName: parsed.value.captainName || "",
    discordId,
    logoUrl: parsed.value.logoUrl || "",
    registeredBy: "",
    source: "manual",
    members: parsed.value.members
  });
  return json({ participant: safeParticipant(participant) }, 201);
}

export async function participantEdit(req, env, user, guildId, tournamentId, participantId) {
  await ensureTournamentTables(env);
  const scoped = await scopedTournament(env, user, guildId, tournamentId);
  if (scoped.error) return scoped.error;
  const tournament = scoped.tournament;
  const body = await bodyOf(req);
  const parsed = validateParticipantInput(body, tournament);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const participants = await listParticipants(env, tournament.id);
  const target = participants.find(p => p.id === String(participantId));
  if (!target) return json({ error: "Participant not found." }, 404);
  const clash = await findParticipantByName(env, tournament.id, parsed.value.name);
  if (clash && clash.id !== target.id) return json({ error: `"${parsed.value.name}" is already in this tournament.` }, 409);
  const taken = await identityClash(env, tournament.id, body, parsed.value, { excludeParticipantId: target.id });
  if (taken) return taken;

  await updateParticipant(env, target.id, {
    name: parsed.value.name,
    logoUrl: parsed.value.logoUrl,
    captainDiscordId: parsed.value.captainDiscordId,
    captainName: parsed.value.captainName,
    members: parsed.value.members,
    tournamentId: tournament.id
  });
  const updated = (await listParticipants(env, tournament.id)).find(p => p.id === target.id);
  return json({ participant: safeParticipant(updated) });
}

export async function participantRemove(env, user, guildId, tournamentId, participantId) {
  await ensureTournamentTables(env);
  const scoped = await scopedTournament(env, user, guildId, tournamentId);
  if (scoped.error) return scoped.error;
  const tournament = scoped.tournament;
  const matches = await listMatches(env, tournament.id);
  if (matches.length) return json({ error: "Regenerate the bracket after changing participants." }, 409);
  const participants = await listParticipants(env, tournament.id);
  const target = participants.find(p => p.id === String(participantId));
  if (!target) return json({ error: "Participant not found." }, 404);
  await deleteParticipant(env, target.id);
  return json({ ok: true });
}

export async function seedsReplace(req, env, user, guildId, tournamentId) {
  await ensureTournamentTables(env);
  const scoped = await scopedTournament(env, user, guildId, tournamentId);
  if (scoped.error) return scoped.error;
  const tournament = scoped.tournament;
  const matches = await listMatches(env, tournament.id);
  if (matches.length) return json({ error: "Regenerate the bracket after reseeding." }, 409);

  const body = await bodyOf(req);
  const order = Array.isArray(body.order) ? body.order.map(String) : [];
  const participants = await listParticipants(env, tournament.id);
  const ids = participants.map(p => p.id);
  if (!order.length || order.length !== ids.length || new Set(order).size !== order.length || order.some(x => !ids.includes(x))) {
    return json({ error: "Seed order must list every participant exactly once." }, 400);
  }
  await replaceSeeds(env, tournament.id, order);
  const updated = await listParticipants(env, tournament.id);
  return json({ participants: updated.map(safeParticipant) });
}

export async function bracketCreate(env, user, guildId, tournamentId) {
  await ensureTournamentTables(env);
  const scoped = await scopedTournament(env, user, guildId, tournamentId);
  if (scoped.error) return scoped.error;
  const tournament = scoped.tournament;

  const participants = await listParticipants(env, tournament.id);
  if (participants.length < 2) return json({ error: "At least 2 participants are required to generate a bracket." }, 400);

  const existing = await listMatches(env, tournament.id);
  if (existing.some(m => m.status === "COMPLETED")) {
    return json({ error: "Results are already recorded — create a new tournament instead of regenerating." }, 409);
  }

  const generated = generateBracket(participants);
  if (!generated.ok) return json({ error: generated.error }, 400);
  const matches = await replaceMatches(env, tournament.id, generated.matches);
  await updateTournament(env, tournament.id, { rounds: generated.rounds });
  const updated = await getTournament(env, tournament.id);
  // Explicit bracket-generation action → "bracket ready" announcement. The key
  // encodes bracket state, so regenerating an identical bracket never re-posts.
  await announceTournamentEvent(env, updated, "bracket_ready", {
    key: `bracket_ready:${generated.rounds}:${participants.length}`,
    names: nameMap(participants)
  });
  return json({ tournament: updated, matches, roundLabels: roundLabels(generated.rounds), names: nameMap(participants) });
}

function parseMatchRef(ref) {
  const m = String(ref || "").match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  return { roundIndex: Number(m[1]), slotIndex: Number(m[2]) };
}

export async function resultRecord(req, env, user, guildId, tournamentId, matchRef) {
  await ensureTournamentTables(env);
  const scoped = await scopedTournament(env, user, guildId, tournamentId);
  if (scoped.error) return scoped.error;
  const tournament = scoped.tournament;
  const ref = parseMatchRef(matchRef);
  if (!ref) return json({ error: "Invalid match reference." }, 400);

  const body = await bodyOf(req);
  const participants = await listParticipants(env, tournament.id);
  const names = nameMap(participants);
  const matches = await listMatches(env, tournament.id);
  const target = matches.find(m => m.roundIndex === ref.roundIndex && m.slotIndex === ref.slotIndex);
  if (!target) return json({ error: "Match not found." }, 404);

  const rounds = matches.length ? Math.max(...matches.map(m => m.roundIndex)) + 1 : 0;
  const applied = applyResult(matches, {
    roundIndex: ref.roundIndex,
    slotIndex: ref.slotIndex,
    winnerId: body.winnerId,
    scoreA: body.scoreA,
    scoreB: body.scoreB
  });
  if (!applied.ok) return json({ error: applied.error }, 400);

  let tournamentAfter = tournament;
  if (!applied.unchanged) {
    await saveMatches(env, tournament.id, applied.matches);
    const played = applied.matches.find(m => m.roundIndex === ref.roundIndex && m.slotIndex === ref.slotIndex);

    const nextRef = ref.roundIndex + 1 < rounds ? { roundIndex: ref.roundIndex + 1, slotIndex: Math.floor(ref.slotIndex / 2) } : null;
    const nextMatch = nextRef ? applied.matches.find(m => m.roundIndex === nextRef.roundIndex && m.slotIndex === nextRef.slotIndex) : null;

    if (applied.champion && tournament.championId !== applied.champion) {
      await updateTournament(env, tournament.id, { championId: applied.champion, status: "FINISHED" });
      tournamentAfter = await getTournament(env, tournament.id);
    } else if (!applied.champion && tournament.championId) {
      // A correction invalidated the completed final: drop the stale champion
      // and reopen the tournament instead of leaving an impossible FINISHED state.
      await updateTournament(env, tournament.id, { championId: "", status: "LIVE" });
      tournamentAfter = await getTournament(env, tournament.id);
    }

    const isFinal = !!applied.champion;
    const labels = roundLabels(tournamentAfter.rounds || rounds);
    await announceTournamentEvent(env, tournamentAfter, "match_result", {
      key: `match:${ref.roundIndex}-${ref.slotIndex}:result:${played.winnerId}:${played.scoreA}-${played.scoreB}`,
      match: played,
      names,
      winnerId: played.winnerId,
      scoreA: played.scoreA,
      scoreB: played.scoreB,
      isFinal,
      roundLabel: labels[ref.roundIndex] || ""
    });
    if (nextMatch && nextMatch.status === "READY") {
      await announceTournamentEvent(env, tournamentAfter, "match_ready", {
        key: `match:${nextRef.roundIndex}-${nextRef.slotIndex}:ready`,
        match: { ...nextMatch, roundLabel: labels[nextRef.roundIndex] || "" },
        names
      });
    }
    if (isFinal) {
      // Champion key is scoped to the champion identity: a rollback announces
      // nothing, the same champion never re-posts, and a NEW champion after a
      // correction posts exactly once more.
      const champ = participants.find(p => p.id === applied.champion) || null;
      const roster = champ
        ? [...(champ.captainName ? [champ.captainName] : []), ...(champ.members || []).map(m => m.displayName || m.discordId)]
            .filter(Boolean)
        : [];
      await announceTournamentEvent(env, tournamentAfter, "winner", {
        key: `winner:${applied.champion}`,
        winnerId: applied.champion,
        names,
        match: played,
        scoreA: played.scoreA,
        scoreB: played.scoreB,
        roundLabel: labels[ref.roundIndex] || "",
        roster,
        logoUrl: champ?.logoUrl || ""
      });
    }
  }

  return json({
    matches: applied.matches,
    tournament: tournamentAfter,
    champion: applied.champion,
    unchanged: !!applied.unchanged
  });
}

export async function tournamentStatusChange(req, env, user, guildId, tournamentId) {
  await ensureTournamentTables(env);
  const scoped = await scopedTournament(env, user, guildId, tournamentId);
  if (scoped.error) return scoped.error;
  const tournament = scoped.tournament;
  const body = await bodyOf(req);
  const next = String(body.status || "").toUpperCase();
  if (!TOURNAMENT_STATUSES.includes(next)) return json({ error: "Unknown tournament status." }, 400);
  if (next === tournament.status) return json({ tournament });
  if (next === "FINISHED") {
    return json({ error: "The tournament is marked FINISHED automatically when the final is completed." }, 400);
  }
  if (!canTransition(tournament.status, next)) {
    return json({ error: `Cannot move a ${tournament.status} tournament to ${next}.` }, 400);
  }
  await updateTournament(env, tournament.id, { status: next });
  const updated = await getTournament(env, tournament.id);
  if (next === "LIVE") {
    await announceTournamentEvent(env, updated, "started", { key: `started:${updated.updatedAt}` });
  }
  return json({ tournament: updated });
}

/* --------------------------------------------------------------- public API */

/**
 * Guild Tournament branding — read (management UI preview).
 * Returns the stored configuration plus whether it is currently APPLIED
 * (premium active). Expiry never deletes stored branding.
 */
export async function tournamentBrandingState(req, env, user) {
  await ensureTournamentTables(env);
  const u = new URL(req.url);
  const guildId = guildParam(u);
  const bad = denyGuild(guildId);
  if (bad) return bad;
  if (!memberOfGuild(user, guildId)) return json({ error: "Forbidden" }, 403);
  const resolved = await effectiveTournamentBranding(env, guildId);
  const active = !!(resolved.premium && resolved.stored.name);
  return json({
    branding: resolved.stored,
    premium: resolved.premium,
    active,
    defaultName: "BALTICM",
    // What the public page header will actually use right now:
    // premium custom logo → active Discord guild icon → BalticM default.
    resolved: { logoUrl: resolved.logoUrl, logoSource: resolved.logoSource }
  });
}

/**
 * Save guild Tournament branding. Premium authorization is enforced HERE,
 * server-side: hiding fields in React is not the gate. A forged request from
 * a non-Premium guild gets 403, and guild isolation is preserved by the
 * memberOfGuild guard (one guild can never write another's branding).
 */
export async function tournamentBrandingSave(req, env, user) {
  await ensureTournamentTables(env);
  const u = new URL(req.url);
  const guildId = guildParam(u);
  const bad = denyGuild(guildId);
  if (bad) return bad;
  if (!memberOfGuild(user, guildId)) return json({ error: "Forbidden" }, 403);

  const premium = await guildPremiumActive(env, guildId);
  if (!premium) {
    return json({ error: "Tournament branding requires an active Premium subscription for this server.", code: "premium_required" }, 403);
  }
  const parsed = validateBrandingInput(await bodyOf(req));
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const saved = await writeTournamentBranding(env, guildId, parsed.value);
  const after = await effectiveTournamentBranding(env, guildId);
  return json({ branding: saved, premium: true, active: !!saved.name, resolved: { logoUrl: after.logoUrl, logoSource: after.logoSource } });
}

/** Public, read-only tournament page data. No admin permission required. */
export async function tournamentPublic(req, env, slug, user = null) {
  await ensureTournamentTables(env);
  const tournament = await getTournamentBySlug(env, String(slug || ""));
  if (!tournament) return json({ error: "Tournament not found" }, 404);
  const [participants, matches, brand] = await Promise.all([
    listParticipants(env, tournament.id),
    listMatches(env, tournament.id),
    effectiveTournamentBranding(env, tournament.guildId)
  ]);
  const rounds = tournament.rounds || (matches.length ? Math.max(...matches.map(m => m.roundIndex)) + 1 : 0);
  const registration = registrationState(tournament, participants.length);
  // Own-entry hint for a signed-in visitor (boolean only — never another
  // visitor's identity), so the page can show "already registered" cleanly.
  if (user?.id) {
    const mine = await findParticipantByRegistrant(env, tournament.id, String(user.id));
    registration.you = mine ? { registered: true, name: mine.name } : { registered: false, name: "" };
  }
  return json({
    branding: {
      custom: !!brand.custom,
      name: brand.custom ? brand.name : "BALTICM",
      logoUrl: brand.logoUrl || "",
      logoSource: brand.logoSource || ""
    },
    tournament: {
      name: tournament.name,
      game: tournament.game,
      description: tournament.description,
      bannerUrl: tournament.bannerUrl,
      format: tournament.format,
      participantType: tournament.participantType,
      maxParticipants: tournament.maxParticipants,
      status: tournament.status,
      startAt: tournament.startAt,
      registrationDeadline: tournament.registrationDeadline,
      publicSlug: tournament.publicSlug,
      championId: tournament.championId,
      rounds,
      updatedAt: tournament.updatedAt
    },
    participants: participants.map(p => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      seed: p.seed,
      captainName: p.captainName || "",
      logoUrl: p.logoUrl || "",
      members: (p.members || []).map(m => m.displayName || "").filter(Boolean)
    })),
    matches: matches.map(m => ({
      roundIndex: m.roundIndex,
      slotIndex: m.slotIndex,
      participantA: m.participantA,
      participantB: m.participantB,
      winnerId: m.winnerId,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      status: m.status,
      scheduledAt: m.scheduledAt
    })),
    names: nameMap(participants),
    roundLabels: roundLabels(rounds),
    registration
  });
}

/**
 * Public registration — requires a Discord session so the registration is tied
 * to a real account; individual tournaments use the Discord identity directly.
 */
export async function tournamentPublicRegister(req, env, user, slug) {
  await ensureTournamentTables(env);
  const tournament = await getTournamentBySlug(env, String(slug || ""));
  if (!tournament) return json({ error: "Tournament not found" }, 404);

  const participants = await listParticipants(env, tournament.id);
  const state = registrationState(tournament, participants.length);
  if (!state.open) return json({ error: state.reason }, 403);

  const body = await bodyOf(req);
  const teams = tournament.participantType === "teams";
  const identity = String(user?.global_name || user?.username || "").trim();
  // Captain identity is NEVER taken from the client — it is derived from the
  // authenticated session below. Only display fields are read from the body.
  const payload = teams
    ? validateParticipantInput({ teamName: body.teamName, logoUrl: body.logoUrl, members: body.members }, tournament)
    : validateParticipantInput({ name: identity || "Player" }, tournament);
  if (!payload.ok) return json({ error: payload.error }, 400);

  const mine = await findParticipantByMember(env, tournament.id, String(user.id));
  if (mine) {
    const own = mine.registeredBy === String(user.id) || mine.discordId === String(user.id);
    return json({ error: own ? "You are already registered for this tournament." : "You are already part of a team in this tournament." }, 409);
  }
  // Members' Discord ids (when supplied) must not already occupy a slot either.
  const taken = await identityClash(env, tournament.id, {}, payload.value);
  if (taken) return taken;
  const clash = await findParticipantByName(env, tournament.id, payload.value.name);
  if (clash) return json({ error: `"${payload.value.name}" is already in this tournament.` }, 409);

  const participant = await insertParticipant(env, {
    tournamentId: tournament.id,
    guildId: tournament.guildId,
    kind: teams ? "team" : "player",
    name: payload.value.name,
    seed: participants.length + 1,
    captainDiscordId: teams ? String(user.id) : "",
    captainName: teams ? identity : "",
    discordId: teams ? "" : String(user.id),
    logoUrl: payload.value.logoUrl || "",
    registeredBy: String(user.id),
    source: "public",
    members: payload.value.members
  });
  return json({ participant: { name: participant.name, kind: participant.kind, seed: participant.seed } }, 201);
}
