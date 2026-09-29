import { buildPremiumViewModel, buildSubscriptionRow, computeExtendVip, computeGrantVip, computeRevokeVip, dmRecipientLimitError, matchesSubscriptionSearch, reactionRoleLimitError, reactionRoleMaxLinks, voiceCreateLimitError, voiceCreateMaxChannels } from "./admin-subscriptions.js";
import { assessTempRoomAction, forgetVoiceRoom, isSnowflake, missingVoicePermissions, normalizeVoiceRooms, prepareVoiceProfiles, rememberVoiceRoom, resolveChannelPermissions, runVoiceDiscord, tempRoomPatch, voicePermissionError } from "./voice-create.js";
import {
  VIP_CODE_ERROR,
  evaluateVipCodeRedeem,
  generateVipCode,
  isAcceptableVipCode,
  isRejectedTebexCoupon,
  normalizeCodeStatus,
  normalizeVipCode,
  parseCodeDurationDays,
  parseCustomVipCode
} from "./vip-codes.js";
import {
  BOT_APP_DESCRIPTION,
  BOT_AVATAR_SIZE,
  FREE_BOT_AVATAR_URL,
  FREE_BOT_INITIALS,
  FREE_BOT_NICKNAME,
  MAX_BOT_AVATAR_BYTES,
  discordBotNickForPlan,
  guildMemberAvatarUrl,
  isHttpsImageUrl,
  resolveGeneralBranding,
  validateBotAvatarDataUri
} from "./general-settings.js";
import {
  TEBEX_VIP_DAYS,
  decideTebexVipExtend,
  extractTebexVipPurchase,
  mapTebexPaymentStatus,
  resolveManageableGuildId,
  shouldRevokeVipOnTebexType,
  summarizeTebexBasket,
  tebexApiErrorMessage
} from "./tebex-vip.js";
import {
  TEBEX_VIP_PACKAGE_NAME,
  buildTebexConfigStatus,
  buildTebexWebhookCard,
  formatTebexPaymentRow,
  formatTebexWebhookEventRow
} from "./admin-tebex.js";
import {
  ADMIN_LOG_CATEGORIES,
  buildEmptyCategoryNotes,
  logRowFromActivity,
  logRowFromAudit,
  logRowFromPayment,
  logRowFromSupportMessage,
  logRowFromVipCodeCreate,
  logRowFromVipCodeRedeem,
  logRowFromWebhookEvent,
  mergeAdminLogRows
} from "./admin-logs.js";
import {
  ACCESS_CONFIGURE,
  ACCESS_KEYS,
  ACCESS_NONE,
  ACCESS_OPERATE,
  accessLevelFromRoles,
  levelMeets,
  memberHasDiscordGuildManager,
  memberRoleIdsForAccess,
  normalizeAccessConfig,
  oauthGuildHasManageAccess,
  requiredLevelForRequest,
  routeAccessKey,
  decideGuildVisibility
} from "./access-control.js";
import {
  STREAMERS_ALTER_SQL,
  STREAMERS_TABLE_SQL,
  STREAMERS_MAX_PER_GUILD,
  STREAMERS_DELETE_MAX_ATTEMPTS,
  STREAMER_SETTINGS_KEY,
  STREAMER_SOURCE_AUTO,
  STREAMER_SOURCE_OWNER,
  USER_STREAMING_ACCOUNTS_TABLE_SQL,
  applyLiveCheckToRow,
  buildLiveAnnouncementPayload,
  checkProviderLive,
  decideProfileStreamingMutation,
  decideStreamerStudioMutation,
  defaultStreamerSettings,
  discordAnnouncementGone,
  discordChannelAllowed,
  duplicateStreamerError,
  liveDetectionAvailable,
  mapProfileAccountRow,
  mapStreamerRow,
  isStreamerSnowflake,
  normalizeStreamerSource,
  parseStreamerConfigBody,
  parseStreamerSettingsBody,
  providerCapabilities,
  shouldAnnounceLive,
  shouldDeleteLiveAnnouncement,
  shouldPauseAutoStreamerAutomation,
  shouldRemoveAutoGuildParticipation,
  streamerAnnouncementError,
  streamerPublicView,
  summarizeStreamerStats
} from "./streamers.js";
import {
  STREAMING_ACCOUNT_ALTER_SQL,
  STREAMING_OAUTH_NONCE_SQL,
  buildAuthorizationUrl,
  createPkcePair,
  createStreamingOAuthState,
  decryptStreamingSecret,
  encryptStreamingSecret,
  exchangeAuthorizationCode,
  getAuthenticatedAccount,
  logStreamingOAuthDiagnostic,
  publicOAuthErrorCode,
  publicStreamingAccount,
  readStreamingOAuthCallbackFields,
  revokeStreamingToken,
  streamingAccountHasSecrets,
  streamingOAuthAvailability,
  streamingOAuthPublicStatus,
  validateStreamingOAuthState
} from "./streaming-oauth.js";
import { decideMemberRoleChange, decideRoleMutation } from "./members-roles-access.js";
import { annotateLink, annotatePanel, botRoleAccess, decideReactionMutation, discordSyncNeeded, emojisForGuild, formatReactionFailure, isUnicodeEmoji, mappingMatchesEvent, messageEmbedUnchanged, planRoleChange, prepareReactionLinks, reactionMutationList, reactionPanelEmbedDescription, REACTION_MUTATION_MAX_RETRIES, reactionSyncPlan, repairMojibake, roleAssignBlock, runReactionMutations, shouldIgnoreReactor } from "./reaction-roles.js";
import { buildGiveawayMessage, channelBelongsToGuild, claimFollowUpAllowed, commitDraw, completeGiveawayEntry, deliveryDone, giveawayBucketPauseMs, giveawayDiscordError, invalidRoleSelection, nextDelivery, openGiveawayEntry, publishActivates, resolveGiveawayEnd, resumeDrawAllowed, runDiscordAttempt, startFinish, winnerAnnouncement, winnerDirectMessage, withDmClaim, withDmResult } from "./giveaways.js";
import { ANNOUNCEMENT_PUBLISH_LOCK_MS, announcementChannelFromDiscord, announcementSaveError, channelDecision, parseAnnouncementBody, runAnnouncementDiscord, runAnnouncementPublish } from "./announcements.js";
import { buildAdminSettingsPayload } from "./admin-settings.js";
import {
  createSupportReplyNotification,
  listNotificationsForUser,
  listSystemNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  ensureNotificationTables,
  markSupportNotificationsRead,
  publishSystemNotification
} from "./user-notifications.js";
import { customerSupportView, ensureTypingTable, isOpenSupportThread, readSupportTyping, setSupportTyping } from "./support-live.js";
import { deleteClosedSupportConversation, deleteSupportMessageRecord } from "./support-admin-delete.js";
import { ensureSupportFeedbackTable, handlingStaffId, listSupportFeedback, pendingRatingDecision, readSupportFeedback, saveSupportFeedback, summarizeRatings } from "./support-feedback.js";
import {
  DAILY_NEURON_BUDGET,
  MAX_OUTPUT_TOKENS,
  SUPPORT_AI_MODEL,
  USER_DAILY_MODEL_CALLS,
  assistantAction,
  buildModelMessages,
  ensureCustomerAssistantTables,
  estimateNeurons,
  estimateTokens,
  fallbackFromSlice,
  handoffSummary,
  insertCustomerAiMessage,
  rotateCustomerAiSession,
  isQuickAction,
  listCustomerAiMessages,
  quickLabel,
  readModelText,
  readModelUsage,
  recentAiTurns,
  releaseAssistantBudget,
  reserveAssistantBudget,
  reserveNeuronsFor,
  sanitizeAssistantReply,
  selectKnowledge,
  wantsHuman
} from "./customer-assistant.js";
import {
  ASSISTANT_FALLBACK,
  assistantPayloadHasNoSecrets,
  buildAssistantResponse,
  matchAssistantIntent
} from "./admin-assistant.js";
import {
  createSignedOAuthState,
  handleAuthMe,
  resolveSession,
  runOAuthCallback
} from "./oauth-session.js";
const CLIENT_ID="1543137268221354035";
const COOKIE="balticm_session", STATE="balticm_oauth_state", OAUTH_RETURN="balticm_oauth_return";
const enc=new TextEncoder(),dec=new TextDecoder();

function parseCookies(req){return Object.fromEntries((req.headers.get("Cookie")||"").split(";").map(x=>x.trim().split("=")).filter(x=>x[0]).map(([k,...v])=>[k,v.join("=")]))}
function b64(bytes){const u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);let bin="";for(let i=0;i<u.length;i+=0x8000)bin+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(bin).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
function unb64(s){s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function sign(p,secret){const d=b64(enc.encode(JSON.stringify(p))),k=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return d+"."+b64(new Uint8Array(await crypto.subtle.sign("HMAC",k,enc.encode(d))))}
async function verify(t,secret){try{const[d,s]=t.split("."),k=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);if(!await crypto.subtle.verify("HMAC",k,unb64(s),enc.encode(d)))return null;const p=JSON.parse(dec.decode(unb64(d)));return p.exp>Date.now()?p:null}catch{return null}}
const json=(data,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});

const TEBEX_PAYMENT_TYPES=new Set([
 "payment.completed",
 "payment.refunded",
 "payment.dispute.opened",
 "payment.dispute.lost"
]);

