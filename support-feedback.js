export function handlingStaffId(messages) {
  const staff = (messages || []).filter(message => message?.senderType === "staff" && String(message.senderId || "").trim());
  if (!staff.length) return "";
  const sorted = staff.slice().sort((a, b) => {
    const time = String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    if (time) return time;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  return String(sorted[sorted.length - 1].senderId);
}

export function validateRating(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) return null;
  return value;
}

export function pendingRatingDecision({ latestClosed = null, hasOpenTicket = false, staffMessages = [], feedback = null } = {}) {
  if (hasOpenTicket || !latestClosed || latestClosed.status !== "closed") return null;
  if (feedback) return null;
  const staffUserId = handlingStaffId(staffMessages);
  if (!staffUserId) return null;
  return { ticketId: String(latestClosed.id), staffUserId };
}

export function summarizeRatings(rows) {
  const rated = (rows || []).filter(row => !row.skipped && validateRating(row.rating));
  if (!rated.length) return { average: null, count: 0 };
  const sum = rated.reduce((total, row) => total + row.rating, 0);
  return { average: Math.round((sum / rated.length) * 10) / 10, count: rated.length };
}

export function starLabel(rating) {
  const value = validateRating(rating);
  if (!value) return "";
  return `${"★".repeat(value)}${"☆".repeat(5 - value)} ${value}/5`;
}

export async function ensureSupportFeedbackTable(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS cc_support_feedback (ticket_id TEXT PRIMARY KEY, customer_user_id TEXT NOT NULL, staff_user_id TEXT NOT NULL, rating INTEGER, skipped INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)").run();
}

export async function readSupportFeedback(db, ticketId) {
  await ensureSupportFeedbackTable(db);
  return db.prepare("SELECT ticket_id AS ticketId, customer_user_id AS customerUserId, staff_user_id AS staffUserId, rating, skipped, created_at AS createdAt FROM cc_support_feedback WHERE ticket_id=?").bind(String(ticketId || "")).first();
}

export async function listSupportFeedback(db) {
  await ensureSupportFeedbackTable(db);
  const rows = await db.prepare("SELECT ticket_id AS ticketId, customer_user_id AS customerUserId, staff_user_id AS staffUserId, rating, skipped, created_at AS createdAt FROM cc_support_feedback").all();
  return rows.results || [];
}

export async function saveSupportFeedback(db, row) {
  await ensureSupportFeedbackTable(db);
  const existing = await readSupportFeedback(db, row.ticketId);
  if (existing) return { error: "Already rated", status: 409 };
  const skipped = row.skipped ? 1 : 0;
  const rating = skipped ? null : validateRating(row.rating);
  if (!skipped && !rating) return { error: "Rating must be an integer from 1 to 5", status: 400 };
  if (!row.staffUserId || !row.customerUserId || !row.ticketId) return { error: "Ticket is not eligible", status: 400 };
  try {
    await db.prepare("INSERT INTO cc_support_feedback (ticket_id, customer_user_id, staff_user_id, rating, skipped, created_at) VALUES (?,?,?,?,?,?)").bind(String(row.ticketId), String(row.customerUserId), String(row.staffUserId), rating, skipped, row.createdAt).run();
  } catch (error) {
    if (/UNIQUE/i.test(String(error?.message || error))) return { error: "Already rated", status: 409 };
    throw error;
  }
  return { ok: true, rating: skipped ? null : rating, skipped: !!skipped, staffUserId: String(row.staffUserId) };
}
