import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const panel = read("src/AdminPanel.jsx");
const modules = read("src/admin-modules.jsx");
const css = read("src/admin.css");
const main = read("src/main.jsx");
const worker = read("worker.js");

test("admin access gate is enforced before any admin UI renders", () => {
  assert.match(panel, /fetch\("\/api\/admin\/access"/);
  // Denied state must render the access-denied gate, never module content.
  assert.match(panel, /if\(!access\)return <div className="adminGate">/);
  assert.match(panel, /Access denied/);
  assert.match(panel, /This area is restricted to BalticM staff\./);
  // Loading state must not be treated as authorized.
  assert.match(panel, /if\(access===null\)return <div className="adminGate">/);
  // 403 on any admin fetch drops the session out of the panel.
  assert.match(panel, /if\(r\.status===403\)\{setAccess\(false\);return\}/);
  // Unauthorized visitors are sent back to the public Control Center.
  assert.match(panel, /href="\/">.*Back to Control Center/);
});

test("worker admin authorization is untouched and covers every admin API", () => {
  assert.match(worker, /function isBalticMAdmin\(env,user\)\{const ids=String\(env\.BALTICM_ADMIN_DISCORD_IDS/);
  assert.match(worker, /function adminDenied\(env,user\)\{return isBalticMAdmin\(env,user\)\?null:json\(\{error:"Forbidden"\},403\)\}/);
  for (const fn of [
    "adminSupportThreads","adminSupportThread","adminSupportReply","adminSupportStatus",
    "adminSubscriptionsList","adminSubscriptionAction","adminTebexOverview",
    "adminSettingsOverview","adminLogsList","adminVipCodesList","adminVipCodeCreate",
    "adminAssistantAsk","adminNotificationsList"
  ]) {
    const at = worker.indexOf(`async function ${fn}`);
    assert.ok(at > -1, `${fn} is missing`);
    const seg = worker.slice(at, at + 400);
    assert.match(seg, /adminDenied\(env,user\)/, `${fn} must call adminDenied`);
  }
  // Route dispatch for /api/admin/discord/commands stays admin-gated.
  assert.match(worker, /p==="\/api\/admin\/discord\/commands"&&req\.method==="GET"\)\{const denied=adminDenied\(env,user\)/);
  // Admin route count must not shrink relative to adminDenied call sites.
  const routes = (worker.match(/p==="\/api\/admin\//g) || []).length;
  assert.ok(routes >= 20, `expected >=20 admin routes, found ${routes}`);
  assert.ok((worker.match(/adminDenied\(env,user\)/g) || []).length >= routes - 1);
});

test("admin surface is mounted only on /admin routes", () => {
  assert.match(main, /if\(isAdminRoute\)return <AdminPanel\/>/);
  assert.match(main, /const isAdminRoute=window\.location\.pathname==="\/admin"\|\|window\.location\.pathname\.startsWith\("\/admin\/"\)/);
});

test("every admin section is present in navigation and rendered", () => {
  const nav = panel.match(/const nav=\[(.*?)\];/s);
  assert.ok(nav, "nav array missing");
  for (const name of ["Dashboard","Support Inbox","Subscriptions","Codes","Tebex","Assistant","Logs","Settings"]) {
    assert.ok(nav[1].includes(`"${name}"`), `${name} missing from nav`);
  }
  // Control Center link is preserved.
  assert.match(panel, /<a href="\/">[\s\S]{0,40}Control Center<\/a>/);
  // Module sections all render.
  for (const name of ["SubscriptionsModule","CodesModule","TebexModule","AssistantModule","LogsModule","SettingsModule"]) {
    assert.ok(modules.includes(`export function ${name}`), `${name} missing`);
  }
  assert.doesNotMatch(panel, /\bSOON\b|reserved for the next stage/i);
});

test("mobile navigation drawer opens, closes and preserves the current section", () => {
  // Header menu button exists with accessible naming.
  assert.match(panel, /className="adminMenuBtn"[^>]*aria-label="Open navigation"/);
  assert.match(panel, /aria-expanded=\{drawer\}/);
  assert.match(panel, /aria-controls="adminNav"/);
  // Backdrop tap closes.
  assert.match(panel, /className="adminNavBackdrop" onClick=\{\(\)=>setDrawer\(false\)\}/);
  // Explicit X close button exists.
  assert.match(panel, /className="adminNavClose" aria-label="Close navigation" onClick=\{\(\)=>setDrawer\(false\)\}/);
  // Escape closes the drawer and body scroll is locked while open.
  assert.match(panel, /e\.key==="Escape"\)setDrawer\(false\)/);
  assert.match(panel, /document\.body\.style\.overflow="hidden"/);
  // Selecting a page closes the drawer and keeps the chosen section (no reload / route change).
  assert.match(panel, /const goSection=next=>\{setSection\(next\);setDrawer\(false\)/);
  assert.doesNotMatch(panel, /window\.location\.(href|assign|replace)\s*=/);
  assert.doesNotMatch(panel, /location\.reload\(/);
  // Nav button markup carries the active state for the current section.
  assert.match(panel, /className=\{section===n\?"active":""\}/);
  assert.match(panel, /aria-current=\{section===n\?"page":undefined\}/);
});

test("support inbox keeps the split desktop layout and adds a mobile list/chat flow", () => {
  assert.match(panel, /className=\{"adminSupport"\+\(chatOpen\?" showChat":""\)\}/);
  // Back control returns to the conversation list on mobile.
  assert.match(panel, /className="adminChatBack"[^>]*onClick=\{\(\)=>setChatOpen\(false\)\}/);
  assert.match(panel, /<ArrowLeft\/>Conversations/);
  // Thread selection opens the conversation view.
  assert.match(panel, /onClick=\{\(\)=>\{setSelected\(t\.id\);setChatOpen\(true\)\}\}/);
  // Reply composer and status actions are preserved.
  assert.match(panel, /api\/admin\/support\/reply/);
  assert.match(panel, /api\/admin\/support\/status/);
  assert.match(panel, /Waiting for staff/);
  assert.match(panel, /Waiting for customer/);
  assert.match(panel, /Reopen/);
  assert.match(panel, /maxLength=\{2000\}/);
  assert.match(panel, /aria-label="Send reply"/);
});

test("dashboard only shows statistics derived from existing admin APIs", () => {
  // Open support + unread come from the support threads payload already loaded.
  assert.match(panel, /threads\.filter\(t=>t\.status!=="closed"\)\.length/);
  assert.match(panel, /threads\.reduce\(\(n,t\)=>n\+Number\(t\.unreadStaff||0\),0\)/);
  // Service status comes from the existing public health endpoint.
  assert.match(panel, /fetch\("\/api\/health"/);
  // Active VIP comes from the existing subscriptions admin API.
  assert.match(panel, /fetch\("\/api\/admin\/subscriptions\?q="/);
  assert.match(panel, /\.filter\(r=>r\.status==="ACTIVE"\)\.length/);
  // No invented numbers: every stat is a computed count of real data.
  assert.doesNotMatch(panel, /Math\.random|lorem ipsum|demo data|mock data/i);
});

test("subscriptions search and grant/extend/revoke actions are preserved", () => {
  assert.match(modules, /\/api\/admin\/subscriptions\?q=/);
  assert.match(modules, /\/api\/admin\/subscriptions\/\$\{action\}/);
  for (const action of ["grant","extend","revoke"]) {
    assert.match(modules, new RegExp(`change\\(r,"${action}"\\)`), `${action} action missing`);
  }
  // Revoke stays behind an explicit confirmation.
  assert.match(modules, /window\.confirm\(`Revoke VIP from /);
  assert.match(modules, /window\.prompt\(/);
});

test("vip code create, history, disable and delete actions are preserved with confirmations", () => {
  assert.match(modules, /"\/api\/admin\/vip-codes"/);
  assert.match(modules, /\/api\/admin\/vip-codes\/\$\{encodeURIComponent\(code\.id\)\}\/history/);
  assert.match(modules, /method:"PATCH"/);
  assert.match(modules, /method:"DELETE"/);
  assert.match(modules, /showHistory\(r\)/);
  assert.match(modules, /\{r\.status==="active"\?"Disable":"Enable"\}/);
  // Destructive actions confirm before firing.
  assert.match(modules, /window\.confirm\(`Disable code /);
  assert.match(modules, /window\.confirm\(`Delete /);
  // Form fields are preserved.
  for (const field of ["codeMode","durationPreset","maxRedemptions","expiresAt"]) {
    assert.ok(modules.includes(field), `${field} field missing`);
  }
});

test("tebex overview keeps status, package, webhook, payments and events", () => {
  assert.match(modules, /"\/api\/admin\/tebex"/);
  for (const key of ["statusLabel","packageName","packageId","lastReceivedAt","payments","webhookEvents"]) {
    assert.ok(modules.includes(key), `${key} missing from Tebex module`);
  }
  for (const col of ["REFERENCE","DISCORD USER","SERVER","AMOUNT","STATUS"]) {
    assert.ok(modules.includes(col), `${col} column missing`);
  }
  // Payments are name-first: the raw ids stay secondary.
  assert.match(modules, /key:"discordUserId",label:"DISCORD USER",render:r=><NameId name=\{r\.discordUserName\} id=\{r\.discordUserId\}\/>/);
  assert.match(modules, /key:"guildId",label:"SERVER",render:r=><NameId name=\{r\.guildName\} id=\{r\.guildId\}\/>/);
});

test("admin tables show readable names first with raw discord ids as secondary", () => {
  // Shared name-first cell: readable name primary, snowflake as muted secondary + tooltip.
  assert.match(modules, /function NameId\(\{name,id\}\)/);
  assert.match(modules, /if\(!label\|\|label===raw\)return raw\?<span className="adminMono" title=\{raw\}>\{raw\}<\/span>:"—";/);
  assert.match(modules, /small className="adminCellSub" title=\{raw\}/);
  // Logs render the resolved actor and server names, never the bare id alone.
  assert.match(modules, /key:"actorDiscordId",label:"ACTOR",render:r=><NameId name=\{r\.actorLabel\} id=\{r\.actorDiscordId\}\/>/);
  assert.match(modules, /key:"guildId",label:"SERVER",render:r=><NameId name=\{r\.guildLabel\} id=\{r\.guildId\}\/>/);
  // Redemption history reuses the same cell.
  assert.match(modules, /label:"USER",render:r=><NameId name=\{r\.discordUsername\} id=\{r\.discordUserId\}\/>/);
  // References that are discord snowflakes resolve too; anything else stays as-is.
  assert.match(modules, /label:"REFERENCE",render:r=><NameId name=\{r\.referenceLabel\} id=\{r\.reference\}\/>/);
  // Support keeps the conversation id as muted metadata under the name.
  assert.match(panel, /className="adminIdMuted" title=\{thread\.thread\.userId\}/);
  // The frontend never calls Discord itself for names — resolution is server-side.
  assert.doesNotMatch(modules, /discord\.com\/api/);
  assert.doesNotMatch(panel, /discord\.com\/api/);
});

test("worker resolves admin names from stored rows first, with bounded cached lookups", () => {
  const logs = read("admin-logs.js");
  const names = read("admin-names.js");
  // Names already stored in the database are selected instead of bare ids.
  assert.match(worker, /actor_name AS actorName/);
  assert.match(worker, /sender_name AS senderName/);
  assert.match(worker, /discord_username AS discordUsername/);
  assert.match(logs, /actorLabel: String\(actorLabel \|\| ""\)\.trim\(\)/);
  assert.match(names, /export function applyAdminLogNames/);
  assert.match(names, /export function adminNameGaps/);
  // Remote resolution is bounded and TTL-cached — never a per-render fan-out.
  assert.match(worker, /const ADMIN_DISPLAY_NAME_TTL=10\*60\*1000;/);
  assert.match(worker, /ADMIN_NAME_LOOKUP_USER_LIMIT=10/);
  assert.match(worker, /ADMIN_NAME_LOOKUP_GUILD_LIMIT=6/);
  assert.match(worker, /loadAdminStoredNameMaps/);
  // Gating is untouched: enrichment runs inside already admin-gated handlers.
  assert.match(worker, /async function adminLogsList\(req,env,user\)\{\s*const denied=adminDenied\(env,user\)/);
  assert.match(worker, /async function adminTebexOverview\(env,user\)\{\s*const denied=adminDenied\(env,user\)/);
});

test("assistant stays read-only behind its own endpoint", () => {
  const at = modules.indexOf("export function AssistantModule");
  const end = modules.indexOf("export function LogsModule");
  const body = modules.slice(at, end);
  assert.ok(at > -1 && end > at, "AssistantModule section not found");
  assert.match(body, /"\/api\/admin\/assistant"/);
  // Read-only: no writes to any mutating admin endpoint from the assistant.
  assert.doesNotMatch(body, /method:"(POST|PUT|PATCH|DELETE)"[^]*?\/api\/admin\/(?!assistant)/);
  assert.doesNotMatch(body, /\/api\/admin\/(vip-codes|subscriptions|logs|settings|tebex)/);
  assert.match(body, /READ-ONLY PLATFORM ASSISTANT/);
  assert.match(body, /BalticM Admin Assistant/);
  // Quick prompts are preserved.
  for (const p of ["Platform status","Recent errors","Recent payments","VIP activity","Support overview"]) {
    assert.ok(body.includes(`"${p}"`), `${p} quick prompt missing`);
  }
});

test("logs filtering by query, category and status is preserved", () => {
  assert.match(modules, /\/api\/admin\/logs\?q=\$\{encodeURIComponent\(query\)\}&category=\$\{encodeURIComponent\(category\)\}&status=\$\{encodeURIComponent\(status\)\}/);
  assert.match(modules, /id="admin-logs-q"/);
  assert.match(modules, /id="admin-logs-cat"/);
  assert.match(modules, /id="admin-logs-status"/);
  assert.match(modules, /All categories/);
  assert.match(modules, /placeholder="Status or all"/);
});

test("settings remains read-only production status", () => {
  const at = modules.indexOf("export function SettingsModule");
  const body = modules.slice(at);
  assert.ok(at > -1);
  assert.match(body, /"\/api\/admin\/settings"/);
  assert.match(body, /adminReadonly/);
  assert.match(body, /Read-only production configuration/);
  // Settings module issues no writes at all.
  assert.doesNotMatch(body, /method:"(POST|PUT|PATCH|DELETE)"/);
  for (const key of ["VIP LIMITS","SERVICE HEALTH","ENVIRONMENT","DATABASE","TEBEX"]) {
    assert.ok(body.includes(key), `${key} card missing`);
  }
  // Credentials are reported as presence only.
  assert.match(body, /Credentials shown as presence only/);
});

test("shared responsive table/card system renders one layout at a time", () => {
  assert.match(modules, /function useIsMobile\(\)/);
  assert.match(modules, /max-width: 760px/);
  // Single renderer used by every page — no duplicated per-page table logic.
  assert.match(modules, /function Table\(\{columns,rows,empty=.*cardTitle.*\}\)/);
  const tableUsages = modules.match(/<Table /g) || [];
  assert.ok(tableUsages.length >= 6, `expected >=6 shared Table usages, found ${tableUsages.length}`);
  // The narrow layout is card markup with the same columns/actions.
  assert.match(modules, /className="adminCards"/);
  assert.match(modules, /className="adminCard"/);
  assert.match(modules, /className="adminCardActions"/);
  // Cards and table derive from the same column render functions.
  assert.match(modules, /function cell\(row,column\)\{return column\.render\?column\.render\(row\)/);
});

test("admin error copy is human-readable, never raw Forbidden/500/[object Object]", () => {
  assert.match(modules, /function errorText\(status,raw\)/);
  assert.match(modules, /if\(status===403\)return"You do not have permission to do that\.";/);
  assert.match(modules, /if\(status>=500\)return"The server could not complete that request\. Please try again\.";/);
  assert.match(modules, /text!=="\[object Object\]"/);
  assert.match(modules, /!\/\^\\d\{3\}\$\/\.test\(text\)/);
  // api() routes every failure through the friendly mapper.
  assert.match(modules, /throw new Error\(errorText\(response\.status,data&&data\.error\)\)/);
  // Raw status strings must never be thrown to the UI as the message.
  assert.doesNotMatch(modules, /Request failed \(/);
  // The panel maps its own fetch failures through a friendly mapper too.
  assert.match(panel, /const humanError=\(status,raw\)=>\{/);
  assert.match(panel, /setSupportError\(humanError\(r\.status,j\.error\)\)/);
  assert.match(panel, /if\(status===403\)return"You do not have permission to do that\.";/);
});

test("admin control surfaces use a consistent button hierarchy", () => {
  assert.match(css, /\.adminModule button\{[^}]*min-height:40px/);
  assert.match(css, /\.adminModule button\.primary\{[^}]*#6d28d9/);
  assert.match(css, /\.adminModule button\.danger\{[^}]*#ef4444/);
  // Destructive buttons stay visually distinct.
  assert.match(css, /\.adminStatusActions button\.danger\{/);
  assert.match(css, /\.adminRowActions button/);
  // Focus states are visible for keyboard users.
  assert.match(css, /:focus-visible\{outline:2px solid #a78bfa/);
  // Icon-only buttons in the panel expose labels.
  assert.match(modules, /aria-label=\{`Delete code \$\{r\.code\}`\}/);
  assert.match(modules, /aria-label=\{`Copy code \$\{r\.code\}`\}/);
  assert.match(modules, /aria-label="Close history"/);
});

test("admin responsive rules cover desktop, tablet and narrow mobile", () => {
  for (const bp of ["1500px","1200px","900px","760px","380px"]) {
    assert.ok(css.includes(`max-width:${bp}`), `breakpoint ${bp} missing`);
  }
  // Sidebar becomes a drawer on small screens.
  assert.match(css, /@media\(max-width:900px\)\{[\s\S]*?\.adminSide\{[\s\S]*?transform:translateX\(-102%\)/);
  assert.match(css, /\.adminSide\.open\{transform:translateX\(0\);visibility:visible\}/);
  // Mobile header is hidden on desktop and shown in the drawer breakpoint.
  assert.match(css, /\.adminMobileBar\{display:none\}/);
  // Stat cards step 4 -> 2 -> 1 columns.
  assert.match(css, /\.adminStatGrid\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:1200px\)\{[\s\S]*?\.adminStatGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:380px\)\{[\s\S]*?\.adminStatGrid\{grid-template-columns:minmax\(0,1fr\)\}/);
  // Long ids wrap instead of overflowing.
  assert.match(css, /\.adminMono\{[\s\S]*?overflow-wrap:anywhere/);
  assert.match(css, /\.adminCardField\{[\s\S]*?overflow-wrap:anywhere/);
  // Content column uses available width with a sane cap.
  assert.match(css, /\.adminMain\{[^}]*max-width:1680px/);
  // Touch targets grow on mobile.
  assert.match(css, /@media\(max-width:760px\)\{[\s\S]*?\.adminModule input,\.adminModule select\{min-height:46px/);
});

test("admin styles stay scoped to admin classes and never touch the public Control Center", () => {
  // No element-level page selectors that would restyle the public site.
  assert.doesNotMatch(css, /(^|\})(html|body|#root)[,{]/m);
  // Every top-level selector starts with .admin (media/at-rules and shared resets aside).
  const stripped = css
    .replace(/@media[^{]+\{/g, "")
    .replace(/@keyframes[^{]+\{[^]*?\n\}/g, "");
  const selectors = stripped
    .split("}")
    .map(s => s.split("{")[0].trim())
    .filter(s => s && !s.startsWith("@") && !s.startsWith("/*") && !s.startsWith("*"));
  for (const sel of selectors) {
    for (const part of sel.split(",").map(x => x.trim())) {
      assert.match(part, /^\.admin|^\.spin|^a\.admin/, `non-admin selector in admin.css: ${part}`);
    }
  }
  // The admin stylesheet defines no public CC layout classes.
  for (const cls of ["topbar","sidebar","workspace","dashboardGrid","controlCard","servercard"]) {
    assert.ok(!css.includes(`.${cls}`), `admin.css must not style public class .${cls}`);
  }
});

test("no secrets, tokens or credentials are exposed in the admin frontend", () => {
  for (const src of [panel, modules, css]) {
    assert.doesNotMatch(src, /BALTICM_ADMIN_DISCORD_IDS/);
    assert.doesNotMatch(src, /DISCORD_TOKEN|DISCORD_CLIENT_SECRET|SESSION_SECRET|TEBEX_SECRET|API_KEY|Bearer\s+[A-Za-z0-9]/i);
    assert.doesNotMatch(src, /process\.env|env\.[A-Z_]{6,}/);
  }
  // Admin identity allowlist stays server-side only.
  assert.ok(worker.includes("BALTICM_ADMIN_DISCORD_IDS"));
  assert.ok(!modules.includes("BALTICM_ADMIN_DISCORD_IDS"));
  assert.ok(!panel.includes("BALTICM_ADMIN_DISCORD_IDS"));
  // Built bundle must not contain server-only config names.
  const dist = new URL("../dist/assets/", import.meta.url);
  if (fs.existsSync(dist)) {
    for (const f of fs.readdirSync(dist)) {
      if (!/\.(js|css)$/.test(f)) continue;
      const body = fs.readFileSync(new URL(f, dist), "utf8");
      assert.doesNotMatch(body, /BALTICM_ADMIN_DISCORD_IDS/, `${f} leaks admin allowlist`);
      assert.doesNotMatch(body, /DISCORD_CLIENT_SECRET\s*[:=]\s*"[^"]+/, `${f} leaks client secret`);
    }
  }
});

test("public Control Center sidebar/navigation tests still pin the original markup", () => {
  // Guard: admin work must not have rewritten the public app entry or its CSS.
  assert.match(main, /import AdminPanel from"\.\/AdminPanel\.jsx"/);
  assert.ok(main.length > 150000, "main.jsx unexpectedly truncated");
  assert.ok(css.length > 20000, "admin.css unexpectedly small");
});
