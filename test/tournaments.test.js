import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { COOKIE_SESSION, buildAuthSessionPayload, signPayload } from "../oauth-session.js";
import {
  ANNOUNCEMENT_FOOTER,
  announceChannelOptions,
  applyResult,
  bracketSizeFor,
  buildAnnouncement,
  canTransition,
  generateBracket,
  roundName,
  standardSeedOrder,
  validateBrandingInput,
  validateTournamentInput
} from "../tournaments.js";
import { ensureTournamentTables, getTournament, listMatches, listParticipants } from "../tournaments-db.js";
import {
  announceTournamentEvent,
  bracketCreate,
  participantCreate,
  participantEdit,
  participantRemove,
  resultRecord,
  seedsReplace,
  tournamentBrandingSave,
  tournamentBrandingState,
  tournamentCreate,
  tournamentDelete,
  tournamentDetail,
  tournamentPublic,
  tournamentPublicRegister,
  tournamentsList,
  tournamentStatusChange,
  tournamentUpdate
} from "../tournaments-api.js";
import { ACCESS_KEYS, ACCESS_OPERATE, requiredLevelForRequest, routeAccessKey } from "../access-control.js";

/* --------------------------------------------------------------- harness */

const GUILD = "884027552174317569";
const OTHER_GUILD = "414587429199282187";
const admin = { id: "293469802188636160", username: "miers", global_name: "MiersBerzins ツ♡", guilds: [{ id: GUILD, name: "Baltic | Mayhem" }] };
const outsider = { id: "111111111111111111", username: "outsider", global_name: "Outsider", guilds: [{ id: OTHER_GUILD, name: "Other Server" }] };

/** In-memory D1 (SQLite) implementing the subset of the D1 API the worker uses. */
function makeEnv() {
  const db = new DatabaseSync(":memory:");
  const stmt = sql => ({
    bind(...args) {
      return {
        first: async () => db.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...args).map(r => ({ ...r })), success: true }),
        run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } })
      };
    },
    first: async () => db.prepare(sql).get() ?? null,
    all: async () => ({ results: db.prepare(sql).all().map(r => ({ ...r })), success: true }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run().changes) } })
  });
  return {
    BALTICM_DB: { prepare: stmt, batch: async stmts => { const out = []; for (const s of stmts) out.push(await s.run()); return out; } },
    DISCORD_BOT_TOKEN: "test-token"
  };
}