function bytesToHex(bytes){return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("")}
function timingSafeEqualHex(a,b){
 if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;
 let diff=0;
 for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
async function sha256HexBytes(bytes){return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))}
async function tebexSignatureHex(rawBody,secret){
 // Official Tebex: HMAC-SHA256(hex(SHA256(rawBody)), webhookSecret)
 const bodyHash=await sha256HexBytes(rawBody);
 const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(bodyHash))));
}
/** Canonical public origin for user-facing absolute URLs (Tebex return, auth redirects). */
function publicAppOrigin(env,req){
 const configured=String(env?.PUBLIC_APP_URL||"").trim().replace(/\/$/,"");
 if(configured)return configured;
 try{if(req?.url)return new URL(req.url).origin}catch{}
 return "https://bot.balticm.eu";
}
function clientIp(req){
 const cf=String(req.headers.get("CF-Connecting-IP")||"").trim();
 if(cf)return cf;
 const xff=String(req.headers.get("X-Forwarded-For")||"").split(",")[0].trim();
 return xff||"127.0.0.1";
}
async function ensureTebexWebhookEventsTable(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS tebex_webhook_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, payment_id TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL, handled TEXT NOT NULL DEFAULT 'recorded')").run();
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_tebex_webhook_events_payment ON tebex_webhook_events(payment_id)").run();
}
async function ensureTebexPaymentsTable(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS tebex_payments (payment_id TEXT PRIMARY KEY, event_id TEXT NOT NULL DEFAULT '', discord_user_id TEXT NOT NULL DEFAULT '', guild_id TEXT NOT NULL DEFAULT '', package_id TEXT NOT NULL DEFAULT '', amount REAL, currency TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, basket_ident TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_tebex_payments_guild ON tebex_payments(guild_id)").run();
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_tebex_payments_discord ON tebex_payments(discord_user_id)").run();
}
async function recordTebexWebhookEvent(env,eventId,type,paymentId,handled="recorded"){
 await ensureTebexWebhookEventsTable(env);
 const existing=await env.BALTICM_DB.prepare("SELECT id,handled FROM tebex_webhook_events WHERE id=?").bind(eventId).first();
 if(existing)return {inserted:false,handled:String(existing.handled||"recorded")};
 await env.BALTICM_DB.prepare("INSERT INTO tebex_webhook_events (id,type,payment_id,received_at,handled) VALUES (?,?,?,?,?)").bind(eventId,type,paymentId||"",new Date().toISOString(),handled).run();
 return {inserted:true,handled};
}
async function markTebexWebhookEventHandled(env,eventId,handled){
 await ensureTebexWebhookEventsTable(env);
 await env.BALTICM_DB.prepare("UPDATE tebex_webhook_events SET handled=? WHERE id=?").bind(handled,eventId).run();
}
async function getTebexPayment(env,paymentId){
 if(!paymentId)return null;
 await ensureTebexPaymentsTable(env);
 return env.BALTICM_DB.prepare("SELECT payment_id AS paymentId,event_id AS eventId,discord_user_id AS discordUserId,guild_id AS guildId,package_id AS packageId,amount,currency,status,basket_ident AS basketIdent,created_at AS createdAt,updated_at AS updatedAt FROM tebex_payments WHERE payment_id=?").bind(paymentId).first();
}
async function upsertTebexPayment(env,row){
 await ensureTebexPaymentsTable(env);
 const now=new Date().toISOString();
 const existing=await getTebexPayment(env,row.paymentId);
 if(existing){
  await env.BALTICM_DB.prepare("UPDATE tebex_payments SET event_id=?,discord_user_id=COALESCE(NULLIF(?,''),discord_user_id),guild_id=COALESCE(NULLIF(?,''),guild_id),package_id=COALESCE(NULLIF(?,''),package_id),amount=COALESCE(?,amount),currency=COALESCE(NULLIF(?,''),currency),status=?,basket_ident=COALESCE(NULLIF(?,''),basket_ident),updated_at=? WHERE payment_id=?").bind(
   row.eventId||existing.eventId||"",
   row.discordUserId||"",
   row.guildId||"",
   row.packageId||"",
   row.amount,
   row.currency||"",
   row.status,
   row.basketIdent||"",
   now,
   row.paymentId
  ).run();
  return {created:false};
 }
 await env.BALTICM_DB.prepare("INSERT INTO tebex_payments (payment_id,event_id,discord_user_id,guild_id,package_id,amount,currency,status,basket_ident,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(
  row.paymentId,
  row.eventId||"",
  row.discordUserId||"",
  row.guildId||"",
  row.packageId||"",
  row.amount,
  row.currency||"",
  row.status,
  row.basketIdent||"",
  now,
  now
 ).run();
 return {created:true};
}
async function createTebexVipBasket(env,{guildId,discordUserId,username,ip,completeUrl,cancelUrl}){
 const token=String(env.TEBEX_PUBLIC_TOKEN||"").trim();
 const packageId=String(env.TEBEX_VIP_PACKAGE_ID||"").trim();
 if(!token||!packageId)throw new Error("Tebex checkout is not configured");
 // Headless: public token goes in the path. Create basket needs no auth unless forwarding ip_address.
 // Official Headless docs + community SDKs: ip_address on a backend requires Basic (public:private).
 const privateKey=String(env.TEBEX_PRIVATE_KEY||"").trim();
 const custom={
  guild_id:String(guildId),
  discord_user_id:String(discordUserId),
  package_id:packageId
 };
 const basketBody={
  complete_url:completeUrl,
  cancel_url:cancelUrl,
  complete_auto_redirect:true,
  custom
 };
 // Universal / web stores reject username ("You can't set the username for this game type").
 // Minecraft/Overwolf stores would need username — BalticM VIP is a Universal package.
 const headers={"Content-Type":"application/json","Accept":"application/json"};
 if(privateKey){
  // Only send client IP when authenticated — otherwise Tebex returns "Basic auth credentials are required".
  const client=String(ip||"").trim();
  if(client)basketBody.ip_address=client;
  headers.Authorization="Basic "+btoa(`${token}:${privateKey}`);
 }
 const createRes=await fetch(`https://headless.tebex.io/api/accounts/${encodeURIComponent(token)}/baskets`,{
  method:"POST",
  headers,
  body:JSON.stringify(basketBody)
 });
 const createJson=await createRes.json().catch(()=>({}));
 if(!createRes.ok){
  const detail=String(createJson?.detail||createJson?.title||createJson?.error||createJson?.message||createRes.status);
  throw new Error("Could not create Tebex basket ("+detail+")");
 }
 const basket=createJson?.data||createJson;
 const ident=String(basket?.ident||"");
 if(!ident)throw new Error("Tebex basket missing ident");
 const pkgBody=JSON.stringify({package_id:Number(packageId)||packageId,quantity:1});
 const addHeaders={"Content-Type":"application/json","Accept":"application/json"};
 const addRes=await fetch(`https://headless.tebex.io/api/baskets/${encodeURIComponent(ident)}/packages`,{
  method:"POST",
  headers:addHeaders,
  body:pkgBody
 });
 const addJson=await addRes.json().catch(()=>({}));
 if(!addRes.ok){
  const addRes2=await fetch(`https://headless.tebex.io/api/accounts/${encodeURIComponent(token)}/baskets/${encodeURIComponent(ident)}/packages`,{
   method:"POST",
   headers:addHeaders,
   body:pkgBody
  });
  const addJson2=await addRes2.json().catch(()=>({}));
  if(!addRes2.ok){
   const detail=String(addJson2?.detail||addJson?.detail||addJson2?.title||addJson?.title||addJson2?.message||addJson?.message||addRes2.status);
   throw new Error("Could not add VIP package to basket ("+detail+")");
  }
  const withPkg2=addJson2?.data||addJson2||basket;
  const checkoutUrl2=String(withPkg2?.links?.checkout||basket?.links?.checkout||"").trim();
  if(!checkoutUrl2)throw new Error("Tebex checkout URL missing");
  return {ident,checkoutUrl:checkoutUrl2,packageId,basket:withPkg2};
 }
 const withPkg=addJson?.data||addJson||basket;
 const checkoutUrl=String(withPkg?.links?.checkout||basket?.links?.checkout||"").trim();
 if(!checkoutUrl)throw new Error("Tebex checkout URL missing");
 return {ident,checkoutUrl,packageId,basket:withPkg};
}
async function fetchTebexBasket(env,basketIdent){
 const token=String(env.TEBEX_PUBLIC_TOKEN||"").trim();
 const ident=String(basketIdent||"").trim();
 if(!token)throw new Error("Tebex checkout is not configured");
 if(!ident)throw new Error("basketIdent is required");
 const res=await fetch(`https://headless.tebex.io/api/accounts/${encodeURIComponent(token)}/baskets/${encodeURIComponent(ident)}`,{
  headers:{"Accept":"application/json"}
 });
 const body=await res.json().catch(()=>({}));
 if(!res.ok)throw new Error(tebexApiErrorMessage(body,"Could not load Tebex basket ("+res.status+")"));
 return body?.data||body;
}
async function applyTebexCoupon(env,basketIdent,couponCode){
 const token=String(env.TEBEX_PUBLIC_TOKEN||"").trim();
 const ident=String(basketIdent||"").trim();
 const code=String(couponCode||"").trim();
 if(!token)throw new Error("Tebex checkout is not configured");
 if(!ident)throw new Error("basketIdent is required");
 if(!code)throw new Error("coupon code is required");
 const res=await fetch(`https://headless.tebex.io/api/accounts/${encodeURIComponent(token)}/baskets/${encodeURIComponent(ident)}/coupons`,{
  method:"POST",
  headers:{"Content-Type":"application/json","Accept":"application/json"},
  body:JSON.stringify({coupon_code:code})
 });
 const body=await res.json().catch(()=>({}));
 if(!res.ok){
  const err=new Error(tebexApiErrorMessage(body,"Invalid coupon code provided"));
  err.status=res.status===422?422:502;
  throw err;
 }
 return body;
}
function assertBasketOwnedByUser(summary,user,guildId){
 if(!summary?.ident)return {error:"Basket not found",status:404};
 if(String(summary.discordUserId||"")&&String(summary.discordUserId)!==String(user.id)){
  return {error:"Forbidden",status:403};
 }
 if(guildId&&String(summary.guildId||"")&&String(summary.guildId)!==String(guildId)){
  return {error:"Forbidden",status:403};
 }
 return {};
}
async function startTebexVipCheckout(req,env,user,guildId){
 try{
  const resolved=resolveManageableGuildId(user,guildId);
  if(resolved.error)return json({error:resolved.error},resolved.status);
  if(!String(env.TEBEX_PUBLIC_TOKEN||"").trim()||!String(env.TEBEX_VIP_PACKAGE_ID||"").trim()){
   return json({error:"Tebex checkout is not configured"},503);
  }
  const origin=publicAppOrigin(env,req);
  const created=await createTebexVipBasket(env,{
   guildId:resolved.guildId,
   discordUserId:String(user.id),
   username:String(user.username||user.global_name||user.id),
   ip:clientIp(req),
   completeUrl:origin+"/?tebex=complete",
   cancelUrl:origin+"/?tebex=cancel"
  });
  let basket=created.basket;
  try{basket=await fetchTebexBasket(env,created.ident)}catch{/* keep package-add payload */}
  const summary=summarizeTebexBasket(basket);
  return json({ok:true,checkoutUrl:created.checkoutUrl,basketIdent:created.ident,basket:summary});
 }catch(e){
  return json({error:String(e.message||e)},502);
 }
}
async function getTebexVipBasket(req,env,user,guildId,basketIdent){
 try{
  const resolved=resolveManageableGuildId(user,guildId);
  if(resolved.error)return json({error:resolved.error},resolved.status);
  const basket=await fetchTebexBasket(env,basketIdent);
  const summary=summarizeTebexBasket(basket);
  const owned=assertBasketOwnedByUser(summary,user,resolved.guildId);
  if(owned.error)return json({error:owned.error},owned.status);
  return json({ok:true,basketIdent:summary.ident||String(basketIdent),basket:summary});
 }catch(e){
  return json({error:String(e.message||e)},502);
 }
}
async function applyTebexVipCoupon(req,env,user,guildId){
 try{
  const resolved=resolveManageableGuildId(user,guildId);
  if(resolved.error)return json({error:resolved.error},resolved.status);
  let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
  const basketIdent=String(body?.basketIdent||body?.ident||"").trim();
  const couponCode=String(body?.couponCode||body?.coupon_code||body?.code||"").trim();
  if(!basketIdent)return json({error:"basketIdent is required"},400);
  if(!couponCode)return json({error:"coupon code is required"},400);
  const before=summarizeTebexBasket(await fetchTebexBasket(env,basketIdent));
  const owned=assertBasketOwnedByUser(before,user,resolved.guildId);
  if(owned.error)return json({error:owned.error},owned.status);
  try{
   await applyTebexCoupon(env,basketIdent,couponCode);
  }catch(e){
   const status=e.status===422?422:502;
   return json({error:String(e.message||e)},status);
  }
  const after=summarizeTebexBasket(await fetchTebexBasket(env,basketIdent));
  return json({ok:true,basketIdent:after.ident||basketIdent,basket:after});
 }catch(e){
  return json({error:String(e.message||e)},502);
 }
}
async function tryClaimTebexPaymentGrant(env,row){
 await ensureTebexPaymentsTable(env);
 const existing=await getTebexPayment(env,row.paymentId);
 const st=String(existing?.status||"").toLowerCase();
 if(["granted","refunded","dispute_opened","dispute_lost"].includes(st))return {claimed:false};
 const now=new Date().toISOString();
 if(!existing){
  await env.BALTICM_DB.prepare("INSERT INTO tebex_payments (payment_id,event_id,discord_user_id,guild_id,package_id,amount,currency,status,basket_ident,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(
   row.paymentId,
   row.eventId||"",
   row.discordUserId||"",
   row.guildId||"",
   row.packageId||"",
   row.amount,
   row.currency||"",
   "granted",
   row.basketIdent||"",
   now,
   now
  ).run();
  return {claimed:true};
 }
 const r=await env.BALTICM_DB.prepare("UPDATE tebex_payments SET event_id=?,discord_user_id=COALESCE(NULLIF(?,''),discord_user_id),guild_id=COALESCE(NULLIF(?,''),guild_id),package_id=COALESCE(NULLIF(?,''),package_id),amount=COALESCE(?,amount),currency=COALESCE(NULLIF(?,''),currency),status='granted',basket_ident=COALESCE(NULLIF(?,''),basket_ident),updated_at=? WHERE payment_id=? AND status NOT IN ('granted','refunded','dispute_opened','dispute_lost')").bind(
  row.eventId||existing.eventId||"",
  row.discordUserId||"",
  row.guildId||"",
  row.packageId||"",
  row.amount,
  row.currency||"",
  row.basketIdent||"",
  now,
  row.paymentId
 ).run();
 return {claimed:(r.meta?.changes||0)>0};
}
async function handleTebexPaymentCompleted(env,payload,eventId){
 const expectedPackageId=String(env.TEBEX_VIP_PACKAGE_ID||"").trim();
 const purchase=extractTebexVipPurchase(payload?.subject,expectedPackageId);
 const paymentId=purchase.paymentId||("event:"+eventId);
 const existing=await getTebexPayment(env,paymentId);
 const decision=decideTebexVipExtend({
  existingStatus:existing?.status,
  packageMatched:purchase.packageMatched,
  guildId:purchase.guildId
 });

 if(decision.action==="skip_duplicate"){
  await markTebexWebhookEventHandled(env,eventId,"granted");
  return {ok:true,type:"payment.completed",duplicate:true,granted:true};
 }

 if(decision.action!=="extend"){
  await upsertTebexPayment(env,{
   paymentId,
   eventId,
   discordUserId:purchase.discordUserId,
   guildId:purchase.guildId,
   packageId:purchase.packageId,
   amount:purchase.amount,
   currency:purchase.currency,
   status:mapTebexPaymentStatus("payment.completed"),
   basketIdent:""
  });
  await markTebexWebhookEventHandled(env,eventId,decision.reason||"recorded");
  return {ok:true,type:"payment.completed",granted:false,reason:decision.reason};
 }

 // Claim payment_id as granted BEFORE extending so retries never double-apply +30 days.
 const {claimed}=await tryClaimTebexPaymentGrant(env,{
  paymentId,
  eventId,
  discordUserId:purchase.discordUserId,
  guildId:purchase.guildId,
  packageId:purchase.packageId||expectedPackageId,
  amount:purchase.amount,
  currency:purchase.currency,
  basketIdent:""
 });
 if(!claimed){
  await markTebexWebhookEventHandled(env,eventId,"granted");
  return {ok:true,type:"payment.completed",duplicate:true,granted:true};
 }

 const current=await readPremiumRaw(env,purchase.guildId);
 const now=new Date();
 const extended=computeExtendVip(current,decision.days||TEBEX_VIP_DAYS,now);
 await writePremiumPlan(env,purchase.guildId,{...extended.value,source:"tebex"});
 await markTebexWebhookEventHandled(env,eventId,"granted");
 await syncGuildBotNickname(env,purchase.guildId);
 await addActivityLog(env,purchase.guildId,{
  actorId:purchase.discordUserId||"tebex",
  actorName:"Tebex",
  action:"VIP purchase",
  target:purchase.guildId,
  source:"TEBEX",
  details:(decision.days||TEBEX_VIP_DAYS)+" days"
 }).catch(()=>{});
 return {ok:true,type:"payment.completed",granted:true,guildId:purchase.guildId,days:decision.days||TEBEX_VIP_DAYS};
}
async function handleTebexPaymentStatusOnly(env,payload,eventId,type){
 const purchase=extractTebexVipPurchase(payload?.subject,String(env.TEBEX_VIP_PACKAGE_ID||"").trim());
 const paymentId=purchase.paymentId||("event:"+eventId);
 const status=mapTebexPaymentStatus(type);
 await upsertTebexPayment(env,{
  paymentId,
  eventId,
  discordUserId:purchase.discordUserId,
  guildId:purchase.guildId,
  packageId:purchase.packageId,
  amount:purchase.amount,
  currency:purchase.currency,
  status,
  basketIdent:""
 });
 await markTebexWebhookEventHandled(env,eventId,status);
 // Refunds/disputes: verify + store only. Never revoke VIP.
 void shouldRevokeVipOnTebexType(type);
 return {ok:true,type,status,revoked:false};
}
async function tebexWebhook(req,env){
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const secret=String(env.TEBEX_WEBHOOK_SECRET||"");
 if(!secret)return json({error:"Webhook secret not configured"},503);
 const signature=String(req.headers.get("X-Signature")||"").trim().toLowerCase();
 if(!signature)return json({error:"Missing signature"},401);
 const rawBody=new Uint8Array(await req.arrayBuffer());
 let expected;
 try{expected=await tebexSignatureHex(rawBody,secret)}catch{return json({error:"Signature verification failed"},401)}
 if(!timingSafeEqualHex(expected,signature))return json({error:"Invalid signature"},401);
 let payload;
 try{payload=JSON.parse(dec.decode(rawBody))}catch{return json({error:"Invalid JSON"},400)}
 const type=String(payload?.type||"");
 const eventId=String(payload?.id||"");
 if(!eventId)return json({error:"Missing webhook id"},400);

 if(type==="validation.webhook")return json({id:eventId});

 if(TEBEX_PAYMENT_TYPES.has(type)){
  const paymentId=String(payload?.subject?.transaction_id||payload?.subject?.id||"");
  const {inserted,handled}=await recordTebexWebhookEvent(env,eventId,type,paymentId);
  if(!inserted&&handled==="granted")return json({ok:true,type,duplicate:true,granted:true});

  try{
   if(type==="payment.completed"){
    const result=await handleTebexPaymentCompleted(env,payload,eventId);
    return json(result);
   }
   const result=await handleTebexPaymentStatusOnly(env,payload,eventId,type);
   return json(result);
  }catch(e){
   return json({error:"Webhook handling failed",detail:String(e.message||e)},500);
  }
 }

 // Acknowledge unknown subscribed types so Tebex does not retry forever.
 if(eventId)await recordTebexWebhookEvent(env,eventId,type,String(payload?.subject?.transaction_id||"")).catch(()=>{});
 return json({ok:true,type,ignored:true});
}


function compareSemver(a,b){
 const pa=String(a||"").replace(/^v/,"").split(".").map(x=>Number.parseInt(x,10)||0),pb=String(b||"").replace(/^v/,"").split(".").map(x=>Number.parseInt(x,10)||0);
 for(let i=0;i<3;i++){if((pa[i]||0)!==(pb[i]||0))return (pa[i]||0)-(pb[i]||0)}return 0;
}
const RELEASES_LATEST="https://github.com/all4fun-91/balticm-bot/releases/latest";
async function latestDesktopRelease(){
 const r=await fetch(RELEASES_LATEST,{redirect:"manual",headers:{"User-Agent":"BalticM-Control-Center-Updater"}});
 const location=r.headers.get("Location")||"";
 const m=location.match(/\/releases\/tag\/v?([^/?#]+)/i);
 if(!m)throw new Error("GitHub latest release redirect failed: "+r.status);
 const version=decodeURIComponent(m[1]);
 const base="https://github.com/all4fun-91/balticm-bot/releases/download/v"+version;
 const file="BalticM.Control.Center_"+version+"_x64-setup.exe";
 const url=base+"/"+file;
 const sigUrl=url+".sig";
 const sr=await fetch(sigUrl,{headers:{"User-Agent":"BalticM-Control-Center-Updater"}});
 if(!sr.ok)throw new Error("GitHub signature download failed: "+sr.status);
 const signature=(await sr.text()).trim();
 if(!signature)throw new Error("GitHub signature is empty");
 return {version,url,signature,notes:"BalticM Control Center v"+version+" is available.",pub_date:new Date().toISOString()};
}
async function desktopUpdate(target,arch,currentVersion){
 if(target!=="windows"||(arch!=="x86_64"&&arch!=="i686"&&arch!=="aarch64"))return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
 try{const r=await latestDesktopRelease();if(!r||compareSemver(r.version,currentVersion)<=0)return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});return json(r)}catch(e){return json({error:"Desktop update lookup failed",detail:String(e.message||e)},502)}
}
async function desktopLatest(){
 try{const r=await latestDesktopRelease();return r?json({available:true,version:r.version,url:r.url,notes:r.notes,pub_date:r.pub_date}):json({available:false})}catch(e){return json({available:false,error:String(e.message||e)},502)}
}
async function health(req,env){
 const origin=publicAppOrigin(env,req);
 const targets=[
  {name:"Main Bot",url:"https://balticm.eu/discord-bot/",kind:"CORE SERVICE"},
  {name:"Reaction Roles",url:"https://balticm.eu/reactions/",kind:"MODULE"},
  {name:"Music Bot",url:"https://balticm.eu/music/",kind:"MODULE"},
  {name:"Voice Create",url:"https://balticm.eu/voice/",kind:"MODULE"},
  {name:"Bot Center",url:origin+"/api/status-public",kind:"CONTROL CENTER",self:true}
 ];
 const services=await Promise.all(targets.map(async target=>{
  const started=Date.now();
  if(target.self)return{...target,ok:true,status:200,responseMs:Date.now()-started,data:{ok:true,service:"BalticM Bot Center"}};
  try{
   const r=await fetch(target.url,{headers:{Accept:"application/json,text/plain,*/*","Cache-Control":"no-cache"}});
   const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text.slice(0,250)}
   return{...target,ok:r.ok,status:r.status,responseMs:Date.now()-started,data};
  }catch(e){return{...target,ok:false,status:0,responseMs:Date.now()-started,error:String(e.message||e)}}
 }));
 return json({ok:services.every(x=>x.ok),checkedAt:new Date().toISOString(),services});
}
async function ensureSupportChatTables(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_support_threads (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,user_name TEXT DEFAULT '',guild_id TEXT DEFAULT '',guild_name TEXT DEFAULT '',status TEXT NOT NULL DEFAULT 'open',unread_user INTEGER NOT NULL DEFAULT 0,unread_staff INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_bot_support_threads_user_updated ON bot_support_threads(user_id,updated_at DESC)").run();
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_support_messages (id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,sender_type TEXT NOT NULL,sender_id TEXT DEFAULT '',sender_name TEXT DEFAULT '',message TEXT NOT NULL,created_at TEXT NOT NULL)").run();
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_bot_support_messages_thread_created ON bot_support_messages(thread_id,created_at ASC)").run();
}
async function deliverHumanSupportMessage(env,user,message,guildId){
 await ensureSupportChatTables(env);
 const text=String(message||"").trim();
 if(!text)return json({error:"Message is required"},400);
 if(text.length>2000)return json({error:"Message is too long"},400);
 let guildName="";
 if(guildId){const g=(user.guilds||[]).find(x=>String(x.id)===guildId);if(!g)return json({error:"Invalid server"},403);guildName=String(g.name||"")}
 let thread=await env.BALTICM_DB.prepare("SELECT id,status FROM bot_support_threads WHERE user_id=? AND status!='closed' ORDER BY updated_at DESC LIMIT 1").bind(String(user.id)).first();
 const now=new Date().toISOString(),userName=String(user.global_name||user.username||"Discord user");
 if(!thread){thread={id:crypto.randomUUID(),status:"waiting_staff"};await env.BALTICM_DB.prepare("INSERT INTO bot_support_threads (id,user_id,user_name,guild_id,guild_name,status,unread_user,unread_staff,created_at,updated_at) VALUES (?,?,?,?,?,'waiting_staff',0,1,?,?)").bind(thread.id,String(user.id),userName,guildId,guildName,now,now).run()}
 else await env.BALTICM_DB.prepare("UPDATE bot_support_threads SET guild_id=?,guild_name=?,user_name=?,status='waiting_staff',unread_staff=unread_staff+1,updated_at=? WHERE id=? AND user_id=?").bind(guildId,guildName,userName,now,thread.id,String(user.id)).run();
 const item={id:crypto.randomUUID(),threadId:thread.id,senderType:"user",senderId:String(user.id),senderName:userName,message:text,createdAt:now};
 await env.BALTICM_DB.prepare("INSERT INTO bot_support_messages (id,thread_id,sender_type,sender_id,sender_name,message,created_at) VALUES (?,?,?,?,?,?,?)").bind(item.id,item.threadId,item.senderType,item.senderId,item.senderName,item.message,item.createdAt).run();
 await setSupportTyping(env.BALTICM_DB,thread.id,"user",false);
 return json({ok:true,mode:"human",threadId:thread.id,message:item});
}
async function answerSupportWithAi(env,user,{message,quickAction,page}){
 await ensureCustomerAssistantTables(env.BALTICM_DB);
 const quick=String(quickAction||"").trim();
 const text=String(message||"").trim();
 if(!text&&!quick)return json({error:"Message is required"},400);
 if(text.length>500)return json({error:"Message is too long"},400);
 if(quick&&!isQuickAction(quick))return json({error:"Unknown action"},400);
 const userId=String(user.id);
 const now=new Date().toISOString();
 const slice=selectKnowledge({page,text,quickAction:quick});
 const action=assistantAction(slice);
 const userRow={id:crypto.randomUUID(),userId,role:"user",content:text||quickLabel(quick),actionPage:"",actionLabel:"",createdAt:now};
 await insertCustomerAiMessage(env.BALTICM_DB,userRow);
 let reply=fallbackFromSlice(slice);
 if(!quick&&env.AI){
  const history=await recentAiTurns(env.BALTICM_DB,userId);
  const messages=buildModelMessages({slice,history:history.filter(turn=>turn.id!==userRow.id),page,text});
  const reserve=reserveNeuronsFor(messages);
  const day=now.slice(0,10);
  const reserved=await reserveAssistantBudget(env.BALTICM_DB,{userId,day,neurons:reserve,budget:DAILY_NEURON_BUDGET,userLimit:USER_DAILY_MODEL_CALLS});
  if(reserved){
   try{
    const result=await env.AI.run(SUPPORT_AI_MODEL,{messages,max_tokens:MAX_OUTPUT_TOKENS,temperature:0.2,chat_template_kwargs:{enable_thinking:false}});
    const raw=sanitizeAssistantReply(readModelText(result));
    if(raw)reply=raw;
    const usage=readModelUsage(result);
    const actual=estimateNeurons(usage.input||estimateTokens(messages.map(m=>m.content).join("\n")),usage.output||estimateTokens(reply));
    const refund=Math.max(0,reserve-actual);
    if(refund)await releaseAssistantBudget(env.BALTICM_DB,{userId,day,neurons:refund,releaseCall:false});
   }catch{
    await releaseAssistantBudget(env.BALTICM_DB,{userId,day,neurons:reserve,releaseCall:true});
    reply=fallbackFromSlice(slice);
   }
  }
 }
 const assistantRow={id:crypto.randomUUID(),userId,role:"assistant",content:reply,actionPage:action?.page||"",actionLabel:action?.label||"",createdAt:new Date().toISOString()};
 await insertCustomerAiMessage(env.BALTICM_DB,assistantRow);
 return json({ok:true,mode:"ai",action});
}
async function supportChatState(req,env,user){
 try{
  await ensureSupportChatTables(env);
  const latest=await env.BALTICM_DB.prepare("SELECT id,user_id AS userId,user_name AS userName,guild_id AS guildId,guild_name AS guildName,status,unread_user AS unreadUser,unread_staff AS unreadStaff,created_at AS createdAt,updated_at AS updatedAt FROM bot_support_threads WHERE user_id=? ORDER BY updated_at DESC LIMIT 1").bind(String(user.id)).first();
  const thread=isOpenSupportThread(latest)?latest:null;
  let human=[];
  if(thread){
   const rows=await env.BALTICM_DB.prepare("SELECT id,thread_id AS threadId,sender_type AS senderType,sender_id AS senderId,sender_name AS senderName,message,created_at AS createdAt FROM bot_support_messages WHERE thread_id=? ORDER BY created_at ASC LIMIT 300").bind(thread.id).all();
   human=rows.results||[];
  }
  const markRead=new URL(req.url).searchParams.get("read")==="1";
  if(thread&&markRead&&Number(thread.unreadUser)>0)await env.BALTICM_DB.prepare("UPDATE bot_support_threads SET unread_user=0 WHERE id=? AND user_id=?").bind(thread.id,String(user.id)).run();
  if(markRead)await markSupportNotificationsRead(env.BALTICM_DB,user.id);
  let pendingRating=null;
  if(!thread&&latest?.status==="closed"){
   const staffRows=await env.BALTICM_DB.prepare("SELECT id, sender_type AS senderType, sender_id AS senderId, created_at AS createdAt FROM bot_support_messages WHERE thread_id=? AND sender_type='staff'").bind(latest.id).all();
   const feedback=await readSupportFeedback(env.BALTICM_DB,latest.id);
   pendingRating=pendingRatingDecision({latestClosed:latest,hasOpenTicket:false,staffMessages:staffRows.results||[],feedback});
  }
  const ai=pendingRating?[]:await listCustomerAiMessages(env.BALTICM_DB,user.id);
  const staffTyping=thread?await readSupportTyping(env.BALTICM_DB,thread.id,"staff"):false;
  return json(customerSupportView({thread,humanMessages:human,aiMessages:ai,staffTyping,markRead,pendingRating}));
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function supportRatingPending(env,user){
 const latest=await env.BALTICM_DB.prepare("SELECT id, user_id AS userId, status FROM bot_support_threads WHERE user_id=? AND status='closed' ORDER BY updated_at DESC LIMIT 1").bind(String(user.id)).first();
 if(!latest)return null;
 const open=await env.BALTICM_DB.prepare("SELECT id FROM bot_support_threads WHERE user_id=? AND status!='closed' LIMIT 1").bind(String(user.id)).first();
 if(open)return null;
 const staffRows=await env.BALTICM_DB.prepare("SELECT id, sender_type AS senderType, sender_id AS senderId, created_at AS createdAt FROM bot_support_messages WHERE thread_id=? AND sender_type='staff'").bind(latest.id).all();
 const feedback=await readSupportFeedback(env.BALTICM_DB,latest.id);
 return pendingRatingDecision({latestClosed:latest,hasOpenTicket:false,staffMessages:staffRows.results||[],feedback});
}
async function supportChatClose(req,env,user){
 try{
  await ensureSupportChatTables(env);
  const body=await req.json().catch(()=>({}));
  const open=await env.BALTICM_DB.prepare("SELECT id, user_id AS userId, status FROM bot_support_threads WHERE user_id=? AND status!='closed' ORDER BY updated_at DESC LIMIT 1").bind(String(user.id)).first();
  if(!open||String(open.userId)!==String(user.id))return json({error:"No active ticket"},404);
  if(body.ticketId&&String(body.ticketId)!==String(open.id))return json({error:"Forbidden"},403);
  const now=new Date().toISOString();
  const updated=await env.BALTICM_DB.prepare("UPDATE bot_support_threads SET status='closed', updated_at=? WHERE id=? AND user_id=?").bind(now,open.id,String(user.id)).run();
  if(!updated.meta?.changes)return json({error:"No active ticket"},404);
  await setSupportTyping(env.BALTICM_DB,open.id,"user",false);
  await setSupportTyping(env.BALTICM_DB,open.id,"staff",false);
  await rotateCustomerAiSession(env.BALTICM_DB,user.id);
  return json({ok:true,status:"closed"});
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function supportChatRate(req,env,user){
 try{
  await ensureSupportChatTables(env);
  const body=await req.json().catch(()=>({}));
  const pending=await supportRatingPending(env,user);
  if(!pending){
   const latest=await env.BALTICM_DB.prepare("SELECT id FROM bot_support_threads WHERE user_id=? AND status='closed' ORDER BY updated_at DESC LIMIT 1").bind(String(user.id)).first();
   if(latest&&await readSupportFeedback(env.BALTICM_DB,latest.id))return json({error:"Already rated"},409);
   return json({error:"Ticket is not eligible"},400);
  }
  if(body.ticketId&&String(body.ticketId)!==String(pending.ticketId))return json({error:"Forbidden"},403);
  const saved=await saveSupportFeedback(env.BALTICM_DB,{ticketId:pending.ticketId,customerUserId:String(user.id),staffUserId:pending.staffUserId,rating:body.rating,skipped:body.skip===true,createdAt:new Date().toISOString()});
  if(saved.error)return json({error:saved.error},saved.status||400);
  await rotateCustomerAiSession(env.BALTICM_DB,user.id);
  return json({ok:true,mode:"ai"});
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function supportChatSend(req,env,user){
 try{
  await ensureSupportChatTables(env);
  if(await supportRatingPending(env,user))return json({error:"Rate or skip the last ticket first",code:"rating-pending"},409);
  const body=await req.json().catch(()=>({}));
  const message=String(body.message||"").trim();
  const quickAction=String(body.quickAction||"").trim();
  const guildId=String(body.guildId||"").trim();
  const page=String(body.page||"").trim().slice(0,40);
  const open=await env.BALTICM_DB.prepare("SELECT id FROM bot_support_threads WHERE user_id=? AND status!='closed' ORDER BY updated_at DESC LIMIT 1").bind(String(user.id)).first();
  if(open){
   if(!message)return json({error:"Message is required"},400);
   if(message.length>2000)return json({error:"Message is too long"},400);
   return deliverHumanSupportMessage(env,user,message,guildId);
  }
  if(message&&wantsHuman(message)){
   if(message.length>2000)return json({error:"Message is too long"},400);
   return deliverHumanSupportMessage(env,user,message,guildId);
  }
  return answerSupportWithAi(env,user,{message,quickAction,page});
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function supportChatHandoff(req,env,user){
 try{
  await ensureSupportChatTables(env);
  if(await supportRatingPending(env,user))return json({error:"Rate or skip the last ticket first",code:"rating-pending"},409);
  const body=await req.json().catch(()=>({}));
  const guildId=String(body.guildId||"").trim();
  const open=await env.BALTICM_DB.prepare("SELECT id FROM bot_support_threads WHERE user_id=? AND status!='closed' ORDER BY updated_at DESC LIMIT 1").bind(String(user.id)).first();
  if(open)return json({ok:true,mode:"human",threadId:open.id});
  const ai=await listCustomerAiMessages(env.BALTICM_DB,user.id);
  return deliverHumanSupportMessage(env,user,handoffSummary(ai),guildId);
 }catch(e){return json({error:String(e.message||e)},500)}
}
function isBalticMAdmin(env,user){const ids=String(env.BALTICM_ADMIN_DISCORD_IDS||"").split(",").map(x=>x.trim()).filter(Boolean);return !!user?.id&&ids.includes(String(user.id))}
function adminDenied(env,user){return isBalticMAdmin(env,user)?null:json({error:"Forbidden"},403)}
async function adminSupportThreads(env,user){const denied=adminDenied(env,user);if(denied)return denied;try{await ensureSupportChatTables(env);const r=await env.BALTICM_DB.prepare("SELECT id,user_id AS userId,user_name AS userName,guild_id AS guildId,guild_name AS guildName,status,unread_user AS unreadUser,unread_staff AS unreadStaff,created_at AS createdAt,updated_at AS updatedAt FROM bot_support_threads ORDER BY CASE WHEN status='closed' THEN 1 ELSE 0 END, updated_at DESC LIMIT 300").all();const feedback=await listSupportFeedback(env.BALTICM_DB);const byTicket=new Map(feedback.map(row=>[row.ticketId,row]));const threads=(r.results||[]).map(thread=>{const row=byTicket.get(thread.id);const rating=row&&!row.skipped?Number(row.rating)||null:null;return {...thread,rating,staffUserId:row?.staffUserId||""}});return json({threads,ratingSummary:summarizeRatings(feedback)})}catch(e){return json({error:String(e.message||e)},500)}}
async function adminSupportThread(req,env,user){const denied=adminDenied(env,user);if(denied)return denied;try{await ensureSupportChatTables(env);const id=new URL(req.url).searchParams.get("id");if(!id)return json({error:"id is required"},400);const thread=await env.BALTICM_DB.prepare("SELECT id,user_id AS userId,user_name AS userName,guild_id AS guildId,guild_name AS guildName,status,unread_user AS unreadUser,unread_staff AS unreadStaff,created_at AS createdAt,updated_at AS updatedAt FROM bot_support_threads WHERE id=?").bind(id).first();if(!thread)return json({error:"Conversation not found"},404);const r=await env.BALTICM_DB.prepare("SELECT id,thread_id AS threadId,sender_type AS senderType,sender_id AS senderId,sender_name AS senderName,message,created_at AS createdAt FROM bot_support_messages WHERE thread_id=? ORDER BY created_at ASC LIMIT 500").bind(id).all();if(Number(thread.unreadStaff)>0)await env.BALTICM_DB.prepare("UPDATE bot_support_threads SET unread_staff=0 WHERE id=?").bind(id).run();const customerTyping=await readSupportTyping(env.BALTICM_DB,id,"user");const feedback=await readSupportFeedback(env.BALTICM_DB,id);const rating=feedback&&!feedback.skipped&&feedback.rating?{rating:Number(feedback.rating),staffUserId:feedback.staffUserId}:null;const handlerId=handlingStaffId(r.results||[]);return json({thread:{...thread,unreadStaff:0},messages:r.results||[],typing:{customer:customerTyping},rating,staffUserId:handlerId||feedback?.staffUserId||""})}catch(e){return json({error:String(e.message||e)},500)}}
async function adminSupportReply(req,env,user){const denied=adminDenied(env,user);if(denied)return denied;try{await ensureSupportChatTables(env);const body=await req.json().catch(()=>({})),threadId=String(body.threadId||"").trim(),message=String(body.message||"").trim();if(!threadId||!message)return json({error:"Thread and message are required"},400);if(message.length>2000)return json({error:"Message is too long"},400);const thread=await env.BALTICM_DB.prepare("SELECT id,user_id,status FROM bot_support_threads WHERE id=?").bind(threadId).first();if(!thread)return json({error:"Conversation not found"},404);if(thread.status==="closed")return json({error:"Reopen this conversation before replying"},409);const now=new Date().toISOString(),item={id:crypto.randomUUID(),threadId,senderType:"staff",senderId:String(user.id),senderName:String(user.global_name||user.username||"BalticM Support"),message,createdAt:now};await env.BALTICM_DB.prepare("INSERT INTO bot_support_messages (id,thread_id,sender_type,sender_id,sender_name,message,created_at) VALUES (?,?,?,?,?,?,?)").bind(item.id,item.threadId,item.senderType,item.senderId,item.senderName,item.message,item.createdAt).run();await env.BALTICM_DB.prepare("UPDATE bot_support_threads SET status='waiting_customer',unread_staff=0,unread_user=unread_user+1,updated_at=? WHERE id=?").bind(now,threadId).run();await createSupportReplyNotification(env.BALTICM_DB,{messageId:item.id,userId:String(thread.user_id||""),now});await setSupportTyping(env.BALTICM_DB,threadId,"staff",false);return json({ok:true,message:item})}catch(e){return json({error:String(e.message||e)},500)}}
async function supportChatTyping(req,env,user){try{await ensureSupportChatTables(env);const body=await req.json().catch(()=>({}));const thread=await env.BALTICM_DB.prepare("SELECT id FROM bot_support_threads WHERE user_id=? AND status!='closed' ORDER BY updated_at DESC LIMIT 1").bind(String(user.id)).first();if(!thread)return json({ok:true,typing:false});await setSupportTyping(env.BALTICM_DB,thread.id,"user",!!body.typing);return json({ok:true})}catch(e){return json({error:String(e.message||e)},500)}}
async function adminSupportTyping(req,env,user){const denied=adminDenied(env,user);if(denied)return denied;try{await ensureSupportChatTables(env);const body=await req.json().catch(()=>({}));const threadId=String(body.threadId||"").trim();if(!threadId)return json({error:"Thread is required"},400);const thread=await env.BALTICM_DB.prepare("SELECT id FROM bot_support_threads WHERE id=?").bind(threadId).first();if(!thread)return json({error:"Conversation not found"},404);await setSupportTyping(env.BALTICM_DB,threadId,"staff",!!body.typing);return json({ok:true})}catch(e){return json({error:String(e.message||e)},500)}}
async function userNotificationsList(env,user){try{return json(await listNotificationsForUser(env.BALTICM_DB,user.id))}catch(e){return json({error:String(e.message||e)},500)}}
async function userNotificationsRead(req,env,user){try{const body=await req.json().catch(()=>({}));const result=await markNotificationRead(env.BALTICM_DB,user.id,body.id);if(result.error)return json({error:result.error},result.status||400);return json(result)}catch(e){return json({error:String(e.message||e)},500)}}
async function userNotificationsReadAll(env,user){try{return json(await markAllNotificationsRead(env.BALTICM_DB,user.id))}catch(e){return json({error:String(e.message||e)},500)}}
async function adminNotificationsList(env,user){const denied=adminDenied(env,user);if(denied)return denied;try{return json(await listSystemNotifications(env.BALTICM_DB))}catch(e){return json({error:String(e.message||e)},500)}}
async function adminPublishNotification(req,env,user){const denied=adminDenied(env,user);if(denied)return denied;try{const body=await req.json().catch(()=>({}));const result=await publishSystemNotification(env.BALTICM_DB,{title:body.title,message:body.message,href:body.href,id:crypto.randomUUID(),now:new Date().toISOString()});if(result.error)return json({error:result.error},result.status||400);return json(result)}catch(e){return json({error:String(e.message||e)},500)}}
async function prepareSupportAdminDelete(env){
 await ensureSupportChatTables(env);
 await ensureTypingTable(env.BALTICM_DB);
 await ensureSupportFeedbackTable(env.BALTICM_DB);
 await ensureNotificationTables(env.BALTICM_DB);
 await ensureAdminAuditLogTable(env);
}
async function adminSupportDeleteMessage(req,env,user){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  await prepareSupportAdminDelete(env);
  const body=await req.json().catch(()=>({}));
  const result=await deleteSupportMessageRecord(env.BALTICM_DB,{threadId:body.threadId,messageId:body.messageId,actorId:String(user.id||"")});
  if(result.error)return json({error:result.error},result.status||400);
  return json(result);
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function adminSupportDeleteConversation(req,env,user){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  await prepareSupportAdminDelete(env);
  const body=await req.json().catch(()=>({}));
  const result=await deleteClosedSupportConversation(env.BALTICM_DB,{threadId:body.threadId,actorId:String(user.id||"")});
  if(result.error)return json({error:result.error},result.status||400);
  return json(result);
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function adminSupportStatus(req,env,user){const denied=adminDenied(env,user);if(denied)return denied;try{await ensureSupportChatTables(env);const body=await req.json().catch(()=>({})),threadId=String(body.threadId||"").trim(),status=String(body.status||"").trim();if(!threadId)return json({error:"Thread is required"},400);if(!["open","waiting_staff","waiting_customer","closed"].includes(status))return json({error:"Invalid status"},400);const existing=await env.BALTICM_DB.prepare("SELECT id,user_id AS userId,status FROM bot_support_threads WHERE id=?").bind(threadId).first();if(!existing)return json({error:"Conversation not found"},404);const now=new Date().toISOString(),r=await env.BALTICM_DB.prepare("UPDATE bot_support_threads SET status=?,updated_at=? WHERE id=?").bind(status,now,threadId).run();if(!r.meta?.changes)return json({error:"Conversation not found"},404);if(status==="closed"){await rotateCustomerAiSession(env.BALTICM_DB,existing.userId);await setSupportTyping(env.BALTICM_DB,threadId,"user",false);await setSupportTyping(env.BALTICM_DB,threadId,"staff",false)}return json({ok:true,status})}catch(e){return json({error:String(e.message||e)},500)}}

async function ensureBotConfigTable(env){if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run()}
async function readPremiumRaw(env,guildId){await ensureBotConfigTable(env);const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key=?").bind(premiumPlanKey(guildId)).first();if(!row?.value)return {plan:"free",source:"",startsAt:"",expiresAt:""};try{const v=JSON.parse(row.value);return {plan:String(v.plan||"free"),source:String(v.source||""),startsAt:String(v.startsAt||""),expiresAt:String(v.expiresAt||""),revokedAt:v.revokedAt?String(v.revokedAt):undefined,code:v.code?String(v.code):undefined}}catch{return {plan:"free",source:"",startsAt:"",expiresAt:""}}}
async function writePremiumPlan(env,guildId,value){await ensureBotConfigTable(env);await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(premiumPlanKey(guildId),JSON.stringify(value),new Date().toISOString()).run()}
async function listBotGuilds(env){const r=await fetch("https://discord.com/api/v10/users/@me/guilds",{headers:botHeaders(env)});if(!r.ok)throw new Error("Could not list bot guilds ("+r.status+")");const guilds=await r.json();return Array.isArray(guilds)?guilds:[]}
async function fetchGuildOwner(env,guildId){try{const gr=await fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)});if(!gr.ok)return {ownerId:"",ownerName:"",guildName:""};const g=await gr.json();const ownerId=String(g.owner_id||"");let ownerName="";if(ownerId){try{const ur=await fetch(`https://discord.com/api/v10/users/${ownerId}`,{headers:botHeaders(env)});if(ur.ok){const u=await ur.json();ownerName=String(u.global_name||u.username||"")}}catch{}}return {ownerId,ownerName,guildName:String(g.name||""),icon:g.icon||null}}catch{return {ownerId:"",ownerName:"",guildName:""}}}
async function loadPremiumMap(env){await ensureBotConfigTable(env);const r=await env.BALTICM_DB.prepare("SELECT key,value FROM bot_config WHERE key LIKE 'premium-plan:%'").all();const map=new Map();for(const row of r.results||[]){const gid=String(row.key||"").slice("premium-plan:".length);if(!gid)continue;try{const v=JSON.parse(row.value);map.set(gid,{plan:String(v.plan||"free"),source:String(v.source||""),startsAt:String(v.startsAt||""),expiresAt:String(v.expiresAt||"")})}catch{map.set(gid,{plan:"free",source:"",startsAt:"",expiresAt:""})}}return map}
async function adminSubscriptionsList(req,env,user){const denied=adminDenied(env,user);if(denied)return denied;try{const q=String(new URL(req.url).searchParams.get("q")||"").trim();const now=Date.now();const [guilds,premiumMap]=await Promise.all([listBotGuilds(env),loadPremiumMap(env)]);const byId=new Map();for(const g of guilds){const id=String(g.id);byId.set(id,{guildId:id,guildName:String(g.name||""),icon:g.icon||null,state:premiumMap.get(id)||{plan:"free",source:"",startsAt:"",expiresAt:""}})}for(const [id,state] of premiumMap){if(!byId.has(id))byId.set(id,{guildId:id,guildName:"",icon:null,state})}let rows=[...byId.values()].map(x=>buildSubscriptionRow({...x,now}));rows=rows.filter(r=>matchesSubscriptionSearch(r,q));rows.sort((a,b)=>{const rank=s=>({ACTIVE:0,EXPIRED:1,FREE:2}[s]??3);const d=rank(a.status)-rank(b.status);if(d)return d;return String(a.guildName||a.guildId).localeCompare(String(b.guildName||b.guildId))});const enrich=rows.slice(0,40);for(let i=0;i<enrich.length;i+=8){const batch=enrich.slice(i,i+8);await Promise.all(batch.map(async row=>{if(row.ownerId&&row.guildName)return;const info=await fetchGuildOwner(env,row.guildId);if(info.guildName&&!row.guildName)row.guildName=info.guildName;if(info.ownerId){row.ownerId=info.ownerId;row.ownerName=info.ownerName}if(info.icon&&!row.icon)row.icon=info.icon}))}if(q&&/^\d{16,22}$/.test(q)&&!rows.some(r=>r.guildId===q)){const state=premiumMap.get(q)||await readPremiumRaw(env,q);const info=await fetchGuildOwner(env,q);rows.unshift(buildSubscriptionRow({guildId:q,guildName:info.guildName,ownerId:info.ownerId,ownerName:info.ownerName,icon:info.icon,state,now}))}return json({servers:rows,total:rows.length})}catch(e){return json({error:String(e.message||e)},500)}}
async function adminSubscriptionAction(req,env,user,action){const denied=adminDenied(env,user);if(denied)return denied;try{const body=await req.json().catch(()=>({}));const guildId=String(body.guildId||"").trim();if(!/^\d{16,22}$/.test(guildId))return json({error:"Valid Guild ID is required"},400);const days=body.days;const current=await readPremiumRaw(env,guildId);const now=new Date();let result;if(action==="grant"){result=computeGrantVip(current,days,now);if(result.error)return json({error:result.error,code:result.code},409)}else if(action==="extend"){result=computeExtendVip(current,days,now)}else if(action==="revoke"){result=computeRevokeVip(current,now)}else return json({error:"Unknown action"},400);await writePremiumPlan(env,guildId,result.value);await syncGuildBotNickname(env,guildId);await addActivityLog(env,guildId,{actorId:user.id,actorName:String(user.global_name||user.username||"Admin"),action:"VIP "+action,target:guildId,source:"ADMIN",details:action==="revoke"?"Revoked VIP":((result.days||"")+" days")});const info=await fetchGuildOwner(env,guildId);return json({ok:true,action,server:buildSubscriptionRow({guildId,guildName:info.guildName||"",ownerId:info.ownerId,ownerName:info.ownerName,icon:info.icon,state:result.value})})}catch(e){return json({error:String(e.message||e)},500)}}

async function adminSettingsOverview(req,env,user){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  let database={status:"error",message:"BALTICM_DB binding is not configured"};
  if(env.BALTICM_DB){
   try{
    await env.BALTICM_DB.prepare("SELECT 1 AS ok").first();
    database={status:"ok",message:""};
   }catch(e){
    database={status:"error",message:String(e.message||e)};
   }
  }
  const origin=publicAppOrigin(env,req);
  const targets=[
   {name:"Main Bot",url:"https://balticm.eu/discord-bot/",kind:"CORE SERVICE"},
   {name:"Reaction Roles",url:"https://balticm.eu/reactions/",kind:"MODULE"},
   {name:"Music Bot",url:"https://balticm.eu/music/",kind:"MODULE"},
   {name:"Voice Create",url:"https://balticm.eu/voice/",kind:"MODULE"},
   {name:"Bot Center",url:origin+"/api/status-public",kind:"CONTROL CENTER",self:true}
  ];
  const healthServices=await Promise.all(targets.map(async target=>{
   if(target.self)return{name:target.name,kind:target.kind,ok:true,status:200};
   try{
    const r=await fetch(target.url,{headers:{Accept:"application/json,text/plain,*/*","Cache-Control":"no-cache"}});
    return{name:target.name,kind:target.kind,ok:r.ok,status:r.status};
   }catch{
    return{name:target.name,kind:target.kind,ok:false,status:0};
   }
  }));
  return json(buildAdminSettingsPayload({env,database,healthServices}));
 }catch(e){return json({error:String(e.message||e)},500)}
}

async function adminTebexOverview(env,user){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  await ensureTebexPaymentsTable(env);
  await ensureTebexWebhookEventsTable(env);
  const config=buildTebexConfigStatus(env);
  const payRes=await env.BALTICM_DB.prepare("SELECT payment_id AS paymentId,event_id AS eventId,discord_user_id AS discordUserId,guild_id AS guildId,package_id AS packageId,amount,currency,status,basket_ident AS basketIdent,created_at AS createdAt,updated_at AS updatedAt FROM tebex_payments ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 200").all();
  const payments=(payRes.results||[]).map(r=>formatTebexPaymentRow(r,TEBEX_VIP_PACKAGE_NAME));
  let packageId=config.packageId;
  if(!packageId){
   const fromPay=payments.find(p=>p.packageId)?.packageId||"";
   packageId=fromPay||"";
  }
  const evRes=await env.BALTICM_DB.prepare("SELECT id,type,payment_id AS paymentId,received_at AS receivedAt,handled FROM tebex_webhook_events ORDER BY received_at DESC LIMIT 100").all();
  const webhookEvents=(evRes.results||[]).map(formatTebexWebhookEventRow);
  const webhook=buildTebexWebhookCard({lastEvent:webhookEvents[0]||null,lastPayment:payments[0]||null});
  webhook.eventsStored=true;
  return json({
   ok:true,
   config:{...config,packageId:packageId||config.packageId||""},
   webhook,
   payments,
   webhookEvents
  });
 }catch(e){return json({error:String(e.message||e)},500)}
}

async function ensureAdminAuditLogTable(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare(`CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  actor_discord_id TEXT NOT NULL DEFAULT '',
  guild_id TEXT NOT NULL DEFAULT '',
  reference TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT ''
 )`).run();
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC)").run();
}

async function adminAssistantAsk(req,env,user){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  let question="";
  if(req.method==="GET"){
   question=String(new URL(req.url).searchParams.get("q")||new URL(req.url).searchParams.get("question")||"").trim();
  }else{
   const body=await req.json().catch(()=>({}));
   question=String(body.question||body.q||body.message||"").trim();
  }
  const intent=matchAssistantIntent(question);
  if(!intent){
   const payload={ok:true,intent:null,reply:ASSISTANT_FALLBACK,readOnly:true};
   return json(payload);
  }

  const now=Date.now();
  const dayStart=new Date();dayStart.setUTCHours(0,0,0,0);
  const dayIso=dayStart.toISOString();

  if(intent==="platform_status"){
   let database={status:"unknown",message:""};
   if(env.BALTICM_DB){
    try{await env.BALTICM_DB.prepare("SELECT 1 AS ok").first();database={status:"ok",message:""}}
    catch(e){database={status:"error",message:String(e.message||e)}}
   }else database={status:"error",message:"BALTICM_DB binding is not configured"};
   const origin=publicAppOrigin(env,req);
   const targets=[
    {name:"Main Bot",url:"https://balticm.eu/discord-bot/",kind:"CORE SERVICE"},
    {name:"Reaction Roles",url:"https://balticm.eu/reactions/",kind:"MODULE"},
    {name:"Music Bot",url:"https://balticm.eu/music/",kind:"MODULE"},
    {name:"Voice Create",url:"https://balticm.eu/voice/",kind:"MODULE"},
    {name:"Bot Center",url:origin+"/api/status-public",kind:"CONTROL CENTER",self:true}
   ];
   const healthServices=await Promise.all(targets.map(async target=>{
    if(target.self)return{name:target.name,kind:target.kind,ok:true,status:200};
    try{
     const r=await fetch(target.url,{headers:{Accept:"application/json,text/plain,*/*","Cache-Control":"no-cache"}});
     return{name:target.name,kind:target.kind,ok:r.ok,status:r.status};
    }catch{return{name:target.name,kind:target.kind,ok:false,status:0}}
   }));
   const built=buildAssistantResponse(intent,{healthServices,database,env,checkedAt:new Date().toISOString()});
   const payload={ok:true,readOnly:true,...built};
   if(!assistantPayloadHasNoSecrets(payload))return json({ok:true,intent:null,reply:ASSISTANT_FALLBACK,readOnly:true});
   return json(payload);
  }

  if(!env.BALTICM_DB){
   return json({ok:true,intent,reply:"D1 is not configured — no stored platform data.",readOnly:true,empty:true});
  }

  if(intent==="recent_errors"){
   // No dedicated error table exists; only surface rows that look like errors if present.
   await ensureActivityLogTable(env);
   await ensureAdminAuditLogTable(env);
   const [actRes,audRes]=await Promise.all([
    env.BALTICM_DB.prepare("SELECT id,guild_id AS guildId,actor_id AS actorId,action,target,source,details,created_at AS createdAt FROM activity_logs WHERE LOWER(action) LIKE '%error%' OR LOWER(details) LIKE '%error%' OR LOWER(action) LIKE '%fail%' ORDER BY created_at DESC LIMIT 50").all().catch(()=>({results:[]})),
    env.BALTICM_DB.prepare("SELECT id,created_at AS createdAt,category,action,actor_discord_id AS actorDiscordId,guild_id AS guildId,reference,status,details FROM admin_audit_log WHERE LOWER(category)='error' OR LOWER(action) LIKE '%error%' OR LOWER(status) LIKE '%fail%' OR LOWER(details) LIKE '%error%' ORDER BY created_at DESC LIMIT 50").all().catch(()=>({results:[]}))
   ]);
   const rows=[
    ...(actRes.results||[]).map(r=>({createdAt:r.createdAt,source:r.source||"activity_logs",action:r.action,guildId:r.guildId,details:r.details})),
    ...(audRes.results||[]).map(r=>({createdAt:r.createdAt,source:r.category||"admin_audit_log",action:r.action,guildId:r.guildId,details:r.details}))
   ].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
   const built=buildAssistantResponse(intent,{rows});
   return json({ok:true,readOnly:true,...built});
  }

  if(intent==="what_happened"){
   await ensureTebexPaymentsTable(env);
   await ensureVipCodeTables(env);
   await ensureActivityLogTable(env);
   await ensureSupportChatTables(env);
   const [payRes,redeemRes,actRes,supRes]=await Promise.all([
    env.BALTICM_DB.prepare("SELECT payment_id AS paymentId,guild_id AS guildId,status,amount,currency,created_at AS createdAt,updated_at AS updatedAt FROM tebex_payments WHERE COALESCE(updated_at,created_at)>=? ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 40").bind(dayIso).all().catch(()=>({results:[]})),
    env.BALTICM_DB.prepare("SELECT id,code,guild_id AS guildId,redeemed_at AS redeemedAt,result FROM vip_code_redemptions WHERE redeemed_at>=? ORDER BY redeemed_at DESC LIMIT 40").bind(dayIso).all().catch(()=>({results:[]})),
    env.BALTICM_DB.prepare("SELECT id,guild_id AS guildId,action,source,details,created_at AS createdAt FROM activity_logs WHERE created_at>=? AND UPPER(source) IN ('ADMIN','TEBEX') ORDER BY created_at DESC LIMIT 40").bind(dayIso).all().catch(()=>({results:[]})),
    env.BALTICM_DB.prepare("SELECT id,status,updated_at AS updatedAt FROM bot_support_threads WHERE updated_at>=? ORDER BY updated_at DESC LIMIT 40").bind(dayIso).all().catch(()=>({results:[]}))
   ]);
   const events=[
    ...(payRes.results||[]).map(r=>({createdAt:r.updatedAt||r.createdAt,kind:"payment",action:"payment."+String(r.status||""),reference:r.paymentId,guildId:r.guildId})),
    ...(redeemRes.results||[]).map(r=>({createdAt:r.redeemedAt,kind:"vip_code",action:"code_redeemed",reference:r.code,guildId:r.guildId})),
    ...(actRes.results||[]).map(r=>({createdAt:r.createdAt,kind:String(r.source||"admin").toLowerCase(),action:r.action,reference:String(r.details||"").slice(0,80),guildId:r.guildId})),
    ...(supRes.results||[]).map(r=>({createdAt:r.updatedAt,kind:"support",action:"thread."+String(r.status||""),reference:r.id,guildId:""}))
   ].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
   const built=buildAssistantResponse(intent,{events,dayLabel:"today (UTC)"});
   return json({ok:true,readOnly:true,...built});
  }

  if(intent==="recent_payments"){
   await ensureTebexPaymentsTable(env);
   const payRes=await env.BALTICM_DB.prepare("SELECT payment_id AS paymentId,event_id AS eventId,discord_user_id AS discordUserId,guild_id AS guildId,package_id AS packageId,amount,currency,status,basket_ident AS basketIdent,created_at AS createdAt,updated_at AS updatedAt FROM tebex_payments ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 15").all();
   const built=buildAssistantResponse(intent,{payments:payRes.results||[]});
   return json({ok:true,readOnly:true,...built});
  }

  if(intent==="active_vip"||intent==="vip_expiring"){
   const premiumMap=await loadPremiumMap(env);
   const premiumRows=[...premiumMap.entries()].map(([guildId,state])=>({guildId,state}));
   const built=buildAssistantResponse(intent,{premiumRows,now});
   return json({ok:true,readOnly:true,...built});
  }

  if(intent==="vip_activity"){
   await ensureVipCodeTables(env);
   const redeemRes=await env.BALTICM_DB.prepare("SELECT id,code_id AS codeId,code,discord_user_id AS discordUserId,guild_id AS guildId,guild_name AS guildName,redeemed_at AS redeemedAt,duration_days AS durationDays,result FROM vip_code_redemptions ORDER BY redeemed_at DESC LIMIT 20").all();
   const built=buildAssistantResponse(intent,{redemptions:redeemRes.results||[]});
   return json({ok:true,readOnly:true,...built});
  }

  if(intent==="failed_webhooks"){
   await ensureTebexWebhookEventsTable(env);
   const evRes=await env.BALTICM_DB.prepare("SELECT id,type,payment_id AS paymentId,received_at AS receivedAt,handled FROM tebex_webhook_events ORDER BY received_at DESC LIMIT 200").all();
   const built=buildAssistantResponse(intent,{events:evRes.results||[]});
   return json({ok:true,readOnly:true,...built});
  }

  if(intent==="support_overview"){
   await ensureSupportChatTables(env);
   const r=await env.BALTICM_DB.prepare("SELECT id,status,unread_staff AS unreadStaff,updated_at AS updatedAt FROM bot_support_threads ORDER BY updated_at DESC LIMIT 500").all();
   const built=buildAssistantResponse(intent,{threads:r.results||[]});
   return json({ok:true,readOnly:true,...built});
  }

  return json({ok:true,intent:null,reply:ASSISTANT_FALLBACK,readOnly:true});
 }catch(e){return json({error:String(e.message||e)},500)}
}

async function adminLogsList(req,env,user){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  await ensureTebexPaymentsTable(env);
  await ensureTebexWebhookEventsTable(env);
  await ensureVipCodeTables(env);
  await ensureActivityLogTable(env);
  await ensureSupportChatTables(env);
  await ensureAdminAuditLogTable(env);

  const url=new URL(req.url);
  const q=String(url.searchParams.get("q")||"").trim();
  const category=String(url.searchParams.get("category")||"all").trim();
  const status=String(url.searchParams.get("status")||"all").trim();

  const [payRes,whRes,codeRes,redeemRes,actRes,supRes,audRes]=await Promise.all([
   env.BALTICM_DB.prepare("SELECT payment_id AS paymentId,discord_user_id AS discordUserId,guild_id AS guildId,amount,currency,status,created_at AS createdAt,updated_at AS updatedAt FROM tebex_payments ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 200").all(),
   env.BALTICM_DB.prepare("SELECT id,type,payment_id AS paymentId,received_at AS receivedAt,handled FROM tebex_webhook_events ORDER BY received_at DESC LIMIT 200").all(),
   env.BALTICM_DB.prepare("SELECT id,code,duration_days AS durationDays,status,created_at AS createdAt,created_by AS createdBy FROM vip_codes WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200").all(),
   env.BALTICM_DB.prepare("SELECT id,code_id AS codeId,code,discord_user_id AS discordUserId,guild_id AS guildId,guild_name AS guildName,redeemed_at AS redeemedAt,duration_days AS durationDays,result FROM vip_code_redemptions ORDER BY redeemed_at DESC LIMIT 200").all(),
   env.BALTICM_DB.prepare("SELECT id,guild_id AS guildId,actor_id AS actorId,action,target,source,details,created_at AS createdAt FROM activity_logs WHERE UPPER(source) IN ('ADMIN','TEBEX') ORDER BY created_at DESC LIMIT 200").all(),
   env.BALTICM_DB.prepare("SELECT m.id,m.thread_id AS threadId,m.sender_type AS senderType,m.sender_id AS senderId,m.message,m.created_at AS createdAt,t.guild_id AS guildId,t.guild_name AS guildName,t.status AS threadStatus FROM bot_support_messages m LEFT JOIN bot_support_threads t ON t.id=m.thread_id ORDER BY m.created_at DESC LIMIT 200").all(),
   env.BALTICM_DB.prepare("SELECT id,created_at AS createdAt,category,action,actor_discord_id AS actorDiscordId,guild_id AS guildId,reference,status,details FROM admin_audit_log ORDER BY created_at DESC LIMIT 200").all()
  ]);

  const raw=[
   ...(payRes.results||[]).map(logRowFromPayment),
   ...(whRes.results||[]).map(logRowFromWebhookEvent),
   ...(codeRes.results||[]).map(logRowFromVipCodeCreate),
   ...(redeemRes.results||[]).map(logRowFromVipCodeRedeem),
   ...(actRes.results||[]).map(logRowFromActivity),
   ...(supRes.results||[]).map(logRowFromSupportMessage),
   ...(audRes.results||[]).map(logRowFromAudit)
  ];
  const events=mergeAdminLogRows(raw,{q,category,status}).slice(0,500);
  const counts={
   payment:(payRes.results||[]).length,
   webhook:(whRes.results||[]).length,
   vip_code:(codeRes.results||[]).length+(redeemRes.results||[]).length,
   vip:(actRes.results||[]).filter(r=>/vip/i.test(String(r.action||""))).length,
   admin:(actRes.results||[]).filter(r=>String(r.source||"").toUpperCase()==="ADMIN").length,
   support:(supRes.results||[]).length,
   audit:(audRes.results||[]).length,
   system:0,
   error:0
  };
  return json({
   ok:true,
   events,
   categories:ADMIN_LOG_CATEGORIES,
   emptyCategories:buildEmptyCategoryNotes(counts),
   sources:{
    tebex_payments:true,
    tebex_webhook_events:true,
    vip_codes:true,
    vip_code_redemptions:true,
    activity_logs_admin_tebex:true,
    bot_support_messages:true,
    admin_audit_log:true
   },
   total:events.length
  });
 }catch(e){return json({error:String(e.message||e)},500)}
}

async function ensureActivityLogTable(env){await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS activity_logs (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,actor_id TEXT DEFAULT '',actor_name TEXT DEFAULT '',action TEXT NOT NULL,target TEXT DEFAULT '',source TEXT NOT NULL,details TEXT DEFAULT '',created_at TEXT NOT NULL)").run();await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_activity_logs_guild_created ON activity_logs(guild_id,created_at DESC)").run()}
async function addActivityLog(env,guildId,{actorId="",actorName="",action,target="",source="BALTICM",details=""}){try{await ensureActivityLogTable(env);await env.BALTICM_DB.prepare("INSERT INTO activity_logs (id,guild_id,actor_id,actor_name,action,target,source,details,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),guildId,String(actorId||""),String(actorName||""),String(action||""),String(target||""),String(source||"BALTICM").toUpperCase(),String(details||""),new Date().toISOString()).run()}catch(e){}}
async function syncDiscordAuditLogs(env,guildId){
 try{
  const ar=await fetch(`https://discord.com/api/v10/guilds/${guildId}/audit-logs?limit=50`,{headers:botHeaders(env)});
  if(!ar.ok)return;
  const data=await ar.json(),users=new Map((data.users||[]).map(x=>[String(x.id),x])),roles=new Map(),channels=new Map();
  try{const rr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`,{headers:botHeaders(env)});if(rr.ok)for(const x of await rr.json())roles.set(String(x.id),x.name)}catch{}
  try{const ch=await cachedGuildChannels(env,guildId);for(const x of ch||[])channels.set(String(x.id),x.name)}catch{}
  const actionNames={10:"Channel created",11:"Channel updated",12:"Channel deleted",20:"Member kicked",22:"Member banned",23:"Member unbanned",24:"Member updated",25:"Member roles updated",30:"Role created",31:"Role updated",32:"Role deleted",40:"Invite created",42:"Invite deleted",72:"Message deleted",73:"Messages bulk deleted",80:"Integration created",82:"Integration deleted"};
  const auditChangeName=(changes,prefer)=>{
   const row=(Array.isArray(changes)?changes:[]).find(x=>x&&x.key==="name");
   if(!row)return "";
   if(prefer==="old")return String(row.old_value??row.new_value??"").trim();
   return String(row.new_value??row.old_value??"").trim();
  };
  for(const e of data.audit_log_entries||[]){
   const type=Number(e.action_type);let label=actionNames[type];if(!label)continue;
   const snow=BigInt(e.id),createdAt=new Date(Number((snow>>22n)+1420070400000n)).toISOString();
   if(Date.now()-new Date(createdAt).getTime()>86400000)continue;
   const id="discord:"+e.id,exists=await env.BALTICM_DB.prepare("SELECT id FROM activity_logs WHERE id=?").bind(id).first();if(exists)continue;
   const actor=users.get(String(e.user_id||"")),actorName=actor?.global_name||actor?.username||String(e.user_id||"Discord");
   let target=String(e.target_id||""),details=e.reason?("Reason: "+e.reason):"";
   if(type===10||type===11||type===12){
    const targetId=target;
    const named=auditChangeName(e.changes,type===12?"old":"new")||channels.get(targetId)||"";
    target=named||(type===12?"Deleted channel":"Unknown channel");
    if(targetId)details=[details,("channelId="+targetId)].filter(Boolean).join(" · ");
   }else if(type===30||type===31||type===32){
    const targetId=target;
    const named=auditChangeName(e.changes,type===32?"old":"new")||roles.get(targetId)||"";
    target=named||(type===32?"Deleted role":"Unknown role");
    if(targetId)details=[details,("roleId="+targetId)].filter(Boolean).join(" · ");
   }else if(type===25){
    const changes=e.changes||[],added=changes.find(x=>x.key==="$add")?.new_value||[],removed=changes.find(x=>x.key==="$remove")?.new_value||[];
    const targetUser=users.get(String(e.target_id||""));target=targetUser?.global_name||targetUser?.username||target;
    if(added.length||removed.length){const bits=[];if(added.length)bits.push("Added: "+added.map(x=>x.name||roles.get(String(x.id))||x.id).join(", "));if(removed.length)bits.push("Removed: "+removed.map(x=>x.name||roles.get(String(x.id))||x.id).join(", "));details=bits.join(" · ");label=added.length&&!removed.length?"Role assigned":removed.length&&!added.length?"Role removed":"Member roles updated"}
    else{const bits=[];for(const ch of changes){if(ch.key==="nick")bits.push("Nickname: "+String(ch.old_value??"None")+" → "+String(ch.new_value??"None"));else if(ch.key==="communication_disabled_until")bits.push(ch.new_value?"Timeout until: "+ch.new_value:"Timeout removed");else if(ch.key==="mute")bits.push("Server mute: "+(ch.new_value?"On":"Off"));else if(ch.key==="deaf")bits.push("Server deaf: "+(ch.new_value?"On":"Off"));}if(bits.length){details=bits.join(" · ");label=bits[0].startsWith("Nickname")?"Nickname changed":bits[0].startsWith("Timeout")?"Timeout changed":"Member updated"}else details="Member settings changed"}
   }
   await env.BALTICM_DB.prepare("INSERT INTO activity_logs (id,guild_id,actor_id,actor_name,action,target,source,details,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,guildId,String(e.user_id||""),actorName,label,target,"DISCORD",details,createdAt).run();
  }
 }catch(e){}
}
function activityLogPage(guildId,searchParams,total){
 const pageSize=25;
 const requested=Math.floor(Number(searchParams?.get("page")));
 const user=String(searchParams?.get("user")||"all").trim().slice(0,100);
 const action=String(searchParams?.get("action")||"all").trim().toLowerCase();
 const source=String(searchParams?.get("source")||"all").trim().toUpperCase();
 const where=["guild_id=?"],binds=[guildId];
 if(user&&user!=="all"){where.push("(CASE WHEN actor_id!='' THEN actor_id ELSE actor_name END)=?");binds.push(user)}
 if(["moderation","role","announcement","giveaway"].includes(action)){where.push("LOWER(action) LIKE ?");binds.push("%"+action+"%")}
 if(source==="DISCORD"||source==="BALTICM"){where.push("source=?");binds.push(source)}
 const count=Math.max(0,Number(total)||0),pages=Math.max(1,Math.ceil(count/pageSize));
 const page=Math.min(pages,Number.isFinite(requested)&&requested>0?requested:1);
 return {pageSize,page,pages,offset:(page-1)*pageSize,whereSql:where.join(" AND "),binds};
}
const activityLogTargetNameCache=new Map();
function activityLogMemberTargetIds(events,guildId){
 const guild=String(guildId||"");
 return [...new Set((Array.isArray(events)?events:[]).map(event=>String(event?.target||"").trim()).filter(id=>/^\d{16,22}$/.test(id)&&id!==guild))];
}
function activityLogEntityKind(action){
 const a=String(action||"").toLowerCase();
 if(a==="channel created"||a==="channel updated"||a==="channel deleted")return "channel";
 if(a==="role created"||a==="role updated"||a==="role deleted")return "role";
 return "";
}
function activityLogEntityFallback(kind,action){
 const deleted=/deleted/i.test(String(action||""));
 if(kind==="channel")return deleted?"Deleted channel":"Unknown channel";
 if(kind==="role")return deleted?"Deleted role":"Unknown role";
 return "";
}
function activityLogDetailsId(details,key){
 const m=String(details||"").match(new RegExp("(?:^|[\\s·•])"+key+"=(\\d{16,22})(?:\\b|$)","i"));
 return m?m[1]:"";
}
async function resolveActivityLogGuildName(env,guildId){
 const id=String(guildId||"");
 if(!/^\d{16,22}$/.test(id)||!env.DISCORD_BOT_TOKEN)return "";
 const key="guild:"+id,hit=activityLogTargetNameCache.get(key);
 if(hit&&hit.exp>Date.now())return hit.name;
 if(hit)activityLogTargetNameCache.delete(key);
 let name="";
 try{
  const gr=await fetch(`https://discord.com/api/v10/guilds/${id}`,{headers:botHeaders(env)});
  if(gr.ok){const guild=await gr.json();name=String(guild.name||"").trim()}
 }catch{}
 if(name)activityLogTargetNameCache.set(key,{name,exp:Date.now()+60000});
 return name;
}
function activityLogIsPlaceholderTarget(target){
 return /^(Deleted channel|Deleted role|Unknown channel|Unknown role)$/i.test(String(target||"").trim());
}
function activityLogHistoryNamesFromEvents(events){
 const names=new Map();
 for(const event of Array.isArray(events)?events:[]){
  const kind=activityLogEntityKind(event?.action);
  if(kind!=="channel"&&kind!=="role")continue;
  const raw=String(event?.target||"").trim();
  if(!raw||/^\d{16,22}$/.test(raw)||activityLogIsPlaceholderTarget(raw))continue;
  const id=activityLogDetailsId(event?.details,kind==="channel"?"channelId":"roleId");
  if(id)names.set(id,raw);
 }
 return names;
}
async function resolveActivityLogNamesFromHistory(env,guildId,ids,detailKey){
 const names=new Map();
 const list=[...new Set((Array.isArray(ids)?ids:[]).map(id=>String(id||"").trim()).filter(id=>/^\d{16,22}$/.test(id)))];
 if(!list.length||!env?.BALTICM_DB)return names;
 await Promise.all(list.map(async id=>{
  try{
   const like="%"+detailKey+"="+id+"%";
   const rows=await env.BALTICM_DB.prepare("SELECT target FROM activity_logs WHERE guild_id=? AND details LIKE ? AND target!='' ORDER BY created_at DESC LIMIT 8").bind(String(guildId||""),like).all();
   for(const row of rows?.results||[]){
    const target=String(row?.target||"").trim();
    if(target&&!/^\d{16,22}$/.test(target)&&!activityLogIsPlaceholderTarget(target)){names.set(id,target);break}
   }
  }catch{}
 }));
 return names;
}
async function resolveActivityLogMemberTargets(env,guildId,events){
 const list=Array.isArray(events)?events:[];
 if(!env.DISCORD_BOT_TOKEN)return list;
 const guild=String(guildId||"");
 const guildName=list.some(event=>String(event?.target||"").trim()===guild)?await resolveActivityLogGuildName(env,guild):"";
 const names=new Map();
 if(guildName)names.set(guild,guildName);
 const memberIds=activityLogMemberTargetIds(list,guildId).filter(id=>{
  return !list.some(event=>{
   const target=String(event?.target||"").trim();
   const kind=activityLogEntityKind(event?.action);
   return target===id&&(kind==="channel"||kind==="role");
  });
 });
 await Promise.all(memberIds.map(async id=>{
  const key="member:"+guild+":"+id,hit=activityLogTargetNameCache.get(key);
  if(hit&&hit.exp>Date.now()){names.set(id,hit.name);return}
  if(hit)activityLogTargetNameCache.delete(key);
  let name="";
  try{
   const mr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${id}`,{headers:botHeaders(env)});
   if(mr.ok){
    const member=await mr.json();
    name=String(member.nick||"").trim()||member.user?.global_name||member.user?.username||"";
   }
  }catch{}
  if(name){activityLogTargetNameCache.set(key,{name,exp:Date.now()+60000});names.set(id,name)}
 }));
 let channelMap=null,roleMap=null;
 const channelIds=[],roleIds=[];
 for(const event of list){
  const kind=activityLogEntityKind(event?.action);
  const raw=String(event?.target||"").trim();
  if(kind==="channel"){
   const id=/^\d{16,22}$/.test(raw)?raw:activityLogDetailsId(event?.details,"channelId");
   if(id)channelIds.push(id);
  }else if(kind==="role"){
   const id=/^\d{16,22}$/.test(raw)?raw:activityLogDetailsId(event?.details,"roleId");
   if(id)roleIds.push(id);
  }
 }
 const needChannels=channelIds.length>0,needRoles=roleIds.length>0;
 if(needChannels){
  try{channelMap=new Map((await cachedGuildChannels(env,guildId)||[]).map(c=>[String(c.id),c.name]))}catch{channelMap=new Map()}
 }
 if(needRoles){
  try{
   const rr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`,{headers:botHeaders(env)});
   roleMap=new Map();
   if(rr.ok)for(const role of await rr.json())roleMap.set(String(role.id),role.name);
  }catch{roleMap=new Map()}
 }
 const historyNames=activityLogHistoryNamesFromEvents(list);
 const missingChannelIds=channelIds.filter(id=>!(channelMap?.get(id)||historyNames.get(id)));
 const missingRoleIds=roleIds.filter(id=>!(roleMap?.get(id)||historyNames.get(id)));
 const [channelHistory,roleHistory]=await Promise.all([
  resolveActivityLogNamesFromHistory(env,guildId,missingChannelIds,"channelId"),
  resolveActivityLogNamesFromHistory(env,guildId,missingRoleIds,"roleId")
 ]);
 for(const[id,name]of channelHistory)historyNames.set(id,name);
 for(const[id,name]of roleHistory)historyNames.set(id,name);
 return list.map(event=>{
  const raw=String(event?.target||"").trim();
  const kind=activityLogEntityKind(event?.action);
  if(kind==="channel"||kind==="role"){
   const detailKey=kind==="channel"?"channelId":"roleId";
   const liveMap=kind==="channel"?channelMap:roleMap;
   const snowflake=/^\d{16,22}$/.test(raw)?raw:"";
   const id=snowflake||activityLogDetailsId(event?.details,detailKey);
   if(snowflake){
    const name=liveMap?.get(snowflake)||historyNames.get(snowflake)||"";
    return {...event,target:name||activityLogEntityFallback(kind,event?.action),targetId:snowflake};
   }
   if(id){
    // Keep an already-stored human name; only fall back when target is empty/placeholder.
    const keep=raw&&!activityLogIsPlaceholderTarget(raw)?raw:"";
    const name=keep||liveMap?.get(id)||historyNames.get(id)||"";
    return {...event,target:name||activityLogEntityFallback(kind,event?.action),targetId:id};
   }
   return event;
  }
  const name=names.get(raw);
  return name?{...event,target:name,targetId:raw}:event;
 });
}
async function activityLogState(env,guildId,url){
 await ensureActivityLogTable(env);
 await syncDiscordAuditLogs(env,guildId);
 const filters=activityLogPage(guildId,url?.searchParams,0);
 const countRow=await env.BALTICM_DB.prepare("SELECT COUNT(*) AS total FROM activity_logs WHERE "+filters.whereSql).bind(...filters.binds).first();
 const page=activityLogPage(guildId,url?.searchParams,Number(countRow?.total)||0);
 const r=await env.BALTICM_DB.prepare("SELECT id,actor_id AS actorId,actor_name AS actorName,action,target,source,details,created_at AS createdAt FROM activity_logs WHERE "+page.whereSql+" ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").bind(...page.binds,page.pageSize,page.offset).all();
 const actorRows=await env.BALTICM_DB.prepare("SELECT actorId, actorName FROM (SELECT actor_id AS actorId, actor_name AS actorName, ROW_NUMBER() OVER (PARTITION BY CASE WHEN actor_id!='' THEN actor_id ELSE actor_name END ORDER BY created_at DESC, id DESC) AS rn FROM activity_logs WHERE guild_id=? AND (actor_id!='' OR actor_name!='')) WHERE rn=1 ORDER BY actorName COLLATE NOCASE, actorId").bind(guildId).all();
 const actors=(actorRows.results||[]).map(row=>({id:row.actorId||row.actorName,name:row.actorName||row.actorId})).filter(row=>row.id);
 const events=await resolveActivityLogMemberTargets(env,guildId,r.results||[]);
 return json({events,total:Number(countRow?.total)||0,page:page.page,pageSize:page.pageSize,pages:page.pages,actors});
}
function sanitizeOAuthReturnPath(raw){
 const s=String(raw||"").trim();
 if(!s||s==="/")return "/";
 if(!s.startsWith("/")||s.startsWith("//")||s.includes("://")||s.includes("\\")||s.includes("@"))return "/";
 const path=s.split("?")[0].split("#")[0].replace(/\/+$/,"")||"/";
 if(path==="/premium")return "/premium";
 return "/";
}
function redirectUri(req,env){return env.DISCORD_REDIRECT_URI||new URL("/api/auth/callback",publicAppOrigin(env,req)).toString()}
async function login(req,env){
 const reqUrl=new URL(req.url);
 const returnPath=sanitizeOAuthReturnPath(reqUrl.searchParams.get("return")||reqUrl.searchParams.get("returnTo")||"/");
 const u=new URL("https://discord.com/oauth2/authorize");
 u.searchParams.set("client_id",env.DISCORD_CLIENT_ID||CLIENT_ID);u.searchParams.set("response_type","code");u.searchParams.set("redirect_uri",redirectUri(req,env));u.searchParams.set("scope","identify guilds");
 let cookieState,discordState;
 if(env.SESSION_SECRET){
  const created=await createSignedOAuthState(env.SESSION_SECRET);
  cookieState=created.nonce;discordState=created.token;
 }else{
  cookieState=discordState=crypto.randomUUID();
 }
 u.searchParams.set("state",discordState);
 const headers=new Headers({Location:u.toString(),"Cache-Control":"no-store"});
 headers.append("Set-Cookie",`${STATE}=${cookieState}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
 headers.append("Set-Cookie",`${OAUTH_RETURN}=${encodeURIComponent(returnPath)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
 return new Response(null,{status:302,headers});
}
async function callback(req,env){
 return runOAuthCallback(req,env,{
  clientId:env.DISCORD_CLIENT_ID||CLIENT_ID,
  publicOrigin:publicAppOrigin(env,req),
  redirectUri:redirectUri(req,env),
  fetchFn:fetch,
  filterOAuthGuilds:(oauthGuilds)=>{
   const out=[];
   for(const g of Array.isArray(oauthGuilds)?oauthGuilds:[]){
    try{if(g?.owner||oauthGuildHasManageAccess(g))out.push(g)}catch{}
   }
   return out;
  }
 });
}
async function session(req,env){return resolveSession(req,env.SESSION_SECRET)}
async function discordGuild(env,id){
 if(!env.DISCORD_BOT_TOKEN)return json({error:"DISCORD_BOT_TOKEN is not configured"},503);
 if(!id)return json({error:"guildId is required"},400);
 const h={Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`};
 const [g,c,r]=await Promise.all([fetch(`https://discord.com/api/v10/guilds/${id}?with_counts=true`,{headers:h}),fetch(`https://discord.com/api/v10/guilds/${id}/channels`,{headers:h}),fetch(`https://discord.com/api/v10/guilds/${id}/roles`,{headers:h})]);
 if(!g.ok){if(g.status===404)return json({error:"Bot is not installed in this server",notInstalled:true},404);return json({error:"Discord guild request failed",status:g.status},502);}
 const gd=await g.json();return json({guild:{id:gd.id,name:gd.name,icon:gd.icon,memberCount:gd.approximate_member_count,onlineCount:gd.approximate_presence_count},channels:c.ok?await c.json():[],roles:r.ok?await r.json():[]});
}

function botHeaders(env,jsonBody=false){return{Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`,...(jsonBody?{"Content-Type":"application/json; charset=utf-8"}:{})}}
function canManageGuild(user,guildId){return(user.guilds||[]).some(g=>g.id===guildId)}
function publicSessionUser(user){
 return{id:user.id,username:user.username,global_name:user.global_name,avatar:user.avatar,guilds:(user.guilds||[]).map(g=>({id:g.id,name:g.name,icon:g.icon,owner:!!g.owner}))};
}
async function mapPool(items,concurrency,fn){
 const list=Array.isArray(items)?items:[];
 const results=new Array(list.length);
 let next=0;
 const workers=Array.from({length:Math.min(Math.max(1,concurrency),Math.max(1,list.length))},async()=>{
  while(true){
   const i=next++;
   if(i>=list.length)return;
   results[i]=await fn(list[i],i);
  }
 });
 await Promise.all(workers);
 return results;
}
async function loadGuildAccessConfig(env,guildId){
 if(!env.BALTICM_DB)return{roles:[]};
 try{
  await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key=?").bind(accessSettingsKey(guildId)).first();
  let config={roles:[]};if(row?.value)try{config={roles:[],...JSON.parse(row.value)}}catch{}
  return normalizeAccessConfig(config);
 }catch{return{roles:[]}}
}
/**
 * Resolve whether a Discord user may see a guild in Control Center.
 * Owner / Manage Guild / Administrator, or BalticM RBAC V2 OPERATE|CONFIGURE on any module.
 */
async function resolveGuildAccessEntry(env,userId,guildHint,previousEntry=null){
 const id=String(guildHint?.id||"");
 if(!/^\d{16,22}$/.test(id))return null;
 const fallbackName=String(guildHint?.name||previousEntry?.name||id);
 const fallbackIcon=guildHint?.icon??previousEntry?.icon??null;
 const keepNative=previousEntry&&(previousEntry.owner||previousEntry.access==="owner"||previousEntry.access==="manage"||oauthGuildHasManageAccess(previousEntry));
 if(!env.DISCORD_BOT_TOKEN){
  if(keepNative)return{id,name:fallbackName,icon:fallbackIcon,owner:!!previousEntry.owner,access:previousEntry.owner?"owner":"manage"};
  return null;
 }
 try{
  const [gr,mr]=await Promise.all([
   fetch(`https://discord.com/api/v10/guilds/${id}`,{headers:botHeaders(env)}),
   fetch(`https://discord.com/api/v10/guilds/${id}/members/${userId}`,{headers:botHeaders(env)})
  ]);
  if(gr.status===404){
   if(keepNative)return{id,name:fallbackName,icon:fallbackIcon,owner:!!previousEntry.owner,access:previousEntry.owner?"owner":"manage"};
   return null;
  }
  if(!gr.ok){
   if(keepNative)return{id,name:fallbackName,icon:fallbackIcon,owner:!!previousEntry.owner,access:previousEntry.owner?"owner":"manage"};
   return null;
  }
  if(!mr.ok)return null;
  const guild=await gr.json();
  const member=await mr.json();
  const rr=await fetch(`https://discord.com/api/v10/guilds/${id}/roles`,{headers:botHeaders(env)});
  const discordRoles=rr.ok?await rr.json():[];
  const accessConfig=await loadGuildAccessConfig(env,id);
  return decideGuildVisibility({
   botInstalled:true,
   memberFound:true,
   guildId:id,
   guildName:guild.name||fallbackName,
   guildIcon:guild.icon??fallbackIcon,
   guildOwnerId:guild.owner_id,
   userId,
   discordRoles,
   memberRoleIds:member.roles||[],
   accessConfig
  });
 }catch{
  if(keepNative)return{id,name:fallbackName,icon:fallbackIcon,owner:!!previousEntry.owner,access:previousEntry.owner?"owner":"manage"};
  return null;
 }
}
/** Build accessible guild list from Discord OAuth guilds (login). */
async function discoverAccessibleGuildsFromOAuth(env,userId,oauthGuilds){
 const gs=Array.isArray(oauthGuilds)?oauthGuilds:[];
 const out=[];
 const seen=new Set();
 const needCheck=[];
 let botIds=null;
 if(env.DISCORD_BOT_TOKEN){
  try{botIds=new Set((await listBotGuilds(env)).map(g=>String(g.id)))}catch{botIds=new Set()}
 }
 for(const g of gs){
  const id=String(g?.id||"");
  if(!/^\d{16,22}$/.test(id)||seen.has(id))continue;
  if(oauthGuildHasManageAccess(g)){
   seen.add(id);
   out.push({id,name:g.name,icon:g.icon,owner:!!g.owner,access:g.owner?"owner":"manage"});
   continue;
  }
  if(botIds&&botIds.has(id))needCheck.push(g);
 }
 const checked=await mapPool(needCheck,5,async g=>resolveGuildAccessEntry(env,userId,g,null));
 for(const entry of checked){
  if(!entry||seen.has(entry.id))continue;
  seen.add(entry.id);
  out.push(entry);
 }
 return out.map(({id,name,icon,owner,access})=>({id,name,icon,owner:!!owner,access:access||(owner?"owner":"rbac")}));
}
/** Discover guilds from bot membership + live Discord member/roles. OAuth lists are not RBAC authority. */
async function refreshAccessibleGuilds(env,user){
 const previous=Array.isArray(user?.guilds)?user.guilds:[];
 const seen=new Set();
 const out=[];
 let botGuilds=[];
 if(env.DISCORD_BOT_TOKEN){
  try{botGuilds=await listBotGuilds(env)}catch{botGuilds=[]}
 }
 const fromBot=await mapPool(botGuilds,5,g=>resolveGuildAccessEntry(env,user.id,g,null));
 for(const entry of fromBot){
  if(!entry||seen.has(entry.id))continue;
  seen.add(entry.id);
  out.push(entry);
 }
 for(const g of previous){
  const id=String(g?.id||"");
  if(!id||seen.has(id))continue;
  if(!(g.owner||g.access==="owner"||g.access==="manage"||oauthGuildHasManageAccess(g)))continue;
  const entry=await resolveGuildAccessEntry(env,user.id,g,g);
  if(entry&&!seen.has(entry.id)){seen.add(entry.id);out.push(entry)}
 }
 return out.map(({id,name,icon,owner,access})=>({id,name,icon,owner:!!owner,access:access||(owner?"owner":"rbac")}));
}
async function controlAccessLevel(env,user,guildId,key){
 if(!/^\d{16,22}$/.test(String(guildId||"")))return ACCESS_NONE;
 const sessionGuild=(user.guilds||[]).find(g=>String(g.id)===String(guildId));
 if(!env.DISCORD_BOT_TOKEN)return sessionGuild?.owner?ACCESS_CONFIGURE:ACCESS_NONE;
 try{
  const [gr,mr]=await Promise.all([fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)}),fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${user.id}`,{headers:botHeaders(env)})]);
  if(gr.status===404)return sessionGuild?.owner?ACCESS_CONFIGURE:ACCESS_NONE;
  if(!gr.ok||!mr.ok)return ACCESS_NONE;
  const guild=await gr.json();
  if(String(guild.owner_id)===String(user.id))return ACCESS_CONFIGURE;
  const member=await mr.json();
  const rr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`,{headers:botHeaders(env)});
  const discordRoles=rr.ok?await rr.json():[];
  if(memberHasDiscordGuildManager(guildId,discordRoles,member.roles||[]))return ACCESS_CONFIGURE;
  const accessConfig=await loadGuildAccessConfig(env,guildId);
  return accessLevelFromRoles(accessConfig.roles,memberRoleIdsForAccess(guildId,member.roles||[]),key);
 }catch{return ACCESS_NONE}
}
async function controlAccess(env,user,guildId,key,minLevel=ACCESS_OPERATE){return levelMeets(await controlAccessLevel(env,user,guildId,key),minLevel)}
async function requireControlAccess(env,user,guildId,key,minLevel=ACCESS_OPERATE){
 const level=await controlAccessLevel(env,user,guildId,key);
 if(levelMeets(level,minLevel))return null;
 return json({error:"Forbidden",requiredPermission:key,requiredLevel:minLevel,accessLevel:level},403);
}

async function discordMembers(env,guildId){
 if(!env.DISCORD_BOT_TOKEN)return json({error:"DISCORD_BOT_TOKEN is not configured"},503);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`,{headers:botHeaders(env)});
 if(!r.ok)return json({error:"Discord members request failed",status:r.status},r.status===403?403:502);
 const members=await r.json();
 return json({members:members.map(m=>({id:m.user?.id,username:m.user?.username||"Unknown",globalName:m.user?.global_name||m.nick||m.user?.username||"Unknown",nick:m.nick||null,avatar:m.user?.avatar||null,roles:m.roles||[],bot:!!m.user?.bot,joinedAt:m.joined_at||null}))});
}
async function ensureDmOptOutTable(env){await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS dm_opt_outs (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, opted_out_at TEXT NOT NULL, PRIMARY KEY (guild_id,user_id))").run()}
async function dmOptOutState(env,guildId){await ensureDmOptOutTable(env);const r=await env.BALTICM_DB.prepare("SELECT user_id AS userId,opted_out_at AS optedOutAt FROM dm_opt_outs WHERE guild_id=? ORDER BY opted_out_at DESC").bind(guildId).all();return json({optedOut:r.results||[]})}
async function setDmOptOut(env,guildId,userId,optOut=true){await ensureDmOptOutTable(env);if(optOut)await env.BALTICM_DB.prepare("INSERT OR REPLACE INTO dm_opt_outs (guild_id,user_id,opted_out_at) VALUES (?,?,?)").bind(guildId,userId,new Date().toISOString()).run();else await env.BALTICM_DB.prepare("DELETE FROM dm_opt_outs WHERE guild_id=? AND user_id=?").bind(guildId,userId).run();return json({ok:true,optOut})}
async function sendDirectMessages(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const memberIds=[...new Set((Array.isArray(body.memberIds)?body.memberIds:[]).map(x=>String(x||"").trim()).filter(x=>/^\d{16,22}$/.test(x)))];
 const message=repairMojibake(String(body.message||"")).trim().slice(0,1900),embed=!!body.embed,bannerUrl=String(body.bannerUrl||"").trim().slice(0,1000);
 if(!memberIds.length)return json({error:"Select at least one member"},400);
 if(memberIds.length>100)return json({error:"Maximum 100 recipients per send"},400);
 const premiumState=await premiumPlanState(env,guildId);
 const recipientErr=dmRecipientLimitError(premiumState.premium,memberIds);
 if(recipientErr)return json({error:recipientErr,plan:premiumState.displayPlan||"FREE",premium:!!premiumState.premium},403);
 if(!premiumState.premium&&embed)return json({error:"Embed DMs require VIP",plan:"FREE",premium:false},403);
 if(!message)return json({error:"Message is required"},400);
 if(bannerUrl&&!/^https:\/\//i.test(bannerUrl))return json({error:"Banner URL must use https://"},400);
 await ensureDmOptOutTable(env);
 const oo=await env.BALTICM_DB.prepare("SELECT user_id AS userId FROM dm_opt_outs WHERE guild_id=?").bind(guildId).all(),blocked=new Set((oo.results||[]).map(x=>x.userId));
 const results=[];
 for(const memberId of memberIds){
  if(blocked.has(memberId)){results.push({memberId,ok:false,skipped:true,error:"Opted out"});continue}
  const member=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,{headers:botHeaders(env)}).then(async r=>r.ok?r.json():null).catch(()=>null);
  if(!member||member.user?.bot){results.push({memberId,ok:false,error:"Member unavailable"});continue}
  const name=member.nick||member.user?.global_name||member.user?.username||memberId;
  let ok=false;
  if(embed){
   const cr=await fetch("https://discord.com/api/v10/users/@me/channels",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify({recipient_id:memberId})});
   if(cr.ok){const ch=await cr.json(),payload={embeds:[{description:message,color:0x7457ff}],components:[{type:1,components:[{type:2,style:2,label:"Unsubscribe from news",custom_id:`dm_unsubscribe:${guildId}`}]}]};if(bannerUrl)payload.embeds[0].image={url:bannerUrl};const dr=await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});ok=dr.ok}
  }else{const cr=await fetch("https://discord.com/api/v10/users/@me/channels",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify({recipient_id:memberId})});if(cr.ok){const ch=await cr.json(),payload={content:message,components:[{type:1,components:[{type:2,style:2,label:"Unsubscribe from news",custom_id:`dm_unsubscribe:${guildId}`}]}]};const dr=await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});ok=dr.ok}}
  results.push({memberId,name,ok,error:ok?null:"DM unavailable"});
  await new Promise(resolve=>setTimeout(resolve,175));
 }
 const sent=results.filter(x=>x.ok).length,skipped=results.filter(x=>x.skipped).length;
 return json({ok:true,sent,failed:results.length-sent-skipped,skipped,total:results.length,results});
}
async function ensureReactionRoleTables(env){
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS reaction_role_panels (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',message_id TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)").run();
 try{await env.BALTICM_DB.prepare("ALTER TABLE reaction_role_panels ADD COLUMN thumbnail_url TEXT NOT NULL DEFAULT ''").run()}catch{}
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS reaction_role_links (id TEXT PRIMARY KEY,panel_id TEXT NOT NULL,guild_id TEXT NOT NULL,emoji TEXT NOT NULL,role_id TEXT NOT NULL,label TEXT NOT NULL DEFAULT '')").run();
 try{await env.BALTICM_DB.prepare("ALTER TABLE reaction_role_links ADD COLUMN emoji_id TEXT NOT NULL DEFAULT ''").run()}catch{}
 try{await env.BALTICM_DB.prepare("ALTER TABLE reaction_role_links ADD COLUMN emoji_name TEXT NOT NULL DEFAULT ''").run()}catch{}
 try{await env.BALTICM_DB.prepare("ALTER TABLE reaction_role_links ADD COLUMN emoji_animated INTEGER NOT NULL DEFAULT 0").run()}catch{}
}
async function countReactionRoleLinks(env,guildId,excludePanelId){
 await ensureReactionRoleTables(env);
 if(excludePanelId){const r=await env.BALTICM_DB.prepare("SELECT COUNT(*) AS c FROM reaction_role_links WHERE guild_id=? AND panel_id!=?").bind(guildId,excludePanelId).first();return Number(r?.c)||0}
 const r=await env.BALTICM_DB.prepare("SELECT COUNT(*) AS c FROM reaction_role_links WHERE guild_id=?").bind(guildId).first();return Number(r?.c)||0;
}
function logReaction(kind,fields){const safe={source:"reaction-roles",kind};for(const[key,value]of Object.entries(fields||{})){if(/token|secret|authorization/i.test(key))continue;safe[key]=value}console.log(JSON.stringify(safe))}
function reactionLinkNeedsEmojiList(link){
 if(/^\d{16,22}$/.test(String(link?.emojiId||"")))return false;
 const emoji=String(link?.emoji||"");
 if(/^<a?:[A-Za-z0-9_]{2,32}:\d{16,22}>$/.test(emoji))return false;
 return !isUnicodeEmoji(emoji);
}
async function loadReactionGuild(env,guildId,options={}){
 const headers=botHeaders(env),wantEmojis=options.emojis!==false;
 const [emojiRes,roleRes,meRes]=await Promise.all([
  wantEmojis?fetch(`https://discord.com/api/v10/guilds/${guildId}/emojis`,{headers}):Promise.resolve({ok:true,json:async()=>[]}),
  fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`,{headers}),
  fetch("https://discord.com/api/v10/users/@me",{headers})
 ]);
 const emojiPayload=emojiRes.ok?await emojiRes.json().catch(()=>[]):[];
 const roles=roleRes.ok?await roleRes.json().catch(()=>[]):[];
 const me=meRes.ok?await meRes.json().catch(()=>null):null;
 let memberRoleIds=[],accessKnown=false;
 if(me?.id){const memberRes=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${me.id}`,{headers});if(memberRes.ok){const member=await memberRes.json().catch(()=>null);if(member){memberRoleIds=member.roles||[];accessKnown=roleRes.ok}}}
 const emojis=emojisForGuild((Array.isArray(emojiPayload)?emojiPayload:[]).map(emoji=>({id:String(emoji.id),name:String(emoji.name||""),animated:!!emoji.animated,guildId:String(guildId)})),guildId);
 return {emojis,roles:Array.isArray(roles)?roles:[],emojiError:emojiRes.ok?"":"BalticM Bot could not load this server's custom emoji",bot:{id:me?.id||"",accessKnown,...botRoleAccess(Array.isArray(roles)?roles:[],memberRoleIds,guildId)},rolesOk:roleRes.ok};
}
async function reactionRoleState(env,guildId){
 await ensureReactionRoleTables(env);
 const [p,l,guild]=await Promise.all([
  env.BALTICM_DB.prepare("SELECT id,guild_id AS guildId,channel_id AS channelId,title,description,thumbnail_url AS thumbnailUrl,message_id AS messageId,enabled,created_at AS createdAt,updated_at AS updatedAt FROM reaction_role_panels WHERE guild_id=? ORDER BY created_at DESC").bind(guildId).all(),
  env.BALTICM_DB.prepare("SELECT id,panel_id AS panelId,guild_id AS guildId,emoji,emoji_id AS emojiId,emoji_name AS emojiName,emoji_animated AS emojiAnimated,role_id AS roleId,label FROM reaction_role_links WHERE guild_id=?").bind(guildId).all(),
  loadReactionGuild(env,guildId)
 ]);
 const links=l.results||[];
 const premiumState=await premiumPlanState(env,guildId),rrMax=reactionRoleMaxLinks(premiumState.premium);
 const panels=(p.results||[]).map(panel=>annotatePanel({...panel,enabled:!!panel.enabled,links:links.filter(link=>link.panelId===panel.id)},guild.emojis,{guildId,emojiListAvailable:!guild.emojiError}));
 return json({panels,emojis:guild.emojis,emojiError:guild.emojiError,bot:guild.bot,premium:!!premiumState.premium,plan:premiumState.displayPlan||"FREE",maxReactionRoles:Number.isFinite(rrMax)?rrMax:null,roleLinkCount:links.length});
}
async function validatedReactionLinks(env,guildId,rawLinks){
 const guild=await loadReactionGuild(env,guildId);
 const prepared=prepareReactionLinks(rawLinks,guild.emojis,{requireGuildList:true,emojiListAvailable:!guild.emojiError,guildId});
 if(prepared.errors.length)return {error:prepared.errors[0],guild};
 if(!prepared.links.length)return {error:"Add at least one emoji and role mapping",guild};
 if(!guild.rolesOk)return {error:"One or more selected roles are invalid",guild};
 for(const link of prepared.links){
  const role=guild.roles.find(item=>String(item.id)===String(link.roleId));
  if(!role)return {error:"One or more selected roles are invalid",guild};
  const block=roleAssignBlock({role:{...role,guildId},botHighestPosition:guild.bot.highestPosition,canManageRoles:guild.bot.canManageRoles,administrator:guild.bot.administrator,accessKnown:guild.bot.accessKnown,guildId});
  if(block)return {error:block,roleId:link.roleId,guild};
 }
 return {links:prepared.links,guild};
}
async function insertReactionLink(env,panelId,guildId,link){
 const id=link.rowId||crypto.randomUUID();
 await env.BALTICM_DB.prepare("INSERT INTO reaction_role_links (id,panel_id,guild_id,emoji,role_id,label,emoji_id,emoji_name,emoji_animated) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,panelId,guildId,link.emoji,link.roleId,link.label,link.emojiId||"",link.emojiName||"",link.animated?1:0).run();
}
async function saveReactionRolePanel(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const channelId=String(body.channelId||"").trim(),title=String(body.title||"").trim().slice(0,256),description=repairMojibake(String(body.description||"")).trim().slice(0,2000),thumbnailUrl=String(body.thumbnailUrl||"").trim().slice(0,1000);
 if(!/^\d{16,22}$/.test(channelId))return json({error:"Select a Discord channel"},400);
 if(!title)return json({error:"Panel title is required"},400);if(thumbnailUrl&&!/^https:\/\//i.test(thumbnailUrl))return json({error:"Thumbnail URL must use https://"},400);
 await ensureReactionRoleTables(env);
 const validated=await validatedReactionLinks(env,guildId,body.links);
 if(validated.error)return json({error:validated.error,roleId:validated.roleId||undefined},validated.error==="BalticM Bot could not load this server's custom emoji"?503:400);
 const links=validated.links;
 {const premiumState=await premiumPlanState(env,guildId),currentCount=await countReactionRoleLinks(env,guildId),nextCount=currentCount+links.length,limitErr=reactionRoleLimitError(premiumState.premium,nextCount,currentCount);
 if(limitErr){const m=reactionRoleMaxLinks(premiumState.premium);return json({error:limitErr,plan:premiumState.displayPlan||"FREE",premium:!!premiumState.premium,maxReactionRoles:Number.isFinite(m)?m:null},403)}}
 const cr=await fetch(`https://discord.com/api/v10/channels/${channelId}`,{headers:botHeaders(env)});
 if(!cr.ok)return json({error:"Channel inaccessible"},400);const ch=await cr.json();if(String(ch.guild_id||"")!==String(guildId)||ch.type!==0)return json({error:"Select a text channel from this server"},400);
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.BALTICM_DB.prepare("INSERT INTO reaction_role_panels (id,guild_id,channel_id,title,description,thumbnail_url,message_id,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,'',1,?,?)").bind(id,guildId,channelId,title,description,thumbnailUrl,now,now).run();
 for(const link of links)await insertReactionLink(env,id,guildId,link);
 return json({ok:true,id},201);
}
async function updateReactionRolePanel(req,env,guildId,id){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 await ensureReactionRoleTables(env);const current=await env.BALTICM_DB.prepare("SELECT id FROM reaction_role_panels WHERE id=? AND guild_id=?").bind(id,guildId).first();if(!current)return json({error:"Panel not found"},404);
 const channelId=String(body.channelId||"").trim(),title=String(body.title||"").trim().slice(0,256),description=repairMojibake(String(body.description||"")).trim().slice(0,2000),thumbnailUrl=String(body.thumbnailUrl||"").trim().slice(0,1000);
 if(!/^\d{16,22}$/.test(channelId)||!title)return json({error:"Channel, title and at least one mapping are required"},400);
 if(thumbnailUrl&&!/^https:\/\//i.test(thumbnailUrl))return json({error:"Thumbnail URL must use https://"},400);
 const validated=await validatedReactionLinks(env,guildId,body.links);
 if(validated.error)return json({error:validated.error,roleId:validated.roleId||undefined},validated.error==="BalticM Bot could not load this server's custom emoji"?503:400);
 const links=validated.links;
 {const premiumState=await premiumPlanState(env,guildId),otherCount=await countReactionRoleLinks(env,guildId,id),currentTotal=await countReactionRoleLinks(env,guildId),nextTotal=otherCount+links.length,limitErr=reactionRoleLimitError(premiumState.premium,nextTotal,currentTotal);
 if(limitErr){const m=reactionRoleMaxLinks(premiumState.premium);return json({error:limitErr,plan:premiumState.displayPlan||"FREE",premium:!!premiumState.premium,maxReactionRoles:Number.isFinite(m)?m:null},403)}}
 const cr=await fetch(`https://discord.com/api/v10/channels/${channelId}`,{headers:botHeaders(env)});if(!cr.ok)return json({error:"Channel inaccessible"},400);const ch=await cr.json();if(String(ch.guild_id||"")!==String(guildId)||ch.type!==0)return json({error:"Select a text channel from this server"},400);
 await env.BALTICM_DB.prepare("UPDATE reaction_role_panels SET channel_id=?,title=?,description=?,thumbnail_url=?,updated_at=? WHERE id=? AND guild_id=?").bind(channelId,title,description,thumbnailUrl,new Date().toISOString(),id,guildId).run();await env.BALTICM_DB.prepare("DELETE FROM reaction_role_links WHERE panel_id=? AND guild_id=?").bind(id,guildId).run();for(const link of links)await insertReactionLink(env,id,guildId,link);return json({ok:true});
}
async function deleteReactionRolePanel(env,guildId,id){
 await ensureReactionRoleTables(env);const p=await env.BALTICM_DB.prepare("SELECT message_id AS messageId,channel_id AS channelId FROM reaction_role_panels WHERE id=? AND guild_id=?").bind(id,guildId).first();if(!p)return json({error:"Panel not found"},404);
 if(p.messageId&&p.channelId)await fetch(`https://discord.com/api/v10/channels/${p.channelId}/messages/${p.messageId}`,{method:"DELETE",headers:botHeaders(env)}).catch(()=>{});
 await env.BALTICM_DB.prepare("DELETE FROM reaction_role_links WHERE panel_id=? AND guild_id=?").bind(id,guildId).run();await env.BALTICM_DB.prepare("DELETE FROM reaction_role_panels WHERE id=? AND guild_id=?").bind(id,guildId).run();return json({ok:true});
}
async function publishReactionRolePanel(env,guildId,id){
 await ensureReactionRoleTables(env);
 const p=await env.BALTICM_DB.prepare("SELECT id,guild_id AS guildId,channel_id AS channelId,title,description,thumbnail_url AS thumbnailUrl,message_id AS messageId FROM reaction_role_panels WHERE id=? AND guild_id=?").bind(id,guildId).first();
 if(!p)return json({error:"Panel not found"},404);
 const lr=await env.BALTICM_DB.prepare("SELECT id,panel_id AS panelId,guild_id AS guildId,emoji,emoji_id AS emojiId,emoji_name AS emojiName,emoji_animated AS emojiAnimated,role_id AS roleId,label FROM reaction_role_links WHERE panel_id=? AND guild_id=?").bind(id,guildId).all();
 const guild=await loadReactionGuild(env,guildId);
 const links=(lr.results||[]).map(link=>annotateLink(link,guild.emojis,{guildId,emojiListAvailable:!guild.emojiError}));
 if(!links.length)return json({error:"Panel has no role mappings"},400);
 const invalid=links.filter(link=>!link.valid);
 if(invalid.length){logReaction("invalid-emoji",{guildId,panelId:id,messageId:p.messageId||"",mappingId:invalid[0].id||"",reason:invalid[0].emojiError});return json({error:invalid[0].emojiError||"Fix invalid emoji mappings before publishing",mappings:invalid.map(link=>({id:link.id,emoji:link.emoji,error:link.emojiError}))},400)}
 for(const link of links){
  if(guild.rolesOk){
   const role=guild.roles.find(item=>String(item.id)===String(link.roleId));
   const block=roleAssignBlock({role:role?{...role,guildId}:null,botHighestPosition:guild.bot.highestPosition,canManageRoles:guild.bot.canManageRoles,administrator:guild.bot.administrator,accessKnown:guild.bot.accessKnown,guildId});
   if(block){logReaction("role-permission",{guildId,panelId:id,mappingId:link.id,roleId:link.roleId,reason:block});return json({error:block,roleId:link.roleId},400)}
  }
  if(link.migrated)await env.BALTICM_DB.prepare("UPDATE reaction_role_links SET emoji=?,emoji_id=?,emoji_name=?,emoji_animated=?,label=? WHERE id=? AND panel_id=? AND guild_id=?").bind(link.emoji,link.emojiId||"",link.emojiName||"",link.animated?1:0,link.label||"",link.id,id,guildId).run();
 }
 const description=reactionPanelEmbedDescription({description:repairMojibake(p.description||""),thumbnailUrl:p.thumbnailUrl},links);
 const embed={title:p.title,description,color:0x7457ff};if(p.thumbnailUrl)embed.thumbnail={url:p.thumbnailUrl};
 const payload={embeds:[embed],allowed_mentions:{parse:[]}};
 const waitDiscord=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const discordHeaderMap=headers=>({"retry-after":headers?.get?.("retry-after")||"","x-ratelimit-remaining":headers?.get?.("x-ratelimit-remaining")||"","x-ratelimit-reset-after":headers?.get?.("x-ratelimit-reset-after")||""});
 async function discordRequest(url,init){
  let pauseMs=0;
  for(let attempt=0;attempt<REACTION_MUTATION_MAX_RETRIES;attempt++){
   if(pauseMs>0)await waitDiscord(pauseMs);
   pauseMs=0;
   const res=await fetch(url,init).catch(()=>null);
   if(!res)return {ok:false,status:0,body:{message:"Discord API request failed"},headers:{}};
   const body=await res.json().catch(()=>({}));
   const headers=discordHeaderMap(res.headers);
   const decision=decideReactionMutation({status:res.status,headers,body,attempt,maxRetries:REACTION_MUTATION_MAX_RETRIES});
   if(decision.done)return {ok:true,status:res.status,body,headers};
   if(decision.retry){logReaction("discord-rate-limit",{guildId,panelId:id,messageId:p.messageId||"",status:429,waitMs:decision.waitMs,attempt});pauseMs=decision.waitMs;continue}
   return {ok:false,status:res.status,body,headers};
  }
  return {ok:false,status:429,body:{message:"You are being rate limited."},headers:{}};
 }
 let messageId=p.messageId,republished=false,current=null;
 if(messageId){
  const read=await discordRequest(`https://discord.com/api/v10/channels/${p.channelId}/messages/${messageId}`,{headers:botHeaders(env)});
  if(read.status===404){logReaction("message-missing",{guildId,panelId:id,messageId,channelId:p.channelId});messageId="";republished=true}
  else if(!read.ok){const reason=read.body?.message||"Could not read Discord message reactions";logReaction("reaction-read-failed",{guildId,panelId:id,messageId,status:read.status,reason});return json({error:reason,status:read.status||502},502)}
  else current=read.body;
 }
 if(current&&!discordSyncNeeded(current,payload,links))return json({ok:true,messageId,unchanged:true,reactionFailures:[]});
 const embedChanged=!current||!messageEmbedUnchanged(current,payload);
 let reactions=Array.isArray(current?.reactions)?current.reactions:[];
 if(embedChanged){
  const write=await discordRequest(`https://discord.com/api/v10/channels/${p.channelId}/messages${messageId?"/"+messageId:""}`,{method:messageId?"PATCH":"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
  if(!write.ok){const reason=write.body?.message||(write.status===403?"Channel inaccessible":"Could not publish panel");logReaction("publish-failed",{guildId,panelId:id,messageId:p.messageId||"",channelId:p.channelId,status:write.status,reason});return json({error:reason,status:write.status||502},502)}
  messageId=write.body?.id||messageId;
  reactions=Array.isArray(write.body?.reactions)?write.body.reactions:null;
  if(!reactions){
   const live=await discordRequest(`https://discord.com/api/v10/channels/${p.channelId}/messages/${messageId}`,{headers:botHeaders(env)});
   if(!live.ok){const reason=live.body?.message||"Could not read Discord message reactions";logReaction("reaction-read-failed",{guildId,panelId:id,messageId,status:live.status,reason});return json({error:reason,status:live.status||502},502)}
   reactions=Array.isArray(live.body?.reactions)?live.body.reactions:[];
  }
 }
 const operations=reactionMutationList(reactionSyncPlan(reactions,links));
 const synced=await runReactionMutations(operations,{maxRetries:REACTION_MUTATION_MAX_RETRIES,wait:waitDiscord,send:async operation=>{
  const res=await fetch(`https://discord.com/api/v10/channels/${p.channelId}/messages/${messageId}/reactions/${encodeURIComponent(operation.api)}/@me`,{method:operation.method,headers:botHeaders(env)}).catch(()=>null);
  if(!res)return {status:0,headers:{},body:{message:"Discord API request failed"}};
  return {status:res.status,headers:discordHeaderMap(res.headers),body:await res.json().catch(()=>({}))};
 }});
 const reactionFailures=synced.failed.map(failure=>({panelId:id,guildId,messageId,mappingId:failure.mappingId||"",emoji:failure.api,emojiId:failure.emojiId||"",status:failure.status||0,reason:failure.reason||"Discord rejected the reaction"}));
 for(const failure of reactionFailures)logReaction(failure.status===429?"reaction-rate-limit":"reaction-sync-failed",failure);
 await env.BALTICM_DB.prepare("UPDATE reaction_role_panels SET message_id=?,description=?,updated_at=? WHERE id=? AND guild_id=?").bind(messageId,repairMojibake(p.description||""),new Date().toISOString(),id,guildId).run();
 if(reactionFailures.length){const error=reactionFailures.map(formatReactionFailure).join(" ");return json({error,reactionFailures,messageId,status:502},502)}
 return json({ok:true,messageId,republished,reactionFailures});
}
async function reactionRoleServiceEvent(req,env){
 const secret=req.headers.get("X-BalticM-Service-Secret")||"";if(!env.BALTICM_REACTION_SERVICE_SECRET||secret!==env.BALTICM_REACTION_SERVICE_SECRET)return json({error:"Unauthorized"},401);
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const guildId=String(body.guildId||""),channelId=String(body.channelId||""),messageId=String(body.messageId||""),userId=String(body.userId||""),action=String(body.action||"").toLowerCase(),emoji=String(body.emoji||"").trim();
 if(!/^\d{16,22}$/.test(guildId)||!/^\d{16,22}$/.test(channelId)||!/^\d{16,22}$/.test(messageId)||!/^\d{16,22}$/.test(userId)||!["add","remove"].includes(action)||!emoji)return json({error:"Invalid reaction event"},400);
 await ensureReactionRoleTables(env);
 const p=await env.BALTICM_DB.prepare("SELECT id FROM reaction_role_panels WHERE guild_id=? AND channel_id=? AND message_id=? AND enabled=1").bind(guildId,channelId,messageId).first();if(!p)return json({ok:true,matched:false});
 const stored=await env.BALTICM_DB.prepare("SELECT id,panel_id AS panelId,guild_id AS guildId,emoji,emoji_id AS emojiId,emoji_name AS emojiName,emoji_animated AS emojiAnimated,role_id AS roleId,label FROM reaction_role_links WHERE guild_id=? AND panel_id=?").bind(guildId,p.id).all();
 const guild=await loadReactionGuild(env,guildId,{emojis:(stored.results||[]).some(reactionLinkNeedsEmojiList)});
 const links=(stored.results||[]).map(link=>annotateLink(link,guild.emojis,{guildId,emojiListAvailable:!guild.emojiError}));
 const link=links.find(item=>mappingMatchesEvent(item,emoji,guildId));
 if(!link)return json({ok:true,matched:false});
 if(link.migrated&&link.id)await env.BALTICM_DB.prepare("UPDATE reaction_role_links SET emoji=?,emoji_id=?,emoji_name=?,emoji_animated=? WHERE id=? AND panel_id=? AND guild_id=?").bind(link.emoji,link.emojiId||"",link.emojiName||"",link.animated?1:0,link.id,p.id,guildId).run();
 const memberRes=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,{headers:botHeaders(env)}).catch(()=>null);
 if(!memberRes?.ok){logReaction("member-missing",{guildId,panelId:p.id,messageId,mappingId:link.id,userId,status:memberRes?.status||0});return json({error:"Member could not be resolved",status:memberRes?.status||0},502)}
 const member=await memberRes.json().catch(()=>null);
 if(!member){logReaction("member-missing",{guildId,panelId:p.id,messageId,mappingId:link.id,userId});return json({error:"Member could not be resolved"},502)}
 if(shouldIgnoreReactor({userId,botUserId:guild.bot.id,bot:!!member.user?.bot}))return json({ok:true,matched:true,ignored:true});
 if(guild.rolesOk){const role=guild.roles.find(item=>String(item.id)===String(link.roleId));const block=roleAssignBlock({role:role?{...role,guildId}:null,botHighestPosition:guild.bot.highestPosition,canManageRoles:guild.bot.canManageRoles,administrator:guild.bot.administrator,accessKnown:guild.bot.accessKnown,guildId});if(block){logReaction("role-permission",{guildId,panelId:p.id,messageId,mappingId:link.id,roleId:link.roleId,reason:block});return json({error:block,roleId:link.roleId},403)}}
 const change=planRoleChange({action,memberRoleIds:member.roles||[],roleId:link.roleId});
 if(!change.apply)return json({ok:true,matched:true,action,roleId:link.roleId,skipped:change.reason});
 const rr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${link.roleId}`,{method:change.method,headers:botHeaders(env)});
 if(!rr.ok){let reason=rr.status===404?"Role could not be resolved":rr.status===403?"Missing Manage Roles permission":"Discord role update failed";try{const detail=await rr.json();if(detail?.code===50013)reason="Missing Manage Roles permission";else if(detail?.message&&rr.status!==403&&rr.status!==404)reason=String(detail.message)}catch{}logReaction("role-update-failed",{guildId,panelId:p.id,messageId,mappingId:link.id,roleId:link.roleId,status:rr.status,reason});return json({error:reason,status:rr.status},rr.status===403?403:502)}
 return json({ok:true,matched:true,action,roleId:link.roleId});
}

const GIVEAWAY_FIELDS="id,guild_id AS guildId,channel_id AS channelId,prize,description,logo_url AS logoUrl,winner_count AS winnerCount,end_at AS endAt,time_zone AS timeZone,required_roles_json AS requiredRolesJson,excluded_roles_json AS excludedRolesJson,required_roles_mode AS requiredRolesMode,message_id AS messageId,status,winner_ids_json AS winnerIdsJson,winner_dm_json AS winnerDmJson,announcement_message_id AS announcementMessageId,needs_delivery AS needsDelivery,created_at AS createdAt,updated_at AS updatedAt,ended_at AS endedAt";
async function ensureGiveawayTables(env){
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS giveaways (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,prize TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',winner_count INTEGER NOT NULL DEFAULT 1,end_at TEXT NOT NULL,required_roles_json TEXT NOT NULL DEFAULT '[]',excluded_roles_json TEXT NOT NULL DEFAULT '[]',message_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft',winner_ids_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,ended_at TEXT)").run();
 for(const sql of ["ALTER TABLE giveaways ADD COLUMN required_roles_mode TEXT NOT NULL DEFAULT 'all'","ALTER TABLE giveaways ADD COLUMN logo_url TEXT NOT NULL DEFAULT ''","ALTER TABLE giveaways ADD COLUMN time_zone TEXT NOT NULL DEFAULT ''","ALTER TABLE giveaways ADD COLUMN announcement_message_id TEXT NOT NULL DEFAULT ''","ALTER TABLE giveaways ADD COLUMN winner_dm_json TEXT NOT NULL DEFAULT '{}'","ALTER TABLE giveaways ADD COLUMN needs_delivery INTEGER NOT NULL DEFAULT 0"]){try{await env.BALTICM_DB.prepare(sql).run()}catch{}}
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS giveaway_entries (giveaway_id TEXT NOT NULL,guild_id TEXT NOT NULL,user_id TEXT NOT NULL,entered_at TEXT NOT NULL,PRIMARY KEY (giveaway_id,user_id))").run();
}
function giveawayRow(x){let requiredRoles=[],excludedRoles=[],winnerIds=[],winnerDm={};try{requiredRoles=JSON.parse(x.requiredRolesJson||"[]")}catch{}try{excludedRoles=JSON.parse(x.excludedRolesJson||"[]")}catch{}try{winnerIds=JSON.parse(x.winnerIdsJson||"[]")}catch{}try{winnerDm=JSON.parse(x.winnerDmJson||"{}")}catch{}return {...x,requiredRoles,excludedRoles,winnerIds,winnerDm,entryCount:Number(x.entryCount||0),needsDelivery:Number(x.needsDelivery||0)}}
async function loadGiveaway(env,guildId,id){await ensureGiveawayTables(env);const row=await env.BALTICM_DB.prepare(`SELECT ${GIVEAWAY_FIELDS} FROM giveaways WHERE id=? AND guild_id=?`).bind(id,guildId).first();return row?giveawayRow(row):null}
async function giveawayState(env,guildId){await ensureGiveawayTables(env);const r=await env.BALTICM_DB.prepare(`SELECT ${GIVEAWAY_FIELDS},(SELECT COUNT(*) FROM giveaway_entries e WHERE e.giveaway_id=g.id AND e.guild_id=g.guild_id) AS entryCount FROM giveaways g WHERE g.guild_id=? ORDER BY g.created_at DESC`).bind(guildId).all();return json({giveaways:(r.results||[]).map(giveawayRow)})}
function parseGiveaway(body){return{channelId:String(body.channelId||"").trim(),prize:String(body.prize||"").trim().slice(0,256),description:String(body.description||"").trim().slice(0,2000),logoUrl:String(body.logoUrl||"").trim().slice(0,1000),winnerCount:Math.max(1,Math.min(20,Number(body.winnerCount)||1)),endAt:String(body.endAt||"").trim(),timeZone:String(body.timeZone||"").trim(),requiredRoles:[...new Set((Array.isArray(body.requiredRoles)?body.requiredRoles:[]).map(String).filter(x=>/^\d{16,22}$/.test(x)))],excludedRoles:[...new Set((Array.isArray(body.excludedRoles)?body.excludedRoles:[]).map(String).filter(x=>/^\d{16,22}$/.test(x)))],requiredRolesMode:body.requiredRolesMode==="any"?"any":"all"}}
function giveawayHeaderMap(headers){return{"retry-after":headers?.get?.("retry-after")||"","x-ratelimit-remaining":headers?.get?.("x-ratelimit-remaining")||"","x-ratelimit-reset-after":headers?.get?.("x-ratelimit-reset-after")||""}}
async function discordGiveaway(url,init){return runDiscordAttempt(async()=>{const res=await fetch(url,init).catch(()=>null);if(!res)return{status:0,headers:{},body:{message:"Discord API request failed"}};return{status:res.status,headers:giveawayHeaderMap(res.headers),body:await res.json().catch(()=>({}))}},{wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))})}
async function validateGiveaway(env,guildId,a){const resolved=resolveGiveawayEnd({endAt:a.endAt,timeZone:a.timeZone});if(!resolved.ok)return resolved.error;if(!/^\d{16,22}$/.test(a.channelId))return"Select a Discord channel";if(!a.prize)return"Prize is required";const [cr,rr]=await Promise.all([fetch("https://discord.com/api/v10/channels/"+a.channelId,{headers:botHeaders(env)}),fetch("https://discord.com/api/v10/guilds/"+guildId+"/roles",{headers:botHeaders(env)})]);if(!cr.ok)return giveawayDiscordError(cr.status,await cr.json().catch(()=>({})));const ch=await cr.json();const channelError=channelBelongsToGuild(ch,guildId);if(channelError)return channelError;if(!rr.ok)return"Could not verify roles for this server";const roles=await rr.json();if(!Array.isArray(roles))return"Could not verify roles for this server";const roleError=invalidRoleSelection([...a.requiredRoles,...a.excludedRoles],roles.map(role=>role.id),true);return roleError||resolved}
async function saveGiveaway(req,env,guildId,id=""){let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}const a=parseGiveaway(body),checked=await validateGiveaway(env,guildId,a);if(typeof checked==="string")return json({error:checked},400);const resolved=checked;await ensureGiveawayTables(env);const now=new Date().toISOString();if(id){const old=await env.BALTICM_DB.prepare("SELECT id,status FROM giveaways WHERE id=? AND guild_id=?").bind(id,guildId).first();if(!old)return json({error:"Giveaway not found"},404);if(old.status==="ended"||old.status==="ending")return json({error:"Finished giveaways cannot be edited"},400);await env.BALTICM_DB.prepare("UPDATE giveaways SET channel_id=?,prize=?,description=?,logo_url=?,winner_count=?,end_at=?,time_zone=?,required_roles_json=?,excluded_roles_json=?,required_roles_mode=?,updated_at=? WHERE id=? AND guild_id=?").bind(a.channelId,a.prize,a.description,a.logoUrl,a.winnerCount,resolved.iso,resolved.timeZone,JSON.stringify(a.requiredRoles),JSON.stringify(a.excludedRoles),a.requiredRolesMode,now,id,guildId).run();return json({ok:true,id})}id=crypto.randomUUID();await env.BALTICM_DB.prepare("INSERT INTO giveaways (id,guild_id,channel_id,prize,description,logo_url,winner_count,end_at,time_zone,required_roles_json,excluded_roles_json,required_roles_mode,message_id,status,winner_ids_json,winner_dm_json,announcement_message_id,needs_delivery,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'','draft','[]','{}','',0,?,?)").bind(id,guildId,a.channelId,a.prize,a.description,a.logoUrl,a.winnerCount,resolved.iso,resolved.timeZone,JSON.stringify(a.requiredRoles),JSON.stringify(a.excludedRoles),a.requiredRolesMode,now,now).run();return json({ok:true,id},201)}
async function giveawayPayload(env,g){const branding=await giveawayBrandingFooter(env,g.guildId),er=await env.BALTICM_DB.prepare("SELECT COUNT(*) AS c FROM giveaway_entries WHERE giveaway_id=? AND guild_id=?").bind(g.id,g.guildId).first();return buildGiveawayMessage({giveaway:g,entryCount:Number(er?.c||0),premium:!branding.footer})}
async function publishGiveaway(env,guildId,id){const g=await loadGiveaway(env,guildId,id);if(!g)return json({error:"Giveaway not found"},404);if(g.status==="ended"||g.status==="ending")return json({error:"Giveaway already ended"},400);const payload=await giveawayPayload(env,g);let outcome;if(g.messageId){outcome=await discordGiveaway("https://discord.com/api/v10/channels/"+g.channelId+"/messages/"+g.messageId,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify(payload)});if(outcome.result?.status===404)outcome=await discordGiveaway("https://discord.com/api/v10/channels/"+g.channelId+"/messages",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)})}else outcome=await discordGiveaway("https://discord.com/api/v10/channels/"+g.channelId+"/messages",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});if(!publishActivates(outcome))return json({error:giveawayDiscordError(outcome.result?.status||0,outcome.result?.body)},502);await env.BALTICM_DB.prepare("UPDATE giveaways SET message_id=?,status='active',updated_at=? WHERE id=? AND guild_id=? AND status!='ended'").bind(outcome.result.body.id,new Date().toISOString(),id,guildId).run();return json({ok:true,messageId:outcome.result.body.id})}
async function editDeferredGiveaway(interaction,content){const token=String(interaction.token||""),applicationId=String(interaction.application_id||"");if(!token||!applicationId)return;for(let attempt=0;attempt<3;attempt++){const res=await fetch("https://discord.com/api/v10/webhooks/"+applicationId+"/"+token+"/messages/@original",{method:"PATCH",headers:{"Content-Type":"application/json; charset=utf-8"},body:JSON.stringify({content})}).catch(()=>null);if(!res||res.ok)return;const body=await res.json().catch(()=>({}));if(!(res.status===404&&body.code===10062)||attempt===2)return;await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)))}}
async function giveawayEnterInteraction(env,interaction,id,ctx){const guildId=String(interaction.guild_id||""),userId=String(interaction.member?.user?.id||interaction.user?.id||"");const opened=openGiveawayEntry(ctx?.waitUntil?task=>ctx.waitUntil(task):null,()=>completeGiveawayEntry({acknowledged:true,load:async()=>({guildId,giveaway:await loadGiveaway(env,guildId,id),userId,bot:!!(interaction.member?.user?.bot||interaction.user?.bot),roles:interaction.member?.roles||[]}),insert:async()=>{const inserted=await env.BALTICM_DB.prepare("INSERT OR IGNORE INTO giveaway_entries (giveaway_id,guild_id,user_id,entered_at) VALUES (?,?,?,?)").bind(id,guildId,userId,new Date().toISOString()).run();return inserted.meta?.changes||0},updateMessage:async()=>{const g=await loadGiveaway(env,guildId,id);if(!g)return;const payload=await giveawayPayload(env,{...g,guildId}),token=String(interaction.token||""),messageId=String(interaction.message?.id||g.messageId||"");if(!token||!messageId)return;await discordGiveaway("https://discord.com/api/v10/webhooks/"+interaction.application_id+"/"+token+"/messages/"+messageId,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})},editOriginal:content=>editDeferredGiveaway(interaction,content)}));if(!ctx?.waitUntil)await opened.task;return json(opened.response)}
async function deliverGiveaway(env,guildId,g){if(!g)return json({error:"Giveaway not found"},404);if(Date.parse(g.updatedAt||"")&&Date.now()-Date.parse(g.updatedAt)>=15000){const dm={...(g.winnerDm||{})};let changed=false;for(const [userId,state] of Object.entries(dm))if(state==="sending"){dm[userId]="failed";changed=true}const announcement=g.announcementMessageId==="sending"?"failed":g.announcementMessageId;if(g.announcementMessageId==="sending")changed=true;if(changed){const cleared=await env.BALTICM_DB.prepare("UPDATE giveaways SET announcement_message_id=?,winner_dm_json=?,updated_at=? WHERE id=? AND guild_id=? AND updated_at=?").bind(announcement||"",JSON.stringify(dm),new Date().toISOString(),g.id,guildId,g.updatedAt).run();if(cleared.meta?.changes)g=await loadGiveaway(env,guildId,g.id)||g}}const ended={...g,status:"ended",guildId};if(g.messageId){const edited=await discordGiveaway("https://discord.com/api/v10/channels/"+g.channelId+"/messages/"+g.messageId,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify(await giveawayPayload(env,ended))});if(!edited.ok&&edited.result?.status!==404)console.log(JSON.stringify({component:"giveaway",event:"message-edit-failed",guildId,giveawayId:g.id,status:edited.result?.status||0}))}let row=await loadGiveaway(env,guildId,g.id)||ended;const plan=nextDelivery(row);if(plan.announcement){const claim=await env.BALTICM_DB.prepare("UPDATE giveaways SET announcement_message_id='sending' WHERE id=? AND guild_id=? AND needs_delivery=1 AND announcement_message_id=''").bind(g.id,guildId).run();if(claim.meta?.changes){const premium=!(await giveawayBrandingFooter(env,guildId)).footer;const sent=await discordGiveaway("https://discord.com/api/v10/channels/"+g.channelId+"/messages",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(winnerAnnouncement({winners:row.winnerIds||[],prize:g.prize,logoUrl:g.logoUrl,premium}))});const messageId=sent.ok?(sent.result.body?.id||"sent"):"failed";await env.BALTICM_DB.prepare("UPDATE giveaways SET announcement_message_id=? WHERE id=? AND guild_id=? AND announcement_message_id='sending'").bind(messageId,g.id,guildId).run();row={...row,announcementMessageId:messageId}}else row=await loadGiveaway(env,guildId,g.id)||row}const directMessages=[];let pauseMs=0;for(const userId of nextDelivery(row).dms){if(pauseMs>0)await new Promise(resolve=>setTimeout(resolve,pauseMs));pauseMs=0;if(!claimFollowUpAllowed(row.winnerIds,userId))continue;const previous=JSON.stringify(row.winnerDm||{});const claimed=withDmClaim(row,userId);if(!claimed.claimed)continue;const locked=await env.BALTICM_DB.prepare("UPDATE giveaways SET winner_dm_json=? WHERE id=? AND guild_id=? AND winner_dm_json=?").bind(JSON.stringify(claimed.row.winnerDm),g.id,guildId,previous).run();if(!locked.meta?.changes)continue;row=claimed.row;let status="failed",headers={};try{const channel=await discordGiveaway("https://discord.com/api/v10/users/@me/channels",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify({recipient_id:userId})});headers=channel.result?.headers||{};if(channel.ok&&channel.result.body?.id){const message=await discordGiveaway("https://discord.com/api/v10/channels/"+channel.result.body.id+"/messages",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(winnerDirectMessage({prize:g.prize,logoUrl:g.logoUrl}))});headers=message.result?.headers||headers;if(message.ok)status="sent"}}catch{status="failed"}const finished=withDmResult(row,userId,status);await env.BALTICM_DB.prepare("UPDATE giveaways SET winner_dm_json=? WHERE id=? AND guild_id=?").bind(JSON.stringify(finished.winnerDm),g.id,guildId).run();row=finished;directMessages.push({userId,status});pauseMs=giveawayBucketPauseMs(headers)}if(deliveryDone(row))await env.BALTICM_DB.prepare("UPDATE giveaways SET needs_delivery=0,updated_at=? WHERE id=? AND guild_id=?").bind(new Date().toISOString(),g.id,guildId).run();if(row.announcementMessageId==="failed")return json({error:"Giveaway ended, but the winner announcement could not be posted.",winnerIds:row.winnerIds||[],directMessages},502);return json({ok:true,winnerIds:row.winnerIds||[],directMessages})}
async function endGiveaway(env,guildId,id,reroll=false){const existing=await loadGiveaway(env,guildId,id);const decision=startFinish(existing,{reroll});if(!decision.ok)return json({error:decision.error},decision.status||400);const now=new Date().toISOString();if(decision.mode==="deliver"||(decision.mode==="resume"&&(existing.winnerIds||[]).length))return deliverGiveaway(env,guildId,existing);if(decision.mode==="resume"&&!resumeDrawAllowed(existing,Date.now()))return json({error:"Giveaway is already being finished"},409);if(existing.status!=="ending"){const from=reroll?"ended":existing.status;const lock=await env.BALTICM_DB.prepare("UPDATE giveaways SET status='ending',updated_at=? WHERE id=? AND guild_id=? AND status=?").bind(now,id,guildId,from).run();if(!lock.meta?.changes){const again=await loadGiveaway(env,guildId,id);if(!again)return json({error:"Giveaway not found"},404);if(again.status==="ended")return Number(again.needsDelivery)?deliverGiveaway(env,guildId,again):json({error:"Giveaway already ended"},400);return json({error:"Giveaway is already being finished"},409)}}const entries=await env.BALTICM_DB.prepare("SELECT user_id AS userId FROM giveaway_entries WHERE giveaway_id=? AND guild_id=?").bind(id,guildId).all();const locked=await loadGiveaway(env,guildId,id);const drawn=commitDraw(locked||{...existing,status:"ending"},(entries.results||[]).map(entry=>entry.userId),now,{replace:!!reroll});if(!drawn.ok)return json({error:drawn.error},409);if(drawn.drawn){const sql=reroll?"UPDATE giveaways SET status='ended',winner_ids_json=?,winner_dm_json=?,needs_delivery=1,announcement_message_id='',ended_at=?,updated_at=? WHERE id=? AND guild_id=? AND status='ending'":"UPDATE giveaways SET status='ended',winner_ids_json=?,winner_dm_json=?,needs_delivery=1,announcement_message_id='',ended_at=?,updated_at=? WHERE id=? AND guild_id=? AND status='ending' AND winner_ids_json='[]'";const saved=await env.BALTICM_DB.prepare(sql).bind(JSON.stringify(drawn.row.winnerIds),JSON.stringify(drawn.row.winnerDm),now,now,id,guildId).run();if(!saved.meta?.changes){const winnerRow=await loadGiveaway(env,guildId,id);if(winnerRow?.status==="ended")return Number(winnerRow.needsDelivery)?deliverGiveaway(env,guildId,winnerRow):json({ok:true,winnerIds:winnerRow.winnerIds||[],directMessages:[]});return json({error:"Giveaway is already being finished"},409)}}const fresh=await loadGiveaway(env,guildId,id);return deliverGiveaway(env,guildId,fresh)}
async function finishDueGiveaways(env){await ensureGiveawayTables(env);const now=new Date().toISOString(),r=await env.BALTICM_DB.prepare("SELECT id,guild_id AS guildId FROM giveaways WHERE (status='active' AND end_at<=?) OR (status='ended' AND needs_delivery=1) OR status='ending' ORDER BY end_at ASC LIMIT 20").bind(now).all();for(const g of r.results||[]){try{await endGiveaway(env,g.guildId,g.id,false)}catch(error){console.log(JSON.stringify({component:"giveaway",event:"finish-failed",guildId:g.guildId,giveawayId:g.id,reason:String(error?.message||"finish failed")}))}}}
async function deleteGiveaway(env,guildId,id){await ensureGiveawayTables(env);const g=await env.BALTICM_DB.prepare("SELECT channel_id AS channelId,message_id AS messageId,status FROM giveaways WHERE id=? AND guild_id=?").bind(id,guildId).first();if(!g)return json({error:"Giveaway not found"},404);if(g.status==="ending")return json({error:"Giveaway is already being finished"},409);if(g.messageId){const removed=await discordGiveaway("https://discord.com/api/v10/channels/"+g.channelId+"/messages/"+g.messageId,{method:"DELETE",headers:botHeaders(env)});if(!removed.ok&&removed.result?.status!==404)return json({error:giveawayDiscordError(removed.result?.status||0,removed.result?.body)},502)}await env.BALTICM_DB.prepare("DELETE FROM giveaway_entries WHERE giveaway_id=? AND guild_id=?").bind(id,guildId).run();await env.BALTICM_DB.prepare("DELETE FROM giveaways WHERE id=? AND guild_id=?").bind(id,guildId).run();return json({ok:true})}

async function ensureAnnouncementTables(env){
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY,guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',thumbnail_url TEXT NOT NULL DEFAULT '',image_url TEXT NOT NULL DEFAULT '',color INTEGER NOT NULL DEFAULT 7624695,footer TEXT NOT NULL DEFAULT '',buttons_json TEXT NOT NULL DEFAULT '[]',message_id TEXT NOT NULL DEFAULT '',crossposted INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,published_at TEXT)").run();
 try{await env.BALTICM_DB.prepare("ALTER TABLE announcements ADD COLUMN followers_status TEXT NOT NULL DEFAULT ''").run()}catch{}
}
function announcementRow(x){if(!x)return null;let buttons=[];try{buttons=JSON.parse(x.buttonsJson||"[]")}catch{}if(!Array.isArray(buttons))buttons=[];return Object.assign({},x,{crossposted:!!Number(x.crossposted),followersStatus:String(x.followersStatus||""),buttons})}
const ANNOUNCEMENT_FIELDS="id,guild_id AS guildId,channel_id AS channelId,title,content,thumbnail_url AS thumbnailUrl,image_url AS imageUrl,color,footer,buttons_json AS buttonsJson,message_id AS messageId,crossposted,followers_status AS followersStatus,status,created_at AS createdAt,updated_at AS updatedAt,published_at AS publishedAt";
async function loadAnnouncement(env,guildId,id){await ensureAnnouncementTables(env);return announcementRow(await env.BALTICM_DB.prepare("SELECT "+ANNOUNCEMENT_FIELDS+" FROM announcements WHERE id=? AND guild_id=?").bind(id,guildId).first())}
function announcementHeaderMap(headers){const out={};if(headers?.forEach)headers.forEach((value,key)=>{out[String(key).toLowerCase()]=value});return out}
async function discordAnnouncement(url,init){return runAnnouncementDiscord(async()=>{const res=await fetch(url,init).catch(()=>null);if(!res)return{status:0,headers:{},body:{message:"Discord API request failed"}};return{status:res.status,headers:announcementHeaderMap(res.headers),body:await res.json().catch(()=>({}))}},{wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))})}
async function announcementState(env,guildId){await ensureAnnouncementTables(env);const r=await env.BALTICM_DB.prepare("SELECT "+ANNOUNCEMENT_FIELDS+" FROM announcements WHERE guild_id=? ORDER BY created_at DESC").bind(guildId).all();return json({announcements:(r.results||[]).map(announcementRow)})}
async function readAnnouncementChannel(env,channelId){return announcementChannelFromDiscord(await discordAnnouncement("https://discord.com/api/v10/channels/"+channelId,{headers:botHeaders(env)}))}
async function saveAnnouncement(req,env,guildId,id=""){let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}const parsed=parseAnnouncementBody(body);if(!parsed.ok)return json({error:parsed.error},400);const a=parsed.value,gate=channelDecision(await readAnnouncementChannel(env,a.channelId),guildId,{crosspost:a.crosspost}),error=announcementSaveError(gate);if(error)return json({error},gate.status||400);await ensureAnnouncementTables(env);const now=new Date().toISOString();if(id){const old=await env.BALTICM_DB.prepare("SELECT id,channel_id AS channelId FROM announcements WHERE id=? AND guild_id=?").bind(id,guildId).first();if(!old)return json({error:"Announcement not found"},404);const channelChanged=String(old.channelId||"")!==String(a.channelId||"");await env.BALTICM_DB.prepare("UPDATE announcements SET channel_id=?,title=?,content=?,thumbnail_url=?,image_url=?,color=?,footer=?,buttons_json=?,crossposted=?,message_id=CASE WHEN ? THEN '' ELSE message_id END,followers_status=CASE WHEN ? THEN '' ELSE followers_status END,status=CASE WHEN ? THEN 'draft' ELSE status END,updated_at=? WHERE id=? AND guild_id=?").bind(a.channelId,a.title,a.content,a.thumbnailUrl,a.imageUrl,a.color,a.footer,JSON.stringify(a.buttons),a.crosspost?1:0,channelChanged?1:0,channelChanged?1:0,channelChanged?1:0,now,id,guildId).run();return json({ok:true,id})}const created=crypto.randomUUID();await env.BALTICM_DB.prepare("INSERT INTO announcements (id,guild_id,channel_id,title,content,thumbnail_url,image_url,color,footer,buttons_json,message_id,crossposted,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'',?,'draft',?,?)").bind(created,guildId,a.channelId,a.title,a.content,a.thumbnailUrl,a.imageUrl,a.color,a.footer,JSON.stringify(a.buttons),a.crosspost?1:0,now,now).run();return json({ok:true,id:created},201)}
async function publishAnnouncement(env,guildId,id){await ensureAnnouncementTables(env);const result=await runAnnouncementPublish({guildId,id,load:()=>loadAnnouncement(env,guildId,id),claimPost:async()=>{const now=new Date().toISOString(),cutoff=new Date(Date.now()-ANNOUNCEMENT_PUBLISH_LOCK_MS).toISOString();const locked=await env.BALTICM_DB.prepare("UPDATE announcements SET status='publishing', updated_at=? WHERE id=? AND guild_id=? AND message_id='' AND (status!='publishing' OR updated_at < ?)").bind(now,id,guildId,cutoff).run();return !!locked.meta?.changes},claimReplace:async oldId=>{const now=new Date().toISOString();const replaced=await env.BALTICM_DB.prepare("UPDATE announcements SET message_id='', followers_status='', status='publishing', updated_at=? WHERE id=? AND guild_id=? AND message_id=?").bind(now,id,guildId,oldId).run();return !!replaced.meta?.changes},releasePost:async()=>{const now=new Date().toISOString();await env.BALTICM_DB.prepare("UPDATE announcements SET status='draft', updated_at=? WHERE id=? AND guild_id=? AND status='publishing' AND message_id=''").bind(now,id,guildId).run()},commitMessage:async(messageId,edit)=>{const now=new Date().toISOString();const saved=edit?await env.BALTICM_DB.prepare("UPDATE announcements SET status='published', published_at=COALESCE(NULLIF(published_at,''), ?), updated_at=? WHERE id=? AND guild_id=? AND message_id=?").bind(now,now,id,guildId,messageId).run():await env.BALTICM_DB.prepare("UPDATE announcements SET message_id=?, status='published', published_at=?, updated_at=? WHERE id=? AND guild_id=? AND message_id=''").bind(messageId,now,now,id,guildId).run();return !!saved.meta?.changes},commitFollowers:async status=>{const now=new Date().toISOString();await env.BALTICM_DB.prepare("UPDATE announcements SET followers_status=?, updated_at=? WHERE id=? AND guild_id=?").bind(status,now,id,guildId).run()},getChannel:channelId=>readAnnouncementChannel(env,channelId),send:async({method,channelId,messageId,payload})=>{const url=method==="PATCH"?"https://discord.com/api/v10/channels/"+channelId+"/messages/"+messageId:"https://discord.com/api/v10/channels/"+channelId+"/messages";return discordAnnouncement(url,{method,headers:botHeaders(env,true),body:JSON.stringify(payload)})},crosspost:({channelId,messageId})=>discordAnnouncement("https://discord.com/api/v10/channels/"+channelId+"/messages/"+messageId+"/crosspost",{method:"POST",headers:botHeaders(env)}),remove:({channelId,messageId})=>discordAnnouncement("https://discord.com/api/v10/channels/"+channelId+"/messages/"+messageId,{method:"DELETE",headers:botHeaders(env)}).catch(()=>null)});if(!result.ok)return json({error:result.error},result.status||502);return json({ok:true,messageId:result.messageId,channelId:result.channelId,crossposted:!!result.crossposted,crosspostError:result.crosspostError||"",bannerSkipped:!!result.bannerSkipped})}
async function deleteAnnouncement(env,guildId,id){await ensureAnnouncementTables(env);const a=await env.BALTICM_DB.prepare("SELECT channel_id AS channelId,message_id AS messageId FROM announcements WHERE id=? AND guild_id=?").bind(id,guildId).first();if(!a)return json({error:"Announcement not found"},404);if(a.messageId)await discordAnnouncement("https://discord.com/api/v10/channels/"+a.channelId+"/messages/"+a.messageId,{method:"DELETE",headers:botHeaders(env)}).catch(()=>null);await env.BALTICM_DB.prepare("DELETE FROM announcements WHERE id=? AND guild_id=?").bind(id,guildId).run();return json({ok:true})}

async function loadMembersRolesContext(env,guildId,actorId,targetMemberId=""){
 if(!env.DISCORD_BOT_TOKEN)return{error:"DISCORD_BOT_TOKEN is not configured",status:503};
 const headers=botHeaders(env);
 const meRes=await fetch("https://discord.com/api/v10/users/@me",{headers});
 if(!meRes.ok)return{error:"Could not resolve bot user",status:502};
 const me=await meRes.json();
 const fetches=[
  fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers}),
  fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`,{headers}),
  fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${actorId}`,{headers}),
  fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${me.id}`,{headers})
 ];
 if(targetMemberId)fetches.push(fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${targetMemberId}`,{headers}));
 const results=await Promise.all(fetches);
 const [gr,rr,actorMr,botMr,targetMr]=results;
 if(!gr.ok)return{error:gr.status===404?"Bot is not installed in this server":"Could not load Discord server",status:gr.status===404?404:502};
 if(!rr.ok)return{error:"Could not load Discord roles",status:502};
 if(!actorMr.ok)return{error:"You are not a member of this server",status:403};
 const guild=await gr.json();
 const guildRoles=await rr.json();
 const actorMember=await actorMr.json();
 const botMember=botMr.ok?await botMr.json():null;
 let targetMember=null;
 if(targetMemberId){
  if(!targetMr||!targetMr.ok)return{error:"Member could not be resolved in this server",status:403,code:"cross_guild"};
  targetMember=await targetMr.json();
 }
 const botAccess=botRoleAccess(guildRoles,botMember?.roles||[],guildId);
 const accessConfig=await loadGuildAccessConfig(env,guildId);
 return{guild,guildRoles,actorMember,targetMember,botAccess,accessConfig,botUserId:me.id};
}
async function createDiscordRole(req,env,user,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const name=String(body?.name||"").trim().slice(0,100);if(!name)return json({error:"Role name is required"},400);
 if(body?.position!=null)return json({error:"Role reordering is not allowed through this endpoint",code:"reorder"},403);
 const ctx=await loadMembersRolesContext(env,guildId,user.id);
 if(ctx.error)return json({error:ctx.error,code:ctx.code},ctx.status||502);
 const actorIsGuildOwner=String(ctx.guild.owner_id)===String(user.id);
 const decision=decideRoleMutation({
  action:"create",
  guildId,
  actorIsGuildOwner,
  actorRoleIds:ctx.actorMember.roles||[],
  guildRoles:ctx.guildRoles,
  botAccess:ctx.botAccess,
  payload:body
 });
 if(!decision.ok)return json({error:decision.error,code:decision.code},403);
 const payload={name,hoist:!!body.hoist,mentionable:!!body.mentionable};
 if(/^#[0-9a-fA-F]{6}$/.test(body.color||""))payload.color=parseInt(body.color.slice(1),16);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 const data=await r.json().catch(()=>({}));if(!r.ok)return json({error:data.message||"Role creation failed",status:r.status},r.status===403?403:502);
 await addActivityLog(env,guildId,{actorId:user?.id||"",actorName:user?.global_name||user?.username||user?.id||"Control Center",action:"Role created",target:data.name||name,source:"BALTICM"});
 return json({role:data},201);
}
async function changeMemberRole(req,env,user,guildId,memberId,roleId,remove=false){
 if(!isSnowflake(memberId)||!isSnowflake(roleId))return json({error:"Invalid member or role id",code:"invalid_id"},400);
 const ctx=await loadMembersRolesContext(env,guildId,user.id,memberId);
 if(ctx.error)return json({error:ctx.error,code:ctx.code},ctx.status||502);
 const role=(ctx.guildRoles||[]).find(r=>String(r.id)===String(roleId))||null;
 const actorIsGuildOwner=String(ctx.guild.owner_id)===String(user.id);
 const targetIsGuildOwner=String(ctx.guild.owner_id)===String(memberId);
 const actorAccessLevel=await controlAccessLevel(env,user,guildId,"members_roles");
 const decision=decideMemberRoleChange({
  guildId,
  actorId:user.id,
  actorIsGuildOwner,
  actorRoleIds:ctx.actorMember.roles||[],
  actorAccessLevel,
  targetMemberId:memberId,
  targetIsGuildOwner,
  targetRoleIds:ctx.targetMember?.roles||[],
  roleId,
  role,
  guildRoles:ctx.guildRoles,
  accessConfigRoles:ctx.accessConfig?.roles||[],
  botAccess:ctx.botAccess,
  remove
 });
 if(!decision.ok)return json({error:decision.error,code:decision.code},403);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}/roles/${roleId}`,{method:remove?"DELETE":"PUT",headers:botHeaders(env)});
 if(!r.ok){const data=await r.json().catch(()=>({}));return json({error:data.message||"Role update failed",status:r.status},r.status===403?403:502)}
 const actorName=user?.global_name||user?.username||user?.id||"Control Center";
 await addActivityLog(env,guildId,{actorId:user?.id||"",actorName,action:remove?"Role removed":"Role assigned",target:memberId,source:"BALTICM",details:`roleId=${roleId}`});
 return new Response(null,{status:204});
}
async function deleteDiscordRole(env,user,guildId,roleId){
 if(!isSnowflake(roleId))return json({error:"Invalid role id",code:"invalid_id"},400);
 const ctx=await loadMembersRolesContext(env,guildId,user.id);
 if(ctx.error)return json({error:ctx.error,code:ctx.code},ctx.status||502);
 const role=(ctx.guildRoles||[]).find(r=>String(r.id)===String(roleId))||null;
 const actorIsGuildOwner=String(ctx.guild.owner_id)===String(user.id);
 const decision=decideRoleMutation({
  action:"delete",
  guildId,
  actorIsGuildOwner,
  actorRoleIds:ctx.actorMember.roles||[],
  roleId,
  role,
  guildRoles:ctx.guildRoles,
  botAccess:ctx.botAccess
 });
 if(!decision.ok)return json({error:decision.error,code:decision.code},403);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`,{method:"DELETE",headers:botHeaders(env)});
 if(!r.ok){const data=await r.json().catch(()=>({}));return json({error:data.message||"Role deletion failed",status:r.status},r.status===403?403:502)}
 return new Response(null,{status:204});
}
async function editDiscordRole(req,env,user,guildId,roleId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 if(!isSnowflake(roleId))return json({error:"Invalid role id",code:"invalid_id"},400);
 if(Object.prototype.hasOwnProperty.call(body||{},"position"))return json({error:"Role reordering is not allowed through this endpoint",code:"reorder"},403);
 const ctx=await loadMembersRolesContext(env,guildId,user.id);
 if(ctx.error)return json({error:ctx.error,code:ctx.code},ctx.status||502);
 const role=(ctx.guildRoles||[]).find(r=>String(r.id)===String(roleId))||null;
 const actorIsGuildOwner=String(ctx.guild.owner_id)===String(user.id);
 const decision=decideRoleMutation({
  action:"edit",
  guildId,
  actorIsGuildOwner,
  actorRoleIds:ctx.actorMember.roles||[],
  roleId,
  role,
  guildRoles:ctx.guildRoles,
  botAccess:ctx.botAccess,
  payload:body
 });
 if(!decision.ok)return json({error:decision.error,code:decision.code},403);
 const payload={};
 if(typeof body.name==="string"&&body.name.trim())payload.name=body.name.trim().slice(0,100);
 if(/^#[0-9a-fA-F]{6}$/.test(body.color||""))payload.color=parseInt(body.color.slice(1),16);
 if(typeof body.hoist==="boolean")payload.hoist=body.hoist;
 if(typeof body.mentionable==="boolean")payload.mentionable=body.mentionable;
 if(body.permissions!==undefined){const permissions=String(body.permissions);if(!/^\d+$/.test(permissions))return json({error:"Invalid permissions bitfield"},400);try{BigInt(permissions)}catch{return json({error:"Invalid permissions bitfield"},400)}payload.permissions=permissions;}
 if(!Object.keys(payload).length)return json({error:"No role changes supplied"},400);
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 const data=await r.json().catch(()=>({}));if(!r.ok)return json({error:data.message||"Role update failed",status:r.status},r.status===403?403:502);
 return json({role:data});
}

async function cachedGuildChannels(env,guildId){
 const key=new Request("https://balticm.internal/discord-channels/"+encodeURIComponent(guildId));
 const cache=caches.default;
 const hit=await cache.match(key);
 if(hit)return hit.json();
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});
 if(!r.ok){const e=new Error("Discord channels request failed");e.status=r.status;throw e}
 const channels=await r.json();
 await cache.put(key,new Response(JSON.stringify(channels),{headers:{"Content-Type":"application/json","Cache-Control":"public, max-age=30"}}));
 return channels;
}

const voiceConfigKey=guildId=>"voice-create:"+guildId;
const normalizeVoiceProfiles=config=>{
 if(!config)return[];
 if(Array.isArray(config.profiles))return config.profiles.filter(Boolean);
 if(config.categoryId&&config.createChannelId)return[{id:"legacy",categoryId:config.categoryId,createChannelId:config.createChannelId,nameTemplate:config.nameTemplate||"{username} Room",userLimit:Number(config.userLimit)||0,privateByDefault:!!config.privateByDefault}];
 return[];
};
async function getVoiceConfig(env,guildId){if(!env.BALTICM_DB)return null;const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key = ?").bind(voiceConfigKey(guildId)).first();if(!row?.value)return null;try{return JSON.parse(row.value)}catch{return null}}
async function setVoiceConfig(env,guildId,config){if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(voiceConfigKey(guildId),JSON.stringify(config),new Date().toISOString()).run()}
const musicConfigKey=guildId=>"music:"+guildId;
async function getMusicConfig(env,guildId){if(!env.BALTICM_DB)return null;const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key = ?").bind(musicConfigKey(guildId)).first();if(!row?.value)return null;try{return JSON.parse(row.value)}catch{return null}}
async function saveMusicConfig(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const commandChannelId=String(body.commandChannelId||"");if(!commandChannelId)return json({error:"Select a Music command channel"},400);
 const cr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});if(!cr.ok)return json({error:"Discord channels request failed"},502);
 const channels=await cr.json(),ch=channels.find(c=>c.id===commandChannelId&&(c.type===0||c.type===5));if(!ch)return json({error:"Selected text channel was not found"},400);
 const config={commandChannelId,commandChannelName:ch.name,updatedAt:new Date().toISOString()};await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(musicConfigKey(guildId),JSON.stringify(config),config.updatedAt).run();return json({config});
}
async function musicConfigState(env,guildId){
 try{const [config,allChannels]=await Promise.all([getMusicConfig(env,guildId),cachedGuildChannels(env,guildId)]);const textChannels=allChannels.filter(c=>c.type===0||c.type===5).map(c=>({id:c.id,name:c.name,parentId:c.parent_id||null}));return json({config,textChannels})}catch(e){return json({error:e.message||"Discord channels request failed",status:e.status||null},502)}
}
const musicRequesterNameCache=new Map();
async function musicProxy(req,env,guildId,action,user=null){
 if(!env.BALTICM_MUSIC_SERVICE_SECRET)return json({error:"Music service secret is not configured"},503);
 let channels;try{channels=(await cachedGuildChannels(env,guildId)).filter(c=>c.type===2||c.type===13).map(c=>({id:c.id,name:c.name,type:c.type,parentId:c.parent_id||null}))}catch(e){return json({error:e.message||"Discord channels request failed",status:e.status||null},502)}
 const path=action==="state"?"state":action;
 const init={method:action==="state"?"GET":"POST",headers:{"X-BalticM-Service-Secret":env.BALTICM_MUSIC_SERVICE_SECRET,"Accept":"application/json"}};
 if(action!=="state"){let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)};if(action==="connect"&&!channels.some(c=>c.id===String(body.channelId||"")))return json({error:"Select a valid voice channel"},400);if(action==="play"){const query=String(body.query||"").trim();if(!query)return json({error:"Enter a song name or music URL"},400);if(query.length>1000)return json({error:"Query is too long"},400);body={query,source:["auto","youtube","soundcloud"].includes(String(body.source||""))?String(body.source):"auto",requestedBy:String(user?.id||user?.username||"")};}if(action==="volume"){const volume=Number(body.volume);if(!Number.isFinite(volume)||volume<0||volume>200)return json({error:"Volume must be between 0 and 200"},400);body={volume:Math.round(volume)};}init.headers["Content-Type"]="application/json";init.body=JSON.stringify({guildId,...body});}
 const target=`https://balticm.eu/music/${path}${action==="state"?`?guildId=${encodeURIComponent(guildId)}`:""}`;
 try{const r=await fetch(target,{...init,cf:{cacheTtl:0}}),data=await r.json().catch(()=>({}));if(!r.ok){const status=r.status===400||r.status===404||r.status===409?r.status:502;return json({error:data.error||"Music service request failed",status:r.status},status)}const musicTracks=[data.currentTrack,...(Array.isArray(data.queue)?data.queue:[]),data.state?.currentTrack,...(Array.isArray(data.state?.queue)?data.state.queue:[])].filter(t=>t&&typeof t==="object"&&/^\d{16,22}$/.test(String(t.requestedBy||"")));const musicIds=[...new Set(musicTracks.map(t=>String(t.requestedBy)))];if(musicIds.length&&env.DISCORD_BOT_TOKEN){const musicNames=new Map();await Promise.all(musicIds.map(async id=>{const key=guildId+":"+id,hit=musicRequesterNameCache.get(key);if(hit&&hit.exp>Date.now()){musicNames.set(id,hit.name);return}if(hit)musicRequesterNameCache.delete(key);let name="";try{const mr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${id}`,{headers:{Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`}});if(mr.ok){const member=await mr.json();name=String(member.nick||"").trim()||member.user?.global_name||member.user?.username||""}else{const ur=await fetch(`https://discord.com/api/v10/users/${id}`,{headers:{Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`}});if(ur.ok){const discordUser=await ur.json();name=discordUser.global_name||discordUser.username||""}}}catch{}if(name){musicRequesterNameCache.set(key,{name,exp:Date.now()+60000});musicNames.set(id,name)}}));const labelMusicRequester=t=>!t||typeof t!=="object"?t:(musicNames.get(String(t.requestedBy||""))?{...t,requestedBy:musicNames.get(String(t.requestedBy||""))}:t);if(data.currentTrack)data.currentTrack=labelMusicRequester(data.currentTrack);if(Array.isArray(data.queue))data.queue=data.queue.map(labelMusicRequester);if(data.state&&typeof data.state==="object"){if(data.state.currentTrack)data.state.currentTrack=labelMusicRequester(data.state.currentTrack);if(Array.isArray(data.state.queue))data.state.queue=data.state.queue.map(labelMusicRequester)}}return json({...data,channels});}catch{return json({error:"Music service is unavailable"},502)}
}
async function voiceCreateState(env,guildId){
 const stored=await getVoiceConfig(env,guildId),profiles=normalizeVoiceProfiles(stored);const premiumEarly=await premiumPlanState(env,guildId),maxEarly=voiceCreateMaxChannels(premiumEarly.premium);if(!profiles.length)return json({config:{enabled:false,profiles:[]},rooms:[],live:{activeRooms:0,owners:0},premium:!!premiumEarly.premium,plan:premiumEarly.displayPlan||"FREE",maxChannels:maxEarly});
 let channels;try{channels=await cachedGuildChannels(env,guildId)}catch(e){return json({error:e.message||"Discord channels request failed",status:e.status||null},502)}
 const hydrated=profiles.map(p=>({...p,createChannelName:channels.find(c=>c.id===p.createChannelId)?.name||"Create Voice",categoryName:channels.find(c=>c.id===p.categoryId)?.name||"Category"}));
 let rooms=[],live={activeRooms:0,owners:0,status:"offline"};
 try{
  const vr=await fetch(`https://balticm.eu/voice/state?guildId=${encodeURIComponent(guildId)}`,{headers:{"X-BalticM-Service-Secret":env.BALTICM_VOICE_SERVICE_SECRET||"","Accept":"application/json"},cf:{cacheTtl:0}});
  if(vr.ok){const v=await vr.json();rooms=Array.isArray(v.rooms)?v.rooms:[];live={activeRooms:Number(v.activeRooms)||rooms.length,owners:Number(v.owners)||0,status:v.status||"online"}}
 }catch{}
 const premiumState=await premiumPlanState(env,guildId),maxChannels=voiceCreateMaxChannels(premiumState.premium);return json({config:{enabled:stored?.enabled!==false,profiles:hydrated},rooms,live,premium:!!premiumState.premium,plan:premiumState.displayPlan||"FREE",maxChannels});
}
const voiceRoomsKey=guildId=>"voice-rooms:"+guildId;
async function getVoiceRooms(env,guildId){if(!env.BALTICM_DB||!isSnowflake(guildId))return[];const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key = ?").bind(voiceRoomsKey(guildId)).first();if(!row?.value)return[];try{return normalizeVoiceRooms(JSON.parse(row.value)).filter(room=>room.guildId===String(guildId))}catch{return[]}}
async function setVoiceRooms(env,guildId,records){if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();const value=JSON.stringify(normalizeVoiceRooms(records).filter(room=>room.guildId===String(guildId)));await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(voiceRoomsKey(guildId),value,new Date().toISOString()).run()}
const waitVoiceDiscord=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function discordVoice(env,url,init={},missingOk=false){return runVoiceDiscord(async()=>{const response=await fetch(url,{...init,headers:init.headers||botHeaders(env,!!init.body)});const data=await response.json().catch(()=>({}));return{status:response.status,headers:response.headers,body:data}},{wait:waitVoiceDiscord,missingOk})}
async function assertVoiceBotPermissions(env,guildId,profiles,channels){
 const me=await discordVoice(env,"https://discord.com/api/v10/users/@me");if(!me.ok||!me.body?.id)return{error:"Could not verify BalticM's Discord permissions.",status:502};
 const [memberRes,rolesRes]=await Promise.all([discordVoice(env,`https://discord.com/api/v10/guilds/${guildId}/members/${me.body.id}`),discordVoice(env,`https://discord.com/api/v10/guilds/${guildId}/roles`)]);
 if(!memberRes.ok)return{error:"BalticM is not in that Discord server, so Voice Create cannot be saved.",status:403};
 if(!rolesRes.ok||!Array.isArray(rolesRes.body))return{error:"Could not verify BalticM's Discord permissions.",status:502};
 for(const profile of profiles){
  for(const channelId of [profile.categoryId,profile.createChannelId]){
   const channel=channels.find(item=>item.id===channelId);
   const perms=resolveChannelPermissions({roles:rolesRes.body,memberRoleIds:memberRes.body?.roles||[],memberId:me.body.id,everyoneId:guildId,overwrites:channel?.permission_overwrites||[]});
   const missing=missingVoicePermissions(perms);
   if(missing.length)return{error:voicePermissionError(missing,channel?.name?`#${channel.name}`:""),status:403};
  }
 }
 return null;
}
async function saveVoiceCreate(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const input=Array.isArray(body.profiles)?body.profiles:[];
 const premiumState=await premiumPlanState(env,guildId),currentCount=normalizeVoiceProfiles(await getVoiceConfig(env,guildId)).length,limitErr=voiceCreateLimitError(premiumState.premium,input.length,currentCount);
 const cr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});if(!cr.ok)return json({error:"Discord channels request failed"},502);
 const channels=await cr.json();
 const prepared=prepareVoiceProfiles(input,channels,{limitError:limitErr});
 if(!prepared.ok)return json({error:prepared.error,plan:premiumState.displayPlan||"FREE",premium:!!premiumState.premium,maxChannels:voiceCreateMaxChannels(premiumState.premium)},prepared.status);
 const permissionError=await assertVoiceBotPermissions(env,guildId,prepared.profiles,channels);if(permissionError)return json({error:permissionError.error},permissionError.status);
 const profiles=prepared.profiles;
 const config={enabled:body.enabled!==false,profiles,updatedAt:new Date().toISOString()};try{await setVoiceConfig(env,guildId,config)}catch(e){return json({error:String(e.message||e)},503)}
 return json({config:{...config,profiles:profiles.map(p=>({...p,createChannelName:channels.find(c=>c.id===p.createChannelId)?.name||"Create Voice",categoryName:channels.find(c=>c.id===p.categoryId)?.name||"Category"}))}});
}
async function voiceServiceRooms(req,env,guildId){
 if(!isSnowflake(guildId))return json({error:"guildId is required"},400);
 if(req.method==="GET")return json({rooms:await getVoiceRooms(env,guildId)});
 if(req.method==="DELETE"){const channelId=new URL(req.url).searchParams.get("channelId");await setVoiceRooms(env,guildId,forgetVoiceRoom(await getVoiceRooms(env,guildId),channelId));return json({ok:true})}
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const saved=rememberVoiceRoom(await getVoiceRooms(env,guildId),{...body,guildId});
 if(!saved.ok)return json({error:saved.error||"Could not store Voice Create room"},409);
 try{await setVoiceRooms(env,guildId,saved.records)}catch(e){return json({error:String(e.message||e)},503)}
 return json({ok:true,room:saved.records.find(room=>room.channelId===String(body.channelId))});
}
async function voiceRoomAction(req,env,guildId,roomId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const profiles=normalizeVoiceProfiles(await getVoiceConfig(env,guildId));
 const records=await getVoiceRooms(env,guildId);
 const room=records.find(item=>item.channelId===String(roomId));
 const gate=assessTempRoomAction({guildId,roomId,room,triggerIds:new Set(profiles.map(profile=>profile.createChannelId)),actorIsManager:true});
 if(!gate.ok)return json({error:gate.error},gate.status);
 const fetched=await discordVoice(env,`https://discord.com/api/v10/channels/${roomId}`);
 if(!fetched.ok)return json({error:fetched.error||fetched.body?.message||"Room not found"},fetched.status===404?404:502);
 if(String(fetched.body?.guild_id||"")!==String(guildId))return json({error:"This is not a managed temporary room for this server."},403);
 const planned=tempRoomPatch(String(body.action||""),body,room,fetched.body);
 if(!planned.ok)return json({error:planned.error},planned.status);
 if(planned.delete){
  const deleted=await discordVoice(env,`https://discord.com/api/v10/channels/${roomId}`,{method:"DELETE"},true);
  if(!deleted.ok)return json({error:deleted.error||deleted.body?.message||"Room deletion failed"},502);
  try{await setVoiceRooms(env,guildId,forgetVoiceRoom(records,roomId))}catch(e){return json({error:"Discord deleted the room, but its ownership record could not be removed. "+String(e.message||e)},503)}
  return json({ok:true});
 }
 const patched=await discordVoice(env,`https://discord.com/api/v10/channels/${roomId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify(planned.patch)});
 if(!patched.ok)return json({error:patched.error||patched.body?.message||"Room update failed"},502);
 if(planned.ownerId){const updated=rememberVoiceRoom(records,{...room,ownerId:planned.ownerId});if(!updated.ok)return json({error:updated.error},409);try{await setVoiceRooms(env,guildId,updated.records)}catch(e){return json({error:"Discord updated the room, but the new owner could not be stored. "+String(e.message||e)},503)}}
 return json({ok:true,room:patched.body});
}


const ticketTablesSql=[
`CREATE TABLE IF NOT EXISTS tickets (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 channel_id TEXT NOT NULL,
 opener_id TEXT NOT NULL,
 opener_name TEXT NOT NULL,
 subject TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 assigned_id TEXT,
 assigned_name TEXT,
 created_at TEXT NOT NULL,
 closed_at TEXT,
 closed_by_id TEXT,
 closed_by_name TEXT
)`,
`CREATE TABLE IF NOT EXISTS ticket_messages (
 id TEXT PRIMARY KEY,
 ticket_id TEXT NOT NULL,
 guild_id TEXT NOT NULL,
 author_id TEXT NOT NULL,
 author_name TEXT NOT NULL,
 content TEXT NOT NULL,
 created_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS ticket_config (
 guild_id TEXT PRIMARY KEY,
 category_id TEXT,
 staff_role_id TEXT,
 panel_channel_id TEXT,
 panel_message_id TEXT,
 updated_at TEXT NOT NULL
)`
,
`CREATE TABLE IF NOT EXISTS ticket_types (
 guild_id TEXT NOT NULL,
 type_key TEXT NOT NULL,
 category_id TEXT,
 staff_role_id TEXT,
 panel_channel_id TEXT,
 panel_message_id TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (guild_id,type_key)
)`];
async function ensureTicketTables(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 for(const sql of ticketTablesSql)await env.BALTICM_DB.prepare(sql).run();
}
async function ticketTypeConfig(env,guildId,typeKey){
 await ensureTicketTables(env);
 const row=await env.BALTICM_DB.prepare("SELECT category_id AS categoryId,staff_role_id AS staffRoleId,panel_channel_id AS panelChannelId,panel_message_id AS panelMessageId FROM ticket_types WHERE guild_id=? AND type_key=?").bind(guildId,typeKey).first();
 if(row)return row;
 if(typeKey==="support"){
  const legacy=await env.BALTICM_DB.prepare("SELECT category_id AS categoryId,staff_role_id AS staffRoleId,panel_channel_id AS panelChannelId,panel_message_id AS panelMessageId FROM ticket_config WHERE guild_id=?").bind(guildId).first();
  if(legacy)return legacy;
 }
 return {categoryId:"",staffRoleId:"",panelChannelId:"",panelMessageId:""};
}
async function ticketTypesState(env,guildId){
 return json({support:await ticketTypeConfig(env,guildId,"support"),report:await ticketTypeConfig(env,guildId,"report")});
}
async function saveTicketType(req,env,guildId,typeKey){
 if(!["support","report"].includes(typeKey))return json({error:"Invalid ticket type"},400);
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const categoryId=String(body.categoryId||"").trim(),staffRoleId=String(body.staffRoleId||"").trim(),panelChannelId=String(body.panelChannelId||"").trim();
 for(const [label,id] of [["category",categoryId],["staff role",staffRoleId],["panel channel",panelChannelId]])if(id&&!/^\d{16,22}$/.test(id))return json({error:`Invalid ${label}`},400);
 await ensureTicketTables(env);
 await env.BALTICM_DB.prepare("INSERT INTO ticket_types (guild_id,type_key,category_id,staff_role_id,panel_channel_id,panel_message_id,updated_at) VALUES (?,?,?,?,?,NULL,?) ON CONFLICT(guild_id,type_key) DO UPDATE SET category_id=excluded.category_id,staff_role_id=excluded.staff_role_id,panel_channel_id=excluded.panel_channel_id,updated_at=excluded.updated_at").bind(guildId,typeKey,categoryId||null,staffRoleId||null,panelChannelId||null,new Date().toISOString()).run();
 return json({ok:true,config:await ticketTypeConfig(env,guildId,typeKey)});
}
async function publishTicketTypePanel(env,guildId,typeKey){
 if(!["support","report"].includes(typeKey))return json({error:"Invalid ticket type"},400);
 const cfg=await ticketTypeConfig(env,guildId,typeKey);
 if(!cfg?.panelChannelId)return json({error:"Select a panel channel first"},400);
 const gr=await fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)}),guild=gr.ok?await gr.json():null;
 const isReport=typeKey==="report";
 const embed=isReport?{author:{name:guild?.name||"Report Center",icon_url:guild?.icon?`https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png`:undefined},title:"🚨 Report a Player",description:"Report a player privately to the server staff.\n\n**Please include**\n> 👤 Player name / ID\n> 📋 What happened and when\n> 🖼️ Screenshots, video or other evidence\n> 🎮 Relevant server / game information\n\n*Reports are private and only visible to you and the staff team.*",color:0xe34d59,footer:{text:"Powered by BalticM.eu • PLAY TOGETHER"}}:{author:{name:guild?.name||"Support Center",icon_url:guild?.icon?`https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png`:undefined},title:"Support Center",description:"Need assistance? Create a **private ticket** and our staff will help you.\n\n**Before opening a ticket**\n> 📝 Explain your issue clearly\n> 🔁 Please do not create duplicate tickets\n> 🕐 A staff member will respond as soon as possible\n\n*Your ticket will only be visible to you and the support team.*",color:0x7457ff,footer:{text:"Powered by BalticM.eu • PLAY TOGETHER"}};
 const payload={embeds:[embed],components:[{type:1,components:[{type:2,style:isReport?4:1,label:isReport?"Report a Player":"Open a Ticket",emoji:{name:isReport?"🚨":"🎫"},custom_id:`ticket_create:${guildId}:${typeKey}`}]}]};
 const pr=await fetch(`https://discord.com/api/v10/channels/${cfg.panelChannelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)}),data=await pr.json().catch(()=>({}));
 if(!pr.ok)return json({error:data.message||"Could not publish ticket panel",status:pr.status},502);
 await env.BALTICM_DB.prepare("UPDATE ticket_types SET panel_message_id=?,updated_at=? WHERE guild_id=? AND type_key=?").bind(data.id,new Date().toISOString(),guildId,typeKey).run();
 return json({ok:true,messageId:data.id,type:typeKey});
}
async function ticketConfigState(env,guildId){
 await ensureTicketTables(env);
 const config=await env.BALTICM_DB.prepare("SELECT category_id AS categoryId,staff_role_id AS staffRoleId,panel_channel_id AS panelChannelId,panel_message_id AS panelMessageId,updated_at AS updatedAt FROM ticket_config WHERE guild_id=?").bind(guildId).first();
 return json({config:config||{categoryId:"",staffRoleId:"",panelChannelId:"",panelMessageId:""}});
}
async function saveTicketConfig(req,env,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const categoryId=String(body.categoryId||"").trim(),staffRoleId=String(body.staffRoleId||"").trim(),panelChannelId=String(body.panelChannelId||"").trim();
 for(const [label,id] of [["category",categoryId],["staff role",staffRoleId],["panel channel",panelChannelId]])if(id&&!/^\d{16,22}$/.test(id))return json({error:`Invalid ${label}`},400);
 await ensureTicketTables(env);
 await env.BALTICM_DB.prepare("INSERT INTO ticket_config (guild_id,category_id,staff_role_id,panel_channel_id,panel_message_id,updated_at) VALUES (?,?,?,?,NULL,?) ON CONFLICT(guild_id) DO UPDATE SET category_id=excluded.category_id,staff_role_id=excluded.staff_role_id,panel_channel_id=excluded.panel_channel_id,updated_at=excluded.updated_at").bind(guildId,categoryId||null,staffRoleId||null,panelChannelId||null,new Date().toISOString()).run();
 return ticketConfigState(env,guildId);
}
async function publishTicketPanel(env,guildId){
 await ensureTicketTables(env);
 const cfg=await env.BALTICM_DB.prepare("SELECT panel_channel_id AS panelChannelId FROM ticket_config WHERE guild_id=?").bind(guildId).first();
 if(!cfg?.panelChannelId)return json({error:"Select a panel channel first"},400);
 const gr=await fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)}),guild=gr.ok?await gr.json():null;
 const payload={embeds:[{author:{name:guild?.name||"Support Center",icon_url:guild?.icon?`https://cdn.discordapp.com/icons/${guildId}/${guild.icon}.png`:undefined},title:"Support Center",description:"Need assistance? Create a **private ticket** and our staff will help you.\n\n**Before opening a ticket**\n> 📝 Explain your issue clearly\n> 🔁 Please do not create duplicate tickets\n> 🕐 A staff member will respond as soon as possible\n\n*Your ticket will only be visible to you and the support team.*",color:0x7457ff,footer:{text:"Powered by BalticM.eu • PLAY TOGETHER"}}],components:[{type:1,components:[{type:2,style:1,label:"Open a Ticket",emoji:{name:"🎫"},custom_id:`ticket_create:${guildId}`}]}]};
 const pr=await fetch(`https://discord.com/api/v10/channels/${cfg.panelChannelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 const data=await pr.json().catch(()=>({}));if(!pr.ok)return json({error:data.message||"Could not publish ticket panel",status:pr.status},502);
 await env.BALTICM_DB.prepare("UPDATE ticket_config SET panel_message_id=?,updated_at=? WHERE guild_id=?").bind(data.id,new Date().toISOString(),guildId).run();
 return json({ok:true,messageId:data.id,guildName:guild?.name||guildId});
}
async function createTicketFromInteraction(env,interaction,guildId,typeKey="support"){
 await ensureTicketTables(env);
 const user=interaction?.member?.user||interaction?.user,userId=String(user?.id||""),username=String(interaction?.member?.nick||user?.global_name||user?.username||"member");
 if(!userId)return json({type:4,data:{content:"Could not identify your Discord account.",flags:64}});
 const subject=typeKey==="report"?"Player report":"Support ticket";
 const existing=await env.BALTICM_DB.prepare("SELECT channel_id AS channelId FROM tickets WHERE guild_id=? AND opener_id=? AND subject=? AND status='open' ORDER BY created_at DESC LIMIT 1").bind(guildId,userId,subject).first();
 if(existing?.channelId)return json({type:4,data:{content:`You already have an open ticket: <#${existing.channelId}>`,flags:64}});
 const cfg=await ticketTypeConfig(env,guildId,typeKey);
 const safe=username.toLowerCase().replace(/[^a-z0-9]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,55)||"member";
 const overwrites=[{id:guildId,type:0,deny:"1024",allow:"0"},{id:userId,type:1,allow:"68608",deny:"0"}];
 if(cfg?.staffRoleId)overwrites.push({id:cfg.staffRoleId,type:0,allow:"68608",deny:"0"});
 const payload={name:`${typeKey==="report"?"report":"ticket"}-${safe}`,type:0,permission_overwrites:overwrites};
 if(cfg?.categoryId)payload.parent_id=cfg.categoryId;
 const cr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 const ch=await cr.json().catch(()=>({}));if(!cr.ok)return json({type:4,data:{content:"I could not create the ticket channel. Check my channel permissions.",flags:64}});
 const id=crypto.randomUUID(),createdAt=new Date().toISOString();
 await env.BALTICM_DB.prepare("INSERT INTO tickets (id,guild_id,channel_id,opener_id,opener_name,subject,status,created_at) VALUES (?,?,?,?,?,?,'open',?)").bind(id,guildId,ch.id,userId,username,subject,createdAt).run();
 const welcome=typeKey==="report"?{content:`<@${userId}>`,embeds:[{title:"🚨 Player report opened",description:"Thanks. Your report is private and has been sent to the staff team.\n\n**Please provide the following**\n> 👤 Player name / ID\n> 🎮 Server or game\n> 📋 What happened and when\n> 🖼️ Screenshots, clips or other evidence\n\n*Do not contact or provoke the reported player while staff reviews the report.*",color:0xe34d59,footer:{text:"Player report • Private conversation"}}],components:[{type:1,components:[{type:2,style:4,label:"Close Report",emoji:{name:"🔒"},custom_id:`ticket_close:${id}`}]}],allowed_mentions:{users:[userId]}}:{content:`<@${userId}>`,embeds:[{title:"🎫 Support request opened",description:"Thanks for contacting our support team.\n\n**Tell us what you need help with**\n> 📋 Describe the issue in as much detail as possible\n> 🖼️ Add screenshots or other useful information if needed\n> 🕐 A staff member will reply as soon as possible\n\n*Please keep this channel open until your issue has been resolved.*",color:0x7457ff,footer:{text:"Support ticket • Private conversation"}}],components:[{type:1,components:[{type:2,style:4,label:"Close Ticket",emoji:{name:"🔒"},custom_id:`ticket_close:${id}`}]}],allowed_mentions:{users:[userId]}};
 await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(welcome)}).catch(()=>null);
 return json({type:4,data:{content:`✅ Your ticket has been created: <#${ch.id}>`,flags:64}});
}
async function closeTicketFromInteraction(env,interaction,ticketId){
 await ensureTicketTables(env);
 const guildId=String(interaction?.guild_id||"");
 const row=await env.BALTICM_DB.prepare("SELECT channel_id AS channelId,opener_id AS openerId,opener_name AS openerName,status FROM tickets WHERE id=? AND guild_id=?").bind(ticketId,guildId).first();
 if(!row)return json({type:4,data:{content:"Ticket not found.",flags:64}});
 if(row.status==="closed")return json({type:4,data:{content:"This ticket is already closed.",flags:64}});
 const user=interaction?.member?.user||interaction?.user,name=interaction?.member?.nick||user?.global_name||user?.username||user?.id||"Discord user",now=new Date().toISOString();
 if(row.channelId)await archiveTicketMessages(env,guildId,ticketId,row.channelId).catch(()=>0);
 await env.BALTICM_DB.prepare("UPDATE tickets SET status='closed',closed_at=?,closed_by_id=?,closed_by_name=? WHERE id=? AND guild_id=?").bind(now,String(user?.id||""),String(name),ticketId,guildId).run();
 if(row.channelId){
  const safe=(`closed-${row.openerName||"ticket"}`).toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").slice(0,90);
  await fetch(`https://discord.com/api/v10/channels/${row.channelId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify({name:safe,permission_overwrites:[{id:guildId,type:0,deny:"1024",allow:"0"},{id:row.openerId,type:1,deny:"2048",allow:"66560"}]})}).catch(()=>null);
  await postTicketTranscript(env,guildId,ticketId,row.channelId).catch(()=>false);
 }
 return json({type:7,data:{content:`🔒 Ticket closed by <@${user?.id}>. Transcript saved and attached below.
Staff can reopen or delete the channel from the Control Center.`,components:[],allowed_mentions:{parse:[]} }});
}
async function ticketsState(env,guildId){
 try{
  await ensureTicketTables(env);
  const rows=await env.BALTICM_DB.prepare("SELECT id,channel_id AS channelId,opener_id AS openerId,opener_name AS openerName,subject,status,assigned_id AS assignedId,assigned_name AS assignedName,created_at AS createdAt,closed_at AS closedAt,closed_by_id AS closedById,closed_by_name AS closedByName FROM tickets WHERE guild_id=? ORDER BY created_at DESC LIMIT 200").bind(guildId).all();
  const tickets=rows.results||[],stats={open:0,waiting:0,assigned:0,closed:0};
  for(const t of tickets){if(t.status==="closed")stats.closed++;else{stats.open++;if(t.assignedId)stats.assigned++;else stats.waiting++;}}
  return json({tickets,stats});
 }catch(e){return json({error:String(e.message||e)},503)}
}
async function fetchTicketChannelMessages(env,channelId){
 const all=[];let before="";
 for(let page=0;page<10;page++){
  const url=new URL(`https://discord.com/api/v10/channels/${channelId}/messages`);url.searchParams.set("limit","100");if(before)url.searchParams.set("before",before);
  const r=await fetch(url,{headers:botHeaders(env)});if(!r.ok)break;
  const batch=await r.json();if(!Array.isArray(batch)||!batch.length)break;
  all.push(...batch);before=batch[batch.length-1].id;if(batch.length<100)break;
 }
 return all.reverse();
}
async function archiveTicketMessages(env,guildId,ticketId,channelId){
 const messages=await fetchTicketChannelMessages(env,channelId);
 await env.BALTICM_DB.prepare("DELETE FROM ticket_messages WHERE ticket_id=? AND guild_id=?").bind(ticketId,guildId).run();
 for(const m of messages){
  const content=[String(m.content||""),...(m.attachments||[]).map(a=>a.url),...(m.embeds||[]).map(e=>e.title||e.description||"").filter(Boolean)].filter(Boolean).join("\n").slice(0,8000);
  if(!content)continue;
  const authorName=m.member?.nick||m.author?.global_name||m.author?.username||m.author?.id||"Unknown";
  await env.BALTICM_DB.prepare("INSERT OR REPLACE INTO ticket_messages (id,ticket_id,guild_id,author_id,author_name,content,created_at) VALUES (?,?,?,?,?,?,?)").bind(String(m.id),ticketId,guildId,String(m.author?.id||""),String(authorName),content,String(m.timestamp||new Date().toISOString())).run();
 }
 return messages.length;
}
async function postTicketTranscript(env,guildId,ticketId,channelId){
 const rows=await env.BALTICM_DB.prepare("SELECT author_name AS authorName,content,created_at AS createdAt FROM ticket_messages WHERE ticket_id=? AND guild_id=? ORDER BY created_at ASC").bind(ticketId,guildId).all();
 const lines=[`Ticket transcript • ${ticketId}`,"",...(rows.results||[]).flatMap(m=>[`[${new Date(m.createdAt).toISOString()}] ${m.authorName}:`,String(m.content||"").replace(/\\n/g,"\n"),""])];
 const text=lines.join("\n"),form=new FormData();
 form.append("payload_json",JSON.stringify({content:"📄 **Ticket transcript**\nA copy of this conversation is attached below."}));
 form.append("files[0]",new Blob([text],{type:"text/plain;charset=utf-8"}),`ticket-${ticketId}.txt`);
 const r=await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`,{method:"POST",headers:{Authorization:`Bot ${env.DISCORD_BOT_TOKEN}`},body:form});
 return r.ok;
}
async function ticketAction(req,env,user,guildId,ticketId){
 let body={};try{body=await req.json()}catch{}
 const action=String(body.action||"").toLowerCase();
 await ensureTicketTables(env);
 const row=await env.BALTICM_DB.prepare("SELECT id,channel_id AS channelId,opener_id AS openerId,opener_name AS openerName,subject,status,assigned_id AS assignedId,assigned_name AS assignedName,created_at AS createdAt,closed_at AS closedAt FROM tickets WHERE id=? AND guild_id=?").bind(ticketId,guildId).first();
 if(!row)return json({error:"Ticket not found"},404);
 const now=new Date().toISOString(),staffName=user.global_name||user.username||user.id;
 if(action==="assign"){
  await env.BALTICM_DB.prepare("UPDATE tickets SET assigned_id=?,assigned_name=? WHERE id=? AND guild_id=?").bind(user.id,staffName,ticketId,guildId).run();
  if(row.channelId){
   const assigned={embeds:[{title:"👤 Ticket assigned",description:`**${staffName}** has taken this support ticket.

**Status:** 🟣 Assigned
A staff member is now handling your request.`,color:0x7457ff,footer:{text:"Support ticket • Assigned"}}]};
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(assigned)}).catch(()=>null);
  }
  return json({ok:true,action,assignedId:user.id,assignedName:staffName});
 }
 if(action==="unassign"){
  await env.BALTICM_DB.prepare("UPDATE tickets SET assigned_id=NULL,assigned_name=NULL WHERE id=? AND guild_id=?").bind(ticketId,guildId).run();
  if(row.channelId){
   const unassigned={embeds:[{title:"↩️ Ticket unassigned",description:`**${staffName}** released this support ticket.

**Status:** 🟡 Waiting
The ticket is available for another staff member.`,color:0xe2ad42,footer:{text:"Support ticket • Waiting"}}]};
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(unassigned)}).catch(()=>null);
  }
  return json({ok:true,action});
 }
 if(action==="close"){
  let archived=0;if(row.channelId)archived=await archiveTicketMessages(env,guildId,ticketId,row.channelId).catch(()=>0);
  await env.BALTICM_DB.prepare("UPDATE tickets SET status='closed',closed_at=?,closed_by_id=?,closed_by_name=? WHERE id=? AND guild_id=?").bind(now,user.id,staffName,ticketId,guildId).run();
  if(row.channelId){
   const safe=(`closed-${row.openerName||"ticket"}`).toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").slice(0,90);
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify({name:safe,permission_overwrites:[{id:guildId,type:0,deny:"1024",allow:"0"},{id:row.openerId,type:1,deny:"2048",allow:"66560"}]})}).catch(()=>null);
   const closed={embeds:[{title:"🔒 Ticket closed",description:`Closed by **${staffName}**

**Status:** 🔴 Closed
📄 Transcript saved

*Staff can reopen this ticket if further assistance is needed.*`,color:0xe34d59,footer:{text:"Support ticket • Closed"}}]};
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(closed)}).catch(()=>null);
   await postTicketTranscript(env,guildId,ticketId,row.channelId).catch(()=>false);
  }
  return json({ok:true,action,archived});
 }
 if(action==="reopen"){
  const cfg=await env.BALTICM_DB.prepare("SELECT staff_role_id AS staffRoleId FROM ticket_config WHERE guild_id=?").bind(guildId).first();
  await env.BALTICM_DB.prepare("UPDATE tickets SET status='open',closed_at=NULL,closed_by_id=NULL,closed_by_name=NULL WHERE id=? AND guild_id=?").bind(ticketId,guildId).run();
  if(row.channelId){
   const safe=(`ticket-${row.openerName||"member"}`).toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").slice(0,90),overwrites=[{id:guildId,type:0,deny:"1024",allow:"0"},{id:row.openerId,type:1,allow:"68608",deny:"0"}];
   if(cfg?.staffRoleId)overwrites.push({id:cfg.staffRoleId,type:0,allow:"68608",deny:"0"});
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify({name:safe,permission_overwrites:overwrites})}).catch(()=>null);
   const reopened={embeds:[{title:"🔓 Ticket reopened",description:`Reopened by **${staffName}**

**Status:** 🟢 Open
You can continue the conversation below.`,color:0x57d39b,footer:{text:"Support ticket • Reopened"}}],components:[{type:1,components:[{type:2,style:4,label:"Close Ticket",emoji:{name:"🔒"},custom_id:`ticket_close:${ticketId}`}]}]};
   await fetch(`https://discord.com/api/v10/channels/${row.channelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(reopened)}).catch(()=>null);
  }
  return json({ok:true,action});
 }
 if(action==="transcript"){
  if(row.status!=="closed"&&row.channelId)await archiveTicketMessages(env,guildId,ticketId,row.channelId).catch(()=>0);
  const messages=await env.BALTICM_DB.prepare("SELECT author_name AS authorName,content,created_at AS createdAt FROM ticket_messages WHERE ticket_id=? AND guild_id=? ORDER BY created_at ASC").bind(ticketId,guildId).all();
  return json({ticket:row,messages:messages.results||[]});
 }
 if(action==="delete"){
  if(row.status!=="closed")return json({error:"Close the ticket before deleting it"},400);
  if(row.channelId){
   const dr=await fetch(`https://discord.com/api/v10/channels/${row.channelId}`,{method:"DELETE",headers:botHeaders(env)});
   if(!dr.ok&&dr.status!==404)return json({error:"Could not delete Discord ticket channel"},502);
  }
  await env.BALTICM_DB.prepare("DELETE FROM ticket_messages WHERE ticket_id=? AND guild_id=?").bind(ticketId,guildId).run();
  await env.BALTICM_DB.prepare("DELETE FROM tickets WHERE id=? AND guild_id=?").bind(ticketId,guildId).run();
  return json({ok:true,action,purged:true});
 }
 return json({error:"Unknown ticket action"},400);
}


const moderationTableSql=`CREATE TABLE IF NOT EXISTS moderation_actions (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 member_id TEXT NOT NULL,
 member_name TEXT NOT NULL,
 moderator_id TEXT NOT NULL,
 moderator_name TEXT NOT NULL,
 action TEXT NOT NULL,
 reason TEXT NOT NULL,
 duration_minutes INTEGER,
 created_at TEXT NOT NULL
)`;
async function ensureModerationTable(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare(moderationTableSql).run();
}
async function moderationState(env,guildId){
 try{
  await ensureModerationTable(env);
  const rows=await env.BALTICM_DB.prepare("SELECT id,member_id AS memberId,member_name AS memberName,moderator_id AS moderatorId,moderator_name AS moderatorName,action,reason,duration_minutes AS durationMinutes,created_at AS createdAt FROM moderation_actions WHERE guild_id = ? ORDER BY created_at DESC LIMIT 100").bind(guildId).all();
  const actions=(rows.results||[]).filter(a=>a.action!=="removed");
  const stats={warnings:0,timeouts:0,kicks:0,bans:0};
  for(const a of actions){if(a.action==="warn")stats.warnings++;else if(a.action==="timeout")stats.timeouts++;else if(a.action==="kick")stats.kicks++;else if(a.action==="ban")stats.bans++;}
  return json({actions,stats});
 }catch(e){return json({error:String(e.message||e)},503)}
}
const accessSettingsKey=guildId=>"access-settings:"+guildId;
const notificationSettingsKey=guildId=>"notification-settings:"+guildId;
const moduleSettingsKey=guildId=>"module-settings:"+guildId;
const MODULE_KEYS=["direct_messages","tickets","members_roles","moderation","reaction_roles","giveaways","announcements","voice_create","music_bot","streamers"];
const NOTIFICATION_KEYS=["moderation","tickets","giveaways","service_status","errors","management"];
async function readBotConfig(env,key,fallback){
 if(!env.BALTICM_DB)return fallback;
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
 const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key=?").bind(key).first();
 if(row?.value)try{return {...fallback,...JSON.parse(row.value)}}catch{}
 return fallback;
}
async function writeBotConfig(env,key,value){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
 await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key,JSON.stringify(value),new Date().toISOString()).run();
}
async function notificationSettingsState(env,guildId){
 const config=await readBotConfig(env,notificationSettingsKey(guildId),{channelId:"",enabled:true,events:Object.fromEntries(NOTIFICATION_KEYS.map(k=>[k,true]))});
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});
 const channels=r.ok?(await r.json()).filter(x=>[0,5].includes(x.type)).map(x=>({id:x.id,name:x.name,type:x.type,parentId:x.parent_id||null})):[];
 return {config,channels};
}
async function saveNotificationSettings(req,env,guildId){
 try{const b=await req.json(),events={};for(const k of NOTIFICATION_KEYS)events[k]=b.events?.[k]!==false;const config={channelId:String(b.channelId||""),enabled:b.enabled!==false,events};await writeBotConfig(env,notificationSettingsKey(guildId),config);return json({ok:true,config})}catch(e){return json({error:String(e.message||e)},500)}
}
async function moduleSettingsState(env,guildId){
 return await readBotConfig(env,moduleSettingsKey(guildId),{modules:Object.fromEntries(MODULE_KEYS.map(k=>[k,true]))});
}
async function saveModuleSettings(req,env,guildId){
 try{const b=await req.json(),modules={};for(const k of MODULE_KEYS)modules[k]=b.modules?.[k]!==false;const config={modules};await writeBotConfig(env,moduleSettingsKey(guildId),config);return json({ok:true,config})}catch(e){return json({error:String(e.message||e)},500)}
}
async function moduleEnabled(env,guildId,key){if(!MODULE_KEYS.includes(key))return true;const c=await moduleSettingsState(env,guildId);return c.modules?.[key]!==false}

async function ensureStreamersTable(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare(STREAMERS_TABLE_SQL).run();
 for(const sql of STREAMERS_ALTER_SQL){try{await env.BALTICM_DB.prepare(sql).run()}catch{}}
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_streamers_guild ON streamers(guild_id)").run();
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_streamers_member ON streamers(discord_member_id, provider)").run();
 await env.BALTICM_DB.prepare(USER_STREAMING_ACCOUNTS_TABLE_SQL).run();
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_user_streaming_accounts_user ON user_streaming_accounts(discord_user_id)").run();
 for(const sql of STREAMING_ACCOUNT_ALTER_SQL){try{await env.BALTICM_DB.prepare(sql).run()}catch{}}
 await env.BALTICM_DB.prepare(STREAMING_OAUTH_NONCE_SQL).run();
 try{
  await env.BALTICM_DB.prepare("INSERT OR IGNORE INTO user_streaming_accounts (id,discord_user_id,provider,provider_user_id,provider_login,display_name,profile_url,watch_url,created_at,updated_at) SELECT id,discord_member_id,provider,provider_user_id,provider_login,display_name,profile_url,watch_url,created_at,updated_at FROM streamers WHERE source IN ('self','auto')").run();
  await env.BALTICM_DB.prepare("UPDATE streamers SET source='auto' WHERE source='self'").run();
 }catch{}
}
async function loadStreamerSettings(env,guildId){
 const raw=await readBotConfig(env,STREAMER_SETTINGS_KEY(guildId),defaultStreamerSettings());
 return {...defaultStreamerSettings(),...(raw&&typeof raw==="object"?raw:{})};
}
async function isDiscordGuildOwner(env,user,guildId){
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)});
 if(!r.ok)return false;
 const g=await r.json();
 return String(g.owner_id||"")===String(user.id);
}
async function discordGuildMemberPresent(env,guildId,userId){
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,{headers:botHeaders(env)});
 return r.ok;
}
async function streamerStudioGate(env,user,guildId){
 const [isOwner,premiumState,level]=await Promise.all([isDiscordGuildOwner(env,user,guildId),premiumPlanState(env,guildId),controlAccessLevel(env,user,guildId,"streamers")]);
 const decision=decideStreamerStudioMutation({isOwner,premium:!!premiumState.premium,canConfigure:levelMeets(level,ACCESS_CONFIGURE)});
 return {...decision,isOwner,premium:!!premiumState.premium,premiumState,accessLevel:level};
}
async function persistStreamerCheck(env,row,check){
 const mapped=mapStreamerRow(row);
 const next=applyLiveCheckToRow(mapped,check);
 const now=new Date().toISOString();
 await env.BALTICM_DB.prepare("UPDATE streamers SET live_status=?,stream_title=?,stream_category=?,viewer_count=?,thumbnail_url=?,profile_image_url=?,session_id=?,watch_url=?,display_name=?,last_checked_at=?,last_error=?,updated_at=? WHERE id=? AND guild_id=?").bind(
  next.liveStatus,next.streamTitle,next.streamCategory,next.viewerCount,next.thumbnailUrl,next.profileImageUrl,next.sessionId,next.watchUrl,next.displayName,next.lastCheckedAt,next.lastError,now,row.id,row.guild_id
 ).run();
 return{...mapped,...next,updatedAt:now};
}
async function deleteStreamerAnnouncement(env,row){
 const mapped=typeof row.announcementMessageId==="string"?row:mapStreamerRow(row);
 const messageId=String(mapped.announcementMessageId||"").trim();
 const channelId=String(mapped.announcementChannelId||"").trim();
 if(!messageId||!channelId)return{deleted:false};
 const attempts=Number(mapped.announcementDeleteAttempts)||0;
 if(attempts>=STREAMERS_DELETE_MAX_ATTEMPTS)return{deleted:false,gaveUp:true};
 const claimed=await env.BALTICM_DB.prepare("UPDATE streamers SET announcement_delete_attempts=announcement_delete_attempts+1,updated_at=? WHERE id=? AND guild_id=? AND announcement_message_id=?").bind(new Date().toISOString(),mapped.id,mapped.guildId,messageId).run();
 if(!claimed.meta?.changes)return{deleted:false,duplicate:true};
 const res=await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,{method:"DELETE",headers:botHeaders(env)});
 const body=await res.json().catch(()=>({}));
 if(res.ok||res.status===204||discordAnnouncementGone(res.status,body)){
  await env.BALTICM_DB.prepare("UPDATE streamers SET announcement_message_id='',announcement_delete_attempts=0,updated_at=? WHERE id=? AND guild_id=?").bind(new Date().toISOString(),mapped.id,mapped.guildId).run();
  return{deleted:true};
 }
 if(res.status===429){
  return{deleted:false,error:streamerAnnouncementError(res.status,body),status:res.status};
 }
 if(attempts+1>=STREAMERS_DELETE_MAX_ATTEMPTS){
  await env.BALTICM_DB.prepare("UPDATE streamers SET last_error=?,updated_at=? WHERE id=? AND guild_id=?").bind("Could not delete the LIVE announcement after several attempts.",new Date().toISOString(),mapped.id,mapped.guildId).run();
 }
 return{deleted:false,error:streamerAnnouncementError(res.status,body),status:res.status};
}
async function sendStreamerLiveAnnouncement(env,row,check){
 const mapped=typeof row.provider==="string"&&row.discordMemberId?row:mapStreamerRow(row);
 if(!shouldAnnounceLive(mapped,check))return{sent:false};
 const channelId=String(mapped.announcementChannelId||"").trim();
 if(!isStreamerSnowflake(channelId)){
  await env.BALTICM_DB.prepare("UPDATE streamers SET last_error=?,updated_at=? WHERE id=? AND guild_id=?").bind("No valid Streamers announcement channel is configured.",new Date().toISOString(),mapped.id,mapped.guildId).run();
  return{sent:false,error:"No valid Streamers announcement channel is configured."};
 }
 const claimed=await env.BALTICM_DB.prepare("UPDATE streamers SET last_announced_session_id=?,updated_at=? WHERE id=? AND guild_id=? AND last_announced_session_id!=?").bind(check.sessionId,new Date().toISOString(),mapped.id,mapped.guildId,check.sessionId).run();
 if(!claimed.meta?.changes)return{sent:false,duplicate:true};
 const member=await loadStreamerMember(env,mapped.guildId,mapped.discordMemberId);
 const payload=buildLiveAnnouncementPayload({streamer:mapped,memberName:member.member?.globalName||mapped.displayName,check});
 const posted=await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 const body=await posted.json().catch(()=>({}));
 if(!posted.ok){
  const err=streamerAnnouncementError(posted.status,body);
  await env.BALTICM_DB.prepare("UPDATE streamers SET last_announced_session_id=?,last_error=?,updated_at=? WHERE id=? AND guild_id=? AND last_announced_session_id=?").bind(mapped.lastAnnouncedSessionId||"",err,new Date().toISOString(),mapped.id,mapped.guildId,check.sessionId).run();
  return{sent:false,error:err,status:posted.status};
 }
 const messageId=String(body.id||"");
 await env.BALTICM_DB.prepare("UPDATE streamers SET announcement_message_id=?,announcement_delete_attempts=0,updated_at=? WHERE id=? AND guild_id=?").bind(messageId,new Date().toISOString(),mapped.id,mapped.guildId).run();
 return{sent:true,messageId};
}
async function refreshOneStreamer(env,row,{announce=true,premium=true}={}){
 const mapped=mapStreamerRow(row);
 if(shouldPauseAutoStreamerAutomation(mapped,premium))return;
 if(normalizeStreamerSource(mapped.source)===STREAMER_SOURCE_AUTO){
  const isMember=await discordGuildMemberPresent(env,mapped.guildId,mapped.discordMemberId);
  if(shouldRemoveAutoGuildParticipation({source:mapped.source,isMember})){
   await removeAutoGuildStreamer(env,mapped);
   return;
  }
 }
 const check=await checkProviderLive(mapped.provider,mapped,env);
 await persistStreamerCheck(env,row,check);
 if(shouldDeleteLiveAnnouncement({announcementMessageId:mapped.announcementMessageId,nextStatus:check.status,liveDetection:check.liveDetection})){
  await deleteStreamerAnnouncement(env,mapped);
 }
 if(announce)await sendStreamerLiveAnnouncement(env,mapped,check);
}
async function pollAllStreamers(env){
 if(!env.BALTICM_DB)return;
 try{
  await ensureStreamersTable(env);
  const premiumCache=new Map();
  const map=await loadPremiumMap(env);
  for(const gid of map.keys()){
   try{
    const premium=!!(await premiumPlanState(env,gid)).premium;
    premiumCache.set(gid,premium);
    if(premium)await syncAutoStreamersForGuild(env,gid,true);
   }catch{}
  }
  const r=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE enabled=1").all();
  for(const row of r.results||[]){
   try{
    const gid=String(row.guild_id||"");
    if(!premiumCache.has(gid))premiumCache.set(gid,!!(await premiumPlanState(env,gid)).premium);
    await refreshOneStreamer(env,row,{announce:true,premium:premiumCache.get(gid)});
   }catch{}
  }
 }catch{}
}
async function loadStreamerMember(env,guildId,memberId){
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,{headers:botHeaders(env)});
 if(r.status===404)return{missing:true};
 if(!r.ok)return{error:true,status:r.status};
 const m=await r.json();
 return{member:{id:m.user?.id,username:m.user?.username||"Unknown",globalName:m.nick||m.user?.global_name||m.user?.username||"Unknown",avatar:m.user?.avatar||null,bot:!!m.user?.bot}};
}
async function loadStreamerChannel(env,channelId){
 const r=await fetch(`https://discord.com/api/v10/channels/${channelId}`,{headers:botHeaders(env)});
 if(r.status===404)return{missing:true};
 if(r.status===403||r.status===50013)return{forbidden:true};
 if(!r.ok)return null;
 return r.json();
}
async function listGuildMembersBrief(env,guildId){
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`,{headers:botHeaders(env)});
 if(!r.ok)return[];
 const members=await r.json();
 return(Array.isArray(members)?members:[]).filter(m=>m.user&&!m.user.bot).map(m=>({id:m.user.id,username:m.user.username||"Unknown",globalName:m.nick||m.user.global_name||m.user.username||"Unknown",avatar:m.user.avatar||null}));
}
async function listGuildTextChannels(env,guildId){
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});
 if(!r.ok)return[];
 const data=await r.json().catch(()=>[]);
 return(Array.isArray(data)?data:[]).filter(x=>[0,5].includes(x.type)).map(x=>({id:x.id,name:x.name,type:x.type}));
}
function streamerRowToView(row,env,extras={}){
 const mapped=mapStreamerRow(row);
 return streamerPublicView(mapped,{env,detection:liveDetectionAvailable(mapped.provider,env),...extras});
}
async function loadProfileAccount(env,userId,provider){
 await ensureStreamersTable(env);
 return env.BALTICM_DB.prepare("SELECT * FROM user_streaming_accounts WHERE discord_user_id=? AND provider=?").bind(userId,provider).first();
}
async function loadProfileAccountsForMembers(env,memberIds){
 const ids=[...new Set((memberIds||[]).filter(Boolean).map(String))];
 const grouped={};
 if(!ids.length)return grouped;
 const chunkSize=80;
 for(let i=0;i<ids.length;i+=chunkSize){
  const chunk=ids.slice(i,i+chunkSize);
  const placeholders=chunk.map(()=>"?").join(",");
  const r=await env.BALTICM_DB.prepare(`SELECT * FROM user_streaming_accounts WHERE discord_user_id IN (${placeholders})`).bind(...chunk).all();
  for(const row of r.results||[]){
   const mapped=mapProfileAccountRow(row);
   if(!mapped?.discordUserId)continue;
   if(!grouped[mapped.discordUserId])grouped[mapped.discordUserId]=[];
   grouped[mapped.discordUserId].push(publicStreamingAccount(row)||mapped);
  }
 }
 return grouped;
}
async function removeAutoGuildStreamer(env,mapped){
 if(!mapped?.id||!mapped.guildId)return;
 if(mapped.announcementMessageId){
  try{await deleteStreamerAnnouncement(env,mapped)}catch{}
 }
 await env.BALTICM_DB.prepare("DELETE FROM streamers WHERE id=? AND guild_id=? AND source IN ('auto','self')").bind(mapped.id,mapped.guildId).run();
}
async function upsertAutoStreamerFromAccount(env,guildId,account,settings){
 const provider=String(account.provider||account.provider);
 const memberId=String(account.discord_user_id||account.discordUserId);
 const existing=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE guild_id=? AND discord_member_id=? AND provider=?").bind(guildId,memberId,provider).first();
 if(existing&&normalizeStreamerSource(existing.source)===STREAMER_SOURCE_OWNER)return existing;
 const dup=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE guild_id=? AND provider=? AND provider_user_id=?").bind(guildId,provider,account.provider_user_id||account.providerUserId).first();
 if(dup&&normalizeStreamerSource(dup.source)===STREAMER_SOURCE_OWNER)return dup;
 const now=new Date().toISOString();
 const channelId=String(settings?.announcementChannelId||existing?.announcement_channel_id||"");
 const autoAnnounce=settings?.autoAnnounce===false?0:1;
 if(existing){
  await env.BALTICM_DB.prepare("UPDATE streamers SET provider_user_id=?,provider_login=?,display_name=?,profile_url=?,watch_url=?,announcement_channel_id=?,auto_announce=?,source=?,updated_at=? WHERE id=? AND guild_id=?").bind(
   account.provider_user_id||account.providerUserId,
   account.provider_login||account.providerLogin||"",
   account.display_name||account.displayName||"",
   account.profile_url||account.profileUrl||"",
   account.watch_url||account.watchUrl||"",
   channelId,
   autoAnnounce,
   STREAMER_SOURCE_AUTO,
   now,
   existing.id,
   guildId
  ).run();
  return existing;
 }
 const count=await env.BALTICM_DB.prepare("SELECT COUNT(*) AS n FROM streamers WHERE guild_id=?").bind(guildId).first();
 if(Number(count?.n||0)>=STREAMERS_MAX_PER_GUILD)return null;
 const id=crypto.randomUUID();
 const detection=liveDetectionAvailable(provider,env);
 await env.BALTICM_DB.prepare("INSERT INTO streamers (id,guild_id,provider,provider_user_id,provider_login,display_name,profile_url,watch_url,discord_member_id,announcement_channel_id,auto_announce,enabled,custom_message,live_status,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
  id,guildId,provider,account.provider_user_id||account.providerUserId,account.provider_login||account.providerLogin||"",account.display_name||account.displayName||"",account.profile_url||account.profileUrl||"",account.watch_url||account.watchUrl||"",memberId,channelId,autoAnnounce,1,"",detection.available?"unknown":"unknown",STREAMER_SOURCE_AUTO,now,now
 ).run();
 return {id};
}
async function syncAutoStreamersForGuild(env,guildId,premium){
 if(!premium)return;
 await ensureStreamersTable(env);
 const members=await listGuildMembersBrief(env,guildId);
 const memberIds=new Set(members.map(m=>String(m.id)));
 const settings=await loadStreamerSettings(env,guildId);
 const accounts=await env.BALTICM_DB.prepare("SELECT * FROM user_streaming_accounts").all();
 for(const account of accounts.results||[]){
  if(Number(account.verified)!==1)continue;
  if(!memberIds.has(String(account.discord_user_id)))continue;
  try{await upsertAutoStreamerFromAccount(env,guildId,account,settings)}catch{}
 }
 const autoRows=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE guild_id=? AND source IN ('auto','self')").bind(guildId).all();
 for(const row of autoRows.results||[]){
  if(memberIds.has(String(row.discord_member_id)))continue;
  try{await removeAutoGuildStreamer(env,mapStreamerRow(row))}catch{}
 }
}
async function syncAutoStreamersForUser(env,userId){
 await ensureStreamersTable(env);
 const map=await loadPremiumMap(env);
 for(const gid of map.keys()){
  try{
   const premium=!!(await premiumPlanState(env,gid)).premium;
   if(!premium)continue;
   const isMember=await discordGuildMemberPresent(env,gid,userId);
   if(!isMember){
    const rows=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE guild_id=? AND discord_member_id=? AND source IN ('auto','self')").bind(gid,userId).all();
    for(const row of rows.results||[]){try{await removeAutoGuildStreamer(env,mapStreamerRow(row))}catch{}}
    continue;
   }
   await syncAutoStreamersForGuild(env,gid,true);
  }catch{}
 }
}
async function streamersState(env,guildId,user){
 try{
  await ensureStreamersTable(env);
  const premium=user?!!(await premiumPlanState(env,guildId)).premium:!!(await premiumPlanState(env,guildId)).premium;
  if(premium)await syncAutoStreamersForGuild(env,guildId,true);
  const r=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE guild_id=? ORDER BY created_at DESC").bind(guildId).all();
  const channels=await listGuildTextChannels(env,guildId);
  const members=await listGuildMembersBrief(env,guildId);
  const memberMap=new Map(members.map(m=>[m.id,m]));
  const channelMap=new Map(channels.map(c=>[c.id,c.name]));
  const streamers=[];
  for(const row of r.results||[]){
   const source=normalizeStreamerSource(row.source);
   if(!premium&&source===STREAMER_SOURCE_AUTO)continue;
   const member=memberMap.get(row.discord_member_id)||null;
   streamers.push(streamerRowToView(row,env,{member,channelName:channelMap.get(row.announcement_channel_id)||"",memberMissing:!member}));
  }
  const memberIds=members.map(m=>m.id);
  const profileAccounts=await loadProfileAccountsForMembers(env,memberIds);
  return json({
   streamers,
   stats:summarizeStreamerStats(streamers),
   members,
   channels,
   providers:providerCapabilities(env),
   settings:await loadStreamerSettings(env,guildId),
   profileAccounts,
   premium,
   isOwner:user?await isDiscordGuildOwner(env,user,guildId):false,
   canMutate:user?(await streamerStudioGate(env,user,guildId)).ok:false
  });
 }catch{return json({error:"Could not load streamers"},500)}
}
async function saveStreamerSettings(req,env,user,guildId){
 const gate=await streamerStudioGate(env,user,guildId);
 if(!gate.ok)return json({error:gate.error},gate.status||403);
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const parsed=parseStreamerSettingsBody(body);
 if(!parsed.ok)return json({error:parsed.error},400);
 if(parsed.value.announcementChannelId){
  const channel=await loadStreamerChannel(env,parsed.value.announcementChannelId);
  if(channel?.missing)return json({error:"The Discord announcement channel no longer exists."},400);
  const allowed=discordChannelAllowed(channel,guildId);
  if(!allowed.ok)return json({error:allowed.error},allowed.status||400);
 }
 await writeBotConfig(env,STREAMER_SETTINGS_KEY(guildId),parsed.value);
 return json({ok:true,settings:parsed.value});
}
async function saveStreamer(req,env,user,guildId,id=""){
 await ensureStreamersTable(env);
 const studio=await streamerStudioGate(env,user,guildId);
 if(!studio.ok)return json({error:studio.error},studio.status||403);
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 if(body.guildId&&String(body.guildId)!==String(guildId))return json({error:"Forbidden"},403);
 const existing=id?await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE id=? AND guild_id=?").bind(id,guildId).first():null;
 if(id&&!existing)return json({error:"Streamer not found"},404);
 const existingSource=existing?normalizeStreamerSource(existing.source):STREAMER_SOURCE_OWNER;
 if(existingSource===STREAMER_SOURCE_AUTO){
  const memberId=String(existing.discord_member_id);
  const parsedFlags=parseStreamerConfigBody({
   ...body,
   discordMemberId:memberId,
   provider:existing.provider,
   channel:existing.profile_url||existing.provider_login,
   announcementChannelId:body.announcementChannelId||existing.announcement_channel_id
  });
  if(!parsedFlags.ok)return json({error:parsedFlags.error},400);
  const channel=await loadStreamerChannel(env,parsedFlags.value.announcementChannelId);
  if(channel?.missing)return json({error:"The Discord announcement channel no longer exists."},400);
  const gate=discordChannelAllowed(channel,guildId);
  if(!gate.ok)return json({error:gate.error},gate.status||400);
  const now=new Date().toISOString();
  await env.BALTICM_DB.prepare("UPDATE streamers SET announcement_channel_id=?,auto_announce=?,enabled=?,custom_message=?,updated_at=? WHERE id=? AND guild_id=?").bind(
   parsedFlags.value.announcementChannelId,parsedFlags.value.autoAnnounce?1:0,parsedFlags.value.enabled?1:0,parsedFlags.value.customMessage,now,id,guildId
  ).run();
  const row=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE id=? AND guild_id=?").bind(id,guildId).first();
  const member=await loadStreamerMember(env,guildId,memberId);
  return json({ok:true,streamer:streamerRowToView(row,env,{member:member.member,channelName:gate.name})});
 }
 const memberHint=String(body.discordMemberId||body.memberId||existing?.discord_member_id||"").trim();
 const providerHint=String(body.provider||existing?.provider||"").trim().toLowerCase();
 if(!String(body.channel||body.profile||body.input||"").trim()&&isStreamerSnowflake(memberHint)&&providerHint){
  const linked=await loadProfileAccount(env,memberHint,providerHint);
  if(linked){
   body={...body,channel:linked.profile_url||linked.provider_login,provider:linked.provider};
  }
 }
 const parsed=parseStreamerConfigBody(body);
 if(!parsed.ok)return json({error:parsed.error},400);
 const discordMemberId=parsed.value.discordMemberId;
 const member=await loadStreamerMember(env,guildId,discordMemberId);
 if(member.missing)return json({error:"That Discord member is not in this server"},400);
 if(member.error)return json({error:"Could not verify the Discord member"},502);
 const channel=await loadStreamerChannel(env,parsed.value.announcementChannelId);
 if(channel?.missing)return json({error:"The Discord announcement channel no longer exists."},400);
 const gate=discordChannelAllowed(channel,guildId);
 if(!gate.ok)return json({error:gate.error},gate.status||400);
 const sameMember=await env.BALTICM_DB.prepare("SELECT id FROM streamers WHERE guild_id=? AND discord_member_id=? AND provider=? AND id!=?").bind(guildId,discordMemberId,parsed.value.provider,id||"").first();
 if(sameMember)return json({error:duplicateStreamerError()},409);
 const dup=await env.BALTICM_DB.prepare("SELECT id FROM streamers WHERE guild_id=? AND provider=? AND provider_user_id=? AND id!=?").bind(guildId,parsed.value.provider,parsed.value.providerUserId,id||"").first();
 if(dup)return json({error:duplicateStreamerError()},409);
 if(!id){
  const count=await env.BALTICM_DB.prepare("SELECT COUNT(*) AS n FROM streamers WHERE guild_id=?").bind(guildId).first();
  if(Number(count?.n||0)>=STREAMERS_MAX_PER_GUILD)return json({error:"This server already has the maximum number of managed streamers."},400);
 }
 const now=new Date().toISOString();
 const streamerId=id||crypto.randomUUID();
 const detection=liveDetectionAvailable(parsed.value.provider,env);
 const liveStatus=detection.available?(existing?.live_status||"unknown"):"unknown";
 if(id){
  await env.BALTICM_DB.prepare("UPDATE streamers SET provider=?,provider_user_id=?,provider_login=?,display_name=?,profile_url=?,watch_url=?,discord_member_id=?,announcement_channel_id=?,auto_announce=?,enabled=?,custom_message=?,live_status=?,updated_at=? WHERE id=? AND guild_id=?").bind(
   parsed.value.provider,parsed.value.providerUserId,parsed.value.providerLogin,parsed.value.displayName,parsed.value.profileUrl,parsed.value.watchUrl,discordMemberId,parsed.value.announcementChannelId,parsed.value.autoAnnounce?1:0,parsed.value.enabled?1:0,parsed.value.customMessage,liveStatus,now,streamerId,guildId
  ).run();
 }else{
  await env.BALTICM_DB.prepare("INSERT INTO streamers (id,guild_id,provider,provider_user_id,provider_login,display_name,profile_url,watch_url,discord_member_id,announcement_channel_id,auto_announce,enabled,custom_message,live_status,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
   streamerId,guildId,parsed.value.provider,parsed.value.providerUserId,parsed.value.providerLogin,parsed.value.displayName,parsed.value.profileUrl,parsed.value.watchUrl,discordMemberId,parsed.value.announcementChannelId,parsed.value.autoAnnounce?1:0,parsed.value.enabled?1:0,parsed.value.customMessage,liveStatus,STREAMER_SOURCE_OWNER,now,now
  ).run();
 }
 const row=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE id=? AND guild_id=?").bind(streamerId,guildId).first();
 return json({ok:true,streamer:streamerRowToView(row,env,{member:member.member,channelName:gate.name})});
}
async function deleteStreamer(env,user,guildId,id){
 await ensureStreamersTable(env);
 const studio=await streamerStudioGate(env,user,guildId);
 if(!studio.ok)return json({error:studio.error},studio.status||403);
 const row=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE id=? AND guild_id=?").bind(id,guildId).first();
 if(!row)return json({error:"Streamer not found"},404);
 if(normalizeStreamerSource(row.source)===STREAMER_SOURCE_AUTO)return json({error:"Premium auto streamers are linked from the member Profile and cannot be converted or deleted here. Disable the streamer instead."},403);
 await env.BALTICM_DB.prepare("DELETE FROM streamers WHERE id=? AND guild_id=?").bind(id,guildId).run();
 return json({ok:true});
}
async function refreshStreamer(env,guildId,id){
 try{
  await ensureStreamersTable(env);
  const premium=!!(await premiumPlanState(env,guildId)).premium;
  const row=id?await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE id=? AND guild_id=?").bind(id,guildId).first():null;
  if(id&&!row)return json({error:"Streamer not found"},404);
  if(id){
   await refreshOneStreamer(env,row,{announce:true,premium});
   const next=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE id=? AND guild_id=?").bind(id,guildId).first();
   return json({ok:true,streamer:streamerRowToView(next,env)});
  }
  const all=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE guild_id=? AND enabled=1").bind(guildId).all();
  for(const item of all.results||[]){try{await refreshOneStreamer(env,item,{announce:true,premium})}catch{}}
  return streamersState(env,guildId);
 }catch{return json({error:"Could not refresh status"},500)}
}
async function streamingAccountsState(env,user){
 const oauth=Object.fromEntries(["twitch","youtube","tiktok","kick"].map(p=>[p,streamingOAuthPublicStatus(p,env)]));
 try{
  const decision=decideProfileStreamingMutation({actorId:user.id,targetUserId:user.id});
  if(!decision.ok)return json({error:decision.error,accounts:[],oauth},decision.status||403);
  await ensureStreamersTable(env);
  const r=await env.BALTICM_DB.prepare("SELECT * FROM user_streaming_accounts WHERE discord_user_id=? ORDER BY provider").bind(user.id).all();
  const accounts=(r.results||[]).map(row=>publicStreamingAccount(row)).filter(Boolean);
  const providers=providerCapabilities(env).map(({credentialKeys,...rest})=>rest);
  const payload={accounts,oauth,providers};
  if(streamingAccountHasSecrets(accounts))return json({error:"Could not load streaming accounts",accounts:[],oauth,providers},500);
  return json(payload);
 }catch{
  return json({accounts:[],oauth,providers:[]});
 }
}
async function saveStreamingAccount(){
 return json({error:"Connect the platform to verify ownership."},400);
}
async function persistVerifiedStreamingAccount(env,userId,account,tokens){
 const now=new Date().toISOString();
 const secret=env.SESSION_SECRET||"";
 const tokenEnc=await encryptStreamingSecret(tokens.accessToken||"",secret);
 const refreshEnc=await encryptStreamingSecret(tokens.refreshToken||"",secret);
 const expires=Date.now()+Math.max(60,Number(tokens.expiresIn)||3600)*1000;
 const existing=await loadProfileAccount(env,userId,account.provider);
 const scope=Array.isArray(tokens.scope)?tokens.scope.join(" "):String(tokens.scope||"");
 if(existing){
  await env.BALTICM_DB.prepare("UPDATE user_streaming_accounts SET provider_user_id=?,provider_login=?,display_name=?,profile_url=?,watch_url=?,profile_image_url=?,verified=1,token_enc=?,refresh_enc=?,token_expires_at=?,token_scope=?,connected_at=?,updated_at=? WHERE discord_user_id=? AND provider=?").bind(
   account.providerUserId,account.providerLogin,account.displayName,account.profileUrl,account.watchUrl,account.profileImageUrl||"",tokenEnc,refreshEnc,expires,scope,now,now,userId,account.provider
  ).run();
 }else{
  await env.BALTICM_DB.prepare("INSERT INTO user_streaming_accounts (id,discord_user_id,provider,provider_user_id,provider_login,display_name,profile_url,watch_url,verified,profile_image_url,token_enc,refresh_enc,token_expires_at,token_scope,connected_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
   crypto.randomUUID(),userId,account.provider,account.providerUserId,account.providerLogin,account.displayName,account.profileUrl,account.watchUrl,1,account.profileImageUrl||"",tokenEnc,refreshEnc,expires,scope,now,now,now
  ).run();
 }
 try{await syncAutoStreamersForUser(env,userId)}catch(e){logStreamingOAuthDiagnostic("auto_sync",{error:String(e&&e.message||e).slice(0,120)})}
}
async function startStreamingOAuth(req,env,user,provider){
 const p=String(provider||"").toLowerCase();
 const availability=streamingOAuthAvailability(p,env);
 if(!availability.available)return json({error:"Connection temporarily unavailable"},503);
 if(!env.SESSION_SECRET)return json({error:"Connection temporarily unavailable"},503);
 await ensureStreamersTable(env);
 const pkce=p==="kick"||p==="tiktok"||p==="youtube"?await createPkcePair():{verifier:"",challenge:"",method:"S256"};
 const created=await createStreamingOAuthState({secret:env.SESSION_SECRET,discordUserId:user.id,provider:p,returnPath:"/profile"});
 if(!created.ok)return json({error:created.error||"Could not start connection"},500);
 const origin=publicAppOrigin(env,req);
 const auth=buildAuthorizationUrl(p,{origin,env,state:created.token,pkce});
 if(!auth.ok)return json({error:"Connection temporarily unavailable"},503);
 await env.BALTICM_DB.prepare("INSERT INTO streaming_oauth_nonce (nonce,discord_user_id,provider,code_verifier,return_path,expires_at,used) VALUES (?,?,?,?,?,?,0)").bind(
  created.nonce,user.id,p,pkce.verifier||"", "/profile", Date.now()+10*60*1000
 ).run();
 return new Response(null,{status:302,headers:{Location:auth.url,"Cache-Control":"no-store"}});
}
function streamingProfileLocation(origin,query){
 const u=new URL("/profile",origin);
 for(const [k,v] of Object.entries(query||{}))if(v!=null&&v!=="")u.searchParams.set(k,String(v));
 return u.toString();
}
async function streamingOAuthCallback(req,env,provider){
 const origin=publicAppOrigin(env,req);
 const p=String(provider||"").toLowerCase();
 const fail=(msg,diag)=>{logStreamingOAuthDiagnostic("callback_fail",{provider:p,...(diag||{})});return new Response(null,{status:302,headers:{Location:streamingProfileLocation(origin,{streaming_error:msg}),"Cache-Control":"no-store"}})};
 try{
  const fields=await readStreamingOAuthCallbackFields(req);
  if(fields.error){
   const errCode=publicOAuthErrorCode(fields.error);
   logStreamingOAuthDiagnostic("google_oauth_error",{provider:p,error:errCode});
   return fail("The platform denied the connection.",{stage:"consent",error:errCode});
  }
  const code=fields.code;
  const stateToken=fields.state;
  if(!code||!stateToken)return fail("The connection could not be completed.",{stage:"missing_params",hasCode:!!code,hasState:!!stateToken});
  const state=await validateStreamingOAuthState(stateToken,{secret:env.SESSION_SECRET,expectedProvider:p});
  if(!state.ok)return fail(state.reason==="expired"?"The connection expired. Try again.":"The connection could not be completed.",{stage:"state",error:state.reason||"invalid"});
  const sessionUser=await session(req,env);
  if(sessionUser&&String(sessionUser.id)!==String(state.discordUserId))return fail("You are signed in as a different Discord user.",{stage:"session_mismatch"});
  await ensureStreamersTable(env);
  const claimed=await env.BALTICM_DB.prepare("UPDATE streaming_oauth_nonce SET used=1 WHERE nonce=? AND provider=? AND discord_user_id=? AND used=0 AND expires_at>? RETURNING code_verifier").bind(state.nonce,p,state.discordUserId,Date.now()).first();
  if(!claimed)return fail("This connection request is no longer valid.",{stage:"nonce"});
  const tokens=await exchangeAuthorizationCode(p,{origin,env,code,codeVerifier:claimed.code_verifier||""});
  if(!tokens.ok)return fail(tokens.error||"The platform authorization failed.",{stage:"token",error:tokens.logCode||""});
  const identity=await getAuthenticatedAccount(p,{env,accessToken:tokens.accessToken,openId:tokens.openId||""});
  if(!identity.ok)return fail(identity.error||"Could not load the connected account.",{stage:"account",error:identity.logCode||""});
  await persistVerifiedStreamingAccount(env,state.discordUserId,identity.value,tokens);
  logStreamingOAuthDiagnostic("callback_ok",{provider:p});
  return new Response(null,{status:302,headers:{Location:streamingProfileLocation(origin,{streaming:"connected",platform:p}),"Cache-Control":"no-store"}});
 }catch(e){
  return fail("The connection could not be completed.",{stage:"exception",error:String(e&&e.message||e).slice(0,120)});
 }
}
async function deleteStreamingAccount(env,user,provider){
 const decision=decideProfileStreamingMutation({actorId:user.id,targetUserId:user.id});
 if(!decision.ok)return json({error:decision.error},decision.status||403);
 const p=String(provider||"").toLowerCase();
 await ensureStreamersTable(env);
 const existing=await loadProfileAccount(env,user.id,p);
 if(!existing)return json({error:"Streaming account not found"},404);
 const secret=env.SESSION_SECRET||"";
 const access=await decryptStreamingSecret(existing.token_enc||"",secret);
 const refresh=await decryptStreamingSecret(existing.refresh_enc||"",secret);
 try{await revokeStreamingToken(p,{env,token:access||refresh})}catch{}
 const autoRows=await env.BALTICM_DB.prepare("SELECT * FROM streamers WHERE discord_member_id=? AND provider=? AND source IN ('auto','self')").bind(user.id,p).all();
 for(const row of autoRows.results||[]){try{await removeAutoGuildStreamer(env,mapStreamerRow(row))}catch{}}
 await env.BALTICM_DB.prepare("DELETE FROM user_streaming_accounts WHERE discord_user_id=? AND provider=?").bind(user.id,p).run();
 return json({ok:true});
}

async function accessSettingsState(env,guildId){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
 const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key=?").bind(accessSettingsKey(guildId)).first();
 let config={roles:[]};if(row?.value)try{config={roles:[],...JSON.parse(row.value)}}catch{}
 config=normalizeAccessConfig(config);
 const [gr,rr]=await Promise.all([fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)}),fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`,{headers:botHeaders(env)})]);
 if(!gr.ok)return {error:"Could not load Discord server",status:gr.status};
 const guild=await gr.json(),roles=rr.ok?await rr.json():[];
 return {config,guild:{id:guild.id,name:guild.name,ownerId:guild.owner_id},roles:roles.filter(r=>r.id!==guildId&&!r.managed).map(r=>({id:r.id,name:r.name,color:r.color,position:r.position})).sort((a,b)=>b.position-a.position)};
}
async function saveAccessSettings(req,env,guildId){
 try{
  const body=await req.json();
  const config=normalizeAccessConfig({roles:Array.isArray(body.roles)?body.roles:[]});
  await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(accessSettingsKey(guildId),JSON.stringify(config),new Date().toISOString()).run();
  return json({ok:true,config});
 }catch(e){return json({error:String(e.message||e)},500)}
}
const premiumPlanKey=guildId=>"premium-plan:"+guildId;
const BOT_APP_PROFILE_KEY="bot-app-profile:v1";
async function premiumPlanState(env,guildId){
 const raw=await readPremiumRaw(env,guildId);
 return buildPremiumViewModel(raw,Date.now());
}
async function discordErrorMessage(res,fallback="Discord request failed"){
 try{const j=await res.json();return String(j.message||j.error||fallback)+(j.code?` (${j.code})`:"")}catch{return `${fallback} (HTTP ${res.status})`}
}
async function ensureBotApplicationProfile(env){
 try{
  if(!env.DISCORD_BOT_TOKEN)return {ok:false,skipped:true};
  await ensureBotConfigTable(env);
  const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key=?").bind(BOT_APP_PROFILE_KEY).first();
  if(row?.value){try{const v=JSON.parse(row.value);if(v.description===BOT_APP_DESCRIPTION)return {ok:true,skipped:true}}catch{}}
  const rr=await fetch("https://discord.com/api/v10/applications/@me",{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify({description:BOT_APP_DESCRIPTION})});
  if(!rr.ok)return {ok:false,status:rr.status,error:await discordErrorMessage(rr,"Could not update bot application description")};
  await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(BOT_APP_PROFILE_KEY,JSON.stringify({description:BOT_APP_DESCRIPTION}),new Date().toISOString()).run();
  return {ok:true,updated:true};
 }catch(e){return {ok:false,error:String(e.message||e)}}
}
async function giveawayBrandingFooter(env,guildId){const state=await premiumPlanState(env,guildId);return state.premium?{}:{footer:{text:"BalticM.eu Giveaway"}}}
async function ensureVipCodeTables(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare(`CREATE TABLE IF NOT EXISTS vip_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  code_normalized TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  max_uses INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
 )`).run();
 await env.BALTICM_DB.prepare(`CREATE TABLE IF NOT EXISTS vip_code_redemptions (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  code TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT NOT NULL DEFAULT '',
  guild_id TEXT NOT NULL,
  guild_name TEXT NOT NULL DEFAULT '',
  redeemed_at TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  previous_expires_at TEXT NOT NULL DEFAULT '',
  resulting_starts_at TEXT NOT NULL DEFAULT '',
  resulting_expires_at TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'success',
  UNIQUE(code_id, guild_id)
 )`).run();
 // Legacy DBs created before resulting_starts_at — ignore if column already exists.
 try{await env.BALTICM_DB.prepare("ALTER TABLE vip_code_redemptions ADD COLUMN resulting_starts_at TEXT NOT NULL DEFAULT ''").run()}catch{}
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_vip_codes_normalized ON vip_codes(code_normalized)").run();
 await env.BALTICM_DB.prepare("CREATE INDEX IF NOT EXISTS idx_vip_code_redemptions_code ON vip_code_redemptions(code_id, redeemed_at DESC)").run();
}
function mapVipCodeRow(row){
 if(!row)return null;
 return {
  id:String(row.id),
  code:String(row.code||""),
  // type column kept for old rows; all codes are activation-only
  type:"activation",
  durationDays:Number(row.duration_days??row.durationDays)||30,
  maxUses:Number(row.max_uses??row.maxUses)||1,
  usedCount:Number(row.used_count??row.usedCount)||0,
  status:normalizeCodeStatus(row.status),
  expiresAt:row.expires_at??row.expiresAt??null,
  deletedAt:row.deleted_at??row.deletedAt??null,
  createdAt:(row.created_at??row.createdAt)||"",
  createdBy:(row.created_by??row.createdBy)||""
 };
}
async function adminVipCodesList(env,user){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  await ensureVipCodeTables(env);
  const r=await env.BALTICM_DB.prepare("SELECT id,code,type,duration_days,max_uses,used_count,status,expires_at,deleted_at,created_at,created_by FROM vip_codes WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500").all();
  return json({codes:(r.results||[]).map(mapVipCodeRow)});
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function adminVipCodeCreate(req,env,user){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  await ensureVipCodeTables(env);
  const body=await req.json().catch(()=>({}));
  const codeMode=String(body.codeMode||body.mode||"generate").trim().toLowerCase();
  const durationDays=parseCodeDurationDays(body.durationDays??body.days,body.durationPreset);
  if(!durationDays)return json({error:"Duration must be 7, 30, 90, 365, or custom days (1–3650)"},400);
  const maxUses=Math.floor(Number(body.maxRedemptions??body.maxUses));
  if(!Number.isFinite(maxUses)||maxUses<1||maxUses>100000)return json({error:"Max redemptions must be a positive integer"},400);
  const status=normalizeCodeStatus(body.status||"active");
  let expiresAt=null;
  if(body.expiresAt!=null&&String(body.expiresAt).trim()&&String(body.expiresAt).toLowerCase()!=="never"){
   const t=Date.parse(body.expiresAt);
   if(!Number.isFinite(t))return json({error:"Invalid expiration datetime"},400);
   expiresAt=new Date(t).toISOString();
  }
  const now=new Date().toISOString();
  const type="activation";
  let code="",id="",inserted=false;

  if(codeMode==="custom"){
   const parsed=parseCustomVipCode(body.customCode??body.code??"");
   if(!parsed.ok)return json({error:parsed.error},400);
   code=parsed.code;
   id=crypto.randomUUID();
   try{
    await env.BALTICM_DB.prepare("INSERT INTO vip_codes (id,code,code_normalized,type,duration_days,max_uses,used_count,status,expires_at,deleted_at,created_at,created_by) VALUES (?,?,?,?,?,?,0,?,?,NULL,?,?)")
     .bind(id,code,code,type,durationDays,maxUses,status,expiresAt,now,String(user.id||"")).run();
    inserted=true;
   }catch(e){
    if(/UNIQUE|constraint/i.test(String(e.message||e)))return json({error:VIP_CODE_ERROR.duplicate},409);
    throw e;
   }
  }else{
   for(let attempt=0;attempt<8&&!inserted;attempt++){
    code=generateVipCode();
    id=crypto.randomUUID();
    try{
     await env.BALTICM_DB.prepare("INSERT INTO vip_codes (id,code,code_normalized,type,duration_days,max_uses,used_count,status,expires_at,deleted_at,created_at,created_by) VALUES (?,?,?,?,?,?,0,?,?,NULL,?,?)")
      .bind(id,code,normalizeVipCode(code),type,durationDays,maxUses,status,expiresAt,now,String(user.id||"")).run();
     inserted=true;
    }catch(e){
     if(!/UNIQUE|constraint/i.test(String(e.message||e)))throw e;
    }
   }
  }
  if(!inserted)return json({error:"Could not allocate a unique VIP code"},500);
  return json({ok:true,code:mapVipCodeRow({id,code,type,duration_days:durationDays,max_uses:maxUses,used_count:0,status,expires_at:expiresAt,deleted_at:null,created_at:now,created_by:String(user.id||"")})});
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function adminVipCodePatch(req,env,user,codeId){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  await ensureVipCodeTables(env);
  const id=String(codeId||"").trim();
  if(!id)return json({error:"Code id is required"},400);
  const body=await req.json().catch(()=>({}));
  const status=normalizeCodeStatus(body.status);
  const r=await env.BALTICM_DB.prepare("UPDATE vip_codes SET status=? WHERE id=? AND deleted_at IS NULL").bind(status,id).run();
  if(!r.meta?.changes)return json({error:"VIP code not found"},404);
  const row=await env.BALTICM_DB.prepare("SELECT id,code,type,duration_days,max_uses,used_count,status,expires_at,deleted_at,created_at,created_by FROM vip_codes WHERE id=?").bind(id).first();
  return json({ok:true,code:mapVipCodeRow(row)});
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function adminVipCodeDelete(req,env,user,codeId){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  await ensureVipCodeTables(env);
  const id=String(codeId||"").trim();
  if(!id)return json({error:"Code id is required"},400);
  const now=new Date().toISOString();
  const r=await env.BALTICM_DB.prepare("UPDATE vip_codes SET deleted_at=?, status='disabled' WHERE id=? AND deleted_at IS NULL").bind(now,id).run();
  if(!r.meta?.changes)return json({error:"VIP code not found"},404);
  return json({ok:true,softDeleted:true});
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function adminVipCodeHistory(req,env,user,codeId){
 const denied=adminDenied(env,user);if(denied)return denied;
 try{
  await ensureVipCodeTables(env);
  const id=String(codeId||"").trim();
  if(!id)return json({error:"Code id is required"},400);
  const code=await env.BALTICM_DB.prepare("SELECT id,code,type,duration_days,max_uses,used_count,status,expires_at,deleted_at,created_at,created_by FROM vip_codes WHERE id=?").bind(id).first();
  if(!code)return json({error:"VIP code not found"},404);
  const r=await env.BALTICM_DB.prepare("SELECT id,code_id AS codeId,code,discord_user_id AS discordUserId,discord_username AS discordUsername,guild_id AS guildId,guild_name AS guildName,redeemed_at AS redeemedAt,duration_days AS durationDays,previous_expires_at AS previousExpiresAt,resulting_starts_at AS resultingStartsAt,resulting_expires_at AS resultingExpiresAt,result FROM vip_code_redemptions WHERE code_id=? ORDER BY redeemed_at DESC LIMIT 500").bind(id).all();
  return json({code:mapVipCodeRow(code),history:r.results||[]});
 }catch(e){return json({error:String(e.message||e)},500)}
}
async function redeemCode(req,env,user,guildId){
 try{
  if(!canManageGuild(user,guildId))return json({error:VIP_CODE_ERROR.noPermission},403);
  const resolved=resolveManageableGuildId(user,guildId);
  if(resolved.error)return json({error:VIP_CODE_ERROR.noPermission},403);
  await ensureVipCodeTables(env);
  const body=await req.json().catch(()=>({}));
  const rawCode=String(body.code||"");
  const code=normalizeVipCode(rawCode);
  if(!code||isRejectedTebexCoupon(code)||!isAcceptableVipCode(code))return json({error:VIP_CODE_ERROR.invalid},400);

  const row=await env.BALTICM_DB.prepare("SELECT id,code,code_normalized,type,duration_days,max_uses,used_count,status,expires_at,deleted_at,created_at,created_by FROM vip_codes WHERE code_normalized=?").bind(code).first();
  const mapped=mapVipCodeRow(row);
  const priorRedeem=mapped?await env.BALTICM_DB.prepare("SELECT id FROM vip_code_redemptions WHERE code_id=? AND guild_id=?").bind(mapped.id,resolved.guildId).first():null;
  const current=await readPremiumRaw(env,resolved.guildId);
  const now=new Date();
  const evaluated=evaluateVipCodeRedeem({
   codeRow:mapped,
   premiumState:current,
   guildId:resolved.guildId,
   alreadyRedeemedGuild:!!priorRedeem,
   now
  });
  if(!evaluated.ok){
   // Failed attempts must not increment used count; ACTIVE VIP stays unchanged
   return json({error:evaluated.error,code:evaluated.code||undefined,premium:buildPremiumViewModel(current,now.getTime())},evaluated.status||400);
  }

  const guildName=String((user.guilds||[]).find(g=>String(g.id)===resolved.guildId)?.name||body.guildName||"");
  const username=String(user.global_name||user.username||"");
  const redemptionId=crypto.randomUUID();
  const nowIso=now.toISOString();

  // Atomic claim: increment uses only if under max + still redeemable; unique guild redemption.
  const claim=await env.BALTICM_DB.prepare(
   "UPDATE vip_codes SET used_count=used_count+1 WHERE id=? AND deleted_at IS NULL AND status='active' AND used_count<max_uses AND (expires_at IS NULL OR expires_at>?)"
  ).bind(mapped.id,nowIso).run();
  if(!claim.meta?.changes){
   const fresh=await env.BALTICM_DB.prepare("SELECT used_count,max_uses,status,expires_at,deleted_at FROM vip_codes WHERE id=?").bind(mapped.id).first();
   if(!fresh||fresh.deleted_at)return json({error:VIP_CODE_ERROR.invalid},400);
   if(normalizeCodeStatus(fresh.status)==="disabled")return json({error:VIP_CODE_ERROR.disabled},400);
   if(fresh.expires_at&&Date.parse(fresh.expires_at)<=now.getTime())return json({error:VIP_CODE_ERROR.expired},400);
   if(Number(fresh.used_count)>=Number(fresh.max_uses))return json({error:VIP_CODE_ERROR.maxUses},400);
   return json({error:VIP_CODE_ERROR.maxUses},400);
  }

  try{
   await env.BALTICM_DB.prepare(
    "INSERT INTO vip_code_redemptions (id,code_id,code,discord_user_id,discord_username,guild_id,guild_name,redeemed_at,duration_days,previous_expires_at,resulting_starts_at,resulting_expires_at,result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
   ).bind(
    redemptionId,mapped.id,mapped.code,String(user.id),username,resolved.guildId,guildName,nowIso,
    evaluated.days,evaluated.previousExpiresAt||"",evaluated.resultingStartsAt||"",evaluated.resultingExpiresAt,"success"
   ).run();
  }catch(e){
   // Roll back the use claim if this guild already redeemed (unique) or insert failed
   await env.BALTICM_DB.prepare("UPDATE vip_codes SET used_count=CASE WHEN used_count>0 THEN used_count-1 ELSE 0 END WHERE id=?").bind(mapped.id).run();
   if(/UNIQUE|constraint/i.test(String(e.message||e)))return json({error:VIP_CODE_ERROR.alreadyRedeemed},409);
   throw e;
  }

  await writePremiumPlan(env,resolved.guildId,evaluated.value);
  await syncGuildBotNickname(env,resolved.guildId);
  await addActivityLog(env,resolved.guildId,{
   actorId:user.id,
   actorName:username||"User",
   action:"VIP code activation",
   target:mapped.code,
   source:"VIP_CODE",
   details:evaluated.days+" days"
  }).catch(()=>{});

  const view=buildPremiumViewModel(evaluated.value,now.getTime());
  return json({
   ok:true,
   message:evaluated.message,
   type:"activation",
   days:evaluated.days,
   startsAt:evaluated.resultingStartsAt,
   expiresAt:evaluated.resultingExpiresAt,
   ...view
  });
 }catch(e){return json({error:String(e.message||e)},500)}
}
const generalSettingsKey=guildId=>"general-settings:"+guildId;
async function loadGeneralSettingsConfig(env,guildId){
 let config={botNickname:FREE_BOT_NICKNAME,botAvatarUrl:FREE_BOT_AVATAR_URL,botInitials:FREE_BOT_INITIALS,timezone:"Europe/Berlin"};
 if(!env.BALTICM_DB)return config;
 await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
 const row=await env.BALTICM_DB.prepare("SELECT value FROM bot_config WHERE key=?").bind(generalSettingsKey(guildId)).first();
 if(row?.value)try{config={...config,...JSON.parse(row.value)}}catch{}
 return config;
}
/** Sync Discord guild nick from current VIP/FREE plan + saved General settings (single builder). */
async function syncGuildBotNickname(env,guildId){
 try{
  const state=await premiumPlanState(env,guildId);
  const stored=await loadGeneralSettingsConfig(env,guildId);
  const targetNick=discordBotNickForPlan(state.premium,stored);
  // Prefer explicit bot user id — Discord often returns 400 for members/@me on GET.
  let current="",hasCustomAvatar=false;
  const mr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${CLIENT_ID}`,{headers:botHeaders(env)});
  if(mr.ok){
   const me=await mr.json();
   current=String(me.nick||"");
   hasCustomAvatar=!!me.avatar;
  }else{
   const fallback=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`,{headers:botHeaders(env)});
   if(fallback.ok){
    const me=await fallback.json();
    current=String(me.nick||"");
    hasCustomAvatar=!!me.avatar;
   }
  }
  const body={nick:targetNick};
  if(!state.premium&&hasCustomAvatar)body.avatar=null;
  if(mr.ok&&current===targetNick&&body.avatar===undefined){
   const same={ok:true,changed:false,nick:targetNick,premium:!!state.premium,from:current};
   await rememberBrandingSync(env,guildId,same);
   return same;
  }
  const rr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`,{method:"PATCH",headers:{...botHeaders(env),"Content-Type":"application/json","X-Audit-Log-Reason":encodeURIComponent(state.premium?"BalticM VIP server branding":"BalticM FREE plan branding")},body:JSON.stringify(body)});
  let patchError;
  if(!rr.ok)patchError=await discordErrorMessage(rr,"Could not sync bot nickname");
  const out={ok:rr.ok,changed:rr.ok,status:rr.status,nick:targetNick,premium:!!state.premium,from:current,getStatus:mr.status,error:patchError};
  await rememberBrandingSync(env,guildId,out);
  return out;
 }catch(e){
  const err={ok:false,error:String(e.message||e)};
  await rememberBrandingSync(env,guildId,err).catch(()=>{});
  return err;
 }
}
async function rememberBrandingSync(env,guildId,result){
 if(!env.BALTICM_DB||!guildId)return;
 try{
  await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  const payload={...result,at:new Date().toISOString()};
  await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind("branding-sync:"+guildId,JSON.stringify(payload),payload.at).run();
 }catch{}
}
/** FREE servers only — used by cron so VIP guilds are not PATCHed every minute. */
async function enforceFreeBotNickname(env,guildId){
 try{
  const state=await premiumPlanState(env,guildId);
  if(state.premium)return {ok:true,skipped:true,plan:state.plan};
  return syncGuildBotNickname(env,guildId);
 }catch(e){return {ok:false,error:String(e.message||e)}}
}
async function enforceFreeBrandingForManagedGuilds(env){
 if(!env.BALTICM_DB)return;
 const r=await fetch("https://discord.com/api/v10/users/@me/guilds",{headers:botHeaders(env)});
 if(!r.ok)return;
 const guilds=await r.json();
 for(const g of guilds.slice(0,200))await enforceFreeBotNickname(env,String(g.id));
}
function arrayBufferToBase64(buf){
 const bytes=new Uint8Array(buf);let binary="";const chunk=0x8000;
 for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
 return btoa(binary);
}
async function centerCropAvatarDataUri(env,buf){
 if(!env.IMAGES)throw new Error("Image processing is not configured on this Worker.");
 try{
  const out=await env.IMAGES.input(buf)
   .transform({width:BOT_AVATAR_SIZE,height:BOT_AVATAR_SIZE,fit:"cover"})
   .output({format:"image/png"});
  const resp=out.response();
  const cropped=await resp.arrayBuffer();
  if(!cropped.byteLength)throw new Error("Avatar crop produced an empty image.");
  if(cropped.byteLength>MAX_BOT_AVATAR_BYTES)throw new Error(`Cropped avatar is too large (${Math.ceil(cropped.byteLength/1024)} KB). Max is ${Math.floor(MAX_BOT_AVATAR_BYTES/1024)} KB.`);
  const checked=validateBotAvatarDataUri(`data:image/png;base64,${arrayBufferToBase64(cropped)}`);
  if(!checked.ok)throw new Error(checked.error);
  return checked.dataUri;
 }catch(e){
  const msg=String(e?.message||e);
  if(/not configured|Image processing/i.test(msg))throw e;
  throw new Error("Could not crop avatar image into a square. Use a valid png, jpg, webp, or gif URL.");
 }
}
async function fetchImageAsDataUriSafe(env,url){
 if(!isHttpsImageUrl(url))throw new Error("Avatar URL must use https://");
 const r=await fetch(url,{redirect:"follow",headers:{Accept:"image/*,*/*"}});
 if(!r.ok)throw new Error("Could not download avatar image (HTTP "+r.status+")");
 const mime=String(r.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
 if(!/^image\/(png|jpeg|jpg|webp|gif)$/.test(mime))throw new Error("Avatar URL must point to a png, jpg, webp, or gif");
 const declared=Number(r.headers.get("content-length")||0);
 if(declared>MAX_BOT_AVATAR_BYTES)throw new Error(`Avatar is too large (${Math.ceil(declared/1024)} KB). Max is ${Math.floor(MAX_BOT_AVATAR_BYTES/1024)} KB.`);
 const buf=await r.arrayBuffer();
 if(buf.byteLength<=0)throw new Error("Avatar image is empty.");
 if(buf.byteLength>MAX_BOT_AVATAR_BYTES)throw new Error(`Avatar is too large (${Math.ceil(buf.byteLength/1024)} KB). Max is ${Math.floor(MAX_BOT_AVATAR_BYTES/1024)} KB.`);
 return centerCropAvatarDataUri(env,buf);
}
async function generalSettingsState(env,guildId){
 let config=await loadGeneralSettingsConfig(env,guildId);
 const premiumState=await premiumPlanState(env,guildId);
 const rr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${CLIENT_ID}`,{headers:botHeaders(env)});
 if(rr.ok){
  const me=await rr.json();
  const userId=String(me.user?.id||CLIENT_ID);
  if(premiumState.premium&&me.avatar)config.botAvatarUrl=guildMemberAvatarUrl(guildId,userId,me.avatar)||config.botAvatarUrl;
 }
 if(!premiumState.premium){config.botNickname=FREE_BOT_NICKNAME;config.botAvatarUrl=FREE_BOT_AVATAR_URL;config.botInitials=FREE_BOT_INITIALS}
 return json({config,plan:premiumState.plan,premium:premiumState.premium,displayPlan:premiumState.displayPlan});
}
async function saveGeneralSettings(req,env,guildId){
 try{
  const body=await req.json().catch(()=>({}));
  const premiumState=await premiumPlanState(env,guildId);
  const branding=resolveGeneralBranding(premiumState.premium,body);
  let botNickname=branding.botNickname,botAvatarUrl=branding.botAvatarUrl,botInitials=branding.botInitials,timezone=branding.timezone;
  if(!premiumState.premium){
   botAvatarUrl=FREE_BOT_AVATAR_URL;
   botNickname=FREE_BOT_NICKNAME;
   botInitials=FREE_BOT_INITIALS;
  }
  const patch={nick:discordBotNickForPlan(premiumState.premium,{botNickname,botInitials})};
  const clearAvatar=body.clearAvatar===true||body.botAvatarUrl===null;
  if(premiumState.premium){
   if(clearAvatar){
    patch.avatar=null;
    botAvatarUrl=FREE_BOT_AVATAR_URL;
   }else if(body.updateAvatar&&body.botAvatarUrl&&String(body.botAvatarUrl).trim()){
    const url=String(body.botAvatarUrl).trim();
    if(!isHttpsImageUrl(url))return json({error:"Avatar URL must use https://"},400);
    try{patch.avatar=await fetchImageAsDataUriSafe(env,url)}catch(e){return json({error:String(e.message||e)},400)}
   }
  }else{
   patch.avatar=null;
  }
  const rr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`,{method:"PATCH",headers:{...botHeaders(env),"Content-Type":"application/json","X-Audit-Log-Reason":encodeURIComponent(premiumState.premium?"BalticM VIP server branding":"BalticM FREE plan branding")},body:JSON.stringify(patch)});
  if(!rr.ok)return json({error:await discordErrorMessage(rr,"Discord rejected the bot branding change"),status:rr.status},rr.status>=400&&rr.status<600?rr.status:502);
  const me=await rr.json().catch(()=>({}));
  const userId=String(me.user?.id||CLIENT_ID);
  if(premiumState.premium&&me.avatar)botAvatarUrl=guildMemberAvatarUrl(guildId,userId,me.avatar)||botAvatarUrl;
  if(premiumState.premium&&patch.avatar===null)botAvatarUrl=FREE_BOT_AVATAR_URL;
  if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
  await env.BALTICM_DB.prepare("CREATE TABLE IF NOT EXISTS bot_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  const config={botNickname,botAvatarUrl,botInitials,timezone};
  await env.BALTICM_DB.prepare("INSERT INTO bot_config (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(generalSettingsKey(guildId),JSON.stringify(config),new Date().toISOString()).run();
  await ensureBotApplicationProfile(env);
  return json({ok:true,config,plan:premiumState.plan,premium:premiumState.premium,displayPlan:premiumState.displayPlan})
 }catch(e){return json({error:String(e.message||e)},500)}
}
const moderationSettingsSql=`CREATE TABLE IF NOT EXISTS moderation_settings (
 guild_id TEXT PRIMARY KEY,
 mod_log_channel_id TEXT NOT NULL DEFAULT ''
)`;
async function ensureModerationSettingsTable(env){
 if(!env.BALTICM_DB)throw new Error("BALTICM_DB binding is not configured");
 await env.BALTICM_DB.prepare(moderationSettingsSql).run();
}
async function moderationSettingsState(env,guildId){
 try{
  await ensureModerationSettingsTable(env);
  const row=await env.BALTICM_DB.prepare("SELECT mod_log_channel_id AS modLogChannelId FROM moderation_settings WHERE guild_id=?").bind(guildId).first();
  return json({config:{modLogChannelId:row?.modLogChannelId||""}});
 }catch(e){return json({error:String(e.message||e)},503)}
}
async function saveModerationSettings(req,env,guildId){
 try{
  const body=await req.json().catch(()=>({})),modLogChannelId=String(body.modLogChannelId||"").trim();
  if(modLogChannelId&&!/^\d{16,22}$/.test(modLogChannelId))return json({error:"Invalid mod log channel"},400);
  if(modLogChannelId){
   const r=await fetch(`https://discord.com/api/v10/channels/${modLogChannelId}`,{headers:botHeaders(env)});
   if(!r.ok)return json({error:"Could not access selected channel"},400);
   const ch=await r.json();
   if(String(ch.guild_id||"")!==String(guildId)||ch.type!==0)return json({error:"Select a text channel from this Discord server"},400);
  }
  await ensureModerationSettingsTable(env);
  await env.BALTICM_DB.prepare("INSERT INTO moderation_settings (guild_id,mod_log_channel_id) VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET mod_log_channel_id=excluded.mod_log_channel_id").bind(guildId,modLogChannelId).run();
  return json({ok:true,config:{modLogChannelId}});
 }catch(e){return json({error:String(e.message||e)},503)}
}
async function discordDm(env,userId,content){
 const cr=await fetch("https://discord.com/api/v10/users/@me/channels",{method:"POST",headers:botHeaders(env,true),body:JSON.stringify({recipient_id:userId})});
 if(!cr.ok)return false;
 const ch=await cr.json();
 const mr=await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify({content})});
 return mr.ok;
}
async function findModLogChannel(env,guildId){
 await ensureModerationSettingsTable(env);
 const cfg=await env.BALTICM_DB.prepare("SELECT mod_log_channel_id AS modLogChannelId FROM moderation_settings WHERE guild_id=?").bind(guildId).first();
 if(cfg?.modLogChannelId)return {id:cfg.modLogChannelId};
 const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`,{headers:botHeaders(env)});
 if(!r.ok)return null;
 const channels=await r.json();
 const names=["mod-logs","moderation-logs","mod-log","logs"];
 return channels.find(c=>c.type===0&&names.includes(String(c.name||"").toLowerCase()))||null;
}
async function sendModLog(env,guildId,entry){
 const ch=await findModLogChannel(env,guildId);if(!ch)return false;
 const meta={
  warn:{title:"⚠️ Member warned",color:0xf1c40f,status:"Warning issued"},
  timeout:{title:"⏳ Member timed out",color:0xf39c12,status:"Timeout active"},
  kick:{title:"👢 Member kicked",color:0xe67e22,status:"Removed from server"},
  ban:{title:"🔨 Member banned",color:0xe74c3c,status:"Banned from server"},
  removed:{title:"✅ Moderation action removed",color:0x2ecc71,status:"Action cleared"}
 }[entry.action]||{title:"🛡️ Moderation action",color:0x7457ff,status:String(entry.action||"Updated")};
 const description=[
  `**Member**
<@${entry.memberId}>`,
  `**Moderator**
<@${entry.moderatorId}>`,
  `**Status**
${meta.status}`,
  entry.durationMinutes?`**Duration**
${entry.durationMinutes} minutes`:null,
  `**Reason**
${String(entry.reason||"No reason provided").slice(0,1000)}`
 ].filter(Boolean).join("\n\n");
 const payload={embeds:[{
  title:meta.title,
  description,
  color:meta.color,
  footer:{text:"Moderation log • Control Center"},
  timestamp:entry.createdAt||new Date().toISOString()
 }],allowed_mentions:{parse:[]}};
 const r=await fetch(`https://discord.com/api/v10/channels/${ch.id}/messages`,{method:"POST",headers:botHeaders(env,true),body:JSON.stringify(payload)});
 return r.ok;
}
async function removeModerationAction(env,user,guildId,id){
 await ensureModerationTable(env);
 const row=await env.BALTICM_DB.prepare("SELECT id,member_id AS memberId,member_name AS memberName,action,reason,duration_minutes AS durationMinutes FROM moderation_actions WHERE id=? AND guild_id=?").bind(id,guildId).first();
 if(!row)return json({error:"Moderation action not found"},404);
 if(row.action==="timeout"){
  const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${row.memberId}`,{method:"PATCH",headers:botHeaders(env,true),body:JSON.stringify({communication_disabled_until:null})});
  if(!r.ok&&r.status!==404)return json({error:"Could not remove Discord timeout"},502);
 }else if(row.action==="ban"){
  const r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/bans/${row.memberId}`,{method:"DELETE",headers:{...botHeaders(env),"X-Audit-Log-Reason":encodeURIComponent("Removed from BalticM Control Center")}});
  if(!r.ok&&r.status!==404)return json({error:"Could not remove Discord ban"},502);
 }
 await env.BALTICM_DB.prepare("DELETE FROM moderation_actions WHERE id=? AND guild_id=?").bind(id,guildId).run();
 const moderatorName=user.global_name||user.username||user.id,createdAt=new Date().toISOString();
 await discordDm(env,row.memberId,`✅ **BalticM Moderation**
Your **${row.action}** in **Baltic | Mayhem** has been removed.
**Removed by:** ${moderatorName}`).catch(()=>false);
 await sendModLog(env,guildId,{action:"removed",memberId:row.memberId,memberName:row.memberName,moderatorId:user.id,moderatorName,reason:`Removed previous ${row.action}: ${row.reason}`,createdAt}).catch(()=>false);
 await addActivityLog(env,guildId,{actorId:user.id,actorName:moderatorName,action:"Moderation: removed "+row.action,target:row.memberName||row.memberId,source:"BALTICM",details:row.reason?("Previous reason: "+row.reason):"Moderation action removed"});
 return json({ok:true,removedId:id,removedAction:row.action});
}
async function moderateMember(req,env,user,guildId){
 let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}
 const memberId=String(body.memberId||"").trim(),action=String(body.action||"").toLowerCase(),reason=String(body.reason||"").trim().slice(0,500);
 if(!/^\d{16,22}$/.test(memberId))return json({error:"Select a valid Discord member"},400);
 if(!["warn","timeout","kick","ban"].includes(action))return json({error:"Unknown moderation action"},400);
 if(!reason)return json({error:"A reason is required"},400);
 let durationMinutes=null;if(action==="timeout")durationMinutes=Math.max(1,Math.min(40320,Number(body.durationMinutes)||10));
 const h=botHeaders(env,true);
 const mr=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,{headers:botHeaders(env)});
 if(!mr.ok)return json({error:"Discord member was not found",status:mr.status},mr.status===404?404:502);
 const member=await mr.json(),memberName=member.nick||member.user?.global_name||member.user?.username||memberId;
 const moderatorName=user.global_name||user.username||user.id;
 const guildName=(await fetch(`https://discord.com/api/v10/guilds/${guildId}`,{headers:botHeaders(env)}).then(x=>x.ok?x.json():null).catch(()=>null))?.name||"Baltic | Mayhem";
 const actionText=action==="warn"?"a warning":action==="timeout"?`a timeout for ${durationMinutes} minutes`:action==="kick"?"a kick":"a ban";
 const dmText=`⚠️ **BalticM Moderation**
You received **${actionText}** in **${guildName}**.
**Reason:** ${reason}
**Moderator:** ${moderatorName}`;
 // Kick/ban remove the shared guild relationship, so notify before the destructive action.
 let dm=false;
 if(action==="kick"||action==="ban")dm=await discordDm(env,memberId,dmText).catch(()=>false);
 let r=null;
 if(action==="timeout"){const until=new Date(Date.now()+durationMinutes*60000).toISOString();r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,{method:"PATCH",headers:h,body:JSON.stringify({communication_disabled_until:until})});}
 else if(action==="kick")r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${memberId}`,{method:"DELETE",headers:{...botHeaders(env),"X-Audit-Log-Reason":encodeURIComponent(reason)}});
 else if(action==="ban")r=await fetch(`https://discord.com/api/v10/guilds/${guildId}/bans/${memberId}`,{method:"PUT",headers:{...h,"X-Audit-Log-Reason":encodeURIComponent(reason)},body:JSON.stringify({delete_message_seconds:0})});
 if(r&&!r.ok){const data=await r.json().catch(()=>({}));return json({error:data.message||("Discord "+action+" failed"),status:r.status},r.status===403?403:502)}
 if(action==="warn"||action==="timeout")dm=await discordDm(env,memberId,dmText).catch(()=>false);
 try{
  await ensureModerationTable(env);
  const id=crypto.randomUUID(),createdAt=new Date().toISOString();
  const entry={id,memberId,memberName,moderatorId:user.id,moderatorName,action,reason,durationMinutes,createdAt};
  await env.BALTICM_DB.prepare("INSERT INTO moderation_actions (id,guild_id,member_id,member_name,moderator_id,moderator_name,action,reason,duration_minutes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,guildId,memberId,memberName,user.id,moderatorName,action,reason,durationMinutes,createdAt).run();
  const modLog=await sendModLog(env,guildId,entry).catch(()=>false);
  await addActivityLog(env,guildId,{actorId:user.id,actorName:moderatorName,action:"Moderation: "+action,target:memberName||memberId,source:"BALTICM",details:reason});
  return json({ok:true,entry,dmSent:dm,modLogSent:modLog});
 }catch(e){return json({error:"Discord action succeeded, but audit log could not be saved",detail:String(e.message||e)},500)}
}

