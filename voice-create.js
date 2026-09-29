export const VOICE_DISCORD_MAX_RETRIES = 4;
export const VOICE_DISCORD_MAX_WAIT_MS = 20000;
export const VOICE_EMPTY_RECHECK_MS = 1000;

const VIEW_CHANNEL = 1n << 10n;
const MANAGE_CHANNELS = 1n << 4n;
const STREAM = 1n << 9n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;
const MOVE_MEMBERS = 1n << 24n;
const USE_VAD = 1n << 25n;
const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;
export const VOICE_OWNER_ALLOW = String(VIEW_CHANNEL | CONNECT | SPEAK | USE_VAD | STREAM | MOVE_MEMBERS | MANAGE_CHANNELS);

export const VOICE_REQUIRED_PERMISSIONS = [
  ["View Channel", VIEW_CHANNEL],
  ["Connect", CONNECT],
  ["Manage Channels", MANAGE_CHANNELS],
  ["Move Members", MOVE_MEMBERS],
  ["Manage Roles", MANAGE_ROLES]
];

export function isSnowflake(value) {
  return /^\d{16,22}$/.test(String(value || ""));
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase()) || "";
  const found = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  return found == null ? "" : String(headers[found] ?? "");
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function discordRetryAfterMs(headers, body) {
  const seconds = [body?.retry_after, headerValue(headers, "retry-after"), headerValue(headers, "x-ratelimit-reset-after")]
    .map(finiteNumber)
    .find(value => value != null && value >= 0);
  return seconds == null ? null : Math.round(seconds * 1000);
}

export function decideVoiceDiscord({ status, headers, body, attempt, maxRetries = VOICE_DISCORD_MAX_RETRIES, missingOk = false }) {
  if (status === 404 && missingOk) return { done: true, retry: false, alreadyGone: true, waitMs: 0, reason: "" };
  if (status >= 200 && status < 300) return { done: true, retry: false, alreadyGone: false, waitMs: 0, reason: "" };
  if (status === 429) {
    const waitMs = discordRetryAfterMs(headers, body);
    const retry = attempt + 1 < maxRetries && waitMs != null && waitMs <= VOICE_DISCORD_MAX_WAIT_MS;
    return { done: false, retry, alreadyGone: false, waitMs: retry ? waitMs : 0, reason: body?.message || "You are being rate limited." };
  }
  return { done: false, retry: false, alreadyGone: false, waitMs: 0, reason: body?.message || "Discord rejected the Voice Create request" };
}

export async function runVoiceDiscord(send, options = {}) {
  const maxRetries = options.maxRetries ?? VOICE_DISCORD_MAX_RETRIES;
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let attempt = 0;
  let last = null;
  while (attempt < maxRetries) {
    const response = await send(attempt);
    last = response;
    const decision = decideVoiceDiscord({
      status: response?.status,
      headers: response?.headers,
      body: response?.body,
      attempt,
      maxRetries,
      missingOk: !!options.missingOk
    });
    if (decision.done) return { ok: true, missing: !!decision.alreadyGone, status: response.status, body: response.body, attempts: attempt + 1 };
    if (!decision.retry) return { ok: false, missing: false, status: response?.status || 0, error: decision.reason, body: response?.body, attempts: attempt + 1, retryAfterMs: discordRetryAfterMs(response?.headers, response?.body) || 0 };
    if (typeof options.onRetry === "function") options.onRetry({ attempt, waitMs: decision.waitMs, status: response?.status || 0 });
    await wait(decision.waitMs);
    attempt += 1;
  }
  return { ok: false, missing: false, status: last?.status || 429, error: "Discord rate limit retries exhausted", body: last?.body, attempts: attempt, retryAfterMs: discordRetryAfterMs(last?.headers, last?.body) || 0 };
}

export async function runVoiceCreate(send, options = {}) {
  let channelId = "";
  return runVoiceDiscord(async attempt => {
    if (channelId) return { status: 200, headers: {}, body: { id: channelId } };
    const response = await send(attempt);
    const id = response?.body?.id;
    if (response?.status >= 200 && response?.status < 300 && id) channelId = String(id);
    return response;
  }, options);
}

