const INSERT_SQL = "INSERT INTO cc_notifications (id,kind,scope,user_id,title,body,href,dedupe_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)";
const LIST_SQL = `SELECT n.id, n.kind AS type, n.title, n.body AS text, n.href, n.created_at AS createdAt,
 0 AS isRead
 FROM cc_notifications n
 LEFT JOIN cc_notification_reads r ON r.notification_id=n.id AND r.user_id=?
 WHERE (n.scope='global' OR (n.scope='user' AND n.user_id=?))
 AND r.notification_id IS NULL
 ORDER BY n.created_at DESC
 LIMIT 40`;
const UNREAD_SQL = `SELECT COUNT(*) AS unread
 FROM cc_notifications n
 LEFT JOIN cc_notification_reads r ON r.notification_id=n.id AND r.user_id=?
 WHERE (n.scope='global' OR (n.scope='user' AND n.user_id=?))
 AND r.notification_id IS NULL`;
const VISIBLE_SQL = "SELECT id, scope, user_id AS userId FROM cc_notifications WHERE id=? AND (scope='global' OR (scope='user' AND user_id=?))";
const MARK_SQL = "INSERT OR IGNORE INTO cc_notification_reads (notification_id, user_id, read_at) VALUES (?,?,?)";
const MARK_ALL_SQL = `INSERT OR IGNORE INTO cc_notification_reads (notification_id, user_id, read_at)
 SELECT n.id, ?, ?
 FROM cc_notifications n
 LEFT JOIN cc_notification_reads r ON r.notification_id=n.id AND r.user_id=?
 WHERE (n.scope='global' OR (n.scope='user' AND n.user_id=?))
 AND r.notification_id IS NULL`;
const ADMIN_LIST_SQL = `SELECT id, kind AS type, title, body AS text, href, created_at AS createdAt
 FROM cc_notifications WHERE scope='global' ORDER BY created_at DESC LIMIT 50`;

export const SUPPORT_NOTIFICATION_TITLE = "New reply from BalticM Support";
export const SUPPORT_NOTIFICATION_TEXT = "Your support ticket has a new response.";

export function isSafeNotificationHref(href) {
  const value = String(href || "");
  if (!value) return true;
  if (value === "support-chat") return true;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://") || value.includes("\\")) return false;
  if (value.length > 120) return false;
  return /^\/[A-Za-z0-9/_-]*$/.test(value);
}

export function validateSystemNotification(input) {
  const title = String(input?.title || "").trim();
  const message = String(input?.message || input?.text || "").trim();
  const href = String(input?.href || "").trim();
  if (!title) return { error: "Title is required" };
  if (title.length > 120) return { error: "Title is too long" };
  if (!message) return { error: "Message is required" };
  if (message.length > 400) return { error: "Message is too long" };
  if (!isSafeNotificationHref(href)) return { error: "Link must be an internal Control Center path" };
  return { title, message, href };
}

export async function ensureNotificationTables(db) {
  if (!db) throw new Error("BALTICM_DB binding is not configured");
  await db.prepare(`CREATE TABLE IF NOT EXISTS cc_notifications (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL,
 scope TEXT NOT NULL,
 user_id TEXT NOT NULL DEFAULT '',
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 href TEXT NOT NULL DEFAULT '',
 dedupe_key TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL
)`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_notifications_dedupe ON cc_notifications(dedupe_key) WHERE dedupe_key<>''").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS cc_notification_reads (
 notification_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 read_at TEXT NOT NULL,
 PRIMARY KEY (notification_id, user_id)
)`).run();
}

function mapRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    text: row.text,
    href: row.href || "",
    createdAt: row.createdAt,
    read: Number(row.isRead) === 1
  };
}

export async function listNotificationsForUser(db, userId) {
  await ensureNotificationTables(db);
  const uid = String(userId || "");
  const [listed, counted] = await Promise.all([
    db.prepare(LIST_SQL).bind(uid, uid).all(),
    db.prepare(UNREAD_SQL).bind(uid, uid).first()
  ]);
  const notifications = (listed.results || []).map(mapRow);
  return { notifications, unread: Number(counted?.unread || 0) };
}

export async function markNotificationRead(db, userId, notificationId) {
  await ensureNotificationTables(db);
  const uid = String(userId || "");
  const id = String(notificationId || "").trim();
  if (!id) return { error: "Notification is required", status: 400 };
  const visible = await db.prepare(VISIBLE_SQL).bind(id, uid).first();
  if (!visible) return { error: "Notification not found", status: 404 };
  await db.prepare(MARK_SQL).bind(id, uid, new Date().toISOString()).run();
  return { ok: true, id };
}

export async function markAllNotificationsRead(db, userId) {
  await ensureNotificationTables(db);
  const uid = String(userId || "");
  const now = new Date().toISOString();
  await db.prepare(MARK_ALL_SQL).bind(uid, now, uid, uid).run();
  return { ok: true };
}

export async function publishSystemNotification(db, input) {
  const parsed = validateSystemNotification(input);
  if (parsed.error) return { error: parsed.error, status: 400 };
  await ensureNotificationTables(db);
  const id = String(input.id || crypto.randomUUID());
  const now = String(input.now || new Date().toISOString());
  try {
    await db.prepare(INSERT_SQL).bind(id, "system", "global", "", parsed.title, parsed.message, parsed.href, "system:" + id, now).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message || e))) return { error: "Notification already exists", status: 409 };
    throw e;
  }
  return { ok: true, notification: { id, type: "system", title: parsed.title, text: parsed.message, href: parsed.href, createdAt: now } };
}

export async function listSystemNotifications(db) {
  await ensureNotificationTables(db);
  const listed = await db.prepare(ADMIN_LIST_SQL).all();
  return { notifications: (listed.results || []).map(row => ({ id: row.id, type: row.type, title: row.title, text: row.text, href: row.href || "", createdAt: row.createdAt })) };
}

const MARK_SUPPORT_SQL = `INSERT OR IGNORE INTO cc_notification_reads (notification_id, user_id, read_at)
 SELECT n.id, ?, ?
 FROM cc_notifications n
 LEFT JOIN cc_notification_reads r ON r.notification_id=n.id AND r.user_id=?
 WHERE n.kind='support' AND n.scope='user' AND n.user_id=?
 AND r.notification_id IS NULL`;

export async function markSupportNotificationsRead(db, userId) {
  await ensureNotificationTables(db);
  const uid = String(userId || "");
  if (!uid) return { ok: false };
  const now = new Date().toISOString();
  await db.prepare(MARK_SUPPORT_SQL).bind(uid, now, uid, uid).run();
  return { ok: true };
}

export async function createSupportReplyNotification(db, { messageId, userId, now }) {
  const uid = String(userId || "").trim();
  const mid = String(messageId || "").trim();
  if (!uid || !mid) return { created: false };
  await ensureNotificationTables(db);
  const id = crypto.randomUUID();
  const createdAt = String(now || new Date().toISOString());
  try {
    await db.prepare(INSERT_SQL).bind(id, "support", "user", uid, SUPPORT_NOTIFICATION_TITLE, SUPPORT_NOTIFICATION_TEXT, "support-chat", "support:" + mid, createdAt).run();
    return { created: true, id };
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message || e))) return { created: false, duplicate: true };
    throw e;
  }
}
