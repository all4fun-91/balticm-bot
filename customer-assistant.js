export const SUPPORT_AI_MODEL = "@cf/zai-org/glm-4.7-flash";
export const DAILY_NEURON_BUDGET = 8000;
export const USER_DAILY_MODEL_CALLS = 20;
export const MAX_OUTPUT_TOKENS = 280;
export const NEURONS_PER_M_INPUT = 5500;
export const NEURONS_PER_M_OUTPUT = 36400;

const PAGES = ["Dashboard", "Servers", "Premium", "Settings", "Music Bot", "Direct Messages", "Reaction Roles", "Voice Create", "Bot Status", "Tickets"];

const MUSIC_DISCORD_COMMANDS = ["play", "join", "disconnect", "pause", "resume", "skip", "stop", "queue", "nowplaying", "np", "volume", "remove", "clear", "shuffle", "loop"];

function musicDiscordCommandNotes() {
  return "Music Bot Discord commands:\n" + MUSIC_DISCORD_COMMANDS.map(name => "/" + name).join("\n");
}

const SLICES = {
  setup: {
    id: "setup",
    page: "Servers",
    label: "Open Servers",
    body: "Connect Discord, then pick the server in Control Center. The bot must already be in that server. VIP servers can set a custom bot nickname, an https avatar URL (center-cropped), and up to 3 initials in Settings. Free servers keep the name BalticM.Eu and initials BM. Modules can be turned off per server; a disabled module returns Feature module is disabled."
  },
  premium: {
    id: "premium",
    page: "Premium",
    label: "Open Premium",
    body: "VIP is BalticM Bot VIP for 30 days at the list price €7.99. Buy or extend it on the Premium page. The checkout is the Tebex payment form inside Control Center. VIP starts only after Tebex confirms the payment, not when the page redirects. Coupons are applied by Tebex. Do not calculate tax or a discounted total yourself. VIP codes activate VIP only for FREE or EXPIRED servers. A server that already has active VIP must use Extend VIP, not a code."
  },
  limits: {
    id: "limits",
    page: "Premium",
    label: "Open Premium",
    body: "Free: Direct Messages can be sent to 1 recipient and cannot use embeds. Reaction Roles can have 4 linked roles. Voice Create can have 1 profile. VIP: bulk Direct Messages, embed DMs, unlimited Reaction Role links, and up to 5 Voice Create profiles. Free bot branding stays BalticM.Eu / BM. VIP can customize nickname, avatar URL, and initials."
  },
  commands: {
    id: "commands",
    page: "Music Bot",
    label: "Open Music Bot",
    body: musicDiscordCommandNotes() + "\n\nControl Center:\nOpen Music Bot to connect/disconnect voice, play a query, pause/resume, skip, stop, manage the queue and volume.\n\nSearch supports:\nAuto, YouTube and SoundCloud."
  },
  music: {
    id: "music",
    page: "Music Bot",
    label: "Open Music Bot",
    body: "Open Music Bot, choose the server, and connect the bot to a voice channel before playback. Control Center can play a query, pause/resume, skip, stop, manage the queue, and set volume from 0 to 200.\n\n" + musicDiscordCommandNotes() + "\n\n/play search supports Auto, YouTube and SoundCloud. If connect fails, check that the bot is in the server and the Music Bot module is enabled."
  },
  troubleshooting: {
    id: "troubleshooting",
    page: "Bot Status",
    label: "Open Bot Status",
    body: "Check Bot Status for Main Bot, Reaction Roles, Music Bot, and Voice Create. The bot must be in the selected server. If a module is disabled, its actions are blocked. Music needs a voice connection from the Music Bot page. Premium VIP appears after Tebex confirms payment, which can take a moment. If the notes here do not cover the problem, use Talk to Support in this same chat."
  }
};

const QUICK = { setup: "setup", premium: "premium", commands: "commands", troubleshooting: "troubleshooting" };

const KEYWORDS = [
  ["premium", ["vip", "premium", "price", "€", "euro", "coupon", "checkout", "extend", "buy", "code", "tebex", "subscription"]],
  ["limits", ["dm", "direct message", "embed", "reaction role", "voice create", "free", "limit", "channel"]],
  ["music", ["music", "song", "queue", "volume", "skip", "pause", "youtube", "soundcloud", "voice channel", "play"]],
  ["commands", ["command", "slash", "nowplaying", "shuffle", "loop"]],
  ["troubleshooting", ["error", "broken", "not working", "offline", "fail", "failed", "stuck", "problem", "help", "bug"]],
  ["setup", ["setup", "invite", "install", "nickname", "avatar", "initials", "settings", "server"]]
];

export function isQuickAction(value) {
  return Object.prototype.hasOwnProperty.call(QUICK, String(value || ""));
}

export function quickLabel(id) {
  return { setup: "Setup Bot", premium: "Premium", commands: "Commands", troubleshooting: "Troubleshooting" }[id] || "Question";
}