export function sanitizeVoiceChannelName(name, max = 100) {
  const clean = String(name ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(clean).slice(0, Math.max(1, max)).join("").trim();
}

export function voiceChannelName(template, displayName) {
  const username = sanitizeVoiceChannelName(displayName, 80) || "Player";
  const named = String(template || "{username} Room").split("{username}").join(username);
  return sanitizeVoiceChannelName(named, 100) || "Player Room";
}

export function voiceOverwritePlan({ privateByDefault = false } = {}) {
  const voice = ["ViewChannel", "Connect", "Speak", "UseVAD", "Stream"];
  return {
    everyone: privateByDefault
      ? { allow: ["ViewChannel", "Speak", "UseVAD", "Stream"], deny: ["Connect"] }
      : { allow: voice, deny: [] },
    owner: { allow: [...voice, "MoveMembers", "ManageChannels"], deny: [] },
    bot: { allow: ["ViewChannel", "Connect", "Speak", "MoveMembers", "ManageChannels"], deny: [] }
  };
}

export function normalizeVoiceRooms(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const rooms = [];
  for (const row of list) {
    const channelId = String(row?.channelId || "");
    const guildId = String(row?.guildId || "");
    if (!isSnowflake(channelId) || !isSnowflake(guildId) || seen.has(channelId)) continue;
    seen.add(channelId);
    rooms.push({
      channelId,
      guildId,
      ownerId: String(row.ownerId || ""),
      ownerName: sanitizeVoiceChannelName(row.ownerName || "", 80),
      profileId: String(row.profileId || ""),
      triggerChannelId: String(row.triggerChannelId || ""),
      createdAt: String(row.createdAt || "")
    });
  }
  return rooms;
}

export function rememberVoiceRoom(records, room) {
  const next = normalizeVoiceRooms(records);
  const channelId = String(room?.channelId || "");
  const guildId = String(room?.guildId || "");
  if (!isSnowflake(channelId) || !isSnowflake(guildId)) return { ok: false, error: "Invalid Voice Create room", records: next };
  const foreign = next.find(row => row.channelId === channelId && row.guildId !== guildId);
  if (foreign) return { ok: false, error: "Temporary channel belongs to another server", records: next };
  const recordsNext = normalizeVoiceRooms([...next.filter(row => row.channelId !== channelId), room]);
  return { ok: recordsNext.some(row => row.channelId === channelId && row.guildId === guildId), records: recordsNext, error: "" };
}

export function forgetVoiceRoom(records, channelId) {
  return normalizeVoiceRooms(records).filter(row => row.channelId !== String(channelId || ""));
}

export function prepareVoiceProfiles(input, channels, options = {}) {
  const list = Array.isArray(input) ? input : [];
  if (!list.length) return { ok: false, status: 400, error: "Add at least one Voice Create configuration", profiles: [] };
  const known = new Map((Array.isArray(channels) ? channels : []).map(channel => [String(channel.id), channel]));
  const seen = new Set();
  const profiles = [];
  for (const raw of list) {
    const categoryId = String(raw?.categoryId || "");
    const createChannelId = String(raw?.createChannelId || "");
    if (!isSnowflake(categoryId) || !isSnowflake(createChannelId)) return { ok: false, status: 400, error: "Every setup needs a category and Create Voice channel from this server", profiles: [] };
    if (seen.has(createChannelId)) return { ok: false, status: 400, error: "The same Create Voice channel cannot be used twice", profiles: [] };
    const category = known.get(categoryId);
    const voice = known.get(createChannelId);
    if (!category || Number(category.type) !== 4 || !voice || Number(voice.type) !== 2) {
      return { ok: false, status: 400, error: "Selected category or voice channel was not found in this server", profiles: [] };
    }
    seen.add(createChannelId);
    profiles.push({
      id: String(raw.id || "").slice(0, 80) || crypto.randomUUID(),
      categoryId,
      createChannelId,
      nameTemplate: sanitizeVoiceChannelName(raw.nameTemplate || "{username} Room", 80) || "{username} Room",
      userLimit: Math.max(0, Math.min(99, Number(raw.userLimit) || 0)),
      privateByDefault: !!raw.privateByDefault
    });
  }
  if (options.limitError) return { ok: false, status: 403, error: options.limitError, profiles: [] };
  return { ok: true, status: 200, error: "", profiles };
}

function bitfield(value) {
  try { return BigInt(value || 0); }
  catch { return 0n; }
}

export function resolveChannelPermissions({ roles = [], memberRoleIds = [], memberId = "", everyoneId = "", overwrites = [] } = {}) {
  const roleIds = new Set((memberRoleIds || []).map(String));
  let perms = 0n;
  for (const role of roles) {
    if (String(role.id) === String(everyoneId) || roleIds.has(String(role.id))) perms |= bitfield(role.permissions);
  }
  if ((perms & ADMINISTRATOR) === ADMINISTRATOR) return perms;
  const everyone = (overwrites || []).find(row => String(row.id) === String(everyoneId) && Number(row.type) === 0);
  if (everyone) {
    perms &= ~bitfield(everyone.deny);
    perms |= bitfield(everyone.allow);
  }
  let allow = 0n;
  let deny = 0n;
  for (const row of overwrites || []) {
    if (Number(row.type) !== 0 || String(row.id) === String(everyoneId) || !roleIds.has(String(row.id))) continue;
    allow |= bitfield(row.allow);
    deny |= bitfield(row.deny);
  }
  perms &= ~deny;
  perms |= allow;
  const member = (overwrites || []).find(row => Number(row.type) === 1 && String(row.id) === String(memberId));
  if (member) {
    perms &= ~bitfield(member.deny);
    perms |= bitfield(member.allow);
  }
  return perms;
}

export function missingVoicePermissions(perms) {
  const bits = bitfield(perms);
  if ((bits & ADMINISTRATOR) === ADMINISTRATOR) return [];
  return VOICE_REQUIRED_PERMISSIONS.filter(([, bit]) => (bits & bit) !== bit).map(([name]) => name);
}

export function voicePermissionError(missing, channelName) {
  if (!missing?.length) return "";
  const where = channelName ? ` in ${channelName}` : "";
  return `BalticM needs ${missing.join(", ")}${where} before Voice Create can be saved.`;
}

export function tempRoomPatch(action, body, room, discordChannel) {
  const name = String(action || "");
  if (name === "delete") return { ok: true, status: 200, delete: true, patch: null };
  if (name === "rename") {
    const next = sanitizeVoiceChannelName(body?.name, 100);
    if (!next) return { ok: false, status: 400, error: "Room name is required" };
    return { ok: true, status: 200, patch: { name: next } };
  }
  if (name === "limit") return { ok: true, status: 200, patch: { user_limit: Math.max(0, Math.min(99, Number(body?.limit) || 0)) } };
  if (name === "lock" || name === "unlock") {
    const everyone = String(room.guildId);
    const overwrites = (Array.isArray(discordChannel?.permission_overwrites) ? discordChannel.permission_overwrites : []).filter(row => String(row.id) !== everyone);
    overwrites.push({ id: everyone, type: 0, allow: name === "unlock" ? "1048576" : "0", deny: name === "lock" ? "1048576" : "0" });
    return { ok: true, status: 200, patch: { permission_overwrites: overwrites } };
  }
  if (name === "transfer") {
    const ownerId = String(body?.ownerId || "").trim();
    if (!isSnowflake(ownerId)) return { ok: false, status: 400, error: "Invalid Discord user ID" };
    const overwrites = (Array.isArray(discordChannel?.permission_overwrites) ? discordChannel.permission_overwrites : []).filter(row => String(row.id) !== String(room.ownerId) && String(row.id) !== ownerId);
    overwrites.push({ id: ownerId, type: 1, allow: VOICE_OWNER_ALLOW, deny: "0" });
    return { ok: true, status: 200, patch: { permission_overwrites: overwrites }, ownerId };
  }
  return { ok: false, status: 400, error: "Unknown room action" };
}

export function assessTempRoomAction({ guildId, roomId, room, triggerIds, actorId, actorIsManager }) {
  if (!isSnowflake(roomId)) return { ok: false, status: 400, error: "Invalid channel" };
  if ((triggerIds || new Set()).has?.(String(roomId)) || (Array.isArray(triggerIds) && triggerIds.map(String).includes(String(roomId)))) {
    return { ok: false, status: 403, error: "The Join to Create channel cannot be changed here." };
  }
  if (!room || String(room.guildId) !== String(guildId) || String(room.channelId) !== String(roomId)) {
    return { ok: false, status: 403, error: "This is not a managed temporary room for this server." };
  }
  if (!actorIsManager && String(room.ownerId) !== String(actorId || "")) {
    return { ok: false, status: 403, error: "You can only manage the temporary room you created." };
  }
  return { ok: true, status: 200, error: "" };
}

function safeLog(log, event, fields) {
  if (typeof log !== "function") return;
  const safe = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (/token|secret|cookie|authorization|password/i.test(key)) continue;
    safe[key] = value;
  }
  log(event, safe);
}