const req = (path, { method = "GET", body, guildId } = {}) =>
  new Request(`https://bot.balticm.eu${path}${guildId ? `?guildId=${guildId}` : ""}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

const read = async (res) => ({ status: res.status, body: await res.json() });

/* V1.2.1: brand/logo resolution must never reach the real network in tests.
   Discord API URLs answer a neutral empty payload (→ no guild icon, cached as
   a miss in that env); everything else falls through. captureDiscord() nests
   over this interceptor safely because it saves/restores the CURRENT fetch. */
const rootFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = String((input && input.url) || input);
  if (u.includes("discord.com/api/v10/")) return { ok: true, status: 200, json: async () => ({}) };
  return rootFetch(input, init);
};

async function setup({ premium = true } = {}) {
  const env = makeEnv();
  await ensureTournamentTables(env);
  // Plan-limit tests request a free server explicitly (setup({ premium: false })).
  // Everything else runs with an active Premium entitlement — the SAME
  // bot_config row (setPremium) the real subscription system uses.
  if (premium) await setPremium(env, GUILD);
  return env;
}

async function createTournament(env, { guildId = GUILD, user = admin, overrides = {} } = {}) {
  const res = await read(
    await tournamentCreate(
      req("/api/tournaments", { method: "POST", guildId, body: {
        name: "BalticM Test Cup",
        game: "Counter-Strike 2",
        startAt: "2026-11-20T18:00:00.000Z",
        participantType: "individuals",
        maxParticipants: 8,
        ...overrides
      } }),
      env,
      user
    )
  );
  return res;
}

async function fillParticipants(env, guildId, tournamentId, count, user = admin) {
  const ids = [];
  for (let i = 1; i <= count; i++) {
    const res = await read(
      await participantCreate(req(`/api/tournaments/${tournamentId}/participants`, { method: "POST", guildId, body: { name: `Player ${i}` } }), env, user, guildId, tournamentId)
    );
    ids.push(res.body.participant.id);
  }
  return ids;
}

async function generate(env, guildId, tournamentId, user = admin) {
  return read(await bracketCreate(env, user, guildId, tournamentId));
}

async function play(env, guildId, tournamentId, roundIndex, slotIndex, winnerId, scoreA, scoreB, user = admin) {
  return read(await resultRecord(req(`/api/tournaments/${tournamentId}/matches/${roundIndex}-${slotIndex}`, { method: "POST", guildId, body: { winnerId, scoreA, scoreB } }), env, user, guildId, tournamentId, `${roundIndex}-${slotIndex}`));
}

/* ------------------------------------------------------- pure bracket logic */

test("bracket sizing, seeding and round labels follow single-elimination rules", () => {
  assert.equal(bracketSizeFor(2), 2);
  assert.equal(bracketSizeFor(4), 4);
  assert.equal(bracketSizeFor(5), 8);
  assert.equal(bracketSizeFor(8), 8);
  assert.equal(bracketSizeFor(9), 16);
  assert.equal(bracketSizeFor(16), 16);
  assert.equal(bracketSizeFor(17), 32);
  assert.deepEqual(standardSeedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.equal(roundName(0, 8), "Round 1");
  assert.equal(roundName(1, 8), "Semifinals");
  assert.equal(roundName(2, 8), "Final");
  assert.equal(roundName(0, 16), "Round of 16");
  assert.equal(roundName(1, 16), "Quarterfinals");
  assert.equal(roundName(2, 16), "Semifinals");
  assert.equal(roundName(3, 16), "Final");
  assert.equal(roundName(0, 4), "Semifinals");
});

test("create validates V1 fields and rejects unsupported formats", async () => {
  const env = await setup();
  const bad = await read(await tournamentCreate(req("/api/tournaments", { method: "POST", guildId: GUILD, body: { name: "", game: "" } }), env, admin));
  assert.equal(bad.status, 400);

  const badFormat = await read(
    await tournamentCreate(req("/api/tournaments", { method: "POST", guildId: GUILD, body: { name: "X", game: "Y", startAt: "2026-11-20T18:00:00.000Z", format: "round_robin" } }), env, admin)
  );
  assert.equal(badFormat.status, 400);
  assert.match(badFormat.body.error, /not available yet/i);

  const badSize = await read(
    await tournamentCreate(req("/api/tournaments", { method: "POST", guildId: GUILD, body: { name: "X", game: "Y", startAt: "2026-11-20T18:00:00.000Z", maxParticipants: 7 } }), env, admin)
  );
  assert.equal(badSize.status, 400);

  const ok = await createTournament(env);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.tournament.format, "single_elimination");
  assert.equal(ok.body.tournament.status, "DRAFT");
  assert.match(ok.body.tournament.publicSlug, /^balticm-test-cup-[0-9a-f]{8}$/);
  assert.notEqual(ok.body.tournament.publicSlug, ok.body.tournament.id);
});

test("guild isolation: each guild only sees and manages its own tournaments", async () => {
  const env = await setup();
  const mine = await createTournament(env);
  // OTHER_GUILD is a free server: the fixture stays within free plan limits
  // (this test verifies isolation, not entitlements).
  const other = await createTournament(env, { guildId: OTHER_GUILD, user: outsider, overrides: { maxParticipants: 4 } });

  const listMine = await read(await tournamentsList(req("/api/tournaments", { guildId: GUILD }), env, admin));
  assert.equal(listMine.body.tournaments.length, 1);
  assert.equal(listMine.body.tournaments[0].id, mine.body.tournament.id);

  const listOther = await read(await tournamentsList(req("/api/tournaments", { guildId: OTHER_GUILD }), env, outsider));
  assert.deepEqual(listOther.body.tournaments.map(t => t.id), [other.body.tournament.id]);

  // Cross-guild read/write of a foreign tournament id resolves to 404 (IDOR).
  const foreign = await read(await tournamentDetail(req(`/api/tournaments/${mine.body.tournament.id}`, { guildId: OTHER_GUILD }), env, outsider, mine.body.tournament.id));
  assert.equal(foreign.status, 404);
  const foreignDelete = await read(await tournamentDelete(env, outsider, OTHER_GUILD, mine.body.tournament.id));
  assert.equal(foreignDelete.status, 404);
  const stillThere = await getTournament(env, mine.body.tournament.id);
  assert.ok(stillThere);
});

test("unauthorized management attempts are refused", async () => {
  const env = await setup();
  const created = await createTournament(env);
  const tid = created.body.tournament.id;

  // Caller not a member of the requested guild at all.
  const forged = await read(await tournamentsList(req("/api/tournaments", { guildId: OTHER_GUILD }), env, admin));
  assert.equal(forged.status, 403);

  const missingGuild = await read(await tournamentsList(req("/api/tournaments"), env, admin));
  assert.equal(missingGuild.status, 400);

  // Outsider member of another guild cannot touch a tournament in GUILD.
  const add = await read(await participantCreate(req(`/api/tournaments/${tid}/participants`, { method: "POST", guildId: OTHER_GUILD, body: { name: "Sneaky" } }), env, outsider, OTHER_GUILD, tid));
  assert.equal(add.status, 404);
  const status = await read(await tournamentStatusChange(req(`/api/tournaments/${tid}/status`, { method: "POST", guildId: OTHER_GUILD, body: { status: "LIVE" } }), env, outsider, OTHER_GUILD, tid));
  assert.equal(status.status, 404);
});

test("tournament list, search, status filter and delete round-trip", async () => {
  const env = await setup();
  await createTournament(env, { overrides: { name: "Alpha Cup", game: "Valorant" } });
  await createTournament(env, { overrides: { name: "Beta Cup", game: "CS2", registrationOpen: true } });

  const all = await read(await tournamentsList(req("/api/tournaments", { guildId: GUILD }), env, admin));
  assert.equal(all.body.tournaments.length, 2);
  assert.equal(all.body.tournaments.find(t => t.name === "Beta Cup").status, "REGISTRATION");

  const search = await read(await tournamentsList(req("/api/tournaments?q=alpha&guildId=" + GUILD), env, admin));
  assert.equal(search.body.tournaments.length, 1);

  const filtered = await read(await tournamentsList(req("/api/tournaments?status=DRAFT&guildId=" + GUILD), env, admin));
  assert.deepEqual(filtered.body.tournaments.map(t => t.name), ["Alpha Cup"]);

  const tid = all.body.tournaments[0].id;
  const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.participants, []);
  assert.deepEqual(detail.body.matches, []);

  const del = await read(await tournamentDelete(env, admin, GUILD, tid));
  assert.equal(del.status, 200);
  assert.equal((await getTournament(env, tid)), null);
});

test("status transitions are validated and FINISHED is automatic only", async () => {
  const env = await setup();
  const tid = (await createTournament(env)).body.tournament.id;

  const invalid = await read(await tournamentStatusChange(req(`/api/tournaments/${tid}/status`, { method: "POST", guildId: GUILD, body: { status: "LIVE" } }), env, admin, GUILD, tid));
  assert.equal(invalid.status, 400);

  const open = await read(await tournamentStatusChange(req(`/api/tournaments/${tid}/status`, { method: "POST", guildId: GUILD, body: { status: "REGISTRATION" } }), env, admin, GUILD, tid));
  assert.equal(open.status, 200);
  assert.equal(open.body.tournament.status, "REGISTRATION");

  const finish = await read(await tournamentStatusChange(req(`/api/tournaments/${tid}/status`, { method: "POST", guildId: GUILD, body: { status: "FINISHED" } }), env, admin, GUILD, tid));
  assert.equal(finish.status, 400);

  assert.equal(canTransition("REGISTRATION", "UPCOMING"), true);
  assert.equal(canTransition("FINISHED", "LIVE"), false);
  assert.equal(canTransition("DRAFT", "FINISHED"), false);
});

test("participant management: add, edit, remove, duplicate and capacity rules", async () => {
  const env = await setup();
  const tid = (await createTournament(env, { overrides: { maxParticipants: 4 } })).body.tournament.id;
  const ids = await fillParticipants(env, GUILD, tid, 4);

  const duplicate = await read(await participantCreate(req(`/api/tournaments/${tid}/participants`, { method: "POST", guildId: GUILD, body: { name: "player 1" } }), env, admin, GUILD, tid));
  assert.equal(duplicate.status, 409);

  const full = await read(await participantCreate(req(`/api/tournaments/${tid}/participants`, { method: "POST", guildId: GUILD, body: { name: "Player 5" } }), env, admin, GUILD, tid));
  assert.equal(full.status, 409);

  const edit = await read(await participantEdit(req(`/api/tournaments/${tid}/participants/${ids[0]}`, { method: "PATCH", guildId: GUILD, body: { name: "Renamed Player" } }), env, admin, GUILD, tid, ids[0]));
  assert.equal(edit.status, 200);
  assert.equal(edit.body.participant.name, "Renamed Player");

  const remove = await read(await participantRemove(env, admin, GUILD, tid, ids[3]));
  assert.equal(remove.status, 200);
  const after = await listParticipants(env, tid);
  assert.equal(after.length, 3);
});

test("seeding reorders participants and is rejected once a bracket exists", async () => {
  const env = await setup();
  const tid = (await createTournament(env)).body.tournament.id;
  const ids = await fillParticipants(env, GUILD, tid, 4);

  const wrongOrder = await read(await seedsReplace(req(`/api/tournaments/${tid}/seeds`, { method: "POST", guildId: GUILD, body: { order: [ids[0], ids[1]] } }), env, admin, GUILD, tid));
  assert.equal(wrongOrder.status, 400);

  const reversed = [...ids].reverse();
  const ok = await read(await seedsReplace(req(`/api/tournaments/${tid}/seeds`, { method: "POST", guildId: GUILD, body: { order: reversed } }), env, admin, GUILD, tid));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.participants.map(p => p.id), reversed);
  assert.deepEqual(ok.body.participants.map(p => p.seed), [1, 2, 3, 4]);

  await generate(env, GUILD, tid);
  const afterBracket = await read(await seedsReplace(req(`/api/tournaments/${tid}/seeds`, { method: "POST", guildId: GUILD, body: { order: ids } }), env, admin, GUILD, tid));
  assert.equal(afterBracket.status, 409);
});

/* ---------------------------------------------------------------- brackets */

async function bracketShape(count) {
  const env = await setup();
  const overrides = count <= 4 ? { maxParticipants: 4 } : count <= 8 ? { maxParticipants: 8 } : { maxParticipants: 16 };
  const tid = (await createTournament(env, { overrides })).body.tournament.id;
  const ids = await fillParticipants(env, GUILD, tid, count);
  const res = await generate(env, GUILD, tid);
  return { env, tid, ids, res };
}

test("4-player bracket is Semifinals → Final and plays through", async () => {
  const { env, tid, ids, res } = await bracketShape(4);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.roundLabels, ["Semifinals", "Final"]);
  assert.equal(res.body.matches.length, 3);

  const first = await play(env, GUILD, tid, 0, 0, ids[0], 2, 0);
  assert.equal(first.status, 200);
  const sf2 = await play(env, GUILD, tid, 0, 1, ids[2], 1, 2); // ids[2] is participantB
  assert.equal(sf2.status, 200);

  const finalMatch = sf2.body.matches.find(m => m.roundIndex === 1);
  assert.equal(finalMatch.status, "READY");
  assert.deepEqual([finalMatch.participantA, finalMatch.participantB], [ids[0], ids[2]]);

  const done = await play(env, GUILD, tid, 1, 0, ids[2], 1, 3); // ids[2] is participantB
  assert.equal(done.body.tournament.status, "FINISHED");
  assert.equal(done.body.tournament.championId, ids[2]);
  assert.equal(done.body.champion, ids[2]);
});

test("8-player bracket is Round 1 → Semifinals → Final with winner advancement", async () => {
  const { env, tid, ids, res } = await bracketShape(8);
  assert.deepEqual(res.body.roundLabels, ["Round 1", "Semifinals", "Final"]);
  assert.equal(res.body.matches.length, 7);
  const r1 = res.body.matches.filter(m => m.roundIndex === 0);
  assert.equal(r1.length, 4);
  // Standard seeding: seed 1 meets seed 8 in the first match.
  const first = r1.find(m => m.slotIndex === 0);
  assert.deepEqual([first.participantA, first.participantB], [ids[0], ids[7]]);

  const win = await play(env, GUILD, tid, 0, 0, ids[0], 2, 1);
  assert.equal(win.status, 200);
  const sf = win.body.matches.find(m => m.roundIndex === 1 && m.slotIndex === 0);
  assert.equal(sf.participantA, ids[0]);
  assert.equal(sf.status, "PENDING");
  const stillPending = win.body.matches.filter(m => m.roundIndex === 1).every(m => m.status !== "COMPLETED");
  assert.ok(stillPending);
});

test("16-player bracket produces a Round of 16 with 15 matches", async () => {
  const { res } = await bracketShape(16);
  assert.deepEqual(res.body.roundLabels, ["Round of 16", "Quarterfinals", "Semifinals", "Final"]);
  assert.equal(res.body.matches.length, 15);
  assert.equal(res.body.matches.filter(m => m.roundIndex === 0).length, 8);
});

test("non-full brackets resolve BYEs automatically", async () => {
  const { env, tid, ids, res } = await bracketShape(6);
  assert.equal(res.status, 200);
  const byes = res.body.matches.filter(m => m.status === "BYE");
  assert.equal(byes.length, 2);
  for (const bye of byes) assert.ok(bye.winnerId === bye.participantA || bye.winnerId === bye.participantB);
  // BYE winners already occupy the semifinal slots.
  const semis = res.body.matches.filter(m => m.roundIndex === 1);
  const fed = semis.flatMap(m => [m.participantA, m.participantB]).filter(Boolean);
  for (const bye of byes) assert.ok(fed.includes(bye.winnerId), "bye winner must advance");
  assert.ok(ids.every(id => res.body.matches.some(m => m.participantA === id || m.participantB === id)));

  // A bye cannot be edited.
  const bye = byes[0];
  const edit = await play(env, GUILD, tid, bye.roundIndex, bye.slotIndex, bye.winnerId, 1, 0);
  assert.equal(edit.status, 400);
});

test("playing a full 8-player bracket ends FINISHED with a champion", async () => {
  const { env, tid, ids, res } = await bracketShape(8);
  assert.equal(res.status, 200);
  const names = Object.fromEntries(ids.map((id, i) => [id, `Player ${i + 1}`]));
  let champion = "";
  let guard = 0;
  while (!champion && guard++ < 20) {
    const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
    const ready = detail.body.matches.find(m => m.status === "READY");
    if (!ready) break;
    const played = await play(env, GUILD, tid, ready.roundIndex, ready.slotIndex, ready.participantA, 2, 0);
    assert.equal(played.status, 200, JSON.stringify(played.body));
    champion = played.body.champion;
    void names;
  }
  assert.ok(champion, "a champion must be produced");
  const finished = await getTournament(env, tid);
  assert.equal(finished.status, "FINISHED");
  assert.equal(finished.championId, champion);

  const payload = await read(await tournamentPublic(req("/api/tournament-public/" + finished.publicSlug), env, finished.publicSlug));
  assert.equal(payload.status, 200);
  assert.equal(payload.body.tournament.status, "FINISHED");
  assert.equal(payload.body.tournament.championId, champion);
});

test("correcting an earlier result clears impossible downstream matches", async () => {
  const { env, tid, ids } = await bracketShape(8);
  const winner0 = await play(env, GUILD, tid, 0, 0, ids[0], 2, 1);
  const winner1 = await play(env, GUILD, tid, 0, 1, ids[4], 1, 2); // ids[4] is participantB
  assert.equal(winner1.status, 200);
  const semi0 = winner1.body.matches.find(m => m.roundIndex === 1 && m.slotIndex === 0);
  assert.deepEqual([semi0.participantA, semi0.participantB], [ids[0], ids[4]]);
  // Complete the semifinal too, so a correction must cascade.
  const semiWin = await play(env, GUILD, tid, 1, 0, ids[0], 3, 2);
  assert.equal(semiWin.status, 200);
  const finalBefore = semiWin.body.matches.find(m => m.roundIndex === 2);
  assert.equal(finalBefore.participantA, ids[0]);

  // Correct Round 1: the other participant wins instead.
  const corrected = await play(env, GUILD, tid, 0, 0, ids[7], 1, 2); // ids[7] is participantB
  assert.equal(corrected.status, 200);
  const matches = corrected.body.matches;
  const sf = matches.find(m => m.roundIndex === 1 && m.slotIndex === 0);
  assert.equal(sf.participantA, ids[7], "corrected winner must replace the old one");
  assert.notEqual(sf.participantA, ids[0]);
  assert.equal(sf.status, "READY", "stale semifinal result must be reset");
  assert.equal(sf.winnerId, "");
  assert.equal(sf.scoreA, 0);
  const finalAfter = matches.find(m => m.roundIndex === 2);
  assert.equal(finalAfter.participantA, "", "impossible final slot must be cleared");
  assert.equal(finalAfter.status, "PENDING");
  assert.equal(corrected.body.champion, "");
  const tournament = await getTournament(env, tid);
  assert.notEqual(tournament.status, "FINISHED");
  void winner0;
});

test("correcting a result after FINISHED clears the champion and reopens the tournament", async () => {
  const { env, tid } = await bracketShape(8);
  let champion = "";
  let guard = 0;
  while (!champion && guard++ < 20) {
    const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
    const ready = detail.body.matches.find(m => m.status === "READY");
    if (!ready) break;
    const played = await play(env, GUILD, tid, ready.roundIndex, ready.slotIndex, ready.participantA, 2, 0);
    assert.equal(played.status, 200, JSON.stringify(played.body));
    champion = played.body.champion;
  }
  assert.ok(champion, "a champion must be produced");
  const done = await getTournament(env, tid);
  assert.equal(done.status, "FINISHED");

  // Flip a semifinal so the recorded final becomes impossible.
  const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
  const semi = detail.body.matches.find(m => m.roundIndex === 1 && m.status === "COMPLETED");
  assert.ok(semi, "a completed semifinal is required");
  const otherIsA = semi.participantA !== semi.winnerId;
  const other = otherIsA ? semi.participantA : semi.participantB;
  assert.ok(other, "semifinal must have two participants");
  const corrected = await play(env, GUILD, tid, 1, 0, other, otherIsA ? 2 : 0, otherIsA ? 0 : 2);
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  assert.equal(corrected.body.champion, "", "the stale champion must be dropped");

  const reopened = await getTournament(env, tid);
  assert.equal(reopened.championId, "");
  assert.notEqual(reopened.status, "FINISHED");
  const final = corrected.body.matches.find(m => m.roundIndex === 2);
  assert.equal(final.status, "READY", "the stale final result must be cleared");
  assert.equal(final.winnerId, "");
  assert.equal(final.scoreA, 0);
  assert.equal(final.scoreB, 0);
  assert.notEqual(final.participantA, champion, "the old champion must not survive in the final");
});

test("invalid results are rejected: wrong winner, draws, bad scores, unknown match", async () => {
  const { env, tid, ids } = await bracketShape(8);
  const wrongWinner = await play(env, GUILD, tid, 0, 0, "999999999999999999", 2, 1);
  assert.equal(wrongWinner.status, 400);

  const draw = await play(env, GUILD, tid, 0, 0, ids[0], 1, 1);
  assert.equal(draw.status, 400);

  const loserWins = await play(env, GUILD, tid, 0, 0, ids[0], 1, 2);
  assert.equal(loserWins.status, 400);

  const negative = await play(env, GUILD, tid, 0, 0, ids[0], -1, 2);
  assert.equal(negative.status, 400);

  const notInteger = await play(env, GUILD, tid, 0, 0, ids[0], 1.5, 0);
  assert.equal(notInteger.status, 400);

  const unknown = await play(env, GUILD, tid, 9, 9, ids[0], 2, 0);
  assert.equal(unknown.status, 404);

  // Nothing was recorded by any rejected attempt.
  const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
  assert.ok(detail.body.matches.every(m => m.status !== "COMPLETED"));
});

test("replaying an identical result is idempotent", async () => {
  const { env, tid, ids } = await bracketShape(8);
  const first = await play(env, GUILD, tid, 0, 0, ids[0], 2, 1);
  assert.equal(first.status, 200);
  const replay = await play(env, GUILD, tid, 0, 0, ids[0], 2, 1);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.unchanged, true);
  assert.deepEqual(replay.body.matches, first.body.matches);
});

/* ------------------------------------------------------------- registration */

test("public registration requires an open tournament and is duplicate-safe", async () => {
  const env = await setup();
  // Registration disabled at creation → the public route must refuse.
  const closedT = await createTournament(env, { overrides: { name: "Closed Cup", publicRegistration: true, registrationOpen: false } });
  const closedSlug = (await getTournament(env, closedT.body.tournament.id)).publicSlug;
  const closed = await read(await tournamentPublicRegister(req(`/api/tournament-public/${closedSlug}/register`, { method: "POST", body: {} }), env, admin, closedSlug));
  assert.equal(closed.status, 403);

  const tid = (await createTournament(env, { overrides: { publicRegistration: true, registrationOpen: true, maxParticipants: 4 } })).body.tournament.id;
  const created = await getTournament(env, tid);
  const slug = created.publicSlug;
  assert.equal(created.status, "REGISTRATION");

  const first = await read(await tournamentPublicRegister(req(`/api/tournament-public/${slug}/register`, { method: "POST", body: {} }), env, admin, slug));
  assert.equal(first.status, 201);
  assert.equal(first.body.participant.name, "MiersBerzins ツ♡");
  assert.equal(first.body.participant.kind, "player");

  const again = await read(await tournamentPublicRegister(req(`/api/tournament-public/${slug}/register`, { method: "POST", body: {} }), env, admin, slug));
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already registered/i);

  const other = await read(await tournamentPublicRegister(req(`/api/tournament-public/${slug}/register`, { method: "POST", body: {} }), env, outsider, slug));
  assert.equal(other.status, 201);

  const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
  assert.equal(detail.body.participants.length, 2);
  assert.equal(detail.body.participants.filter(p => p.source === "public").length, 2);

  const unknown = await read(await tournamentPublicRegister(req("/api/tournament-public/nope/register", { method: "POST", body: {} }), env, admin, "nope"));
  assert.equal(unknown.status, 404);
});

test("team registration validates team payload", async () => {
  const env = await setup();
  const tid = (await createTournament(env, { overrides: { participantType: "teams", publicRegistration: true, registrationOpen: true } })).body.tournament.id;
  await tournamentStatusChange(req(`/api/tournaments/${tid}/status`, { method: "POST", guildId: GUILD, body: { status: "REGISTRATION" } }), env, admin, GUILD, tid);
  const slug = (await getTournament(env, tid)).publicSlug;

  const missing = await read(await tournamentPublicRegister(req(`/api/tournament-public/${slug}/register`, { method: "POST", body: {} }), env, admin, slug));
  assert.equal(missing.status, 400);

  const ok = await read(await tournamentPublicRegister(req(`/api/tournament-public/${slug}/register`, { method: "POST", body: { teamName: "BalticM", members: ["Ace", "Rusher"] } }), env, admin, slug));
  assert.equal(ok.status, 201);
  assert.equal(ok.body.participant.kind, "team");
  const stored = await listParticipants(env, tid);
  assert.equal(stored[0].members.length, 2);
  assert.equal(stored[0].captainDiscordId, admin.id);
});

test("public endpoint is read-only and leaks no internal identifiers", async () => {
  const env = await setup();
  const tid = (await createTournament(env)).body.tournament.id;
  await fillParticipants(env, GUILD, tid, 4);
  await generate(env, GUILD, tid);
  const slug = (await getTournament(env, tid)).publicSlug;

  const res = await read(await tournamentPublic(req("/api/tournament-public/" + slug), env, slug));
  assert.equal(res.status, 200);
  assert.equal(res.body.tournament.name, "BalticM Test Cup");
  assert.equal(res.body.matches.length, 3);
  assert.ok(res.body.roundLabels.includes("Final"));
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes(GUILD), "guild id must not be public");
  assert.ok(!text.includes(admin.id), "discord ids must not be public");
  assert.ok(!text.includes(tid), "internal tournament id must not be public");
  assert.ok(!("announceChannelId" in res.body.tournament));
  assert.ok(!("createdBy" in res.body.tournament));
  // GET only — registration writes go through the separate authenticated route.
  const notFound = await read(await tournamentPublic(req("/api/tournament-public/missing"), env, "missing"));
  assert.equal(notFound.status, 404);
});

/* ------------------------------------------------------- Discord announcements */

test("announcements are idempotent and never post without a channel", async () => {
  const env = await setup();
  const tid = (await createTournament(env, { overrides: { announceChannelId: "123456789012345678" } })).body.tournament.id;
  const tournament = await getTournament(env, tid);
  const realFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    posts.push(u + (init?.method || "GET"));
    if (u.includes("/channels/123456789012345678/messages")) return { ok: true, json: async () => ({ id: "m1" }) };
    return { ok: true, json: async () => ({ id: "123456789012345678", guild_id: GUILD }) };
  };
  try {
    const first = await announceTournamentEvent(env, tournament, "created", { key: "created" });
    assert.equal(first.ok, true);
    const replay = await announceTournamentEvent(env, tournament, "created", { key: "created" });
    assert.equal(replay.duplicate, true);
    const messageSends = posts.filter(p => p.includes("/messages") && p.includes("POST"));
    assert.equal(messageSends.length, 1, "a replayed lifecycle event must not post twice");

    // No channel configured → nothing is sent at all.
    const noChannel = { ...tournament, announceChannelId: "" };
    const skipped = await announceTournamentEvent(env, noChannel, "started", { key: "started" });
    assert.equal(skipped.skipped, true);

    // Channel belonging to another guild is refused and the claim is released.
    globalThis.fetch = async url => String(url).includes("/messages")
      ? { ok: true, json: async () => ({ id: "m2" }) }
      : { ok: true, json: async () => ({ id: "999999999999999999", guild_id: OTHER_GUILD }) };
    const foreign = await announceTournamentEvent(env, tournament, "started", { key: "started" });
    assert.equal(foreign.ok, false);
    const retried = await announceTournamentEvent(env, tournament, "started", { key: "started" });
    assert.notEqual(retried.duplicate, true, "failed send must release the claim so a retry can post");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("result announcements carry the BalticM footer and result copy", () => {
  const tournament = { name: "BalticM Test Cup", game: "CS2" };
  const match = { participantA: "a", participantB: "b", roundIndex: 1 };
  const names = { a: "BalticM", b: "Team X" };
  const result = buildAnnouncement("match_result", { tournament, match, names, winnerId: "a", scoreA: 2, scoreB: 1, isFinal: false });
  assert.equal(result.embeds[0].title, "🏆 Tournament Result");
  assert.match(result.embeds[0].description, /BalticM 2 — 1 Team X/);
  assert.match(result.embeds[0].description, /advances to the next round/);
  assert.equal(result.embeds[0].footer.text, "Powered by Bot.BalticM.eu • PLAY TOGETHER");

  const final = buildAnnouncement("match_result", { tournament, match, names, winnerId: "a", scoreA: 2, scoreB: 1, isFinal: true });
  assert.match(final.embeds[0].description, /wins the tournament/);
  const champion = buildAnnouncement("winner", { tournament, names, winnerId: "a" });
  assert.match(champion.embeds[0].description, /wins BalticM Test Cup/);
  assert.equal(champion.embeds[0].footer.text, "Powered by Bot.BalticM.eu • PLAY TOGETHER");
});

/* ------------------------------------------------------- permissions & routing */

test("tournament routes are wired into the existing RBAC model", () => {
  assert.ok(ACCESS_KEYS.includes("tournaments"));
  assert.equal(routeAccessKey("/api/tournaments"), "tournaments");
  assert.equal(routeAccessKey("/api/tournaments/abc/matches/0-1"), "tournaments");
  assert.equal(routeAccessKey("/api/tournament-public/abc"), null, "public routes must not demand guild RBAC");
  assert.equal(requiredLevelForRequest("/api/tournaments", "GET"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/tournaments/abc/matches/0-1", "POST"), ACCESS_OPERATE);
  assert.equal(requiredLevelForRequest("/api/tournaments/abc", "DELETE"), ACCESS_OPERATE);
});

test("worker dispatch enforces session, guild membership and route order", async () => {
  const fs = await import("node:fs");
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  // Public routes are registered before the authenticated /api/* gate.
  const gateAt = worker.indexOf('if(p.startsWith("/api/"))');
  const publicAt = worker.indexOf('if(p.startsWith("/api/tournament-public/"))');
  assert.ok(publicAt > -1 && gateAt > -1 && publicAt < gateAt, "public tournament routes must precede the auth gate");
  // Registration requires a session.
  assert.match(worker, /tournamentPublicRegister\(req,env,user,slug\)/);
  assert.match(worker, /const user=await session\(req,env\);if\(!user\)return json\(\{error:"Unauthorized"\},401\)/);
  // Every management dispatch line validates guildId + membership.
  const lines = worker.split("\n").filter(l => l.includes("tournaments") && l.includes("guildId"));
  assert.ok(lines.length >= 8, "expected tournament routes with guild checks");
  for (const line of lines) {
    assert.match(line, /canManageGuild\(user,guildId\)/);
    assert.match(line, /guildId is required/);
  }
  assert.match(worker, /from "\.\/tournaments-api\.js"/);
  const api = fs.readFileSync(new URL("../tournaments-api.js", import.meta.url), "utf8");
  assert.match(api, /from "\.\/tournaments\.js"/);
  assert.match(api, /from "\.\/tournaments-db\.js"/);
});

test("frontend routes, nav and public page are wired without breaking existing pages", async () => {
  const fs = await import("node:fs");
  const main = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const state = fs.readFileSync(new URL("../src/control-center-state.js", import.meta.url), "utf8");
  assert.match(state, /Tournaments: "\/tournaments"/);
  assert.match(state, /Tournaments: "tournaments"/);
  assert.match(main, /\["Tournaments",Trophy\]/);
  assert.match(main, /page==="Tournaments"&&user&&<Tournaments/);
  assert.match(main, /publicTournamentMatch/);
  assert.match(main, /<PublicTournament slug=\{decodeURIComponent\(publicTournamentMatch\[1\]\)\}\/>/);
  // Existing admin mount untouched.
  assert.match(main, /if\(isAdminRoute\)return <AdminPanel\/>/);
  assert.ok(main.length > 150000, "main.jsx unexpectedly truncated");

  const css = fs.readFileSync(new URL("../src/tournaments.css", import.meta.url), "utf8");
  // Bracket scrolling is confined to the frame, never the page.
  assert.match(css, /\.tBracketScroll\{overflow-x:auto/);
  assert.match(css, /\.tBracketFrame\{[^}]*max-width:100%/);
  assert.match(css, /@media\(max-width:768px\)/);
  assert.match(css, /@media\(max-width:480px\)/);
  // Touch targets stay usable on phones.
  assert.match(css, /\.tMatchScore\{[^}]*min-height:44px/);
});

test("validation helpers keep V1 inputs inside safe bounds", () => {
  assert.equal(validateTournamentInput({ name: "A".repeat(200), game: "CS2", startAt: "2026-11-20T18:00:00.000Z" }).ok, false);
  assert.equal(validateTournamentInput({ name: "Ok", game: "CS2", startAt: "not-a-date" }).ok, false);
  assert.equal(validateTournamentInput({ name: "Ok", game: "CS2", startAt: "2026-11-20T18:00:00.000Z", bannerUrl: "http://insecure.example/x.png" }).ok, false);
  assert.equal(validateTournamentInput({ name: "Ok", game: "CS2", startAt: "2026-11-20T18:00:00.000Z", bannerUrl: "https://example.com/x.png" }).ok, true);
  const patch = validateTournamentInput({ registrationOpen: true }, { partial: true });
  assert.equal(patch.ok, true);
  assert.equal(patch.value.registrationOpen, true);
});

test("applyResult never advances a loser and championFrom waits for the final", () => {
  const participants = Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, seed: i + 1 }));
  const { ok, matches } = generateBracket(participants);
  assert.ok(ok);
  const bad = applyResult(matches, { roundIndex: 0, slotIndex: 0, winnerId: "not-a-player", scoreA: 2, scoreB: 0 });
  assert.equal(bad.ok, false);
  const after = applyResult(matches, { roundIndex: 0, slotIndex: 0, winnerId: matches[0].participantA, scoreA: 2, scoreB: 0 });
  assert.equal(after.ok, true);
  assert.equal(after.champion, "", "champion only exists once the final completes");
  const sf = after.matches.find(m => m.roundIndex === 1 && m.slotIndex === 0);
  assert.ok(sf.participantA === matches[0].participantA || sf.participantB === matches[0].participantA);
});

/* ================================================== Team / Clan tournaments */

async function addTeam(env, guildId, tid, name, members = [], user = admin, extra = {}) {
  return read(
    await participantCreate(
      req(`/api/tournaments/${tid}/participants`, { method: "POST", guildId, body: { teamName: name, members, ...extra } }),
      env, user, guildId, tid
    )
  );
}

async function registerTeam(env, slug, user, body) {
  return read(await tournamentPublicRegister(req(`/api/tournament-public/${slug}/register`, { method: "POST", body }), env, user, slug));
}

test("team tournament: creation, team CRUD, member CRUD, capacity and logo validation", async () => {
  const env = await setup();
  const created = await createTournament(env, { overrides: { participantType: "teams", maxParticipants: 4 } });
  assert.equal(created.status, 201);
  assert.equal(created.body.tournament.participantType, "teams");
  assert.equal(created.body.tournament.maxParticipants, 4, "capacity counts TEAMS, not players");
  const tid = created.body.tournament.id;

  const badLogo = await addTeam(env, GUILD, tid, "Insecure FC", [], admin, { logoUrl: "http://logo.example/x.png" });
  assert.equal(badLogo.status, 400);

  const first = await addTeam(env, GUILD, tid, "BalticM", ["MiersBerzins", "PlayerTwo", "PlayerThree", "PlayerFour", "PlayerFive"], admin, {
    logoUrl: "https://logo.example/balticm.png",
    captainName: "MiersBerzins"
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.participant.kind, "team");
  assert.equal(first.body.participant.logoUrl, "https://logo.example/balticm.png");
  assert.equal(first.body.participant.members.length, 5);
  assert.equal(first.body.participant.captainName, "MiersBerzins");

  // Duplicate team name is refused (case-insensitive).
  const dupName = await addTeam(env, GUILD, tid, "balticm");
  assert.equal(dupName.status, 409);

  assert.equal((await addTeam(env, GUILD, tid, "NightWolves", ["PlayerA", "PlayerB"])).status, 201);
  assert.equal((await addTeam(env, GUILD, tid, "Arctic Foxes", ["Frost"])).status, 201);
  assert.equal((await addTeam(env, GUILD, tid, "Team X", ["Someone"])).status, 201);

  // Capacity is enforced in teams.
  const overflow = await addTeam(env, GUILD, tid, "Team Five");
  assert.equal(overflow.status, 409);

  // Member + team edit round-trip: edit members (add/edit/remove) and logo/captain.
  const target = (await listParticipants(env, tid)).find(p => p.name === "NightWolves");
  const edited = await read(await participantEdit(
    req(`/api/tournaments/${tid}/participants/${target.id}`, { method: "PATCH", guildId: GUILD, body: {
      teamName: "NightWolves", logoUrl: "https://logo.example/nw.png", captainName: "PlayerA",
      members: [{ displayName: "PlayerA" }, { displayName: "PlayerB2" }]
    } }),
    env, admin, GUILD, tid, target.id
  ));
  assert.equal(edited.status, 200);
  assert.equal(edited.body.participant.logoUrl, "https://logo.example/nw.png");
  assert.equal(edited.body.participant.captainName, "PlayerA");
  assert.deepEqual(edited.body.participant.members.map(m => m.displayName), ["PlayerA", "PlayerB2"]);

  // Remove a team.
  const removed = await read(await participantRemove(env, admin, GUILD, tid, target.id));
  assert.equal(removed.status, 200);
  assert.equal((await listParticipants(env, tid)).length, 3);
});

test("teams: guild isolation, unauthorized mutation and identity rules", async () => {
  const env = await setup();
  const tid = (await createTournament(env, { overrides: { participantType: "teams" } })).body.tournament.id;
  await addTeam(env, GUILD, tid, "BalticM", [{ displayName: "MiersBerzins", discordId: admin.id }]);

  // Caller not a member of the requested guild at all.
  const forged = await addTeam(env, OTHER_GUILD, tid, "Sneaky");
  assert.equal(forged.status, 403);
  // Outsider of another guild hitting this tournament id resolves to 404 (IDOR).
  const idor = await addTeam(env, OTHER_GUILD, tid, "Sneaky", [], outsider);
  assert.equal(idor.status, 404);
  const edit = await read(await participantEdit(
    req(`/api/tournaments/${tid}/participants/x`, { method: "PATCH", guildId: OTHER_GUILD, body: { teamName: "Hacked" } }),
    env, outsider, OTHER_GUILD, tid, "x"
  ));
  assert.equal(edit.status, 404);

  // Same Discord user cannot sit in two teams where identity is known.
  const clash = await addTeam(env, GUILD, tid, "NightWolves", [{ displayName: "Alt", discordId: admin.id }]);
  assert.equal(clash.status, 409);
  // Unknown identities are fine.
  assert.equal((await addTeam(env, GUILD, tid, "NightWolves", [{ displayName: "PlayerA", discordId: "555555555555555555" }])).status, 201);
});

test("public team registration: session-derived captain, duplicates, capacity, closed and deadline", async () => {
  const env = await setup();
  const tid = (await createTournament(env, {
    overrides: { participantType: "teams", publicRegistration: true, registrationOpen: true, maxParticipants: 4 }
  })).body.tournament.id;
  const slug = (await getTournament(env, tid)).publicSlug;

  // Forged captain identity in the body is ignored — the session decides.
  const forged = await registerTeam(env, slug, admin, { teamName: "NightWolves", captainDiscordId: outsider.id, members: [{ displayName: "Ace", discordId: "666666666666666666" }] });
  assert.equal(forged.status, 201);
  const stored = (await listParticipants(env, tid))[0];
  assert.equal(stored.captainDiscordId, admin.id, "captain must come from the session, never the client");
  assert.equal(stored.source, "public");

  // Same user cannot register a second team.
  const again = await registerTeam(env, slug, admin, { teamName: "NightWolves II" });
  assert.equal(again.status, 409);
  assert.match(again.body.error, /already registered/i);

  // Duplicate team name from a different user.
  const dupName = await registerTeam(env, slug, outsider, { teamName: "nightwolves" });
  assert.equal(dupName.status, 409);

  // A Discord id already inside another team cannot be used as a member.
  const memberClash = await registerTeam(env, slug, outsider, { teamName: "Arctic Foxes", members: [{ displayName: "Miers alt", discordId: admin.id }] });
  assert.equal(memberClash.status, 409);

  // Legitimate second team.
  assert.equal((await registerTeam(env, slug, outsider, { teamName: "Arctic Foxes", members: [{ displayName: "Frost" }] })).status, 201);

  // Registration hint: signed-in visitor sees own-entry state, anonymous does not.
  const withSession = await read(await tournamentPublic(req(`/api/tournament-public/${slug}`), env, slug, admin));
  assert.deepEqual(withSession.body.registration.you, { registered: true, name: "NightWolves" });
  const anon = await read(await tournamentPublic(req(`/api/tournament-public/${slug}`), env, slug, null));
  assert.ok(!("you" in anon.body.registration));

  // Fill to capacity → registration refuses (capacity counts teams).
  const third = { id: "777777777777777777", username: "t3", global_name: "Third", guilds: [{ id: GUILD, name: "Baltic" }] };
  const fourth = { id: "888888888888888888", username: "t4", global_name: "Fourth", guilds: [{ id: GUILD, name: "Baltic" }] };
  const fifth = { id: "999999999999999999", username: "t5", global_name: "Fifth", guilds: [{ id: GUILD, name: "Baltic" }] };
  assert.equal((await registerTeam(env, slug, third, { teamName: "Team Three" })).status, 201);
  assert.equal((await registerTeam(env, slug, fourth, { teamName: "Team Four" })).status, 201);
  const full = await registerTeam(env, slug, fifth, { teamName: "Team Five" });
  assert.equal(full.status, 403);
  assert.match(full.body.error, /full/i);
});

test("team registration refuses closed tournaments and expired deadlines", async () => {
  const env = await setup();
  // Registration disabled at creation.
  const closedT = (await createTournament(env, { overrides: { name: "Closed Teams", participantType: "teams", publicRegistration: true, registrationOpen: false } })).body.tournament;
  const closed = await registerTeam(env, closedT.publicSlug, admin, { teamName: "Nope" });
  assert.equal(closed.status, 403);

  // Deadline in the past.
  const past = (await createTournament(env, {
    overrides: { name: "Late Teams", participantType: "teams", publicRegistration: true, registrationOpen: true, registrationDeadline: "2020-01-01T00:00:00.000Z" }
  })).body.tournament;
  const late = await registerTeam(env, past.publicSlug, admin, { teamName: "Too Late" });
  assert.equal(late.status, 403);
  assert.match(late.body.error, /deadline/i);

  // Missing team name → 400.
  const missing = await registerTeam(env, past.publicSlug, admin, {});
  assert.ok(missing.status === 403 || missing.status === 400);
});

async function teamBracket(count) {
  const env = await setup();
  const max = count <= 4 ? 4 : count <= 8 ? 8 : 16;
  const tid = (await createTournament(env, { overrides: { participantType: "teams", maxParticipants: max } })).body.tournament.id;
  const ids = [];
  for (let i = 1; i <= count; i++) {
    const res = await addTeam(env, GUILD, tid, `Squad ${i}`);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ids.push(res.body.participant.id);
  }
  const res = await generate(env, GUILD, tid);
  return { env, tid, ids, res };
}

test("4-team bracket: Semifinals → Final → team Champion with roster", async () => {
  const { env, tid, ids, res } = await teamBracket(4);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.roundLabels, ["Semifinals", "Final"]);
  assert.equal(res.body.matches.length, 3);
  // Standard seeding: seed 1 meets seed 4, seed 2 meets seed 3.
  const sf1 = res.body.matches.find(m => m.roundIndex === 0 && m.slotIndex === 0);
  assert.deepEqual([sf1.participantA, sf1.participantB], [ids[0], ids[3]]);

  const m1 = await play(env, GUILD, tid, 0, 0, ids[0], 2, 0);
  assert.equal(m1.status, 200);
  const m2 = await play(env, GUILD, tid, 0, 1, ids[1], 2, 1);
  assert.equal(m2.status, 200);
  const finalM = m2.body.matches.find(m => m.roundIndex === 1);
  assert.equal(finalM.status, "READY");
  assert.deepEqual([finalM.participantA, finalM.participantB], [ids[0], ids[1]], "teams advance, not members");

  const done = await play(env, GUILD, tid, 1, 0, ids[1], 1, 3);
  assert.equal(done.body.tournament.status, "FINISHED");
  assert.equal(done.body.champion, ids[1]);
  assert.equal(done.body.tournament.championId, ids[1]);

  // Public payload: champion is a TEAM and its roster is visible.
  const slug = (await getTournament(env, tid)).publicSlug;
  const pub = await read(await tournamentPublic(req("/api/tournament-public/" + slug), env, slug));
  assert.equal(pub.status, 200);
  const champ = pub.body.participants.find(p => p.id === pub.body.tournament.championId);
  assert.equal(champ.name, "Squad 2");
  assert.ok(Array.isArray(champ.members));
});

test("8-team bracket, BYEs with 6 teams, and team seeding", async () => {
  const eight = await teamBracket(8);
  assert.deepEqual(eight.res.body.roundLabels, ["Round 1", "Semifinals", "Final"]);
  assert.equal(eight.res.body.matches.length, 7);
  const r1 = eight.res.body.matches.filter(m => m.roundIndex === 0);
  assert.deepEqual([r1[0].participantA, r1[0].participantB], [eight.ids[0], eight.ids[7]], "seed 1 vs seed 8");
  const win = await play(eight.env, GUILD, eight.tid, 0, 0, eight.ids[0], 2, 1);
  assert.equal(win.status, 200);
  const sf = win.body.matches.find(m => m.roundIndex === 1 && m.slotIndex === 0);
  assert.equal(sf.participantA, eight.ids[0], "winning TEAM advances");

  // 6 teams → bracket of 8 → 2 BYEs auto-advance.
  const six = await teamBracket(6);
  const byes = six.res.body.matches.filter(m => m.status === "BYE");
  assert.equal(byes.length, 2);
  const semis = six.res.body.matches.filter(m => m.roundIndex === 1);
  const fed = semis.flatMap(m => [m.participantA, m.participantB]).filter(Boolean);
  for (const bye of byes) assert.ok(fed.includes(bye.winnerId), "bye winner team must advance");

  // Seeding works before the bracket and is refused afterwards.
  const seedEnv = await setup();
  const seedTid = (await createTournament(seedEnv, { overrides: { participantType: "teams", maxParticipants: 8 } })).body.tournament.id;
  const a = (await addTeam(seedEnv, GUILD, seedTid, "Alpha")).body.participant.id;
  const b = (await addTeam(seedEnv, GUILD, seedTid, "Bravo")).body.participant.id;
  const c = (await addTeam(seedEnv, GUILD, seedTid, "Charlie")).body.participant.id;
  const reordered = await read(await seedsReplace(req(`/api/tournaments/${seedTid}/seeds`, { method: "POST", guildId: GUILD, body: { order: [c, a, b] } }), seedEnv, admin, GUILD, seedTid));
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.participants.map(p => p.name), ["Charlie", "Alpha", "Bravo"]);
  await generate(seedEnv, GUILD, seedTid);
  const afterBracket = await read(await seedsReplace(req(`/api/tournaments/${seedTid}/seeds`, { method: "POST", guildId: GUILD, body: { order: [a, b, c] } }), seedEnv, admin, GUILD, seedTid));
  assert.equal(afterBracket.status, 409);
});

test("16-team bracket produces a Round of 16 with 15 matches", async () => {
  const { res } = await teamBracket(16);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.roundLabels, ["Round of 16", "Quarterfinals", "Semifinals", "Final"]);
  assert.equal(res.body.matches.length, 15);
  assert.equal(res.body.matches.filter(m => m.roundIndex === 0).length, 8);
});

test("team result correction cascades and rolls back a finished team champion", async () => {
  const { env, tid, ids } = await teamBracket(4);
  assert.equal((await play(env, GUILD, tid, 0, 0, ids[0], 2, 0)).status, 200);
  assert.equal((await play(env, GUILD, tid, 0, 1, ids[1], 2, 0)).status, 200);
  const done = await play(env, GUILD, tid, 1, 0, ids[1], 1, 2); // ids[1] is participantB
  assert.equal(done.body.tournament.status, "FINISHED");
  assert.equal(done.body.tournament.championId, ids[1]);

  // Flip a semifinal → the completed final becomes impossible.
  const corrected = await play(env, GUILD, tid, 0, 0, ids[3], 0, 2);
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  assert.equal(corrected.body.champion, "", "stale champion must be dropped");
  const reopened = await getTournament(env, tid);
  assert.equal(reopened.championId, "");
  assert.notEqual(reopened.status, "FINISHED");
  const finalM = corrected.body.matches.find(m => m.roundIndex === 1);
  assert.equal(finalM.status, "READY", "impossible final result cleared but rebuilt with the new finalist");
  assert.equal(finalM.winnerId, "");
  assert.equal(finalM.scoreA, 0);

  // Re-complete the tournament after the correction.
  const replay = await play(env, GUILD, tid, 1, 0, ids[3], 2, 0);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.tournament.status, "FINISHED");
  assert.equal(replay.body.tournament.championId, ids[3]);
});

test("team public payload exposes rosters but no discord ids, guild ids or internals", async () => {
  const env = await setup();
  const tid = (await createTournament(env, { overrides: { participantType: "teams", publicRegistration: true, registrationOpen: true } })).body.tournament.id;
  await addTeam(env, GUILD, tid, "BalticM", [{ displayName: "MiersBerzins", discordId: admin.id }, { displayName: "PlayerTwo" }], admin, { captainName: "MiersBerzins", logoUrl: "https://logo.example/bm.png" });
  await addTeam(env, GUILD, tid, "NightWolves", ["PlayerA"]);
  await addTeam(env, GUILD, tid, "Arctic Foxes", ["Frost"]);
  await addTeam(env, GUILD, tid, "Team X", ["Ghost"]);
  await generate(env, GUILD, tid);
  const slug = (await getTournament(env, tid)).publicSlug;

  const res = await read(await tournamentPublic(req("/api/tournament-public/" + slug), env, slug));
  assert.equal(res.status, 200);
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes(GUILD), "guild id must not be public");
  assert.ok(!text.includes(admin.id), "discord ids must not be public");
  assert.ok(!text.includes(tid), "internal tournament id must not be public");
  assert.ok(!text.includes("discordId"), "member discord ids stay internal");
  assert.ok(!("registeredBy" in res.body.participants[0]));
  const balticm = res.body.participants.find(p => p.name === "BalticM");
  assert.equal(balticm.logoUrl, "https://logo.example/bm.png");
  assert.deepEqual(balticm.members, ["MiersBerzins", "PlayerTwo"], "roster visible as display names");
  assert.equal(balticm.captainName, "MiersBerzins");
  // Bracket treats teams as single participants.
  const sf = res.body.matches.find(m => m.roundIndex === 1);
  assert.ok(res.body.names[sf.participantA] || !sf.participantA);
});

/* ================================================== V1.2 — premium branding,
   Discord announcement polish, idempotency and regression coverage ======= */

const CHANNEL = "123456789012345678";

/** Grant / expire Premium through the SAME bot_config row the real system uses. */
async function setPremium(env, guildId = GUILD, { expiresAt = "2099-01-01T00:00:00.000Z" } = {}) {
  await env.BALTICM_DB.prepare(
    "INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
  )
    .bind(`premium-plan:${guildId}`, JSON.stringify({ plan: "vip", source: "tebex", startsAt: "2026-01-01T00:00:00.000Z", expiresAt }), new Date().toISOString())
    .run();
}

const brandingReq = (method, body, guildId) => req("/api/tournaments/branding", { method, body, guildId });

/** Capture every Discord message the code under test tries to send. */
function captureDiscord() {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("/messages") && init?.method === "POST") {
      sent.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: "m" + sent.length }) };
    }
    if (u.includes("/channels/")) return { ok: true, json: async () => ({ id: CHANNEL, guild_id: GUILD }) };
    return { ok: true, json: async () => ({}) };
  };
  return { sent, restore: () => { globalThis.fetch = realFetch; } };
}

const fieldsOf = (embed) => Object.fromEntries((embed.fields || []).map(x => [x.name, x.value]));
const champPosts = (sent) => sent.filter(m => m.embeds?.[0]?.title === "🏆 TOURNAMENT CHAMPION");

/* ------------------------------------------------- 1–5: branding security */

test("V1.2 free guild cannot save custom Tournament branding", async () => {
  const env = await setup({ premium: false });
  const save = await read(await tournamentBrandingSave(brandingReq("POST", { name: "My Community", logoUrl: "https://img.example/logo.png" }, GUILD), env, admin));
  assert.equal(save.status, 403);
  assert.equal(save.body.code, "premium_required");
  const state = await read(await tournamentBrandingState(brandingReq("GET", undefined, GUILD), env, admin));
  assert.equal(state.status, 200);
  assert.equal(state.body.premium, false);
  assert.equal(state.body.active, false);
  assert.equal(state.body.branding.name, "", "a free guild must not persist branding");
});

test("V1.2 premium guild can save custom branding and reset it", async () => {
  const env = await setup();
  await setPremium(env, GUILD);
  const save = await read(await tournamentBrandingSave(brandingReq("POST", { name: "My Community", logoUrl: "https://img.example/logo.png" }, GUILD), env, admin));
  assert.equal(save.status, 200);
  assert.equal(save.body.active, true);
  const state = await read(await tournamentBrandingState(brandingReq("GET", undefined, GUILD), env, admin));
  assert.equal(state.body.premium, true);
  assert.equal(state.body.active, true);
  assert.equal(state.body.branding.name, "My Community");
  assert.equal(state.body.branding.logoUrl, "https://img.example/logo.png");
  const reset = await read(await tournamentBrandingSave(brandingReq("POST", { name: "", logoUrl: "" }, GUILD), env, admin));
  assert.equal(reset.status, 200);
  assert.equal(reset.body.active, false, "an empty payload clears back to BalticM defaults");
});

test("V1.2 cross-guild branding access and updates are rejected", async () => {
  const env = await setup();
  await setPremium(env, GUILD);
  assert.equal((await read(await tournamentBrandingSave(brandingReq("POST", { name: "GUILD Brand" }, GUILD), env, admin))).status, 200);
  await setPremium(env, OTHER_GUILD);
  // Admin is not a member of OTHER_GUILD — forged guild id is refused.
  const forgedSave = await read(await tournamentBrandingSave(brandingReq("POST", { name: "Hijack" }, OTHER_GUILD), env, admin));
  assert.equal(forgedSave.status, 403);
  const forgedGet = await read(await tournamentBrandingState(brandingReq("GET", undefined, OTHER_GUILD), env, admin));
  assert.equal(forgedGet.status, 403);
  // Another guild's member reads their OWN (empty) branding — never GUILD's.
  const otherView = await read(await tournamentBrandingState(brandingReq("GET", undefined, OTHER_GUILD), env, outsider));
  assert.equal(otherView.status, 200);
  assert.equal(otherView.body.branding.name, "", "branding must be guild-isolated");
  const missing = await read(await tournamentBrandingSave(brandingReq("POST", { name: "X" }), env, admin));
  assert.equal(missing.status, 400);
});

test("V1.2 expired premium falls back to BalticM branding without deleting config", async () => {
  const env = await setup();
  await setPremium(env, GUILD);
  assert.equal((await read(await tournamentBrandingSave(brandingReq("POST", { name: "Old Brand", logoUrl: "https://img.example/old.png" }, GUILD), env, admin))).status, 200);
  // Create while Premium is active (plan limits apply at creation time) — the
  // tournament below then proves expiry never downgrades existing data.
  const tid = (await createTournament(env)).body.tournament.id;
  await setPremium(env, GUILD, { expiresAt: "2020-01-01T00:00:00.000Z" });
  const state = await read(await tournamentBrandingState(brandingReq("GET", undefined, GUILD), env, admin));
  assert.equal(state.body.premium, false);
  assert.equal(state.body.active, false, "expired premium must not apply branding");
  assert.equal(state.body.branding.name, "Old Brand", "stored configuration must survive expiry");
  const blocked = await read(await tournamentBrandingSave(brandingReq("POST", { name: "New Brand" }, GUILD), env, admin));
  assert.equal(blocked.status, 403, "saving requires active premium again");
  const slug = (await getTournament(env, tid)).publicSlug;
  const pub = await read(await tournamentPublic(req("/api/tournament-public/" + slug), env, slug));
  assert.equal(pub.body.branding.custom, false);
  assert.equal(pub.body.branding.name, "BALTICM");
  assert.equal(pub.body.branding.logoUrl, "");
});

test("V1.2 valid custom branding appears in the public Tournament payload", async () => {
  const env = await setup();
  await setPremium(env, GUILD);
  assert.equal((await read(await tournamentBrandingSave(brandingReq("POST", { name: "Mayhem Arena", logoUrl: "https://img.example/ma.png" }, GUILD), env, admin))).status, 200);
  const tid = (await createTournament(env)).body.tournament.id;
  const slug = (await getTournament(env, tid)).publicSlug;
  const pub = await read(await tournamentPublic(req("/api/tournament-public/" + slug), env, slug));
  assert.equal(pub.status, 200);
  assert.equal(pub.body.branding.custom, true);
  assert.equal(pub.body.branding.name, "Mayhem Arena");
  assert.equal(pub.body.branding.logoUrl, "https://img.example/ma.png");
  const text = JSON.stringify(pub.body.branding);
  assert.ok(!text.includes(GUILD), "branding must not leak guild ids");
});

/* ------------------------------------------------------- 6–7: team logos */

test("V1.2 team logo direct URL persists through detail, edit and public payload", async () => {
  const env = await setup();
  const tid = (await createTournament(env, { overrides: { participantType: "teams", publicRegistration: true, registrationOpen: true } })).body.tournament.id;
  const added = await addTeam(env, GUILD, tid, "Logo FC", ["A", "B"], admin, { logoUrl: "https://i.imgur.com/abc.png" });
  assert.equal(added.status, 201);
  assert.equal(added.body.participant.logoUrl, "https://i.imgur.com/abc.png");
  const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
  assert.equal(detail.body.participants[0].logoUrl, "https://i.imgur.com/abc.png");
  const slug = (await getTournament(env, tid)).publicSlug;
  const pub = await read(await tournamentPublic(req("/api/tournament-public/" + slug), env, slug));
  assert.equal(pub.body.participants.find(p => p.name === "Logo FC").logoUrl, "https://i.imgur.com/abc.png");
  const target = detail.body.participants[0];
  const edited = await read(await participantEdit(
    req(`/api/tournaments/${tid}/participants/${target.id}`, { method: "PATCH", guildId: GUILD, body: { teamName: "Logo FC", logoUrl: "https://i.imgur.com/xyz.png", members: [{ displayName: "A" }] } }),
    env, admin, GUILD, tid, target.id
  ));
  assert.equal(edited.body.participant.logoUrl, "https://i.imgur.com/xyz.png");
});

test("V1.2 invalid logo URLs are rejected and branding input is sanitized", async () => {
  const env = await setup();
  const tid = (await createTournament(env, { overrides: { participantType: "teams" } })).body.tournament.id;
  assert.equal((await addTeam(env, GUILD, tid, "Insecure FC", [], admin, { logoUrl: "http://x.example/logo.png" })).status, 400);
  assert.equal((await addTeam(env, GUILD, tid, "Ftp FC", [], admin, { logoUrl: "ftp://x.example/logo.png" })).status, 400);
  // Pure branding validation: https-only, length-limited, whitespace-sanitized,
  // empty payload = explicit reset, name required when a logo is present.
  assert.equal(validateBrandingInput({ name: "Ok", logoUrl: "https://x.example/l.png" }).ok, true);
  assert.equal(validateBrandingInput({ name: "Ok", logoUrl: "http://x.example/l.png" }).ok, false);
  assert.equal(validateBrandingInput({ name: "Ok", logoUrl: "ftp://x.example/l.png" }).ok, false);
  assert.equal(validateBrandingInput({ name: "A".repeat(60) }).ok, false);
  assert.equal(validateBrandingInput({ name: "A".repeat(48) }).ok, true);
  assert.equal(validateBrandingInput({ name: "  Spaced   Name  " }).value.name, "Spaced Name");
  assert.equal(validateBrandingInput({ name: "", logoUrl: "" }).ok, true);
  assert.equal(validateBrandingInput({ name: "", logoUrl: "https://x.example/l.png" }).ok, false);
  assert.equal(validateBrandingInput(null).ok, true, "empty body = reset");
  // API level: even a premium guild gets 400 for an insecure logo.
  await setPremium(env, GUILD);
  const bad = await read(await tournamentBrandingSave(brandingReq("POST", { name: "Ok", logoUrl: "http://x.example/l.png" }, GUILD), env, admin));
  assert.equal(bad.status, 400);
});

/* --------------------------------------------- 8–12: announcement content */

test("V1.2 registration-open announcement includes full event content and CTA", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    const tid = (await createTournament(env, {
      overrides: { name: "Announce Cup", game: "Valorant", announceChannelId: CHANNEL, registrationDeadline: "2026-12-01T18:00:00.000Z" }
    })).body.tournament.id;
    assert.equal(cap.sent.length, 1, "creation announces once");
    assert.match(cap.sent[0].embeds[0].title, /New tournament/);
    const patch = await read(await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { registrationOpen: true } }), env, admin, tid));
    assert.equal(patch.status, 200);
    assert.equal(cap.sent.length, 2);
    const emb = cap.sent[1].embeds[0];
    assert.match(emb.title, /Registration open/);
    assert.match(emb.title, /Announce Cup/);
    const f = fieldsOf(emb);
    assert.equal(f.Game, "Valorant");
    assert.equal(f.Format, "Single Elimination");
    assert.equal(f.Type, "Individual players");
    assert.ok(f.Starts, "start date/time is included");
    assert.equal(f["Registration closes"], new Date("2026-12-01T18:00:00.000Z").toUTCString());
    assert.equal(f.Entrants, "0 / 8 players");
    assert.ok(emb.url.includes("/tournaments/"), "public Tournament URL is linked");
    assert.equal(emb.footer.text, ANNOUNCEMENT_FOOTER);
    assert.equal(emb.author.name, "BALTICM TOURNAMENTS");
    const btn = cap.sent[1].components[0].components[0];
    assert.equal(btn.style, 5, "link button CTA");
    assert.equal(btn.label, "Register / View Tournament");
    assert.equal(btn.url, emb.url);
    // Re-sending the same state is not a transition → no duplicate.
    const again = await read(await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { registrationOpen: true } }), env, admin, tid));
    assert.equal(again.status, 200);
    assert.equal(cap.sent.length, 2, "duplicate state must not announce");
  } finally { cap.restore(); }
});

test("V1.2 team tournament announcements use team wording, counts and bracket-ready", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    const tid = (await createTournament(env, {
      overrides: { name: "Clan Wars", participantType: "teams", maxParticipants: 4, announceChannelId: CHANNEL, registrationOpen: false }
    })).body.tournament.id;
    assert.equal((await addTeam(env, GUILD, tid, "Team One", ["A"])).status, 201);
    assert.equal((await addTeam(env, GUILD, tid, "Team Two", ["B"])).status, 201);
    cap.sent.length = 0;
    const open = await read(await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { registrationOpen: true } }), env, admin, tid));
    assert.equal(open.status, 200);
    assert.equal(cap.sent.length, 1);
    const emb = cap.sent[0].embeds[0];
    const f = fieldsOf(emb);
    assert.equal(f.Type, "Teams", "team tournaments announce as Teams");
    assert.equal(f.Entrants, "2 / 4 teams", "counts are expressed in teams");
    assert.match(emb.title, /Clan Wars/);
    // Bracket generation → bracket-ready announcement with count + URL.
    assert.equal((await generate(env, GUILD, tid)).status, 200);
    const br = cap.sent.find(m => m.embeds[0].title.includes("Bracket ready"));
    assert.ok(br, "generating the bracket must announce bracket-ready");
    assert.match(br.embeds[0].description, /2 teams/);
    assert.ok(br.embeds[0].url.includes("/tournaments/"));
    assert.equal(br.components[0].components[0].label, "View Bracket");
    // Regenerating an identical bracket does not re-announce.
    assert.equal((await generate(env, GUILD, tid)).status, 200);
    assert.equal(cap.sent.filter(m => m.embeds[0].title.includes("Bracket ready")).length, 1);
  } finally { cap.restore(); }
});

test("V1.2 result announcements are concise: round, competitors, score, winner, link", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    const tid = (await createTournament(env, { overrides: { maxParticipants: 4, announceChannelId: CHANNEL, registrationOpen: false } })).body.tournament.id;
    const ids = await fillParticipants(env, GUILD, tid, 4);
    assert.equal((await generate(env, GUILD, tid)).status, 200);
    cap.sent.length = 0;
    const r1 = await play(env, GUILD, tid, 0, 0, ids[0], 2, 1);
    assert.equal(r1.status, 200);
    const result = cap.sent.find(m => m.embeds[0].title === "🏆 Tournament Result");
    assert.ok(result, "an explicit result action must announce");
    const emb = result.embeds[0];
    const [line1, line2] = emb.description.split("\n");
    assert.equal(line1, "Player 1 2 — 1 Player 4", "competitor A, score, competitor B");
    assert.match(line2, /Player 1 advances to the next round/, "winner is stated");
    const f = fieldsOf(emb);
    assert.equal(f.Round, "Semifinals");
    assert.equal(f.Tournament, "BalticM Test Cup");
    assert.equal(emb.footer.text, ANNOUNCEMENT_FOOTER);
    assert.ok(emb.url.includes("/tournaments/"));
    assert.equal(result.components[0].components[0].label, "View Tournament");
    // Second semifinal completes → the final becomes READY → upcoming-match post.
    const r2 = await play(env, GUILD, tid, 0, 1, ids[2], 1, 2);
    assert.equal(r2.status, 200);
    assert.ok(cap.sent.find(m => m.embeds[0].title.includes("Upcoming match")), "a newly ready match announces once");
    // Replaying the identical result is a no-op for announcements.
    const before = cap.sent.length;
    const replay = await play(env, GUILD, tid, 0, 0, ids[0], 2, 1);
    assert.equal(replay.body.unchanged, true);
    assert.equal(cap.sent.length, before, "replaying a result must not announce again");
  } finally { cap.restore(); }
});

test("V1.2 champion announcement is distinct, with final score and gold styling", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    const tid = (await createTournament(env, { overrides: { name: "Crown Cup", game: "CS2", maxParticipants: 4, announceChannelId: CHANNEL, registrationOpen: false } })).body.tournament.id;
    const ids = await fillParticipants(env, GUILD, tid, 4);
    assert.equal((await generate(env, GUILD, tid)).status, 200);
    cap.sent.length = 0;
    assert.equal((await play(env, GUILD, tid, 0, 0, ids[0], 2, 0)).status, 200);
    assert.equal((await play(env, GUILD, tid, 0, 1, ids[2], 1, 2)).status, 200);
    const done = await play(env, GUILD, tid, 1, 0, ids[2], 0, 3);
    assert.equal(done.body.tournament.status, "FINISHED");
    const champ = cap.sent.find(m => m.embeds[0].title === "🏆 TOURNAMENT CHAMPION");
    assert.ok(champ, "finishing the final must announce the champion");
    const emb = champ.embeds[0];
    assert.equal(emb.description, "Player 3 wins Crown Cup!");
    assert.equal(emb.color, 0xfacc15, "gold styling sets it apart from results");
    assert.equal(emb.footer.text, ANNOUNCEMENT_FOOTER);
    const f = fieldsOf(emb);
    assert.equal(f.Game, "CS2");
    assert.equal(f["Final score"], "3 — 0");
    assert.ok(f.Format.includes("Individual players"));
    assert.ok(emb.url.includes("/tournaments/"));
    assert.equal(champ.components[0].components[0].label, "View Tournament");
    // Final result post also exists (3 results total: 2 semis + final),
    // but the champion embed is its own distinct message.
    assert.equal(cap.sent.filter(m => m.embeds[0].title === "🏆 Tournament Result").length, 3);
    const before = cap.sent.length;
    const replay = await play(env, GUILD, tid, 1, 0, ids[2], 0, 3);
    assert.equal(replay.body.unchanged, true);
    assert.equal(cap.sent.length, before);
  } finally { cap.restore(); }
});

test("V1.2 team champion announcement carries team identity, roster and logo", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    const tid = (await createTournament(env, {
      overrides: { name: "Team Crown", participantType: "teams", maxParticipants: 4, announceChannelId: CHANNEL, registrationOpen: false }
    })).body.tournament.id;
    const logo = "https://i.imgur.com/champ.png";
    const t1 = await addTeam(env, GUILD, tid, "Solar Drifters", [{ displayName: "Ace" }, { displayName: "Rush" }], admin, { logoUrl: logo, captainName: "Captain Ace" });
    assert.equal(t1.status, 201);
    assert.equal((await addTeam(env, GUILD, tid, "Night Owls", ["Shadow"])).status, 201);
    assert.equal((await addTeam(env, GUILD, tid, "Frost Giants", ["Ice"])).status, 201);
    const ids = [(await listParticipants(env, tid)).find(p => p.name === "Solar Drifters").id,
      (await listParticipants(env, tid)).find(p => p.name === "Night Owls").id,
      (await listParticipants(env, tid)).find(p => p.name === "Frost Giants").id];
    assert.equal((await generate(env, GUILD, tid)).status, 200);
    cap.sent.length = 0;
    // 3 teams → seed 1 gets a BYE; semifinal is match slot 1 (seed 2 vs seed 3).
    assert.equal((await play(env, GUILD, tid, 0, 1, ids[1], 2, 1)).status, 200);
    const done = await play(env, GUILD, tid, 1, 0, ids[0], 3, 1);
    assert.equal(done.body.tournament.status, "FINISHED");
    const champ = cap.sent.find(m => m.embeds[0].title === "🏆 TOURNAMENT CHAMPION");
    assert.ok(champ);
    const emb = champ.embeds[0];
    assert.equal(emb.description, "Solar Drifters wins Team Crown!");
    const f = fieldsOf(emb);
    assert.equal(f.Format, "Single Elimination • Teams");
    assert.equal(f["Final score"], "3 — 1");
    assert.ok(f.Roster.includes("Captain Ace"), "captain is part of the announced roster");
    assert.ok(f.Roster.includes("Ace") && f.Roster.includes("Rush"));
    assert.equal(emb.thumbnail.url, logo, "team logo shown on the champion embed");
  } finally { cap.restore(); }
});

/* ------------------------------------------- 13–16: idempotency & security */

test("V1.2 announcement idempotency — replayed actions never double-post", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    const tid = (await createTournament(env, { overrides: { name: "Idem Cup", announceChannelId: CHANNEL, registrationOpen: false } })).body.tournament.id;
    assert.equal(cap.sent.length, 1);
    const tournament = await getTournament(env, tid);
    const first = await announceTournamentEvent(env, tournament, "created", { key: "created" });
    assert.equal(first.duplicate, true, "the same event key can never post twice");
    assert.equal(cap.sent.length, 1);
    const noChannel = await announceTournamentEvent(env, { ...tournament, announceChannelId: "" }, "created", { key: "created2" });
    assert.equal(noChannel.skipped, true, "no channel → nothing is sent");
    assert.equal(cap.sent.length, 1);
    const open = await read(await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { registrationOpen: true } }), env, admin, tid));
    assert.equal(open.status, 200);
    assert.equal(cap.sent.length, 2);
    // Same-state PATCH is not a transition → silent.
    const dup = await read(await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { registrationOpen: true } }), env, admin, tid));
    assert.equal(dup.status, 200);
    assert.equal(cap.sent.length, 2, "re-sending the same registration state must not announce");
    // Close → re-open is a GENUINE new event → one more post, then stable again.
    // (Brief pause so the re-open transition lands on a later updatedAt.)
    await new Promise(r => setTimeout(r, 5));
    await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { registrationOpen: false } }), env, admin, tid);
    await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { registrationOpen: true } }), env, admin, tid);
    assert.equal(cap.sent.length, 3, "a genuine re-open announces exactly once more");
    await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { registrationOpen: true } }), env, admin, tid);
    assert.equal(cap.sent.length, 3);
  } finally { cap.restore(); }
});

test("V1.2 refresh, GET and public page loads never send announcements", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    const tid = (await createTournament(env, { overrides: { name: "Quiet Cup", announceChannelId: CHANNEL, publicRegistration: true, registrationOpen: true } })).body.tournament.id;
    await fillParticipants(env, GUILD, tid, 4);
    const slug = (await getTournament(env, tid)).publicSlug;
    const baseline = cap.sent.length;
    for (let i = 0; i < 3; i++) {
      await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid);
      await tournamentsList(req("/api/tournaments", { guildId: GUILD }), env, admin);
      await tournamentBrandingState(brandingReq("GET", undefined, GUILD), env, admin);
    }
    for (let i = 0; i < 3; i++) {
      await tournamentPublic(req("/api/tournament-public/" + slug), env, slug, admin);
      await tournamentPublic(req("/api/tournament-public/" + slug), env, slug, null);
    }
    assert.equal(cap.sent.length, baseline, "read paths must never announce");
  } finally { cap.restore(); }
});

test("V1.2 unauthorized and cross-guild announcement attempts are rejected", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    const tid = (await createTournament(env, { overrides: { name: "Guarded Cup", announceChannelId: CHANNEL, registrationOpen: false } })).body.tournament.id;
    await generate(env, GUILD, tid);
    const before = cap.sent.length;
    // Outsider acting on another guild's tournament id → 404, no announce.
    const forgedResult = await read(await resultRecord(
      req(`/api/tournaments/${tid}/matches/0-0`, { method: "POST", guildId: OTHER_GUILD, body: { winnerId: "x", scoreA: 2, scoreB: 0 } }),
      env, outsider, OTHER_GUILD, tid, "0-0"
    ));
    assert.equal(forgedResult.status, 404);
    const forgedStatus = await read(await tournamentStatusChange(
      req(`/api/tournaments/${tid}/status`, { method: "POST", guildId: OTHER_GUILD, body: { status: "LIVE" } }),
      env, outsider, OTHER_GUILD, tid
    ));
    assert.equal(forgedStatus.status, 404);
    // Admin forging a guild id they are not a member of → 403.
    const forgedGuild = await read(await tournamentStatusChange(
      req(`/api/tournaments/${tid}/status`, { method: "POST", guildId: OTHER_GUILD, body: { status: "LIVE" } }),
      env, admin, OTHER_GUILD, tid
    ));
    assert.equal(forgedGuild.status, 403);
    assert.equal(cap.sent.length, before, "rejected requests must not announce");
    // A channel that belongs to another server is refused before any POST.
    let foreignPosts = 0;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/messages") && init?.method === "POST") { foreignPosts++; return { ok: true, json: async () => ({ id: "mX" }) }; }
      return { ok: true, json: async () => ({ id: "999999999999999999", guild_id: OTHER_GUILD }) };
    };
    const foreign = await announceTournamentEvent(env, await getTournament(env, tid), "registration_opened", { key: "registration_opened:guard" });
    assert.equal(foreign.ok, false);
    assert.equal(foreignPosts, 0, "a channel in another guild must never be posted to");
  } finally { cap.restore(); }
});

test("V1.2 corrected champion rollback leaves valid announcement state and re-announces the new champion", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    const tid = (await createTournament(env, { overrides: { name: "Rollback Cup", maxParticipants: 4, announceChannelId: CHANNEL, registrationOpen: false } })).body.tournament.id;
    const ids = await fillParticipants(env, GUILD, tid, 4);
    assert.equal((await generate(env, GUILD, tid)).status, 200);
    cap.sent.length = 0;
    // Finish with champion = Player 1.
    assert.equal((await play(env, GUILD, tid, 0, 0, ids[0], 2, 0)).status, 200);
    assert.equal((await play(env, GUILD, tid, 0, 1, ids[2], 1, 2)).status, 200);
    const done = await play(env, GUILD, tid, 1, 0, ids[0], 3, 0);
    assert.equal(done.body.tournament.status, "FINISHED");
    assert.equal(champPosts(cap.sent).length, 1);
    assert.match(champPosts(cap.sent)[0].embeds[0].description, /Player 1 wins/);
    // Correct a semifinal → the completed final becomes impossible → rollback.
    const corrected = await play(env, GUILD, tid, 0, 1, ids[1], 2, 1);
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    assert.equal(corrected.body.champion, "");
    assert.equal(champPosts(cap.sent).length, 1, "rollback must not announce a champion");
    const rolled = await getTournament(env, tid);
    assert.equal(rolled.championId, "");
    assert.notEqual(rolled.status, "FINISHED");
    // Re-finish with a DIFFERENT champion → exactly one new champion post.
    const refinal = await play(env, GUILD, tid, 1, 0, ids[1], 0, 2);
    assert.equal(refinal.body.tournament.status, "FINISHED");
    assert.equal(champPosts(cap.sent).length, 2, "the corrected tournament's new champion must be announced");
    assert.match(champPosts(cap.sent)[1].embeds[0].description, /Player 2 wins/);
    // Replaying the identical final is silent.
    const before = cap.sent.length;
    const replay = await play(env, GUILD, tid, 1, 0, ids[1], 0, 2);
    assert.equal(replay.body.unchanged, true);
    assert.equal(cap.sent.length, before);
    // Same champion re-announced via the API → duplicate key, still silent.
    const again = await announceTournamentEvent(env, await getTournament(env, tid), "winner", { key: `winner:${ids[1]}`, winnerId: ids[1], names: {} });
    assert.equal(again.duplicate, true);
    assert.equal(champPosts(cap.sent).length, 2);
  } finally { cap.restore(); }
});

/* --------------------------------------------------- 17–18: regressions */

test("V1.2 individual tournament regression: register, bracket, play, finish, public privacy", async () => {
  const env = await setup(); // no announcement channel → full flow without Discord
  const tid = (await createTournament(env, {
    overrides: { name: "Solo Flow", maxParticipants: 4, publicRegistration: true, registrationOpen: true }
  })).body.tournament.id;
  const slug = (await getTournament(env, tid)).publicSlug;
  const reg = await read(await tournamentPublicRegister(req(`/api/tournament-public/${slug}/register`, { method: "POST", body: {} }), env, admin, slug));
  assert.equal(reg.status, 201);
  assert.equal(reg.body.participant.kind, "player");
  const pub1 = await read(await tournamentPublic(req(`/api/tournament-public/${slug}`), env, slug, admin));
  assert.deepEqual(pub1.body.registration.you, { registered: true, name: "MiersBerzins ツ♡" });
  assert.equal(pub1.body.branding.name, "BALTICM", "free guild shows standard branding");
  assert.equal(pub1.body.branding.custom, false);
  await fillParticipants(env, GUILD, tid, 3);
  assert.equal((await generate(env, GUILD, tid)).status, 200);
  let champion = "";
  let guard = 0;
  while (!champion && guard++ < 10) {
    const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
    const ready = detail.body.matches.find(m => m.status === "READY");
    if (!ready) break;
    const r = await play(env, GUILD, tid, ready.roundIndex, ready.slotIndex, ready.participantA, 2, 0);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    champion = r.body.champion;
  }
  assert.ok(champion, "individual flow must produce a champion");
  assert.equal((await getTournament(env, tid)).status, "FINISHED");
  const pub = await read(await tournamentPublic(req("/api/tournament-public/" + slug), env, slug, null));
  assert.equal(pub.body.tournament.status, "FINISHED");
  assert.ok(pub.body.tournament.championId);
  const text = JSON.stringify(pub.body);
  assert.ok(!text.includes(GUILD) && !text.includes(admin.id) && !text.includes(tid), "public payload stays private");
});

test("V1.2 team tournament regression: registration, BYEs, cascade, re-complete, public roster", async () => {
  const env = await setup();
  const tid = (await createTournament(env, {
    overrides: { name: "Team Flow", participantType: "teams", maxParticipants: 8, publicRegistration: true, registrationOpen: true }
  })).body.tournament.id;
  const slug = (await getTournament(env, tid)).publicSlug;
  const reg = await registerTeam(env, slug, admin, { teamName: "Registered FC", logoUrl: "https://i.imgur.com/reg.png", members: [{ displayName: "Striker" }] });
  assert.equal(reg.status, 201);
  for (const name of ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]) {
    assert.equal((await addTeam(env, GUILD, tid, name)).status, 201);
  }
  const gen = await generate(env, GUILD, tid);
  assert.equal(gen.status, 200);
  assert.ok(gen.body.matches.some(m => m.status === "BYE"), "6 teams in an 8-slot bracket produce BYEs");
  const pub1 = await read(await tournamentPublic(req("/api/tournament-public/" + slug), env, slug, null));
  const regTeam = pub1.body.participants.find(p => p.name === "Registered FC");
  assert.equal(regTeam.logoUrl, "https://i.imgur.com/reg.png");
  assert.deepEqual(regTeam.members, ["Striker"]);
  assert.equal(pub1.body.tournament.participantType, "teams");
  const playToChampion = async () => {
    let champion = "";
    let guard = 0;
    while (!champion && guard++ < 20) {
      const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
      const ready = detail.body.matches.find(m => m.status === "READY");
      if (!ready) break;
      const r = await play(env, GUILD, tid, ready.roundIndex, ready.slotIndex, ready.participantA, 2, 0);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      champion = r.body.champion;
    }
    return champion;
  };
  assert.ok(await playToChampion(), "team flow must produce a champion");
  assert.equal((await getTournament(env, tid)).status, "FINISHED");
  // Correction cascade: flip a semifinal → champion and final must roll back.
  const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
  const semi = detail.body.matches.find(m => m.roundIndex === 1 && m.status === "COMPLETED");
  assert.ok(semi, "a completed semifinal is required");
  const other = semi.participantA !== semi.winnerId ? semi.participantA : semi.participantB;
  const otherIsA = semi.participantA === other;
  const corrected = await play(env, GUILD, tid, 1, 0, other, otherIsA ? 2 : 0, otherIsA ? 0 : 2);
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  assert.equal(corrected.body.champion, "");
  const rolled = await getTournament(env, tid);
  assert.equal(rolled.championId, "");
  assert.notEqual(rolled.status, "FINISHED");
  assert.ok(await playToChampion(), "team tournament must be re-completable after correction");
  assert.equal((await getTournament(env, tid)).status, "FINISHED");
});

/* ================================================== V1.2.1 — UI/UX polish:
   announcement channel selector, guild logo fallback, roster verification,
   dark form controls and modal backdrop ================================ */

const guildIconCdn = (gid, hash) => `https://cdn.discordapp.com/icons/${gid}/${hash}.png?size=64`;

/** Seed the cached guild-icon row exactly the way production caches it. */
async function setGuildIcon(env, guildId, hash) {
  await env.BALTICM_DB.prepare(
    "INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at"
  ).bind(`guild-icon:${guildId}`, JSON.stringify({ icon: hash }), new Date().toISOString()).run();
}

test("V1.2.1 channel selector options: text/announcement channels only, none-option, unavailable placeholder", () => {
  const channels = [
    { id: "1550164668528468131", name: "💬・general", type: 0 },
    { id: "1551984191103832205", name: "📢・announcements", type: 5 },
    { id: "1550162399536091216", name: "🔊・Bazars", type: 2 },
    { id: "1552336823811051643", name: "forum-channel", type: 15 },
    { id: "1553134553206624369", name: "no-send", type: 0, permissions: "0" },
    { id: "1553134553206624370", name: "admin-chan", type: 0, permissions: "8" },
    { id: "1553134553206624371", name: "send-only", type: 0, permissions: "2048" },
    { id: "not-a-snowflake", name: "bad", type: 0 }
  ];
  const opts = announceChannelOptions(channels, "");
  assert.deepEqual(opts[0], { value: "", label: "No announcement channel" }, "clearing the channel is a valid choice");
  const values = opts.map(o => o.value);
  assert.ok(values.includes("1550164668528468131"), "text channels are offered");
  assert.ok(values.includes("1551984191103832205"), "announcement channels are offered");
  assert.ok(!values.includes("1550162399536091216"), "voice channels are excluded");
  assert.ok(!values.includes("1552336823811051643"), "forum channels are excluded");
  assert.ok(!values.includes("1553134553206624369"), "channels the bot cannot post in are excluded when permissions are known");
  assert.ok(values.includes("1553134553206624370"), "ADMINISTRATOR keeps a channel sendable");
  assert.ok(values.includes("1553134553206624371"), "SEND_MESSAGES keeps a channel sendable");
  assert.ok(!values.includes("not-a-snowflake"), "non-snowflake ids are never offered");
  assert.equal(opts.find(o => o.value === "1551984191103832205").label, "# 📢・announcements", "human-readable channel names");

  const missing = announceChannelOptions(channels.slice(0, 2), "999999999999999999");
  const placeholder = missing.find(o => o.value === "999999999999999999");
  assert.ok(placeholder && placeholder.label.includes("Unavailable"), "a deleted channel shows a clear unavailable state");

  const withSaved = announceChannelOptions(channels, "1551984191103832205");
  assert.equal(withSaved.filter(o => o.value === "1551984191103832205").length, 1, "an available saved channel is not duplicated");

  assert.deepEqual(announceChannelOptions([], "123456789012345678").map(o => o.value), ["", "123456789012345678"], "a failed channel list degrades to none + the saved id");
  assert.deepEqual(announceChannelOptions(null, "").map(o => o.value), [""], "missing channel data never crashes");
});

function captureGuildFetch() {
  const real = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, init) => {
    const u = String((url && url.url) || url);
    urls.push(u);
    if (u.includes(`/guilds/${GUILD}/channels`)) return { ok: true, status: 200, json: async () => ([{ id: "1550164668528468131", name: "💬・general", type: 0 }, { id: "1551984191103832205", name: "📢・announcements", type: 5 }]) };
    if (u.includes(`/guilds/${OTHER_GUILD}/channels`)) return { ok: true, status: 200, json: async () => ([{ id: "414587429199282190", name: "other-guild-ch", type: 0 }]) };
    if (u.includes("/roles")) return { ok: true, status: 200, json: async () => ([]) };
    if (u.includes("discord.com/api/v10/guilds/")) return { ok: true, status: 200, json: async () => ({ id: "0", name: "Guild", icon: null }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { urls, restore: () => { globalThis.fetch = real; } };
}

test("V1.2.1 /api/discord/guild returns only the active guild's channels and rejects cross-guild reads", async () => {
  const worker = (await import("../worker.js")).default;
  const SECRET = "v121-session-secret";
  const cookieFor = async (u, guilds) => `${COOKIE_SESSION}=${await signPayload(await buildAuthSessionPayload(u, guilds), SECRET)}`;
  const mock = captureGuildFetch();
  try {
    const env = { SESSION_SECRET: SECRET, DISCORD_BOT_TOKEN: "test-token" };
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    const adminCookie = await cookieFor({ id: admin.id, username: admin.username, global_name: admin.global_name, avatar: null }, [{ id: GUILD, name: "Baltic | Mayhem", icon: null, owner: true }]);
    const ok = await worker.fetch(new Request(`https://bot.balticm.eu/api/discord/guild?guildId=${GUILD}`, { headers: { cookie: adminCookie } }), env, ctx);
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual(body.channels.map(c => c.id), ["1550164668528468131", "1551984191103832205"], "exactly the active guild's channels come back");
    assert.ok(mock.urls.some(u => u.includes(`/guilds/${GUILD}/channels`)), "channels are read through the guild-scoped Discord endpoint");
    assert.ok(!mock.urls.some(u => u.includes(OTHER_GUILD)), "another guild is never queried");

    mock.urls.length = 0;
    const outsiderCookie = await cookieFor({ id: outsider.id, username: outsider.username, global_name: outsider.global_name, avatar: null }, [{ id: OTHER_GUILD, name: "Other Server", icon: null, owner: false }]);
    const denied = await worker.fetch(new Request(`https://bot.balticm.eu/api/discord/guild?guildId=${GUILD}`, { headers: { cookie: outsiderCookie } }), env, ctx);
    assert.equal(denied.status, 403, "cross-guild channel reads are rejected");
    assert.equal(mock.urls.length, 0, "no Discord call happens for a rejected request");
  } finally { mock.restore(); }
});

test("V1.2.1 announcement channel persists as a raw id, changes and clears; selection never announces", async () => {
  const env = await setup();
  const created = await createTournament(env, { overrides: { announceChannelId: CHANNEL } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.tournament.announceChannelId, CHANNEL, "the raw channel id is stored verbatim (backward compatible)");
  const tid = created.body.tournament.id;

  const detail = await read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, admin, tid));
  assert.equal(detail.status, 200, "settings keep working even when the saved channel is not in the current channel list");
  assert.equal(detail.body.tournament.announceChannelId, CHANNEL);

  const changed = await read(await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { announceChannelId: "1550167581782974646" } }), env, admin, tid));
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.tournament.announceChannelId, "1550167581782974646", "changing the selected channel persists");

  const cleared = await read(await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { announceChannelId: "" } }), env, admin, tid));
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.tournament.announceChannelId, "", "no announcement channel persists as empty");

  const cap = captureDiscord();
  try {
    await read(await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { announceChannelId: CHANNEL } }), env, admin, tid));
    assert.equal(cap.sent.length, 0, "changing the channel selection itself must not send an announcement");
  } finally { cap.restore(); }
});

