/**
 * Admin display-name helpers — map stored Discord snowflakes to readable names.
 * Pure functions only: no I/O and no Discord API calls. Remote lookups and their
 * cache live in the Worker so admin responses stay a single bounded request.
 *
 * Every row keeps its raw id: when no name is known the label stays empty and the
 * frontend falls back to the raw id.
 */

const DASH = "\u2014";

const clean = (v) => String(v ?? "").trim();

export function isSnowflake(value) {
  return /^\d{16,22}$/.test(clean(value));
}

/* Field layout per payload kind:
   log      -> admin-logs rows (actorDiscordId/actorLabel, guildId/guildLabel)
   payment  -> Tebex payment rows (discordUserId/discordUserName, guildId/guildName) */
const KIND_FIELDS = {
  log: { userId: "actorDiscordId", userName: "actorLabel", guildId: "guildId", guildLabel: "guildLabel", reference: "reference", referenceLabel: "referenceLabel" },
  payment: { userId: "discordUserId", userName: "discordUserName", guildId: "guildId", guildLabel: "guildName" }
};

function fieldsFor(kind) {
  return KIND_FIELDS[kind] || KIND_FIELDS.log;
}

function toMap(source) {
  if (source instanceof Map) return source;
  return new Map(Object.entries(source || {}));
}

/** Build {users, guilds} lookup maps from rows shaped {id,name}. */
export function buildAdminNameMaps(userRows = [], guildRows = []) {
  const users = new Map();
  const guilds = new Map();
  const add = (map, row) => {
    const id = clean(row && row.id);
    const name = clean(row && row.name);
    if (!id || !name || id === name || map.has(id)) return;
    map.set(id, name);
  };
  for (const row of userRows || []) add(users, row);
  for (const row of guildRows || []) add(guilds, row);
  return { users, guilds };
}

/** Fill missing display names on rows in place; unresolved ids keep an empty label. */
export function applyAdminNames(rows = [], maps = {}, kind = "log") {
  const f = fieldsFor(kind);
  const users = toMap(maps.users);
  const guilds = toMap(maps.guilds);
  for (const row of rows || []) {
    if (!row) continue;
    const userId = clean(row[f.userId]);
    if (userId && !clean(row[f.userName])) {
      const name = users.get(userId);
      if (name) row[f.userName] = name;
    }
    const guildId = clean(row[f.guildId]);
    const current = clean(row[f.guildLabel]);
    if (guildId && (!current || current === DASH)) {
      const name = guilds.get(guildId);
      row[f.guildLabel] = name || "";
    }
    /* A reference that is a known discord snowflake (e.g. the guild an admin
       action targeted) gets the same readable treatment; anything else stays raw. */
    if (f.referenceLabel && !clean(row[f.referenceLabel])) {
      const ref = clean(row[f.reference]);
      if (isSnowflake(ref)) {
        const name = guilds.get(ref) || users.get(ref);
        if (name) row[f.referenceLabel] = name;
      }
    }
  }
  return rows;
}

export function applyAdminLogNames(rows, maps) {
  return applyAdminNames(rows, maps, "log");
}

export function applyAdminPaymentNames(rows, maps) {
  return applyAdminNames(rows, maps, "payment");
}

/** Distinct ids still missing a name — the bounded remote lookup consumes this. */
export function adminNameGaps(rows = [], kind = "log") {
  const f = fieldsFor(kind);
  const userIds = new Set();
  const guildIds = new Set();
  for (const row of rows || []) {
    if (!row) continue;
    const userId = clean(row[f.userId]);
    if (userId && isSnowflake(userId) && !clean(row[f.userName])) userIds.add(userId);
    const guildId = clean(row[f.guildId]);
    const label = clean(row[f.guildLabel]);
    if (guildId && isSnowflake(guildId) && (!label || label === DASH)) guildIds.add(guildId);
  }
  return { userIds: [...userIds], guildIds: [...guildIds] };
}