export function selectKnowledge({ page = "", text = "", quickAction = "" } = {}) {
  const quick = QUICK[String(quickAction || "")];
  if (quick) return SLICES[quick];
  const scores = Object.fromEntries(Object.keys(SLICES).map(id => [id, 0]));
  const pageName = String(page || "");
  if (pageName === "Premium") scores.premium += 3;
  else if (pageName === "Music Bot") scores.music += 3;
  else if (pageName === "Direct Messages" || pageName === "Reaction Roles" || pageName === "Voice Create") scores.limits += 3;
  else if (pageName === "Settings" || pageName === "Servers") scores.setup += 3;
  else if (pageName === "Bot Status" || pageName === "Logs") scores.troubleshooting += 3;
  const hay = String(text || "").toLowerCase();
  for (const [id, words] of KEYWORDS) {
    for (const word of words) if (hay.includes(word)) scores[id] += 2;
  }
  let best = "setup";
  let bestScore = -1;
  for (const id of Object.keys(scores)) {
    if (scores[id] > bestScore) {
      best = id;
      bestScore = scores[id];
    }
  }
  return SLICES[best];
}

export function wantsHuman(text) {
  return /(talk to (support|a human|human|staff|someone)|human help|real person|live agent|speak to (support|a human|someone)|mitarbeiter|echten menschen|человек|оператор|живой оператор|cilvēk|cilveks)/i.test(String(text || ""));
}

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

export function estimateNeurons(inputTokens, outputTokens) {
  const input = Math.max(0, Number(inputTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);
  return Math.ceil((input * NEURONS_PER_M_INPUT + output * NEURONS_PER_M_OUTPUT) / 1_000_000);
}

export function reserveNeuronsFor(messages) {
  const input = estimateTokens((messages || []).map(m => m?.content || "").join("\n"));
  return estimateNeurons(input, MAX_OUTPUT_TOKENS);
}

export function canSpend({ neuronsUsed = 0, userCalls = 0, reserveNeurons = 1 } = {}) {
  if (Number(userCalls) >= USER_DAILY_MODEL_CALLS) return false;
  if (Number(neuronsUsed) + Number(reserveNeurons) > DAILY_NEURON_BUDGET) return false;
  return true;
}

export function supportMessageParts(text) {
  const value = String(text || "");
  const known = new Set(MUSIC_DISCORD_COMMANDS);
  const parts = [];
  const re = /(^|[^/\w<])(\/[a-z][a-z0-9]{0,31})(?![a-z0-9/])/gi;
  let last = 0;
  for (const match of value.matchAll(re)) {
    const start = match.index + match[1].length;
    const command = match[2];
    if (!known.has(command.slice(1).toLowerCase())) continue;
    if (start > last) parts.push({ type: "text", value: value.slice(last, start) });
    parts.push({ type: "command", value: command });
    last = start + command.length;
  }
  if (last < value.length || !parts.length) parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

export function fallbackFromSlice(slice) {
  const body = String(slice?.body || "").trim();
  return body + "\n\nIf this does not solve it, use Talk to Support in this chat.";
}

export function sanitizeAssistantReply(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (/(sk-[a-z0-9]{8,}|api[_-]?key\s*[:=]|session_secret|tebex_webhook|begin private|discord_bot_token|workers\.dev)/i.test(value)) return "";
  return value.slice(0, 1200);
}

export function buildModelMessages({ slice, history = [], page = "", text = "" }) {
  const notes = String(slice?.body || "");
  const system = [
    "You are BalticM AI Assistant inside the existing BalticM Support chat.",
    "Answer only from NOTES. Reply in the customer's language: English, German, Latvian, or Russian.",
    "If NOTES do not contain the answer, say you do not have that detail and mention Talk to Support.",
    "Do not invent prices, limits, commands, or policies. Do not mention API keys, tokens, or other customers.",
    "When NOTES name a Discord command, keep the leading slash, such as /play. Control Center steps are not slash commands.",
    "Keep the reply under 90 words. Current page: " + (page || "Dashboard") + ".",
    "NOTES:",
    notes
  ].join("\n");
  const messages = [{ role: "system", content: system }];
  for (const turn of history.slice(-4)) {
    const role = turn?.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content: String(turn?.content || "").slice(0, 400) });
  }
  messages.push({ role: "user", content: String(text || "").slice(0, 500) });
  return messages;
}

export function readModelText(result) {
  if (!result || typeof result !== "object") return "";
  if (typeof result.response === "string") return result.response;
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => part?.text || part?.content || "").join("");
  return "";
}

export function readModelUsage(result) {
  const usage = result?.usage || {};
  return {
    input: Number(usage.prompt_tokens || usage.input_tokens || 0) || 0,
    output: Number(usage.completion_tokens || usage.output_tokens || 0) || 0
  };
}

export function handoffSummary(messages) {
  const questions = (messages || []).filter(m => m?.senderType === "user").map(m => String(m.message || "").trim()).filter(Boolean).slice(-4);
  const body = questions.join("\n").slice(0, 1200);
  return body ? "Talk to Support.\n" + body : "Talk to Support.";
}

export function assistantAction(slice) {
  if (!slice?.page || !PAGES.includes(slice.page)) return null;
  return { page: slice.page, label: slice.label || "Open" };
}