test("V1.2.1 guild icon is the branding logo fallback for preview, public page and announcements", async () => {
  const env = await setup({ premium: false });
  await setGuildIcon(env, GUILD, "guildhash123");
  const expected = guildIconCdn(GUILD, "guildhash123");

  const state = await read(await tournamentBrandingState(brandingReq("GET", undefined, GUILD), env, admin));
  assert.equal(state.status, 200);
  assert.equal(state.body.branding.logoUrl, "", "no custom config is stored for a free guild");
  assert.equal(state.body.resolved.logoUrl, expected, "the preview resolves the active Discord guild icon");
  assert.equal(state.body.resolved.logoSource, "guild");

  const created = await createTournament(env, { overrides: { announceChannelId: CHANNEL, maxParticipants: 4 } });
  const slug = created.body.tournament.publicSlug;
  const pub = await read(await tournamentPublic(req("/api/tournament-public/" + slug), env, slug));
  assert.equal(pub.body.branding.custom, false, "the guild icon is NOT premium custom branding");
  assert.equal(pub.body.branding.name, "BALTICM", "name rules are unchanged for free guilds");
  assert.equal(pub.body.branding.logoUrl, expected, "the public header uses the same resolved logo");
  assert.equal(pub.body.branding.logoSource, "guild");

  const cap = captureDiscord();
  try {
    await announceTournamentEvent(env, await getTournament(env, created.body.tournament.id), "registration_opened", { key: "registration_opened:icon-fallback" });
    const post = cap.sent.find(m => m.embeds[0].title.includes("Registration open"));
    assert.ok(post, "the announcement must send");
    assert.equal(post.embeds[0].author.icon_url, expected, "the Discord embed uses the same resolved logo");
    assert.equal(post.embeds[0].author.name, "BALTICM TOURNAMENTS");
    assert.equal(post.embeds[0].footer.text, ANNOUNCEMENT_FOOTER, "BalticM attribution is always kept");
  } finally { cap.restore(); }
});