export function createVoiceSession(deps = {}) {
  const rooms = new Map();
  const creating = new Set();
  const deleting = new Set();
  const moving = new Set();
  const pendingDelete = new Map();
  const cycles = new Map();
  const pendingMove = new Map();
  const recheckMs = Number.isFinite(deps.recheckMs) ? deps.recheckMs : VOICE_EMPTY_RECHECK_MS;
  const log = (event, fields) => safeLog(deps.log, event, fields);
  const schedule = typeof deps.schedule === "function"
    ? deps.schedule
    : (fn, ms) => {
        const timer = setTimeout(() => {
          Promise.resolve(fn()).catch(error => log("discord-failure", { action: "scheduled-delete", error: error?.message || "delete failed" }));
        }, ms);
        return () => clearTimeout(timer);
      };

  function cycleIdFor(lock, channelId) {
    return cycles.get(lock)?.id || rooms.get(channelId)?.cycleId || pendingMove.get(lock)?.cycleId || "";
  }

  function trace(event, fields) {
    const lock = fields.lock || `${fields.guildId || ""}:${fields.userId || ""}`;
    const channelId = fields.channelId || "";
    log(event, {
      guildId: fields.guildId || "",
      userId: fields.userId || "",
      oldChannelId: fields.oldChannelId || "",
      newChannelId: fields.newChannelId || "",
      channelId,
      cycleId: fields.cycleId || cycleIdFor(lock, channelId),
      createLock: fields.createLock != null ? fields.createLock : creating.has(lock),
      moveInFlight: channelId ? moving.has(channelId) : moving.size > 0,
      attempt: fields.attempt || 1,
      discordStatus: fields.discordStatus || 0,
      retryAfterMs: fields.retryAfterMs || 0,
      elapsedMs: fields.elapsedMs || 0,
      sinceVoiceStateMs: fields.sinceVoiceStateMs || 0,
      sinceCreateMs: fields.sinceCreateMs || 0,
      sinceMoveMs: fields.sinceMoveMs || 0,
      sinceLeaveMs: fields.sinceLeaveMs || 0,
      cacheChannelId: fields.cacheChannelId || "",
      newChannelMembers: fields.newChannelMembers ?? null,
      oldChannelMembers: fields.oldChannelMembers ?? null,
      trackedRooms: fields.trackedRooms ?? null,
      error: fields.error || ""
    });
  }

  function cancelDelete(channelId) {
    const cancel = pendingDelete.get(channelId);
    if (typeof cancel === "function") cancel();
    pendingDelete.delete(channelId);
  }

  function queueDelete(channelId, delayMs) {
    cancelDelete(channelId);
    const wait = Number(delayMs);
    if (!(wait > 0)) return attemptDelete(channelId);
    let cancel = () => {};
    const run = () => {
      if (pendingDelete.get(channelId) === cancel) pendingDelete.delete(channelId);
      return attemptDelete(channelId);
    };
    cancel = schedule(run, wait) || (() => {});
    pendingDelete.set(channelId, cancel);
    return Promise.resolve({ status: "scheduled" });
  }

  function scheduleDelete(channelId) {
    return attemptDelete(channelId);
  }

  function queueFallback(channelId) {
    if (!(recheckMs > 0)) return false;
    queueDelete(channelId, recheckMs);
    return true;
  }

  function transientDeleteFailure(result) {
    const status = Number(result?.status || 0);
    if (status === 429 || status === 408 || (status >= 500 && status <= 599)) return true;
    const code = String(result?.code || "");
    return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN" || code === "ECONNREFUSED";
  }

  function scheduleDeleteRetry(channelId, result) {
    const room = rooms.get(channelId);
    if (!room || !transientDeleteFailure(result)) return false;
    room.deleteRetries = Number(room.deleteRetries || 0) + 1;
    if (room.deleteRetries >= VOICE_DISCORD_MAX_RETRIES) return false;
    const waitMs = Math.min(
      VOICE_DISCORD_MAX_WAIT_MS,
      Math.max(recheckMs > 0 ? recheckMs : VOICE_EMPTY_RECHECK_MS, Number(result?.retryAfterMs || 0) || 0)
    );
    queueDelete(channelId, waitMs);
    return true;
  }

  async function forgetRecord(room) {
    if (!room) return;
    if (typeof deps.forgetRoom === "function") await deps.forgetRoom(room.guildId, room.channelId);
    rooms.delete(room.channelId);
  }

  async function attemptDelete(channelId, options = {}) {
    if (deleting.has(channelId)) return { status: "busy" };
    const room = rooms.get(channelId);
    if (!room) return { status: "untracked" };
    if (room.triggerChannelId && String(room.triggerChannelId) === String(channelId)) return { status: "trigger" };
    const leaveAt = room.leaveAt || 0;
    const base = {
      guildId: room.guildId,
      userId: room.ownerId,
      channelId,
      cycleId: room.cycleId || "",
      oldChannelId: channelId,
      sinceLeaveMs: leaveAt ? Date.now() - leaveAt : 0
    };
    trace("DELETE_CHECK_STARTED", base);
    if (moving.has(channelId)) {
      trace("DELETE_SKIPPED_MOVE_IN_FLIGHT", base);
      if (queueFallback(channelId)) return { status: "recheck", channelId };
      return { status: "moving" };
    }
    deleting.add(channelId);
    const started = Date.now();
    try {
      if (!options.force && typeof deps.protectChannel === "function" && await deps.protectChannel(channelId)) {
        trace("DELETE_REFUSED", { ...base, error: "protected channel" });
        return { status: "protected", channelId };
      }
      if (!options.force) {
        let occupants = typeof deps.occupantCount === "function" ? await deps.occupantCount(channelId) : 0;
        if (occupants !== 0) {
          try {
            if (typeof deps.confirmOccupants === "function") occupants = await deps.confirmOccupants(channelId);
            else if (occupants == null && queueFallback(channelId)) return { status: "recheck", channelId };
          } catch (error) {
            if (queueFallback(channelId)) return { status: "recheck", channelId };
            throw error;
          }
        }
        if (occupants == null) {
          if (queueFallback(channelId)) return { status: "recheck", channelId };
          return { status: "unknown", channelId };
        }
        if (occupants > 0) {
          room.deleteRetries = 0;
          log("cleanup-skipped-occupied", { guildId: room.guildId, channelId, occupants, cycleId: room.cycleId || "" });
          return { status: "occupied" };
        }
      }
      trace("CHANNEL_DELETE_STARTED", { ...base, sinceLeaveMs: leaveAt ? Date.now() - leaveAt : 0 });
      const result = typeof deps.deleteChannel === "function"
        ? await deps.deleteChannel(channelId, { guildId: room.guildId, userId: room.ownerId, cycleId: room.cycleId || "" })
        : { ok: false, error: "Delete is not configured" };
      if (result?.ok || result?.missing) {
        trace("CHANNEL_DELETE_SUCCESS", {
          ...base,
          attempt: result.attempts || 1,
          discordStatus: result.status || (result.missing ? 404 : 200),
          elapsedMs: Date.now() - started,
          sinceLeaveMs: leaveAt ? Date.now() - leaveAt : 0
        });
        await forgetRecord(room);
        trace("ROOM_STATE_REMOVED", { ...base, sinceLeaveMs: leaveAt ? Date.now() - leaveAt : 0 });
        return { status: "deleted", channelId };
      }
      const status = result?.status || 0;
      trace(status === 429 ? "DELETE_429" : "DISCORD_REST_ERROR", {
        ...base,
        attempt: result?.attempts || 1,
        discordStatus: status,
        retryAfterMs: result?.retryAfterMs || 0,
        elapsedMs: Date.now() - started,
        error: result?.error || "delete failed"
      });
      if (status === 429) trace("VOICE_OPERATION_TIMEOUT", { ...base, attempt: result?.attempts || 1, discordStatus: status, elapsedMs: Date.now() - started, error: result?.error || "delete failed" });
      if (scheduleDeleteRetry(channelId, result)) return { status: "retry", channelId };
      return { status: "failed", channelId, error: result?.error || "delete failed" };
    } catch (error) {
      trace("DISCORD_REST_ERROR", { ...base, elapsedMs: Date.now() - started, discordStatus: error?.status || 0, error: error?.message || "delete failed" });
      if (scheduleDeleteRetry(channelId, { status: error?.status || 0, code: error?.code || "", retryAfterMs: error?.retryAfterMs || 0 })) return { status: "retry", channelId };
      return { status: "failed", channelId, error: error?.message || "delete failed" };
    } finally {
      deleting.delete(channelId);
      trace("DELETE_LOCK_RELEASED", { ...base, elapsedMs: Date.now() - started, sinceLeaveMs: leaveAt ? Date.now() - leaveAt : 0 });
    }
  }

  async function rollback(channelId, guildId) {
    const room = rooms.get(channelId) || { channelId, guildId, triggerChannelId: "" };
    rooms.set(channelId, room);
    const deleted = await attemptDelete(channelId, { force: true });
    if (deleted.status !== "deleted") log("rollback-incomplete", { guildId, channelId, status: deleted.status });
    return deleted;
  }

  function trackedFor(guildId, userId) {
    let count = 0;
    for (const room of rooms.values()) {
      if (room.guildId === guildId && room.ownerId === userId) count += 1;
    }
    return count;
  }

  async function handleVoiceState(event) {
    const receivedAt = Date.now();
    const guildId = String(event?.guildId || "");
    const userId = String(event?.userId || "");
    const oldChannelId = event?.oldChannelId ? String(event.oldChannelId) : "";
    const newChannelId = event?.newChannelId ? String(event.newChannelId) : "";
    const lock = `${guildId}:${userId}`;
    const state = {
      lock,
      guildId,
      userId,
      oldChannelId,
      newChannelId,
      cacheChannelId: event?.cacheChannelId ? String(event.cacheChannelId) : "",
      newChannelMembers: event?.newChannelMembers ?? null,
      oldChannelMembers: event?.oldChannelMembers ?? null,
      trackedRooms: trackedFor(guildId, userId)
    };
    if (!event?.bot) trace("VOICE_STATE_RECEIVED", state);
    const pending = pendingMove.get(lock);
    if (pending && newChannelId && newChannelId === pending.channelId) {
      trace("VOICE_STATE_AFTER_MOVE", {
        ...state,
        channelId: pending.channelId,
        cycleId: pending.cycleId,
        sinceMoveMs: Date.now() - pending.moveStartedAt,
        elapsedMs: pending.moveFinishedAt ? Date.now() - pending.moveFinishedAt : Date.now() - pending.moveStartedAt
      });
      pendingMove.delete(lock);
    }
    const createCandidate = !event?.bot && !!newChannelId && oldChannelId !== newChannelId;
    const leavingRoom = !event?.bot && oldChannelId && oldChannelId !== newChannelId && rooms.has(oldChannelId);
    if (leavingRoom) {
      const room = rooms.get(oldChannelId);
      room.leaveAt = receivedAt;
      trace("VOICE_LEAVE_RECEIVED", { ...state, channelId: oldChannelId, cycleId: room.cycleId || "" });
    }
    if (createCandidate && creating.has(lock)) {
      if (newChannelId && rooms.has(newChannelId)) cancelDelete(newChannelId);
      if (leavingRoom) await scheduleDelete(oldChannelId);
      trace("DUPLICATE_VOICE_STATE", { ...state, cycleId: cycleIdFor(lock, oldChannelId) });
      trace("CREATE_SUPPRESSED_BY_LOCK", { ...state, cycleId: cycleIdFor(lock, oldChannelId), createLock: true });
      return { status: "duplicate" };
    }
    if (createCandidate) {
      const cycleId = `${receivedAt.toString(36)}-${userId.slice(-4)}`;
      cycles.set(lock, { id: cycleId, startedAt: receivedAt });
      creating.add(lock);
      trace("CREATE_LOCK_ACQUIRED", { ...state, cycleId, createLock: true, elapsedMs: Date.now() - receivedAt });
    }
    let channelId = "";
    const cycle = cycles.get(lock);
    try {
    if (leavingRoom) await scheduleDelete(oldChannelId);
    if (newChannelId && rooms.has(newChannelId)) cancelDelete(newChannelId);
    if (!createCandidate) return { status: "ignored" };
    const config = typeof deps.getConfig === "function" ? await deps.getConfig(guildId) : null;
    if (!config || config.enabled === false) return { status: "disabled" };
    const profiles = Array.isArray(config.profiles) ? config.profiles : [];
    const profile = profiles.find(row => String(row.createChannelId) === newChannelId);
    if (!profile) return { status: "not-trigger" };
      const live = typeof deps.currentChannelId === "function" ? await deps.currentChannelId(guildId, userId) : newChannelId;
      if (live && String(live) !== newChannelId) {
        trace("MEMBER_LEFT_BEFORE_CREATE", { ...state, cycleId: cycle?.id || "", cacheChannelId: String(live), elapsedMs: Date.now() - receivedAt });
        return { status: "left-before-create" };
      }
      const name = voiceChannelName(profile.nameTemplate, event.displayName);
      const createStarted = Date.now();
      trace("CHANNEL_CREATE_STARTED", { ...state, cycleId: cycle?.id || "", sinceVoiceStateMs: createStarted - receivedAt });
      const created = await deps.createChannel({
        guildId,
        categoryId: String(profile.categoryId),
        name,
        userLimit: Math.max(0, Math.min(99, Number(profile.userLimit) || 0)),
        privateByDefault: !!profile.privateByDefault,
        ownerId: userId,
        botId: String(event.botId || ""),
        cycleId: cycle?.id || ""
      });
      channelId = String(created?.id || "");
      if (!channelId) throw new Error("Discord did not return a channel");
      const room = {
        channelId,
        guildId,
        ownerId: userId,
        ownerName: sanitizeVoiceChannelName(event.displayName || "Player", 80) || "Player",
        profileId: String(profile.id || ""),
        triggerChannelId: String(profile.createChannelId),
        createdAt: new Date().toISOString(),
        cycleId: cycle?.id || ""
      };
      rooms.set(channelId, room);
      const createFinished = Date.now();
      trace("CHANNEL_CREATE_SUCCESS", {
        ...state,
        channelId,
        cycleId: room.cycleId,
        attempt: created.attempts || 1,
        discordStatus: created.status || 200,
        elapsedMs: createFinished - createStarted,
        sinceVoiceStateMs: createFinished - receivedAt,
        trackedRooms: trackedFor(guildId, userId)
      });
      const beforeMove = typeof deps.currentChannelId === "function" ? await deps.currentChannelId(guildId, userId) : newChannelId;
      if (beforeMove && String(beforeMove) !== newChannelId && String(beforeMove) !== channelId) {
        trace("MEMBER_LEFT_BEFORE_MOVE", { ...state, channelId, cycleId: room.cycleId, cacheChannelId: String(beforeMove) });
        await rollback(channelId, guildId);
        return { status: "left-before-move", channelId };
      }
      const moveStartedAt = Date.now();
      pendingMove.set(lock, { channelId, cycleId: room.cycleId, moveStartedAt, moveFinishedAt: 0 });
      moving.add(channelId);
      let moveError = null;
      let moveResult = null;
      try {
        trace("MEMBER_MOVE_STARTED", { ...state, channelId, cycleId: room.cycleId, sinceCreateMs: moveStartedAt - createFinished, sinceVoiceStateMs: moveStartedAt - receivedAt, moveInFlight: true });
        moveResult = await deps.moveMember({ guildId, userId, channelId, cycleId: room.cycleId });
      } catch (error) {
        moveError = error;
      } finally {
        moving.delete(channelId);
      }
      if (moveError) {
        pendingMove.delete(lock);
        const status = moveError.status || 0;
        trace(status === 429 ? "MOVE_429" : "DISCORD_REST_ERROR", {
          ...state,
          channelId,
          cycleId: room.cycleId,
          discordStatus: status,
          elapsedMs: Date.now() - moveStartedAt,
          error: moveError.message || "move failed"
        });
        if (status === 429) trace("VOICE_OPERATION_TIMEOUT", { ...state, channelId, cycleId: room.cycleId, discordStatus: status, elapsedMs: Date.now() - moveStartedAt });
        await rollback(channelId, guildId);
        return { status: "move-failed", channelId, error: moveError.message || "move failed" };
      }
      const moveFinishedAt = Date.now();
      const pendingRow = pendingMove.get(lock);
      if (pendingRow) pendingRow.moveFinishedAt = moveFinishedAt;
      trace("MEMBER_MOVE_SUCCESS", {
        ...state,
        channelId,
        cycleId: room.cycleId,
        attempt: moveResult?.attempts || 1,
        discordStatus: moveResult?.status || 200,
        elapsedMs: moveFinishedAt - moveStartedAt,
        sinceCreateMs: moveFinishedAt - createFinished,
        sinceVoiceStateMs: moveFinishedAt - receivedAt
      });
      const saveStarted = Date.now();
      try {
        trace("OWNERSHIP_SAVE_STARTED", { ...state, channelId, cycleId: room.cycleId, sinceMoveMs: saveStarted - moveStartedAt });
        if (typeof deps.saveRoom === "function") await deps.saveRoom(room);
        trace("OWNERSHIP_SAVE_SUCCESS", { ...state, channelId, cycleId: room.cycleId, elapsedMs: Date.now() - saveStarted, sinceMoveMs: Date.now() - moveStartedAt });
      } catch (error) {
        trace("DISCORD_REST_ERROR", { ...state, channelId, cycleId: room.cycleId, elapsedMs: Date.now() - saveStarted, error: error?.message || "Could not store room" });
        return { status: "save-failed", channelId, error: error?.message || "Could not store room" };
      }
      return { status: "created", channelId };
    } catch (error) {
      if (channelId) {
        moving.delete(channelId);
        pendingMove.delete(lock);
        await rollback(channelId, guildId);
      }
      const status = error?.status || 0;
      trace(status === 429 ? "CREATE_429" : "DISCORD_REST_ERROR", {
        ...state,
        channelId,
        cycleId: cycle?.id || "",
        discordStatus: status,
        elapsedMs: Date.now() - receivedAt,
        error: error?.message || "create failed"
      });
      if (status === 429) trace("VOICE_OPERATION_TIMEOUT", { ...state, channelId, cycleId: cycle?.id || "", discordStatus: status, elapsedMs: Date.now() - receivedAt });
      return { status: "create-failed", error: error?.message || "create failed" };
    } finally {
      if (createCandidate) {
        creating.delete(lock);
        trace("CREATE_LOCK_RELEASED", { ...state, channelId, cycleId: cycle?.id || cycles.get(lock)?.id || "", createLock: false, sinceVoiceStateMs: Date.now() - receivedAt });
        cycles.delete(lock);
      }
    }
  }

  async function reconcileGuild(guildId) {
    const config = typeof deps.getConfig === "function" ? await deps.getConfig(guildId) : null;
    const triggers = new Set((config?.profiles || []).map(row => String(row.createChannelId || "")).filter(Boolean));
    const remote = typeof deps.loadRooms === "function" ? normalizeVoiceRooms(await deps.loadRooms(guildId)) : [];
    const actions = [];
    for (const row of remote.filter(item => item.guildId === String(guildId))) {
      if (triggers.has(row.channelId)) {
        await deps.forgetRoom?.(guildId, row.channelId);
        actions.push({ channelId: row.channelId, action: "drop-trigger-record" });
        continue;
      }
      const info = typeof deps.inspectChannel === "function" ? await deps.inspectChannel(row.channelId) : { missing: false, guildId, memberCount: 0 };
      if (info?.missing) {
        await deps.forgetRoom?.(guildId, row.channelId);
        rooms.delete(row.channelId);
        actions.push({ channelId: row.channelId, action: "forget-missing" });
        continue;
      }
      if (info?.guildId && String(info.guildId) !== String(guildId)) {
        await deps.forgetRoom?.(guildId, row.channelId);
        actions.push({ channelId: row.channelId, action: "drop-foreign" });
        continue;
      }
      rooms.set(row.channelId, { ...row, triggerChannelId: row.triggerChannelId || "" });
      if (Number(info?.memberCount) > 0) {
        actions.push({ channelId: row.channelId, action: "keep-occupied" });
        continue;
      }
      const deleted = await attemptDelete(row.channelId);
      actions.push({ channelId: row.channelId, action: deleted.status === "deleted" ? "delete-empty" : "keep-after-failed-delete" });
    }
    log("reconcile", { guildId, actions: actions.map(item => `${item.channelId}:${item.action}`).join(",") });
    return actions;
  }

  function forgetLocal(channelId) {
    cancelDelete(channelId);
    rooms.delete(String(channelId || ""));
    deleting.delete(String(channelId || ""));
  }

  return {
    rooms,
    creating,
    deleting,
    moving,
    pendingDelete,
    handleVoiceState,
    reconcileGuild,
    attemptDelete,
    forgetLocal,
    cancelDelete
  };
}