export async function ensureCustomerAssistantTables(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS cc_assistant_budget (day TEXT PRIMARY KEY, neurons INTEGER NOT NULL DEFAULT 0)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS cc_assistant_user_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS cc_support_ai_messages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, action_page TEXT DEFAULT '', action_label TEXT DEFAULT '', created_at TEXT NOT NULL, session_id TEXT NOT NULL DEFAULT '')").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_cc_support_ai_user ON cc_support_ai_messages(user_id, created_at)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS cc_support_ai_session (user_id TEXT PRIMARY KEY, session_id TEXT NOT NULL)").run();
  try { await db.prepare("ALTER TABLE cc_support_ai_messages ADD COLUMN session_id TEXT NOT NULL DEFAULT ''").run(); } catch {}
}

export async function currentAiSessionId(db, userId) {
  await ensureCustomerAssistantTables(db);
  const id = String(userId || "");
  const row = await db.prepare("SELECT session_id AS sessionId FROM cc_support_ai_session WHERE user_id=?").bind(id).first();
  if (row?.sessionId) return String(row.sessionId);
  const sessionId = crypto.randomUUID();
  await db.prepare("INSERT INTO cc_support_ai_session (user_id, session_id) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING").bind(id, sessionId).run();
  const again = await db.prepare("SELECT session_id AS sessionId FROM cc_support_ai_session WHERE user_id=?").bind(id).first();
  return String(again?.sessionId || sessionId);
}

export async function rotateCustomerAiSession(db, userId) {
  await ensureCustomerAssistantTables(db);
  const sessionId = crypto.randomUUID();
  await db.prepare("INSERT INTO cc_support_ai_session (user_id, session_id) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id").bind(String(userId || ""), sessionId).run();
  return sessionId;
}

export async function insertCustomerAiMessage(db, row) {
  await ensureCustomerAssistantTables(db);
  const sessionId = row.sessionId || await currentAiSessionId(db, row.userId);
  await db.prepare("INSERT INTO cc_support_ai_messages (id,user_id,role,content,action_page,action_label,created_at,session_id) VALUES (?,?,?,?,?,?,?,?)").bind(row.id, row.userId, row.role, row.content, row.actionPage || "", row.actionLabel || "", row.createdAt, sessionId).run();
}

function mapAiRow(row, userId) {
  return {
    id: row.id,
    threadId: "",
    senderType: row.role === "assistant" ? "assistant" : "user",
    senderId: row.role === "assistant" ? "" : String(userId),
    senderName: row.role === "assistant" ? "BalticM AI Assistant" : "",
    message: row.content,
    createdAt: row.createdAt,
    actionPage: row.actionPage || "",
    actionLabel: row.actionLabel || ""
  };
}

export async function listCustomerAiMessages(db, userId) {
  await ensureCustomerAssistantTables(db);
  const sessionId = await currentAiSessionId(db, userId);
  const r = await db.prepare("SELECT id, role, content, action_page AS actionPage, action_label AS actionLabel, created_at AS createdAt FROM cc_support_ai_messages WHERE user_id=? AND session_id=? ORDER BY created_at ASC LIMIT 80").bind(String(userId), sessionId).all();
  return (r.results || []).map(row => mapAiRow(row, userId));
}

export async function recentAiTurns(db, userId) {
  await ensureCustomerAssistantTables(db);
  const sessionId = await currentAiSessionId(db, userId);
  const r = await db.prepare("SELECT id, role, content, created_at AS createdAt FROM cc_support_ai_messages WHERE user_id=? AND session_id=? ORDER BY created_at DESC LIMIT 8").bind(String(userId), sessionId).all();
  return (r.results || []).slice().reverse();
}

export async function reserveAssistantBudget(db, { userId, day, neurons, budget = DAILY_NEURON_BUDGET, userLimit = USER_DAILY_MODEL_CALLS }) {
  await ensureCustomerAssistantTables(db);
  const budgetWrite = await db.prepare("INSERT INTO cc_assistant_budget (day, neurons) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET neurons=neurons+excluded.neurons WHERE neurons+excluded.neurons<=?").bind(day, neurons, budget).run();
  if (!budgetWrite?.meta?.changes) return false;
  const userWrite = await db.prepare("INSERT INTO cc_assistant_user_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count=count+1 WHERE count+1<=?").bind(userId, day, userLimit).run();
  if (!userWrite?.meta?.changes) {
    await db.prepare("UPDATE cc_assistant_budget SET neurons=MAX(0, neurons-?) WHERE day=?").bind(neurons, day).run();
    return false;
  }
  return true;
}

export async function releaseAssistantBudget(db, { userId, day, neurons = 0, releaseCall = false }) {
  if (neurons > 0) await db.prepare("UPDATE cc_assistant_budget SET neurons=MAX(0, neurons-?) WHERE day=?").bind(neurons, day).run();
  if (releaseCall) await db.prepare("UPDATE cc_assistant_user_usage SET count=MAX(0, count-1) WHERE user_id=? AND day=?").bind(userId, day).run();
}