test("V1.2.1 premium custom logo overrides the guild icon and reset falls back to it", async () => {
  const env = await setup();
  await setGuildIcon(env, GUILD, "guildhash123");
  await setPremium(env, GUILD);
  const save = await read(await tournamentBrandingSave(brandingReq("POST", { name: "My Community", logoUrl: "https://img.example/custom.png" }, GUILD), env, admin));
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.equal(save.body.resolved.logoUrl, "https://img.example/custom.png");
  assert.equal(save.body.resolved.logoSource, "custom");

  const created = await createTournament(env, {});
  const pub = await read(await tournamentPublic(req("/api/tournament-public/" + created.body.tournament.publicSlug), env, created.body.tournament.publicSlug));
  assert.equal(pub.body.branding.custom, true);
  assert.equal(pub.body.branding.name, "My Community");
  assert.equal(pub.body.branding.logoUrl, "https://img.example/custom.png");
  assert.equal(pub.body.branding.logoSource, "custom");

  const reset = await read(await tournamentBrandingSave(brandingReq("POST", { name: "", logoUrl: "" }, GUILD), env, admin));
  assert.equal(reset.status, 200);
  assert.equal(reset.body.resolved.logoSource, "guild", "resetting custom branding returns to the guild icon");
});

test("V1.2.1 BalticM default fallback applies when neither custom logo nor guild icon exists", async () => {
  const env = await setup();
  const state = await read(await tournamentBrandingState(brandingReq("GET", undefined, GUILD), env, admin));
  assert.equal(state.body.resolved.logoUrl, "");
  assert.equal(state.body.resolved.logoSource, "");
  const created = await createTournament(env, {});
  const pub = await read(await tournamentPublic(req("/api/tournament-public/" + created.body.tournament.publicSlug), env, created.body.tournament.publicSlug));
  assert.equal(pub.body.branding.logoUrl, "", "the public header falls back to the BalticM gradient");
  assert.equal(pub.body.branding.logoSource, "");
  assert.equal(pub.body.branding.name, "BALTICM");
});