let discordInteractionVerifyKey=null;
let discordInteractionVerifyKeyAt=0;
async function getDiscordInteractionVerifyKey(env){
 if(discordInteractionVerifyKey&&Date.now()-discordInteractionVerifyKeyAt<3600000)return discordInteractionVerifyKey;
 const token=env.DISCORD_BOT_TOKEN;
 if(!token)throw new Error("DISCORD_BOT_TOKEN missing");
 const r=await fetch("https://discord.com/api/v10/oauth2/applications/@me",{headers:{Authorization:"Bot "+token,"User-Agent":"BalticM.eu Interaction Gateway"}});
 if(!r.ok)throw new Error("Discord application lookup failed: "+r.status);
 const app=await r.json(),hex=String(app.verify_key||"");
 if(!/^[0-9a-f]{64}$/i.test(hex))throw new Error("Discord verify_key missing");
 const raw=new Uint8Array(hex.match(/../g).map(x=>parseInt(x,16)));
 discordInteractionVerifyKey=await crypto.subtle.importKey("raw",raw,{name:"Ed25519"},false,["verify"]);
 discordInteractionVerifyKeyAt=Date.now();
 return discordInteractionVerifyKey;
}
async function verifyDiscordInteraction(req,raw,env){
 const sig=req.headers.get("x-signature-ed25519")||"",ts=req.headers.get("x-signature-timestamp")||"";
 if(!/^[0-9a-f]{128}$/i.test(sig)||!/^\d{10,12}$/.test(ts))return false;
 const key=await getDiscordInteractionVerifyKey(env);
 const signature=new Uint8Array(sig.match(/../g).map(x=>parseInt(x,16)));
 const message=new Uint8Array(enc.encode(ts).length+raw.length);
 message.set(enc.encode(ts),0);message.set(raw,enc.encode(ts).length);
 return crypto.subtle.verify("Ed25519",key,signature,message);
}
async function discordInteractionGateway(req,env,ctx){
 if(req.method!=="POST")return json({ok:true,service:"BalticM Discord Interaction Gateway",version:"1.0.0"});
 const raw=new Uint8Array(await req.arrayBuffer());
 let valid=false;try{valid=await verifyDiscordInteraction(req,raw,env)}catch(e){return json({error:"Verification unavailable"},503)}
 if(!valid)return json({error:"Invalid request signature"},401);
 let interaction;try{interaction=JSON.parse(dec.decode(raw))}catch{return json({error:"Invalid JSON"},400)}
 if(interaction?.type===1)return json({type:1});
 const customId=String(interaction?.data?.custom_id||"");
 if(interaction?.type===3&&customId.startsWith("ticket_create:")){
 const parts=customId.slice("ticket_create:".length).split(":"),guildId=parts[0],typeKey=parts[1]||"support";
 if(!guildId||guildId!==String(interaction?.guild_id||"")||!["support","report"].includes(typeKey))return json({type:4,data:{content:"Invalid ticket server.",flags:64}});
 try{return await createTicketFromInteraction(env,interaction,guildId,typeKey)}catch(e){return json({type:4,data:{content:"Could not create your ticket. Please contact server staff.",flags:64}})}
}
if(interaction?.type===3&&customId.startsWith("ticket_close:")){
 const ticketId=customId.slice("ticket_close:".length);
 try{return await closeTicketFromInteraction(env,interaction,ticketId)}catch(e){return json({type:4,data:{content:"Could not close this ticket.",flags:64}})}
}
if(interaction?.type===3&&customId.startsWith("giveaway_enter:")){try{return await giveawayEnterInteraction(env,interaction,customId.slice("giveaway_enter:".length),ctx)}catch(e){return json({type:4,data:{content:"Could not update your giveaway entry.",flags:64}})}}
 if(interaction?.type===3&&customId.startsWith("dm_unsubscribe:")){
  const guildId=customId.slice("dm_unsubscribe:".length),userId=String(interaction?.user?.id||interaction?.member?.user?.id||"");
  if(guildId&&userId){
   try{await ensureDmOptOutTable(env);await env.BALTICM_DB.prepare("INSERT OR REPLACE INTO dm_opt_outs (guild_id,user_id,opted_out_at) VALUES (?,?,?)").bind(guildId,userId,new Date().toISOString()).run()}catch(e){return json({type:4,data:{content:"Could not update your BalticM news preference. Please try again.",flags:64}})}
   return json({type:7,data:{content:"🔕 News messages are unsubscribed. Moderation and essential service messages may still be sent.",components:[{type:1,components:[{type:2,style:3,label:"Subscribe to news",custom_id:`dm_subscribe:${guildId}`}]}]}});
  }
 }
 if(interaction?.type===3&&customId.startsWith("dm_subscribe:")){
  const guildId=customId.slice("dm_subscribe:".length),userId=String(interaction?.user?.id||interaction?.member?.user?.id||"");
  if(guildId&&userId){
   try{await ensureDmOptOutTable(env);await env.BALTICM_DB.prepare("DELETE FROM dm_opt_outs WHERE guild_id=? AND user_id=?").bind(guildId,userId).run()}catch(e){return json({type:4,data:{content:"Could not update your news preference. Please try again.",flags:64}})}
   return json({type:7,data:{content:"🔔 News messages are subscribed.",components:[{type:1,components:[{type:2,style:2,label:"Unsubscribe from news",custom_id:`dm_unsubscribe:${guildId}`}]}]}});
  }
 }
 const headers=new Headers(req.headers);headers.set("content-type","application/json");headers.delete("host");
 ctx.waitUntil(fetch("https://balticm.eu/discord-bot",{method:"POST",headers,body:raw}).catch(()=>{}));
 if(interaction?.type===3)return json({type:6});
 if(interaction?.type===2&&["play","join","disconnect","pause","resume","skip","stop","queue","nowplaying","np","volume","remove","clear","shuffle","loop"].includes(interaction?.data?.name))return json({type:5,data:{flags:64}});
 return json({type:4,data:{content:"BalticM.eu interaction server is online.",flags:64}});
}

