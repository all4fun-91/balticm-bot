async function runBatch(db, statements) {
  if (typeof db.batch === "function") {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

function auditInsert(db, { id, now, action, actorId, guildId, reference, details }) {
  return db.prepare("INSERT INTO admin_audit_log (id, created_at, category, action, actor_discord_id, guild_id, reference, status, details) VALUES (?,?,?,?,?,?,?,?,?)").bind(id, now, "support", action, String(actorId || ""), String(guildId || ""), String(reference || ""), "deleted", String(details || ""));
}

export async function deleteSupportMessageRecord(db, { threadId, messageId, actorId, now } = {}) {
  const ticketId = String(threadId || "").trim();
  const id = String(messageId || "").trim();
  if (!ticketId || !id) return { error: "Thread and message are required", status: 400 };
  const thread = await db.prepare("SELECT id, user_id AS userId, guild_id AS guildId, status FROM bot_support_threads WHERE id=?").bind(ticketId).first();
  if (!thread) return { error: "Conversation not found", status: 404 };
  const message = await db.prepare("SELECT id FROM bot_support_messages WHERE id=? AND thread_id=?").bind(id, ticketId).first();
  if (!message) return { error: "Message not found", status: 404 };
  const createdAt = String(now || new Date().toISOString());
  await auditInsert(db, {
    id: crypto.randomUUID(),
    now: createdAt,
    action: "Message permanently deleted",
    actorId,
    guildId: thread.guildId,
    reference: ticketId,
    details: "message:" + id
  }).run();
  const userId = String(thread.userId || "");
  const dedupe = "support:" + id;
  await runBatch(db, [
    db.prepare("DELETE FROM cc_notification_reads WHERE notification_id IN (SELECT id FROM cc_notifications WHERE kind='support' AND scope='user' AND user_id=? AND dedupe_key=?)").bind(userId, dedupe),
    db.prepare("DELETE FROM cc_notifications WHERE kind='support' AND scope='user' AND user_id=? AND dedupe_key=?").bind(userId, dedupe),
    db.prepare("DELETE FROM bot_support_messages WHERE id=? AND thread_id=?").bind(id, ticketId)
  ]);
  return { ok: true, threadId: ticketId, messageId: id };
}

export async function deleteClosedSupportConversation(db, { threadId, actorId, now } = {}) {
  const ticketId = String(threadId || "").trim();
  if (!ticketId) return { error: "Thread is required", status: 400 };
  const thread = await db.prepare("SELECT id, user_id AS userId, guild_id AS guildId, status FROM bot_support_threads WHERE id=?").bind(ticketId).first();
  if (!thread) return { error: "Conversation not found", status: 404 };
  if (thread.status !== "closed") return { error: "Close this conversation before deleting it", status: 409 };
  const createdAt = String(now || new Date().toISOString());
  await auditInsert(db, {
    id: crypto.randomUUID(),
    now: createdAt,
    action: "Conversation permanently deleted",
    actorId,
    guildId: thread.guildId,
    reference: ticketId,
    details: ""
  }).run();
  const userId = String(thread.userId || "");
  await runBatch(db, [
    db.prepare("DELETE FROM cc_notification_reads WHERE notification_id IN (SELECT n.id FROM cc_notifications n WHERE n.kind='support' AND n.scope='user' AND n.user_id=? AND n.dedupe_key IN (SELECT 'support:' || m.id FROM bot_support_messages m WHERE m.thread_id=?))").bind(userId, ticketId),
    db.prepare("DELETE FROM cc_notifications WHERE kind='support' AND scope='user' AND user_id=? AND dedupe_key IN (SELECT 'support:' || id FROM bot_support_messages WHERE thread_id=?)").bind(userId, ticketId),
    db.prepare("DELETE FROM bot_support_typing WHERE thread_id=?").bind(ticketId),
    db.prepare("DELETE FROM cc_support_feedback WHERE ticket_id=?").bind(ticketId),
    db.prepare("DELETE FROM bot_support_messages WHERE thread_id=? AND EXISTS (SELECT 1 FROM bot_support_threads WHERE id=? AND status='closed')").bind(ticketId, ticketId),
    db.prepare("DELETE FROM bot_support_threads WHERE id=? AND status='closed'").bind(ticketId)
  ]);
  const still = await db.prepare("SELECT id, status FROM bot_support_threads WHERE id=?").bind(ticketId).first();
  if (still) return { error: "Conversation was not deleted", status: 409 };
  return { ok: true, threadId: ticketId };
}