test("V1.2.1 free guild still cannot save custom branding while its guild icon is shown", async () => {
  const env = await setup({ premium: false });
  await setGuildIcon(env, GUILD, "guildhash123");
  const save = await read(await tournamentBrandingSave(brandingReq("POST", { name: "Hijack", logoUrl: "https://evil.example/x.png" }, GUILD), env, admin));
  assert.equal(save.status, 403);
  assert.equal(save.body.code, "premium_required");
  const state = await read(await tournamentBrandingState(brandingReq("GET", undefined, GUILD), env, admin));
  assert.equal(state.body.branding.name, "", "nothing custom persists for a free guild");
  assert.equal(state.body.branding.logoUrl, "");
  assert.equal(state.body.resolved.logoSource, "guild", "the free visual fallback stays the guild icon");
});

test("V1.2.1 team champion announcement shows the full roster exactly once; individual champion shows none", async () => {
  const env = await setup();
  const cap = captureDiscord();
  try {
    // --- Team champion: captain + five members.
    const tid = (await createTournament(env, { overrides: { name: "Roster Cup", game: "CS2", participantType: "teams", maxParticipants: 4, announceChannelId: CHANNEL, registrationOpen: false } })).body.tournament.id;
    const members = ["PlayerOne", "PlayerTwo", "PlayerThree", "PlayerFour", "PlayerFive"].map(displayName => ({ displayName, discordId: "" }));
    const a = await addTeam(env, GUILD, tid, "Full Squad", members, admin, { captainName: "PlayerOne" });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const b = await addTeam(env, GUILD, tid, "Rivals", [{ displayName: "Other", discordId: "" }]);
    assert.equal(b.status, 201, JSON.stringify(b.body));
    assert.equal((await generate(env, GUILD, tid)).status, 200);
    cap.sent.length = 0;
    const done = await play(env, GUILD, tid, 0, 0, a.body.participant.id, 2, 0);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.tournament.status, "FINISHED");
    const champs = champPosts(cap.sent);
    assert.equal(champs.length, 1);
    const roster = fieldsOf(champs[0].embeds[0]).Roster;
    assert.ok(roster, "a team champion must announce its roster");
    assert.deepEqual(roster.split(" • "), ["PlayerOne", "PlayerTwo", "PlayerThree", "PlayerFour", "PlayerFive"], "the FULL roster appears exactly once each");

    // --- Individual champion: no team roster field at all.
    const iid = (await createTournament(env, { overrides: { name: "Solo Cup", maxParticipants: 4, announceChannelId: CHANNEL, registrationOpen: false } })).body.tournament.id;
    const [p1] = await fillParticipants(env, GUILD, iid, 2);
    assert.equal((await generate(env, GUILD, iid)).status, 200);
    cap.sent.length = 0;
    // Two participants bracket to size 2: the only match IS the final.
    const solo = await play(env, GUILD, iid, 0, 0, p1, 2, 0);
    assert.equal(solo.status, 200, JSON.stringify(solo.body));
    const soloChamps = champPosts(cap.sent);
    assert.equal(soloChamps.length, 1);
    assert.equal(fieldsOf(soloChamps[0].embeds[0]).Roster, undefined, "individual champions never show a team roster");
  } finally { cap.restore(); }
});