export default{async scheduled(event,env,ctx){await Promise.all([finishDueGiveaways(env),enforceFreeBrandingForManagedGuilds(env),pollAllStreamers(env)])},async fetch(req,env,ctx){
 const u=new URL(req.url),p=u.pathname;
 if(p==="/api/health")return health(req,env);
 if(p==="/api/status-public")return json({ok:true,service:"BalticM Bot Center",version:"status-public-v2",checkedAt:new Date().toISOString()});
 if(p==="/api/tebex/webhook")return tebexWebhook(req,env);
 if(p==="/api/reaction-roles/service/event"&&req.method==="POST")return reactionRoleServiceEvent(req,env);
 if(p==="/api/discord-interactions")return discordInteractionGateway(req,env,ctx);
 if(p==="/api/desktop/latest")return desktopLatest();
 const um=p.match(/^\/api\/desktop\/update\/([^/]+)\/([^/]+)\/([^/]+)$/);if(um)return desktopUpdate(decodeURIComponent(um[1]),decodeURIComponent(um[2]),decodeURIComponent(um[3]));
 if(p==="/api/music/service/config"){const guildId=u.searchParams.get("guildId"),secret=req.headers.get("X-BalticM-Service-Secret")||"";if(!env.BALTICM_MUSIC_SERVICE_SECRET||secret!==env.BALTICM_MUSIC_SERVICE_SECRET)return json({error:"Unauthorized"},401);if(!guildId)return json({error:"guildId is required"},400);const config=await getMusicConfig(env,guildId);return json({config});}
 if(p==="/api/voice-create/service/config"){const guildId=u.searchParams.get("guildId"),secret=req.headers.get("X-BalticM-Service-Secret")||"";if(!env.BALTICM_VOICE_SERVICE_SECRET||secret!==env.BALTICM_VOICE_SERVICE_SECRET)return json({error:"Unauthorized"},401);if(!guildId)return json({error:"guildId is required"},400);const config=await getVoiceConfig(env,guildId);return json({config});}
 if(p==="/api/voice-create/service/rooms"){const secret=req.headers.get("X-BalticM-Service-Secret")||"";if(!env.BALTICM_VOICE_SERVICE_SECRET||secret!==env.BALTICM_VOICE_SERVICE_SECRET)return json({error:"Unauthorized"},401);return voiceServiceRooms(req,env,u.searchParams.get("guildId")||"");}
 if(p==="/api/auth/login")return login(req,env);
 if(p==="/api/auth/callback")return callback(req,env);
 if(p==="/api/auth/logout")return new Response(null,{status:302,headers:{Location:publicAppOrigin(env,req)+"/","Set-Cookie":`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`}});
 if(p==="/api/auth/me")return handleAuthMe(req,env,{refreshGuilds:user=>refreshAccessibleGuilds(env,user)});
 const stCb=p.match(/^\/api\/profile\/streaming\/(twitch|youtube|tiktok|kick)\/callback$/);
 if(stCb)return streamingOAuthCallback(req,env,stCb[1]);
 if(p.startsWith("/api/")){try{const user=await session(req,env);if(!user)return json({error:"Unauthorized"},401);if(p==="/api/control-access"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);const permissions={};for(const k of ACCESS_KEYS)permissions[k]=await controlAccessLevel(env,user,guildId,k);const mod=await moduleSettingsState(env,guildId);const modules={};for(const k of MODULE_KEYS)modules[k]=mod.modules?.[k]!==false;return json({permissions,modules});}
const guildIdForAccess=u.searchParams.get("guildId");
if(guildIdForAccess){
 const routeKey=routeAccessKey(p);
 if(routeKey){const minLevel=requiredLevelForRequest(p,req.method);const denied=await requireControlAccess(env,user,guildIdForAccess,routeKey,minLevel);if(denied)return denied;if(MODULE_KEYS.includes(routeKey)&&!await moduleEnabled(env,guildIdForAccess,routeKey))return json({error:"Feature module is disabled",module:routeKey},403)}
}
if(p==="/api/admin/access")return json({admin:isBalticMAdmin(env,user)});
if(p==="/api/admin/support/threads"&&req.method==="GET")return adminSupportThreads(env,user);
if(p==="/api/admin/support/thread"&&req.method==="GET")return adminSupportThread(req,env,user);
if(p==="/api/admin/support/reply"&&req.method==="POST")return adminSupportReply(req,env,user);if(p==="/api/admin/support/typing"&&req.method==="POST")return adminSupportTyping(req,env,user);
if(p==="/api/admin/support/status"&&req.method==="POST")return adminSupportStatus(req,env,user);if(p==="/api/admin/support/message/delete"&&req.method==="POST")return adminSupportDeleteMessage(req,env,user);if(p==="/api/admin/support/conversation/delete"&&req.method==="POST")return adminSupportDeleteConversation(req,env,user);
if(p==="/api/admin/subscriptions"&&req.method==="GET")return adminSubscriptionsList(req,env,user);
if(p==="/api/admin/subscriptions/grant"&&req.method==="POST")return adminSubscriptionAction(req,env,user,"grant");
if(p==="/api/admin/subscriptions/extend"&&req.method==="POST")return adminSubscriptionAction(req,env,user,"extend");
if(p==="/api/admin/subscriptions/revoke"&&req.method==="POST")return adminSubscriptionAction(req,env,user,"revoke");
if(p==="/api/admin/tebex"&&req.method==="GET")return adminTebexOverview(env,user);
if(p==="/api/admin/settings"&&req.method==="GET")return adminSettingsOverview(req,env,user);
if(p==="/api/admin/assistant"&&(req.method==="POST"||req.method==="GET"))return adminAssistantAsk(req,env,user);
if(p==="/api/admin/logs"&&req.method==="GET")return adminLogsList(req,env,user);
if(p==="/api/admin/vip-codes"&&req.method==="GET")return adminVipCodesList(env,user);
if(p==="/api/admin/vip-codes"&&req.method==="POST")return adminVipCodeCreate(req,env,user);
const vipCodeHist=p.match(/^\/api\/admin\/vip-codes\/([^/]+)\/history$/);if(vipCodeHist&&req.method==="GET")return adminVipCodeHistory(req,env,user,decodeURIComponent(vipCodeHist[1]));
const vipCodeOne=p.match(/^\/api\/admin\/vip-codes\/([^/]+)$/);if(vipCodeOne&&req.method==="PATCH")return adminVipCodePatch(req,env,user,decodeURIComponent(vipCodeOne[1]));
if(vipCodeOne&&req.method==="DELETE")return adminVipCodeDelete(req,env,user,decodeURIComponent(vipCodeOne[1]));
if(p==="/api/support-chat/close"&&req.method==="POST")return supportChatClose(req,env,user);if(p==="/api/support-chat/rating"&&req.method==="POST")return supportChatRate(req,env,user);if(p==="/api/support-chat/handoff"&&req.method==="POST")return supportChatHandoff(req,env,user);if(p==="/api/support-chat/typing"&&req.method==="POST")return supportChatTyping(req,env,user);if(p==="/api/support-chat"){if(req.method==="GET")return supportChatState(req,env,user);if(req.method==="POST")return supportChatSend(req,env,user);return json({error:"Method not allowed"},405);}
if(p==="/api/notifications"&&req.method==="GET")return userNotificationsList(env,user);if(p==="/api/notifications/read-all"&&req.method==="POST")return userNotificationsReadAll(env,user);if(p==="/api/notifications/read"&&req.method==="POST")return userNotificationsRead(req,env,user);if(p==="/api/admin/notifications"&&req.method==="GET")return adminNotificationsList(env,user);if(p==="/api/admin/notifications"&&req.method==="POST")return adminPublishNotification(req,env,user);if(p==="/api/status")return json({ok:true,user:{id:user.id,username:user.username},configured:{discordClientSecret:!!env.DISCORD_CLIENT_SECRET,sessionSecret:!!env.SESSION_SECRET,discordBotToken:!!env.DISCORD_BOT_TOKEN}});if(p==="/api/discord/guild"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return discordGuild(env,guildId);}
if(p==="/api/music/config"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveMusicConfig(req,env,guildId):musicConfigState(env,guildId);}
if(p==="/api/music"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(req.method!=="GET")return json({error:"Method not allowed"},405);return musicProxy(req,env,guildId,"state");}
const musicAct=p.match(/^\/api\/music\/(connect|disconnect|play|pause|resume|skip|stop|volume)$/);if(musicAct&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return musicProxy(req,env,guildId,musicAct[1],user);}
if(p==="/api/voice-create"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveVoiceCreate(req,env,guildId):voiceCreateState(env,guildId);}
const vr=p.match(/^\/api\/voice-create\/rooms\/([^/]+)$/);if(vr&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return voiceRoomAction(req,env,guildId,decodeURIComponent(vr[1]));}
if(p==="/api/tickets"&&req.method==="GET"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return ticketsState(env,guildId);}
if(p==="/api/tickets/types"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return ticketTypesState(env,guildId);}
const ttc=p.match(/^\/api\/tickets\/types\/(support|report)$/);if(ttc&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return saveTicketType(req,env,guildId,ttc[1]);}
const ttp=p.match(/^\/api\/tickets\/types\/(support|report)\/publish$/);if(ttp&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return publishTicketTypePanel(env,guildId,ttp[1]);}
if(p==="/api/tickets/config"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveTicketConfig(req,env,guildId):ticketConfigState(env,guildId);}
if(p==="/api/tickets/publish"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return publishTicketPanel(env,guildId);}
const ta=p.match(/^\/api\/tickets\/([^/]+)$/);if(ta&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return ticketAction(req,env,user,guildId,decodeURIComponent(ta[1]));}
if(p==="/api/premium/redeem"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:VIP_CODE_ERROR.noPermission},403);return redeemCode(req,env,user,guildId);}
if(p==="/api/premium/tebex/checkout"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return startTebexVipCheckout(req,env,user,guildId);}
if(p==="/api/premium/tebex/basket"&&req.method==="GET"){const guildId=u.searchParams.get("guildId");const basketIdent=u.searchParams.get("basketIdent")||u.searchParams.get("ident");if(!guildId)return json({error:"guildId is required"},400);if(!basketIdent)return json({error:"basketIdent is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return getTebexVipBasket(req,env,user,guildId,basketIdent);}
if(p==="/api/premium/tebex/coupon"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return applyTebexVipCoupon(req,env,user,guildId);}
if(p==="/api/premium"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);const state=await premiumPlanState(env,guildId);if(!state.premium)await syncGuildBotNickname(env,guildId);ctx.waitUntil(ensureBotApplicationProfile(env));return json({ok:true,...state});}
if(p==="/api/settings/notifications"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveNotificationSettings(req,env,guildId):json(await notificationSettingsState(env,guildId));}
if(p==="/api/settings/modules"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveModuleSettings(req,env,guildId):json({config:await moduleSettingsState(env,guildId)});}
if(p==="/api/settings/access"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(req.method==="POST")return saveAccessSettings(req,env,guildId);try{const state=await accessSettingsState(env,guildId);if(state.error)return json({error:state.error},state.status||502);return json(state)}catch(e){return json({error:String(e.message||e)},500)}}
if(p==="/api/settings/general"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(req.method==="POST")return saveGeneralSettings(req,env,guildId);ctx.waitUntil(ensureBotApplicationProfile(env));return generalSettingsState(env,guildId);}
if(p==="/api/moderation/settings"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveModerationSettings(req,env,guildId):moderationSettingsState(env,guildId);}
if(p==="/api/moderation"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?moderateMember(req,env,user,guildId):moderationState(env,guildId);}const ma=p.match(/^\/api\/moderation\/([^/]+)$/);if(ma&&req.method==="DELETE"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return removeModerationAction(env,user,guildId,decodeURIComponent(ma[1]));}
if(p==="/api/reaction-roles"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="POST"?saveReactionRolePanel(req,env,guildId):reactionRoleState(env,guildId);}
const rrp=p.match(/^\/api\/reaction-roles\/([^/]+)(?:\/(publish))?$/);if(rrp){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(rrp[2]==="publish"&&req.method==="POST")return publishReactionRolePanel(env,guildId,decodeURIComponent(rrp[1]));if(!rrp[2]&&req.method==="PUT")return updateReactionRolePanel(req,env,guildId,decodeURIComponent(rrp[1]));if(!rrp[2]&&req.method==="DELETE")return deleteReactionRolePanel(env,guildId,decodeURIComponent(rrp[1]));}
if(p==="/api/giveaways"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(req.method==="GET")return giveawayState(env,guildId);if(req.method==="POST")return saveGiveaway(req,env,guildId);return json({error:"Method not allowed"},405);}
const gw=p.match(new RegExp("^/api/giveaways/([^/]+)(?:/(publish|end|reroll))?$"));if(gw){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);const id=decodeURIComponent(gw[1]),action=gw[2]||"";if(action==="publish"&&req.method==="POST")return publishGiveaway(env,guildId,id);if(action==="end"&&req.method==="POST")return endGiveaway(env,guildId,id,false);if(action==="reroll"&&req.method==="POST")return endGiveaway(env,guildId,id,true);if(!action&&req.method==="PUT")return saveGiveaway(req,env,guildId,id);if(!action&&req.method==="DELETE")return deleteGiveaway(env,guildId,id);}
if(p==="/api/announcements"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(req.method==="GET")return announcementState(env,guildId);if(req.method==="POST")return saveAnnouncement(req,env,guildId);return json({error:"Method not allowed"},405);}
if(p==="/api/streaming-accounts"){if(req.method==="GET")return streamingAccountsState(env,user);if(req.method==="POST")return saveStreamingAccount();return json({error:"Method not allowed"},405);}
const stAcc=p.match(/^\/api\/streaming-accounts\/([^/]+)$/);if(stAcc){const provider=decodeURIComponent(stAcc[1]);if(req.method==="PUT")return saveStreamingAccount();if(req.method==="DELETE")return deleteStreamingAccount(env,user,provider);return json({error:"Method not allowed"},405);}
const stCo=p.match(/^\/api\/profile\/streaming\/(twitch|youtube|tiktok|kick)\/connect$/);if(stCo&&req.method==="GET")return startStreamingOAuth(req,env,user,stCo[1]);
if(p==="/api/streamers/self"){if(req.method==="GET")return streamingAccountsState(env,user);return json({error:"Method not allowed"},405);}
if(p==="/api/streamers/settings"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(req.method==="POST")return saveStreamerSettings(req,env,user,guildId);if(req.method==="GET"){const settings=await loadStreamerSettings(env,guildId);return json({settings});}return json({error:"Method not allowed"},405);}
if(p==="/api/streamers"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(req.method==="GET")return streamersState(env,guildId,user);if(req.method==="POST")return saveStreamer(req,env,user,guildId);return json({error:"Method not allowed"},405);}
if(p==="/api/streamers/refresh"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return refreshStreamer(env,guildId,"");}
const st=p.match(/^\/api\/streamers\/([^/]+)(?:\/(check))?$/);if(st){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);const id=decodeURIComponent(st[1]);if(id==="refresh"||id==="self"||id==="settings")return json({error:"Not found"},404);if(st[2]==="check"&&req.method==="POST")return refreshStreamer(env,guildId,id);if(!st[2]&&req.method==="PUT")return saveStreamer(req,env,user,guildId,id);if(!st[2]&&req.method==="DELETE")return deleteStreamer(env,user,guildId,id);return json({error:"Method not allowed"},405);}
const an=p.match(new RegExp("^/api/announcements/([^/]+)(?:/(publish))?$"));if(an){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);const id=decodeURIComponent(an[1]);if(an[2]==="publish"&&req.method==="POST")return publishAnnouncement(env,guildId,id);if(!an[2]&&req.method==="PUT")return saveAnnouncement(req,env,guildId,id);if(!an[2]&&req.method==="DELETE")return deleteAnnouncement(env,guildId,id);}
if(p==="/api/direct-messages/opt-outs"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);if(req.method==="GET")return dmOptOutState(env,guildId);if(req.method==="DELETE"){let body;try{body=await req.json()}catch{return json({error:"Invalid JSON"},400)}const userId=String(body.userId||"").trim();if(!/^\d{16,22}$/.test(userId))return json({error:"Invalid user"},400);return setDmOptOut(env,guildId,userId,false)}return json({error:"Method not allowed"},405);}
if(p==="/api/direct-messages"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return sendDirectMessages(req,env,guildId);}
if(p==="/api/logs"&&req.method==="GET"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return activityLogState(env,guildId,u);}
if(p==="/api/discord/members"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return discordMembers(env,guildId);}
if(p==="/api/discord/roles"&&req.method==="POST"){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return createDiscordRole(req,env,guildId);}const er=p.match(/^\/api\/discord\/roles\/([^/]+)$/);if(er&&(req.method==="PATCH"||req.method==="DELETE")){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return req.method==="DELETE"?deleteDiscordRole(env,guildId,decodeURIComponent(er[1])):editDiscordRole(req,env,guildId,decodeURIComponent(er[1]));}
const rm=p.match(/^\/api\/discord\/members\/([^/]+)\/roles\/([^/]+)$/);if(rm&&(req.method==="PUT"||req.method==="DELETE")){const guildId=u.searchParams.get("guildId");if(!guildId)return json({error:"guildId is required"},400);if(!canManageGuild(user,guildId))return json({error:"Forbidden"},403);return changeMemberRole(req,env,user,guildId,decodeURIComponent(rm[1]),decodeURIComponent(rm[2]),req.method==="DELETE");}
return json({error:"Not found"},404)}catch(e){return json({error:"Request failed"},500)}}
 return env.ASSETS.fetch(req);
}};
