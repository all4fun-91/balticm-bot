export const TYPING_TTL_MS = 4000;

export function isTypingFresh(updatedAt, nowMs, ttl = TYPING_TTL_MS) {
  const t = Date.parse(updatedAt || "");
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - t;
  return age >= 0 && age <= ttl;
}

export function incomingSupportSounds(previousIds, messages, ownSenderType) {
  const list = Array.isArray(messages) ? messages : [];
  const nextIds = list.map(m => String(m?.id || "")).filter(Boolean);
  if (!previousIds) return { nextIds, play: false };
  const known = new Set(previousIds);
  const play = list.some(m => m?.id && !known.has(String(m.id)) && m.senderType === "staff" && m.senderType !== ownSenderType);
  return { nextIds, play };
}

export function supportUnreadIncreases(previous, threads) {
  const next = {};
  for (const thread of threads || []) next[String(thread.id)] = Number(thread.unreadStaff || 0);
  if (!previous) return { next, play: false };
  let play = false;
  for (const id of Object.keys(next)) {
    if (next[id] > Number(previous[id] || 0)) play = true;
  }
  return { next, play };
}

export function isOpenSupportThread(thread) {
  return !!thread && thread.status !== "closed";
}

export function customerSupportView({ thread, humanMessages = [], aiMessages = [], staffTyping = false, markRead = false, pendingRating = null } = {}) {
  if (isOpenSupportThread(thread)) {
    const messages = [...aiMessages, ...humanMessages].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    return {
      mode: "human",
      thread: { ...thread, unreadUser: markRead ? 0 : Number(thread.unreadUser || 0) },
      messages,
      typing: { staff: !!staffTyping },
      pendingRating: null
    };
  }
  if (pendingRating?.ticketId) {
    return { mode: "rating", thread: null, messages: [], typing: { staff: false }, pendingRating: { ticketId: String(pendingRating.ticketId) } };
  }
  return { mode: "ai", thread: null, messages: aiMessages, typing: { staff: false }, pendingRating: null };
}

export function closeSupportThread(threads, threadId) {
  return (threads || []).map(thread => thread.id === threadId ? { ...thread, status: "closed" } : thread);
}

export function startHumanThread(threads, { userId, guildId = "", id }) {
  const open = (threads || []).find(thread => thread.userId === userId && thread.status !== "closed");
  if (open) return { threads: threads || [], thread: open, created: false };
  const thread = { id, userId, guildId, status: "waiting_staff", unreadUser: 0, unreadStaff: 1 };
  return { threads: [...(threads || []), thread], thread, created: true };
}

export function messagesForThread(messages, threadId) {
  return (messages || []).filter(message => message.threadId === threadId);
}

export function adminClosedThread(threads, messages, threadId) {
  const thread = (threads || []).find(item => item.id === threadId) || null;
  if (!thread) return null;
  return { thread, messages: messagesForThread(messages, threadId) };
}

let beepUrl = "";
let beep = null;
let notifyReg = null;

function wavDataUri(samples, sampleRate) {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true);
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return "data:audio/wav;base64," + btoa(binary);
}

function beepUrlOnce() {
  if (beepUrl) return beepUrl;
  const rate = 22050;
  const count = Math.floor(rate * 0.16);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const env = Math.exp(-t * 14);
    samples[i] = Math.max(-32767, Math.min(32767, Math.sin(2 * Math.PI * (740 - t * 1200) * t) * env * 9000));
  }
  beepUrl = wavDataUri(samples, rate);
  return beepUrl;
}

function playBeep() {
  try {
    if (typeof Audio === "undefined") return false;
    if (!beep) beep = new Audio(beepUrlOnce());
    beep.volume = 0.9;
    try { beep.currentTime = 0; } catch {}
    const started = beep.play();
    if (started && typeof started.catch === "function") started.catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function showBackgroundNotice() {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const options = { body: "New message", tag: "balticm-support-sound", silent: false };
    if (notifyReg && typeof notifyReg.showNotification === "function") {
      notifyReg.showNotification("BalticM Support", options).catch(() => {});
      return;
    }
    new Notification("BalticM Support", options);
  } catch {}
}

export function unlockSupportSound() {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default" && typeof Notification.requestPermission === "function") Notification.requestPermission().catch(() => {});
    if (typeof navigator !== "undefined" && navigator.serviceWorker && !notifyReg) {
      navigator.serviceWorker.register("/support-notify-sw.js").then(reg => { notifyReg = reg; }).catch(() => {});
    }
    if (typeof Audio !== "undefined") {
      if (!beep) beep = new Audio(beepUrlOnce());
      if (beep) {
        beep.volume = 0.0001;
        const primed = beep.play();
        if (primed && typeof primed.then === "function") primed.then(() => { try { beep.pause(); beep.currentTime = 0; beep.volume = 0.9; } catch {} }).catch(() => {});
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function playSupportSound() {
  const played = playBeep();
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  // Callers already dedupe to one new-message event; no renotify, so this never loops.
  if (hidden) showBackgroundNotice();
  return played;
}

export async function ensureTypingTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS bot_support_typing (
 thread_id TEXT NOT NULL,
 actor TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (thread_id, actor)
)`).run();
}

export async function setSupportTyping(db, threadId, actor, typing, nowIso) {
  await ensureTypingTable(db);
  const id = String(threadId || "");
  const who = actor === "staff" ? "staff" : "user";
  if (!id) return;
  if (!typing) {
    await db.prepare("DELETE FROM bot_support_typing WHERE thread_id=? AND actor=?").bind(id, who).run();
    return;
  }
  await db.prepare("INSERT INTO bot_support_typing (thread_id,actor,updated_at) VALUES (?,?,?) ON CONFLICT(thread_id,actor) DO UPDATE SET updated_at=excluded.updated_at").bind(id, who, nowIso || new Date().toISOString()).run();
}

export async function readSupportTyping(db, threadId, actor, nowMs = Date.now()) {
  await ensureTypingTable(db);
  const row = await db.prepare("SELECT updated_at AS updatedAt FROM bot_support_typing WHERE thread_id=? AND actor=?").bind(String(threadId || ""), actor === "staff" ? "staff" : "user").first();
  return isTypingFresh(row?.updatedAt, nowMs);
}