test("V1.2.1 modal backdrop is dark and viewport-covering; native controls are dark-themed", () => {
  const css = readFileSync(new URL("../src/tournaments.css", import.meta.url), "utf8");
  const m = css.match(/\.tModalBackdrop\{([^}]*)\}/);
  assert.ok(m, "the modal backdrop rule exists");
  assert.match(m[1], /position:fixed/, "the backdrop stays fixed to the viewport");
  assert.match(m[1], /inset:0/, "the backdrop covers the entire viewport");
  assert.match(m[1], /rgba\(5,5,11,\.84\)/, "background content is only faintly visible");
  assert.match(m[1], /backdrop-filter:blur\(12px\)/, "a subtle backdrop blur is applied");
  assert.match(m[1], /z-index:90/, "the backdrop stacks above page content");
  assert.ok(!/100vw/.test(m[1]), "no viewport-width sizing that could introduce horizontal overflow");
  assert.match(css, /\.tFilter select[^{]*\{[^}]*color-scheme:dark/, "native selects render dark via color-scheme");
  // The channel dropdown must BE the Tickets dropdown (style.css
  // `.ticketsPage .modAction*`): same declarations re-scoped, not a lookalike.
  assert.match(css, /\.tModal \.modActionTrigger[^{]*\{[^}]*min-height:40px/, "trigger matches the Tickets trigger sizing");
  assert.match(css, /\.tModal \.modActionTrigger[^{]*\{[^}]*border-radius:10px/, "trigger matches the Tickets border radius");
  assert.match(css, /\.tModal \.modActionTrigger[^{]*\{[^}]*background:var\(--bg\)/, "trigger uses the shared theme background like Tickets");
  // Tickets wraps the widget in the global `label` rule (12px·type-scale,
  // 650, .04em) — the wrapper must contribute the same typography.
  assert.match(css, /\.tModal \.modActionSelect[^{]*\{[^}]*font-weight:650/, "select wrapper carries the Tickets label typography");
  assert.match(css, /\.tModal \.modActionMenu[^{]*\{[^}]*background:#0e0c0a/, "menu uses the Tickets menu background");
  assert.match(css, /\.tModal \.modActionMenu[^{]*\{[^}]*border:1px solid rgba\(232,176,120,\.35\)/, "menu uses the Tickets amber border");
  assert.match(css, /\.tModal \.modActionMenu li\.selected[^{]*\{[^}]*rgba\(232,137,44,\.18\)/, "the selected state matches Tickets");
  assert.match(css, /\.tModal \.modActionMenu li\.active[^{]*\{[^}]*rgba\(232,137,44,\.1\)/, "the hover/active state matches Tickets");
  // Tickets bumps the trigger to a 44px touch target on phones — keep it.
  assert.match(css, /@media\(max-width:767px\)\{[\s\S]{0,400}?\.tModal \.modActionTrigger[^{]*\{min-height:44px/, "mobile keeps the 44px trigger exactly like Tickets");
  // The blanket 44px guarantee block must not clobber the shared dropdown's
  // Tickets sizing (it ships later in the file and would win the cascade).
  assert.match(css, /\.tSettings\.tSettings button:not\(\.modActionTrigger\)/, "the 44px guarantee never overrides the Tickets dropdown trigger");
  // style.css's generic `.contentWell button{min-height:40px}` ships later at
  // equal specificity; doubled-class selectors must win so controls stay 44px.
  assert.match(css, /\.tToolbar\.tToolbar button[^{]*\{[^}]*min-height:44px/, "tournament buttons keep 44px targets despite the shared .contentWell rule");
  assert.match(css, /\.tBrandActions\.tBrandActions button[^{]*\{[^}]*min-height:44px/, "the branding buttons stay 44px");
  assert.match(css, /\.tBack\.tBack[^{]*\{[^}]*min-height:44px/, "detail-view back button stays 44px outside .tournamentsPage");
});

test("V1.2.1 theme parity: no violet leftovers anywhere inside the amber Control Center shell", () => {
  const css = readFileSync(new URL("../src/tournaments.css", import.meta.url), "utf8");
  // The public esports page (.tPub*) intentionally keeps the root violet brand;
  // everything rendered inside .shell must use only amber theme tokens.
  const adminCss = css.split("Public tournament page")[0];
  assert.ok(!/118,87,255/.test(adminCss), "no violet rgb() tints in the Control Center section");
  assert.ok(!/#5b3ee0|#8d89a3|#12101c|#a78bfa/.test(adminCss), "no violet hexes in the Control Center section");
  // Native select chrome follows the Tickets tokens (arrow = text-secondary,
  // option popup = the dropdown menu background).
  assert.match(css, /\.tFilter select[^{]*\{[^}]*#b7ab9e/, "the select arrow uses the theme text-secondary, not violet-grey");
  assert.match(css, /select option\{background:#0e0c0a/, "select option popups use the Tickets menu background");
  // Primary actions match the reference .contentWell button.primary
  // (solid accent + accent-hover), never the old violet gradient — and the
  // rule is scoped to tournament containers so no other feature inherits it.
  assert.match(css, /\.tModal footer button\[type=submit\],\.tPartFormActions button\[type=submit\]\{background:var\(--accent\)/, "modal/form submit buttons use the reference solid accent");
  assert.match(css, /button\[type=submit\]:hover\{background:var\(--accent-hover\)/, "submit buttons hover to the reference accent-hover");
  assert.ok(!/(^|[^.\w])button\.primary\{/.test(css), "the primary-button rule is scoped to tournament containers, never global");
  // Accent-tinted surfaces use the shared --accent-soft token.
  assert.match(css, /\.tModalIcon\{[^}]*background:var\(--accent-soft\)/, "the modal icon chip uses --accent-soft");
  assert.match(css, /\.tDetailIcon\{[^}]*background:var\(--accent-soft\)/, "the detail icon chip uses --accent-soft");
  assert.match(css, /\.tSeed\{[^}]*background:var\(--accent-soft\)/, "participant seed badges use --accent-soft");
  assert.match(css, /\.tMatchConfirm\{[^}]*background:var\(--accent-soft\)/, "the match confirm button uses --accent-soft");
  assert.match(css, /\.tBracketChips button\.on\{background:var\(--accent-soft\);border-color:rgba\(232,137,44,\.55\)/, "the active bracket chip is amber, not violet");
  assert.match(css, /\.tCard\{[^}]*rgba\(232,137,44,\.06\)/, "the card glow is amber");
  assert.match(css, /\.tBrandMark\{[^}]*linear-gradient\(135deg,var\(--accent-hover\),var\(--accent\)\)/, "the brand mark gradient is pure amber");
});

test("V1.2.2 every tournament dropdown reuses the shared TicketOptionSelect widget", () => {
  const jsx = readFileSync(new URL("../src/Tournaments.jsx", import.meta.url), "utf8");
  // Exactly ONE native <select> may remain: ChanSelectFallback itself (the
  // emergency path when the shared widget is not provided).
  const native = jsx.match(/<select/g) || [];
  assert.equal(native.length, 1, "only ChanSelectFallback still renders a native select");
  const i = jsx.indexOf("<select");
  assert.match(jsx.slice(Math.max(0, i - 400), i + 200), /ChanSelectFallback/, "the only native select lives inside ChanSelectFallback");
  for (const file of ["TournamentBracket.jsx", "TournamentPublic.jsx"]) {
    const src = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.ok(!/<select/.test(src), `${file} has no native select`);
  }
  // Create modal: participant type + maximum participants use the widget.
  assert.match(jsx, /label="Participant type"[\s\S]{0,200}?options=\{\[\{value:"individuals",label:"Individual players"\},\{value:"teams",label:"Teams"\}\]\}/, "participant type offers Individuals/Teams through the shared widget");
  assert.match(jsx, /id="t-create-max-participants"[\s\S]{0,300}?options=\{MAX_OPTIONS\.map\(n=>\(\{value:String\(n\),label:String\(n\)\}\)\)\}/, "maximum participants lists its options through the shared widget");
  assert.match(jsx, /const MAX_OPTIONS=\[4,8,16,32\]/, "the maximum-participant options stay exactly 4, 8, 16, 32");
  // The toolbar status filter is converted too (it was a native select).
  assert.match(jsx, /className="tFilter"[\s\S]{0,300}?<Select id="t-status-filter"/, "the status filter uses the shared widget");
  // Selected values and API payload must be byte-identical to before.
  assert.match(jsx, /const emptyForm=\{[^}]*participantType:"individuals",maxParticipants:"8"/, "default form values are unchanged");
  assert.match(jsx, /participantType:form\.participantType,maxParticipants:Number\(form\.maxParticipants\)/, "the create payload shape and coercion are unchanged");
});

test("V1.2.2 the shared widget keeps full Tickets parity in every tournament container", () => {
  const css = readFileSync(new URL("../src/tournaments.css", import.meta.url), "utf8");
  // The copied Tickets rules now also cover the toolbar (.tFilter) scope.
  assert.match(css, /\.tFilter \.modActionTrigger[^{]*\{[^}]*min-height:40px/, "toolbar trigger matches the Tickets 40px sizing");
  assert.match(css, /\.tFilter \.modActionTrigger[^{]*\{[^}]*border-radius:10px/, "toolbar trigger matches the Tickets radius");
  assert.match(css, /\.tFilter \.modActionMenu\{[^}]*background:#0e0c0a/, "toolbar menu uses the Tickets panel background");
  assert.match(css, /\.tFilter \.modActionMenu\{[^}]*border:1px solid rgba\(232,176,120,\.35\)/, "toolbar menu uses the Tickets amber border");
  assert.match(css, /\.tFilter \.modActionMenu li\.selected[^{]*\{[^}]*rgba\(232,137,44,\.18\)/, "toolbar selected state matches Tickets");
  assert.match(css, /\.tFilter \.modActionMenu li\.active[^{]*\{[^}]*rgba\(232,137,44,\.1\)/, "toolbar hover state matches Tickets");
  // The wrapper anchors the absolute menu inside the container — the panel
  // can never escape the modal or widen the page.
  assert.match(css, /\.tFilter \.modActionSelect[^{]*\{[^}]*position:relative/, "the toolbar wrapper anchors the menu");
  assert.match(css, /\.modActionMenu\{[^}]*width:100%/, "the menu is exactly as wide as its trigger");
  // Mobile touch targets: the 767px bump must include the toolbar filter.
  assert.match(css, /\.tFilter \.modActionTrigger[^{]*\{min-height:44px/, "the status filter reaches 44px on mobile");
  // …but the desktop toolbar guarantee must not force the trigger to 44px.
  assert.match(css, /\.tToolbar\.tToolbar button:not\(\.modActionTrigger\)[^{]*\{[^}]*min-height:44px/, "the 44px guarantee exempts the Tickets trigger");
});

test("V1.2.1 create with an empty registration deadline (exact UI payload) succeeds instead of a 500", async () => {
  const env = await setup();
  // The Create modal ALWAYS sends the key — "" when the optional field is
  // untouched. That must mean "no deadline", never Invalid time value.
  const res = await read(await tournamentCreate(
    req("/api/tournaments", { method: "POST", guildId: GUILD, body: {
      name: "UI Shape Cup", game: "Valorant",
      description: "", bannerUrl: "", format: "single_elimination",
      participantType: "teams", maxParticipants: 4,
      startAt: "2026-11-20T18:00:00.000Z",
      registrationOpen: true, registrationDeadline: "",
      publicRegistration: false, announceChannelId: ""
    } }),
    env, admin
  ));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(!res.body.tournament.registrationDeadline, "an empty deadline stays empty instead of crashing");
});

test("V1.2.1 settings PATCH clears the registration deadline with an empty string", async () => {
  const env = await setup();
  const created = await createTournament(env, { overrides: { registrationDeadline: "2026-11-21T10:00:00.000Z" } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(created.body.tournament.registrationDeadline, "the deadline persists when provided");
  const tid = created.body.tournament.id;
  const cleared = await read(await tournamentUpdate(
    req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body: { registrationDeadline: "" } }),
    env, admin, tid
  ));
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.ok(!cleared.body.tournament.registrationDeadline, "clearing the deadline persists as empty");
});

/* ------------------------------------- V1.2.3: free vs premium plan limits */

const planBody = (over = {}) => ({
  name: "Plan Cup", game: "Counter-Strike 2",
  description: "", bannerUrl: "", format: "single_elimination",
  startAt: "2026-12-01T18:00:00.000Z",
  registrationOpen: false, registrationDeadline: "", publicRegistration: false,
  announceChannelId: "", ...over
});
const createAs = async (env, user, body) =>
  read(await tournamentCreate(req("/api/tournaments", { method: "POST", guildId: GUILD, body }), env, user));
const patchAs = async (env, user, tid, body) =>
  read(await tournamentUpdate(req(`/api/tournaments/${tid}`, { method: "PATCH", guildId: GUILD, body }), env, user, tid));
const detailAs = async (env, user, tid) =>
  read(await tournamentDetail(req(`/api/tournaments/${tid}`, { guildId: GUILD }), env, user, tid));

test("V1.2.3 FREE guild plan limits: Individual+4 allowed; Individual 8/16/32 and Teams rejected", async () => {
  const env = await setup({ premium: false });
  // Free + Individual + 4 → allowed
  const ok = await createAs(env, admin, planBody({ name: "Free Ind 4", participantType: "individuals", maxParticipants: 4 }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  // Free + Individual + 8/16/32 → rejected with the Premium-required 403
  for (const maxParticipants of [8, 16, 32]) {
    const res = await createAs(env, admin, planBody({ name: `Free Ind ${maxParticipants}`, participantType: "individuals", maxParticipants }));
    assert.equal(res.status, 403, `Individual + ${maxParticipants} must be rejected on a free guild`);
    assert.equal(res.body.code, "premium_required");
    assert.match(res.body.error, /premium/i);
  }
  // Free + Teams + 4 → rejected
  const teams = await createAs(env, admin, planBody({ name: "Free Teams 4", participantType: "teams", maxParticipants: 4 }));
  assert.equal(teams.status, 403, JSON.stringify(teams.body));
  assert.equal(teams.body.code, "premium_required");
  // Omitted maxParticipants (effective default 8) → rejected too: the server
  // never trusts what the browser sent.
  const omitted = await createAs(env, admin, planBody({ name: "Free Omitted", participantType: "individuals" }));
  assert.equal(omitted.status, 403, JSON.stringify(omitted.body));
  assert.equal(omitted.body.code, "premium_required");
  // No rejected request created anything.
  const list = await read(await tournamentsList(req(`/api/tournaments?guildId=${GUILD}`), env, admin));
  assert.equal(list.body.total, 1, "only the allowed tournament exists");
});

test("V1.2.3 forged FREE guild API request cannot upgrade participant type or max participants", async () => {
  const env = await setup({ premium: false });
  const created = await createAs(env, admin, planBody({ name: "Patch Guard", participantType: "individuals", maxParticipants: 4 }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tid = created.body.tournament.id;
  // participant_type = teams → 403 Premium-required
  const typeRes = await patchAs(env, admin, tid, { participantType: "teams" });
  assert.equal(typeRes.status, 403, JSON.stringify(typeRes.body));
  assert.equal(typeRes.body.code, "premium_required");
  // max_participants = 8/16/32 → 403 Premium-required
  for (const maxParticipants of [8, 16, 32]) {
    const res = await patchAs(env, admin, tid, { maxParticipants });
    assert.equal(res.status, 403, `PATCH maxParticipants ${maxParticipants} must be rejected`);
    assert.equal(res.body.code, "premium_required");
  }
  // Unrelated settings edits keep working on free servers.
  const renamed = await patchAs(env, admin, tid, { name: "Patch Guard Renamed" });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  // Rejected requests never touched the stored configuration.
  const row = await getTournament(env, tid);
  assert.equal(row.participantType, "individuals");
  assert.equal(Number(row.maxParticipants), 4);
  assert.equal(row.name, "Patch Guard Renamed");
});

test("V1.2.3 PREMIUM guild plan limits: Individual and Teams × 4/8/16/32 all allowed", async () => {
  const env = await setup(); // active Premium entitlement
  let first = null;
  for (const participantType of ["individuals", "teams"]) {
    for (const maxParticipants of [4, 8, 16, 32]) {
      const res = await createAs(env, admin, planBody({ name: `Premium ${participantType} ${maxParticipants}`, participantType, maxParticipants }));
      assert.equal(res.status, 201, `${participantType} + ${maxParticipants}: ${JSON.stringify(res.body)}`);
      if (!first) first = res.body.tournament;
    }
  }
  const list = await read(await tournamentsList(req(`/api/tournaments?guildId=${GUILD}`), env, admin));
  assert.equal(list.body.total, 8, "all eight premium combinations exist");
  // Editing premium settings (participant type + max) stays allowed.
  const up = await patchAs(env, admin, first.id, { participantType: "teams", maxParticipants: 32 });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const row = await getTournament(env, first.id);
  assert.equal(row.participantType, "teams");
  assert.equal(Number(row.maxParticipants), 32);
});

test("V1.2.3 Premium expiry never downgrades or corrupts an existing tournament", async () => {
  const env = await setup(); // active Premium at creation time
  const created = await createAs(env, admin, planBody({ name: "Expiry Cup", participantType: "teams", maxParticipants: 8 }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tid = created.body.tournament.id;
  // Premium expires afterwards.
  await setPremium(env, GUILD, { expiresAt: "2020-01-01T00:00:00.000Z" });
  // Existing data is preserved exactly — nothing is auto-downgraded.
  let row = await getTournament(env, tid);
  assert.equal(row.participantType, "teams");
  assert.equal(Number(row.maxParticipants), 8);
  // Same-value PATCH (not a configuration change) still works without Premium.
  const same = await patchAs(env, admin, tid, { maxParticipants: 8 });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  // Unrelated settings edits still work without Premium.
  const edited = await patchAs(env, admin, tid, { description: "kept after expiry" });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  // Premium-only CHANGES are blocked after expiry.
  const raise = await patchAs(env, admin, tid, { maxParticipants: 16 });
  assert.equal(raise.status, 403, JSON.stringify(raise.body));
  assert.equal(raise.body.code, "premium_required");
  // The detail endpoint still loads the tournament with its config intact.
  const detail = await detailAs(env, admin, tid);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.tournament.participantType, "teams");
  assert.equal(Number(detail.body.tournament.maxParticipants), 8);
  row = await getTournament(env, tid);
  assert.equal(row.description, "kept after expiry");
});

test("V1.2.3 cross-guild permissions remain protected on plan-limited endpoints", async () => {
  const env = await setup(); // premium guild
  const created = await createAs(env, admin, planBody({ name: "Cross Guard", participantType: "individuals", maxParticipants: 4 }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tid = created.body.tournament.id;
  // Outsider (member of another guild only) forging GUILD id → 403, and the
  // membership refusal comes BEFORE any plan-limit logic.
  const forgedCreate = await createAs(env, outsider, planBody({ name: "Hijack", participantType: "teams", maxParticipants: 16 }));
  assert.equal(forgedCreate.status, 403);
  assert.equal(forgedCreate.body.error, "Forbidden");
  assert.notEqual(forgedCreate.body.code, "premium_required");
  const forgedPatch = await patchAs(env, outsider, tid, { participantType: "teams", maxParticipants: 8 });
  assert.equal(forgedPatch.status, 403);
  assert.equal(forgedPatch.body.error, "Forbidden");
  const forgedList = await read(await tournamentsList(req(`/api/tournaments?guildId=${GUILD}`), env, outsider));
  assert.equal(forgedList.status, 403);
  // Nothing was modified.
  const row = await getTournament(env, tid);
  assert.equal(row.participantType, "individuals");
  assert.equal(Number(row.maxParticipants), 4);
});

test("V1.2.3 free guild runs a full Individual-4 bracket through champion unchanged", async () => {
  const env = await setup({ premium: false });
  const created = await createAs(env, admin, planBody({ name: "Free Flow Cup", participantType: "individuals", maxParticipants: 4 }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tid = created.body.tournament.id;
  const ids = await fillParticipants(env, GUILD, tid, 4);
  assert.equal(ids.length, 4);
  const gen = await generate(env, GUILD, tid);
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  let detail = await detailAs(env, admin, tid);
  assert.equal(detail.body.matches.length, 3, "semifinals + final");
  let guard = 0;
  while (detail.body.tournament.status !== "FINISHED" && guard++ < 8) {
    const m = (detail.body.matches || []).find(x => !x.winnerId && x.participantA && x.participantB);
    if (!m) break;
    const res = await play(env, GUILD, tid, m.roundIndex, m.slotIndex, m.participantA, 2, 0);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    detail = await detailAs(env, admin, tid);
  }
  assert.equal(detail.body.tournament.status, "FINISHED");
  assert.ok(detail.body.tournament.championId, "a champion is crowned on a free guild");
});

test("V1.2.3 locked Premium options and the upgrade CTA are wired through the shared dropdown", () => {
  const jsx = readFileSync(new URL("../src/Tournaments.jsx", import.meta.url), "utf8");
  // The page threads the existing entitlement source + the Premium upgrade page.
  assert.match(jsx, /export default function Tournaments\(\{user,selectedGuild,canConfigure,TicketOptionSelect,premium,onUpgrade\}\)/);
  assert.match(jsx, /premium=\{!!premium\} onUpgrade=\{onUpgrade\}/);
  // Free servers: per-field locked values, never silently applied.
  assert.match(jsx, /locked=\{premium\?\[\]:\["teams"\]\} onLocked=\{lockTeam\}/);
  assert.match(jsx, /locked=\{premium\?\[\]:\["8","16","32"\]\} onLocked=\{lockMax\}/);
  assert.match(jsx, /if\(!premium&&v==="teams"\)\{lockTeam\(\);return\}/);
  assert.match(jsx, /if\(!premium&&Number\(v\)>4\)\{lockMax\(\);return\}/);
  // Free default is Individual + 4 (module defaults stay untouched — see V1.2.2).
  assert.match(jsx, /useState\(\(\)=>premium\?emptyForm:\{\.\.\.emptyForm,maxParticipants:"4"\}\)/);
  // Reuses the existing BalticM Premium hint styling + CTA to the Premium page.
  assert.match(jsx, /tBrandLocked tPlanLock/);
  assert.match(jsx, />View Premium plans</);
  // The server's premium_required message surfaces instead of generic 403 text.
  assert.match(jsx, /code==="premium_required"/);
  const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  // Shared widget: locked options stay visible, keyboard-reachable, aria-disabled, labelled 🔒 Premium.
  assert.match(main, /function TicketOptionSelect\(\{id,label,value,onChange,options,flip,search,disabled,locked,onLocked\}\)/);
  assert.match(main, /if\(isLocked\(v\)\)\{if\(onLocked\)onLocked\(v\)/);
  assert.match(main, /aria-disabled=\{isLocked\(o\.value\)\|\|undefined\}/);
  assert.match(main, /isLocked\(o\.value\)\?o\.label\+" 🔒 Premium":o\.label/);
  // Entitlement comes from the existing per-guild premium source in Section.
  assert.match(main, /premium=\{serverPlan\.premium\} onUpgrade=\{\(\)=>openPage\("Premium"\)\}/);
  const css = readFileSync(new URL("../src/tournaments.css", import.meta.url), "utf8");
  assert.match(css, /\.tModal \.modActionMenu li\.locked\{color:#e7c65a\}/);
  assert.match(css, /\.tBrandLocked\.tPlanLock\{/);
  // Backend: both write paths enforce the entitlement with the same code.
  const apiSrc = readFileSync(new URL("../tournaments-api.js", import.meta.url), "utf8");
  assert.match(apiSrc, /effType === "teams" \|\| effMax > 4/);
  assert.match(apiSrc, /changesType && wantType === "teams"/);
  assert.match(apiSrc, /code: "premium_required"/);
});
