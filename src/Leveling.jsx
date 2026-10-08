import React,{useEffect,useRef,useState}from"react";
import {Crown,Loader2,Plus,RefreshCw,Search,Send,Star,Trophy,X}from"lucide-react";
import {ALLOWED_ANNOUNCE_PLACEHOLDERS,ANNOUNCE_BRANDING,DEFAULT_ANNOUNCE_CARD,DEFAULT_ANNOUNCE_MESSAGE,renderLevelUpCard}from"../leveling.js";
import"./leveling.css";

/* Control Center → ⭐ Leveling (guild scoped). Every request carries the
   selected guild id; the worker validates session, membership and RBAC, and
   Premium restrictions are enforced server-side — this UI only reflects them
   (locked options stay visible with 🔒 Premium, never silently change, and
   clicking one opens the existing BalticM Premium upgrade page).

   V2: every action answers INSIDE the section where it was triggered — a
   success or error never appears in a page-level banner, and the user is
   never scrolled away from the control they just used. */

const fmt=n=>Number(n||0).toLocaleString();
const num=(v,min,max)=>{const n=Math.floor(Number(v));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min};
/* Discord role colours arrive as integers (0 = no colour) — normalise to a
   safe hex string for the shared dropdown's colour dot. */
const hexColor=c=>{const n=Number(c);return Number.isInteger(n)&&n>0&&n<=16777215?"#"+n.toString(16).padStart(6,"0"):null};
const avatarSrc=m=>m&&m.avatar?`https://cdn.discordapp.com/avatars/${m.id}/${m.avatar}.png?size=64`:null;

/* ---------------------------------------------- V3 card + interval glue --
   Interval dropdowns store the SAME seconds values the backend always used
   (3600 → "1 hour", 86400 → "24 hours", anything else → "Custom…"), so no
   saved setting is ever reset by opening the page. */
const INTERVAL_PRESETS=[60,300,600,900,1800,3600,7200,10800,21600,43200,86400];
const intervalLabel=s=>{const n=Math.floor(Number(s)||0),h=Math.floor(n/3600),m=Math.floor(n/60);if(n>=3600&&n%3600===0)return h+" hour"+(h===1?"":"s");if(n>=60&&n%60===0)return m+" minute"+(m===1?"":"s");return n+" seconds"};
const intervalPreset=v=>INTERVAL_PRESETS.includes(Number(v))?String(v):"custom";
/* The settings payload always carries a card merged with the defaults. A
   legacy guild (custom announceMessage, no card yet) derives a CUSTOM card
   whose description is the existing message — nothing is ever discarded. */
const withCard=s=>{
 if(!s)return s;
 if(s.announceCard)return {...s,announceCard:{...DEFAULT_ANNOUNCE_CARD,...s.announceCard}};
 const msg=String(s.announceMessage||"");
 const derived=msg&&msg!==DEFAULT_ANNOUNCE_MESSAGE?{...DEFAULT_ANNOUNCE_CARD,mode:"custom",description:msg}:{...DEFAULT_ANNOUNCE_CARD};
 return {...s,announceCard:derived};
};
/* Minimal Discord markdown: **bold** only, matching what the embed shows. */
const md=s=>String(s||"").split(/(\*\*[^*]+\*\*)/g).map((p,i)=>p.length>4&&p.startsWith("**")&&p.endsWith("**")?<b key={i}>{p.slice(2,-2)}</b>:p);

function Notice({value}){return value?<div className={"lvNotice "+(value.ok?"ok":"error")} role={value.ok?"status":"alert"}>{value.text}</div>:null}

function UpgradeHint({message,onUpgrade}){
 if(!message)return null;
 return <div className="lvUpgrade" role="status"><Crown/><span>{message}</span><button type="button" onClick={()=>{if(onUpgrade)onUpgrade()}}>View Premium plans</button></div>;
}

async function api(url,options){
 const r=await fetch(url,{cache:"no-store",...options});
 const data=await r.json().catch(()=>({}));
 if(!r.ok){
  if(data&&data.code==="premium_required"){const e=new Error(data.error||"This requires an active Premium subscription for this server.");e.premiumRequired=true;throw e}
  throw new Error(String(data&&data.error||"Request could not be completed."));
 }
 return data;
}

export default function Leveling({user,selectedGuild,canConfigure,TicketOptionSelect,premium,onUpgrade}){
 const Select=TicketOptionSelect;
 const[loading,setLoading]=useState(true),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 /* Section-local feedback — never a page-level banner. */
 const[settingsNotice,setSettingsNotice]=useState(null),[rewardNotice,setRewardNotice]=useState(null);
 const[xpNotice,setXpNotice]=useState(null),[announceNotice,setAnnounceNotice]=useState(null);
 const[locks,setLocks]=useState({});
 const[state,setState]=useState(null),[form,setForm]=useState(null);
 const[roles,setRoles]=useState([]),[channels,setChannels]=useState([]),[guildName,setGuildName]=useState(""),[guildIconHash,setGuildIconHash]=useState("");
 const[board,setBoard]=useState([]),[boardTotal,setBoardTotal]=useState(0),[boardQ,setBoardQ]=useState(""),[boardBusy,setBoardBusy]=useState(false);
 const[rewardLevel,setRewardLevel]=useState(""),[rewardRoleId,setRewardRoleId]=useState(""),[editingId,setEditingId]=useState("");
 const[members,setMembers]=useState([]),[memberQuery,setMemberQuery]=useState(""),[picked,setPicked]=useState(null);
 const[xpAmount,setXpAmount]=useState(""),[xpReason,setXpReason]=useState("");
 /* Description editor ref — placeholder chips insert at the CURSOR. */
 const descRef=useRef(null);

 const isPremium=state?!!state.premium:!!premium;
 const locked=!isPremium;
 const set=(k,v)=>setForm(f=>f?{...f,[k]:v}:f);
 /* Premium lock hints render inside the section that raised them. */
 const lock=(k,msg)=>setLocks(l=>({...l,[k]:msg}));
 const clearNotices=()=>{setSettingsNotice(null);setRewardNotice(null);setXpNotice(null);setAnnounceNotice(null);setLocks({})};

 const loadBoard=async(q)=>{
  if(!selectedGuild)return;
  setBoardBusy(true);
  try{
   const x=await api(`/api/leveling/leaderboard?guildId=${encodeURIComponent(selectedGuild)}&q=${encodeURIComponent(q||"")}`);
   setBoard(x.entries||[]);setBoardTotal(x.totalMembers||0);
  }catch{ /* keep the previous board on a transient failure */ }
  finally{setBoardBusy(false)}
 };

 const load=async(manual)=>{
  if(!selectedGuild)return;
  if(manual)setBoardBusy(true);
  setLoading(true);setError("");clearNotices();
  try{
   const s=await api(`/api/leveling?guildId=${encodeURIComponent(selectedGuild)}`);
   setState(s);setForm(withCard(s.settings));
   const[g,m]=await Promise.all([
    fetch(`/api/discord/guild?guildId=${encodeURIComponent(selectedGuild)}`,{cache:"no-store"}).then(r=>r.ok?r.json():{}).catch(()=>({})),
    fetch(`/api/discord/members?guildId=${encodeURIComponent(selectedGuild)}`,{cache:"no-store"}).then(r=>r.ok?r.json():{}).catch(()=>({}))
   ]);
   setGuildName(g&&g.guild&&g.guild.name?String(g.guild.name):"");
   setGuildIconHash(g&&g.guild&&g.guild.icon?String(g.guild.icon):"");
   setRoles((g.roles||[]).filter(r=>String(r.id)!==String(selectedGuild)&&!r.managed));
   setChannels((g.channels||[]).filter(c=>Number(c.type)===0));
   setMembers((m.members||[]).filter(x=>!x.bot));
   await loadBoard("");
  }catch(e){setError(e.message)}finally{setLoading(false);setBoardBusy(false)}
 };
 useEffect(()=>{setState(null);setForm(null);setBoard([]);setPicked(null);setMemberQuery("");setEditingId("");setRewardLevel("");setRewardRoleId("");setGuildIconHash("");if(selectedGuild)load();else setLoading(false)},[selectedGuild]);
 useEffect(()=>{setLocks({})},[isPremium]);

 const save=async e=>{
  e.preventDefault();
  if(!canConfigure||!form)return;
  setBusy(true);setSettingsNotice(null);setAnnounceNotice(null);setLocks({});
  try{
   const r=await api(`/api/leveling?guildId=${encodeURIComponent(selectedGuild)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
   setState(s=>s?{...s,settings:r.settings,premium:r.premium}:s);
   setForm(withCard(r.settings));
   setSettingsNotice({ok:true,text:"Leveling settings saved."});
  }catch(err){
   if(err.premiumRequired){lock("settings",err.message)}else setSettingsNotice({ok:false,text:err.message});
  }finally{setBusy(false)}
 };

 const toggleSetting=key=>{
  if(!canConfigure)return;
  if(key==="voiceXp"&&locked){lock("voice","Voice XP is a Premium feature for this server. Upgrade to Premium to reward members who hang out in voice channels.");return}
  set(key,!form?.[key]);
 };

 const addIgnored=(kind,id)=>{
  if(!id)return;
  if(locked){lock("ignored",kind==="channels"?"Ignored channels are a Premium feature for this server.":"Ignored roles are a Premium feature for this server. Upgrade to Premium to exclude channels and roles from XP.");return}
  const list=form?.[kind==="channels"?"ignoredChannels":"ignoredRoles"]||[];
  if(!list.includes(id))set(kind==="channels"?"ignoredChannels":"ignoredRoles",[...list,id]);
 };
 const dropIgnored=(kind,id)=>{if(!canConfigure)return;const key=kind==="channels"?"ignoredChannels":"ignoredRoles";set(key,(form?.[key]||[]).filter(x=>x!==id))};

 const roleName=id=>{const f=roles.find(x=>String(x.id)===String(id));return f?f.name:id};

 const addReward=async()=>{
  if(!canConfigure||!form)return;
  const level=Math.floor(Number(rewardLevel));
  if(!Number.isFinite(level)||level<1){setRewardNotice({ok:false,text:"Choose the level for this reward."});return}
  if(!rewardRoleId){setRewardNotice({ok:false,text:"Choose the Discord role for this reward."});return}
  if(locked&&(state?.rewards||[]).length>=3){lock("rewards","Free servers can configure up to 3 reward roles. Premium unlocks unlimited reward roles.");return}
  setBusy(true);setRewardNotice(null);setLocks(l=>({...l,rewards:null}));
  try{
   const r=await api(`/api/leveling/rewards?guildId=${encodeURIComponent(selectedGuild)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({level,roleId:rewardRoleId})});
   setState(s=>s?{...s,rewards:[...(s.rewards||[]),r.reward].sort((a,b)=>a.level-b.level)}:s);
   setRewardLevel("");setRewardRoleId("");
   setRewardNotice({ok:true,text:`Level ${level} → @${r.reward.roleName} reward added.`});
  }catch(err){
   if(err.premiumRequired){lock("rewards",err.message)}else setRewardNotice({ok:false,text:err.message});
  }finally{setBusy(false)}
 };
 const startEdit=r=>{
  if(!canConfigure)return;
  setEditingId(String(r.id));setRewardLevel(String(r.level));setRewardRoleId(String(r.roleId));setRewardNotice(null);
 };
 const cancelEdit=()=>{setEditingId("");setRewardLevel("");setRewardRoleId("");setRewardNotice(null)};
 const updateReward=async()=>{
  if(!canConfigure||!editingId)return;
  const level=Math.floor(Number(rewardLevel));
  if(!Number.isFinite(level)||level<1){setRewardNotice({ok:false,text:"Choose the level for this reward."});return}
  if(!rewardRoleId){setRewardNotice({ok:false,text:"Choose the Discord role for this reward."});return}
  setBusy(true);setRewardNotice(null);setLocks(l=>({...l,rewards:null}));
  try{
   const r=await api(`/api/leveling/rewards/${encodeURIComponent(editingId)}?guildId=${encodeURIComponent(selectedGuild)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({level,roleId:rewardRoleId})});
   setState(s=>s?{...s,rewards:(s.rewards||[]).map(x=>String(x.id)===String(editingId)?r.reward:x).sort((a,b)=>a.level-b.level)}:s);
   cancelEdit();
   setRewardNotice({ok:true,text:`Reward updated → Level ${level} → @${r.reward.roleName}.`});
  }catch(err){
   if(err.premiumRequired){lock("rewards",err.message)}else setRewardNotice({ok:false,text:err.message});
  }finally{setBusy(false)}
 };
 const removeReward=async reward=>{
  if(!canConfigure)return;
  if(!window.confirm(`Remove the Level ${reward.level} → @${reward.roleName} reward? Granted roles are not removed from members.`))return;
  setBusy(true);setRewardNotice(null);
  try{
   await api(`/api/leveling/rewards/${encodeURIComponent(reward.id)}?guildId=${encodeURIComponent(selectedGuild)}`,{method:"DELETE"});
   setState(s=>s?{...s,rewards:(s.rewards||[]).filter(x=>x.id!==reward.id)}:s);
   if(String(editingId)===String(reward.id))cancelEdit();
   setRewardNotice({ok:true,text:`Level ${reward.level} reward removed. Roles already granted to members stay untouched.`});
  }catch(err){setRewardNotice({ok:false,text:err.message})}finally{setBusy(false)}
 };

 const runXpAction=async(action,target)=>{
  if(!canConfigure)return;
  if(!target){setXpNotice({ok:false,text:"Choose a member first."});return}
  if(action==="reset"&&!window.confirm(`Reset ALL XP for ${target.displayName||target.username}? This cannot be undone.`))return;
  const amount=action==="reset"?0:num(xpAmount,1,1000000);
  if(action!=="reset"&&(!xpAmount||xpAmount<1)){setXpNotice({ok:false,text:"Enter the XP amount first."});return}
  setBusy(true);setXpNotice(null);
  try{
   const r=await api(`/api/leveling/xp?guildId=${encodeURIComponent(selectedGuild)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,userId:String(target.id),amount,reason:xpReason,targetName:target.displayName||target.globalName||target.username,confirm:action==="reset"})});
   setXpNotice({ok:true,text:`${r.action==="reset"?"Reset":r.action[0].toUpperCase()+r.action.slice(1)} XP for ${r.targetName}: ${fmt(r.previousXp)} → ${fmt(r.newXp)} XP (Level ${r.level}).`+(r.announced?" 🎉 Level-up announced to Discord.":"")});
   if(action==="reset")setPicked(null);
   setXpAmount("");setXpReason("");
   await loadBoard(boardQ);
  }catch(err){setXpNotice({ok:false,text:err.message})}finally{setBusy(false)}
 };

 /* ------------------------------------------------ V3 card builder ---- */
 const cardValue=()=>({...(form?.announceCard||DEFAULT_ANNOUNCE_CARD)});
 const setCard=patch=>{if(!canConfigure)return;set("announceCard",{...cardValue(),...patch})};
 const setCardMode=mode=>{
  if(!canConfigure)return;
  if(mode==="custom"&&locked){lock("announce","A custom level-up card is a Premium feature for this server. Upgrade to Premium to design your own Level-Up card, colors and placeholders.");return}
  setCard({mode});
 };
 /* Placeholder chips insert at the CURRENT cursor position (or replace the
    selection) instead of blindly appending to the end. */
 const insertPlaceholder=token=>{
  const el=descRef.current,cur=String(cardValue().description||"");
  if(!el){setCard({description:(cur+token).slice(0,600)});return}
  const start=el.selectionStart??cur.length,end=el.selectionEnd??start;
  const next=(cur.slice(0,start)+token+cur.slice(end)).slice(0,600);
  setCard({description:next});
  const pos=Math.min(start+token.length,next.length);
  requestAnimationFrame(()=>{try{el.focus();el.setSelectionRange(pos,pos)}catch{}});
 };
 const resetCard=()=>{
  if(!canConfigure)return;
  if(!window.confirm("Reset the Level-Up card to the default BalticM design? Your current card edits will be lost."))return;
  set("announceCard",{...DEFAULT_ANNOUNCE_CARD,mode:cardValue().mode==="custom"?"custom":"ready"});
  setAnnounceNotice({ok:true,text:"Card reset to the default design — press Save settings to apply it."});
 };

 /* The test uses the ALREADY-SELECTED Announcement Channel — never a second
    picker. With announcements off (or no channel yet) it answers locally. */
 const sendTestAnnouncement=async()=>{
  if(!canConfigure||busy)return;
  const chId=form.announceMode==="channel"?form.announceChannelId:"";
  if(form.announceMode==="off"){setAnnounceNotice({ok:false,text:"Level-up announcements are disabled — choose where to announce first, then send a test."});return}
  if(!chId){setAnnounceNotice({ok:false,text:"Choose a specific announcement channel — tests are always sent to your selected Announcement Channel."});return}
  setBusy(true);setAnnounceNotice(null);
  try{
   await api(`/api/leveling/announce/test?guildId=${encodeURIComponent(selectedGuild)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channelId:chId})});
   const ch=channels.find(c=>String(c.id)===String(chId));
   setAnnounceNotice({ok:true,text:`Test announcement sent to #${ch?ch.name:"channel"} — clearly marked, no XP granted.`});
  }catch(err){setAnnounceNotice({ok:false,text:err.message})}finally{setBusy(false)}
 };

 if(!user)return <div className="lvState"><Trophy/><b>Discord login required</b><span>Connect your Discord account to manage leveling.</span></div>;
 if(!selectedGuild)return <div className="lvState"><Trophy/><b>Select a Discord server</b><span>Leveling is managed per server — pick one from the Servers page first.</span></div>;
 if(loading||!state||!form)return <div className="lvState"><Loader2 className="lvSpin"/><b>Loading leveling…</b></div>;

 const s=state.stats||{};
 const usedRoleIds=new Set((state.rewards||[]).map(r=>String(r.roleId)));
 const rewardOptions=roles.filter(r=>!usedRoleIds.has(String(r.id))||String(r.id)===rewardRoleId);
 const memberResults=memberQuery.trim()
  ?members.filter(m=>(String(m.globalName||"")+" "+String(m.username||"")).toLowerCase().includes(memberQuery.trim().toLowerCase())).slice(0,8)
  :[];
 const top=s.topMember;

 /* Live Discord preview — the SAME renderLevelUpCard() the worker uses for
    the real payload, called with sample context (level 10, this admin). */
 const sampleName=user.global_name||user.username||"Member";
 const card=form.announceCard||DEFAULT_ANNOUNCE_CARD;
 const sampleAvatar=avatarSrc({id:user.id,avatar:user.avatar});
 const serverIconUrl=guildIconHash?`https://cdn.discordapp.com/icons/${selectedGuild}/${guildIconHash}.png?size=128`:null;
 const previewEmbed=renderLevelUpCard(card,{user:"123456789012345678",username:sampleName,level:10,server:guildName||"this server",premium:isPremium,nextReward:(state.rewards||[]).find(r=>Number(r.level)>10)||null,avatar:sampleAvatar,serverIcon:serverIconUrl});
 const previewDesc=String(previewEmbed.description||"").replace(/<@!?\d{16,22}>/g,"@"+sampleName);

 return <div className="lvPage">
  <div className="lvHead">
   <div className="sectionLead"><span className="sectionIcon"><Star/></span><span><b>Leveling</b><small>XP, levels and role rewards for this Discord server.</small></span></div>
   <div className="lvHeadActions">
    <span className={"lvPlanBadge"+(isPremium?" premium":"")}>{isPremium?"PREMIUM":"FREE"}</span>
    <button type="button" onClick={()=>load(true)} disabled={loading||boardBusy}><RefreshCw/>Refresh</button>
   </div>
  </div>
  <Notice value={error?{text:error}:null}/>

  {/* ---------------------------------------------------------- Overview */}
  <section className="lvPanel">
   <div className="lvPanelHead"><div><span className="eyebrow">OVERVIEW</span><h3>Server activity</h3></div></div>
   <div className="lvStats">
    <div className={"lvStat"+(form.enabled?" on":"")}><span>STATUS</span><b>{form.enabled?"ENABLED":"DISABLED"}</b><small>Leveling is {form.enabled?"actively rewarding members":"paused for this server"}</small></div>
    <div className="lvStat"><span>MEMBERS WITH XP</span><b>{fmt(s.membersWithXp)}</b><small>Ranked in this server</small></div>
    <div className="lvStat"><span>XP EARNED TODAY</span><b>{fmt(s.xpToday)}</b><small>Message + voice XP today</small></div>
    <div className="lvStat"><span>MESSAGES REWARDED TODAY</span><b>{fmt(s.messagesToday)}</b><small>Passed the anti-spam cooldown</small></div>
    <div className="lvStat"><span>VOICE XP TODAY</span><b>{fmt(s.voiceXpToday)}</b><small>{locked?"🔒 Premium feature":"Earned in voice channels"}</small></div>
    <div className="lvStat"><span>HIGHEST-LEVEL MEMBER</span><b>{top?top.displayName:"—"}</b><small>{top?`Level ${fmt(top.level)} • ${fmt(top.totalXp)} XP`:"No XP awarded yet"}</small></div>
   </div>
  </section>

  {/* ------------------------------------------------------- XP settings */}
  <form className="lvPanel" onSubmit={save}>
   <div className="lvPanelHead"><div><span className="eyebrow">XP SETTINGS</span><h3>How XP is earned</h3></div>
    <button type="button" className={"lvToggle"+(form.enabled?" on":"")} aria-pressed={form.enabled} onClick={()=>toggleSetting("enabled")} disabled={!canConfigure}><i/>{form.enabled?"Leveling enabled":"Leveling disabled"}</button>
   </div>
   {/* V3: ALL seven XP controls in ONE compact row — Message XP (toggle,
       min, max, cooldown) then Voice XP (toggle, amount, interval). The
       oversized nested Voice XP container is gone; values and anti-farm
       logic are untouched. Cooldown/interval are seconds-backed dropdowns
       (3600 → “1 hour”, anything else → Custom… with a manual field). */}
   <div className="lvXpRow">
    <div className="lvField"><span>MESSAGE XP</span>
     <button type="button" className={"lvToggle"+(form.messageXp?" on":"")} aria-pressed={form.messageXp} onClick={()=>toggleSetting("messageXp")} disabled={!canConfigure}><i/>{form.messageXp?"Enabled":"Disabled"}</button>
    </div>
    <label className="lvField"><span>MIN XP</span><input type="number" min="1" max="100" value={form.minXp} disabled={!canConfigure} onChange={e=>set("minXp",num(e.target.value,1,100))}/></label>
    <label className="lvField"><span>MAX XP</span><input type="number" min="1" max="200" value={form.maxXp} disabled={!canConfigure} onChange={e=>set("maxXp",num(e.target.value,1,200))}/></label>
    <div className="lvField"><span>MESSAGE COOLDOWN</span>
     {Select&&<Select id="lv-message-cooldown" label="Message cooldown" flip value={intervalPreset(form.messageCooldown)} onChange={v=>set("messageCooldown",v==="custom"?num(form.messageCooldown,10,86400):Number(v))} options={[...INTERVAL_PRESETS.map(s=>({value:String(s),label:intervalLabel(s)})),{value:"custom",label:"Custom…"}]}/>} 
     {intervalPreset(form.messageCooldown)==="custom"&&<input className="lvXpCustom" type="number" min="10" max="86400" value={form.messageCooldown} disabled={!canConfigure} onChange={e=>set("messageCooldown",num(e.target.value,10,86400))} aria-label="Custom message cooldown in seconds"/>}
    </div>
    <div className="lvField"><span>VOICE XP {locked&&<em>🔒 Premium</em>}</span>
     <button type="button" className={"lvToggle"+(form.voiceXp?" on":"")} aria-pressed={form.voiceXp} onClick={()=>toggleSetting("voiceXp")} disabled={!canConfigure}><i/>{form.voiceXp?"Enabled":"Disabled"}</button>
    </div>
    <label className="lvField"><span>VOICE AMOUNT</span><input type="number" min="1" max="200" value={form.voiceXpAmount} readOnly={locked} onClick={()=>locked&&lock("voice","Voice XP is a Premium feature for this server.")} disabled={!canConfigure} onChange={e=>set("voiceXpAmount",num(e.target.value,1,200))}/></label>
    <div className="lvField"><span>VOICE INTERVAL</span>
     {Select&&<Select id="lv-voice-interval" label="Voice XP interval" flip locked={locked?INTERVAL_PRESETS.concat("custom").map(String):[]} onLocked={()=>lock("voice","Voice XP is a Premium feature for this server.")} value={intervalPreset(form.voiceInterval)} onChange={v=>set("voiceInterval",v==="custom"?num(form.voiceInterval,15,86400):Number(v))} options={[...INTERVAL_PRESETS.map(s=>({value:String(s),label:intervalLabel(s)})),{value:"custom",label:"Custom…"}]}/>} 
     {intervalPreset(form.voiceInterval)==="custom"&&<input className="lvXpCustom" type="number" min="15" max="86400" value={form.voiceInterval} readOnly={locked} onClick={()=>locked&&lock("voice","Voice XP is a Premium feature for this server.")} disabled={!canConfigure} onChange={e=>set("voiceInterval",num(e.target.value,15,86400))} aria-label="Custom voice XP interval in seconds"/>}
    </div>
   </div>
   <p className="lvHint">Per-member rate protection — bots, webhooks and DMs are never rewarded. Members alone in a channel, AFK and bots never earn voice XP.</p>
   {locks.voice&&<UpgradeHint message={locks.voice} onUpgrade={onUpgrade}/>}

   <div className={"lvPremiumBox"+(locked?" locked":"")}>
    <div className="lvPremiumHead"><span className="eyebrow">IGNORED CHANNELS &amp; ROLES {locked&&<em>🔒 Premium</em>}</span></div>
    <div className="lvGrid lvIgnored">
     <div className="lvField"><span>IGNORED CHANNELS</span>
      {Select&&<Select id="lv-ignored-channel" label="Add ignored channel" search flip value="" onChange={v=>addIgnored("channels",v)} options={[{value:"",label:"Add a channel…"},...channels.filter(c=>!(form.ignoredChannels||[]).includes(String(c.id))).map(c=>({value:String(c.id),label:"#"+c.name}))]}/>}
      <div className="lvChips">{(form.ignoredChannels||[]).map(id=><span key={id} className="lvChip"><span className="lvChipName">#{(channels.find(c=>String(c.id)===id)||{}).name||id}</span>{canConfigure&&<button type="button" aria-label={"Remove "+id} title="Remove" onClick={()=>dropIgnored("channels",id)}><X/></button>}</span>)}</div>
      <small>Messages in these channels never award XP.</small>
     </div>
     <div className="lvField"><span>IGNORED ROLES</span>
      {Select&&<Select id="lv-ignored-role" label="Add ignored role" search flip value="" onChange={v=>addIgnored("roles",v)} options={[{value:"",label:"Add a role…"},...roles.filter(r=>!(form.ignoredRoles||[]).includes(String(r.id))).map(r=>({value:String(r.id),label:"@"+r.name,color:hexColor(r.color)}))]}/>}
      <div className="lvChips">{(form.ignoredRoles||[]).map(id=>{const rr=roles.find(r=>String(r.id)===id)||{};const rc=hexColor(rr.color);return <span key={id} className="lvChip">{rc&&<i className="lvChipDot" style={{background:rc}}/>}<span className="lvChipName">@{rr.name||id}</span>{canConfigure&&<button type="button" aria-label={"Remove "+id} title="Remove" onClick={()=>dropIgnored("roles",id)}><X/></button>}</span>})}</div>
      <small>Members with these roles never earn XP.</small>
     </div>
    </div>
    {locks.ignored&&<UpgradeHint message={locks.ignored} onUpgrade={onUpgrade}/>}
   </div>

   {/* ------------------------------------------- level-up announcements */}
   <div className="lvSubHead"><span className="eyebrow">LEVEL-UP ANNOUNCEMENTS</span></div>
   {/* One compact top section: where to announce + the channel + the inline
       test action. The test ALWAYS uses the already-selected Announcement
       Channel — never a second picker. */}
   <div className="lvAnnRow">
    <div className="lvField"><span>ANNOUNCE WHERE</span>
     {Select&&<Select id="lv-announce-mode" label="Level-up announcement" flip value={form.announceMode} onChange={v=>set("announceMode",v)} options={[{value:"off",label:"Disabled"},{value:"same_channel",label:"Same channel where XP was earned"},{value:"channel",label:"Specific channel…"}]}/>}
     <small>Celebrate every level crossing automatically.</small>
    </div>
    {form.announceMode==="channel"&&<div className="lvField"><span>ANNOUNCEMENT CHANNEL</span>
     {Select&&<Select id="lv-announce-channel" label="Announcement channel" search flip value={form.announceChannelId} onChange={v=>set("announceChannelId",v)} options={[{value:"",label:"Choose a channel…"},...channels.map(c=>({value:String(c.id),label:"#"+c.name}))]}/>}
    </div>}
    <div className="lvField lvTestField"><span>TEST — GRANTS NO XP</span>
     <button type="button" className="lvTestBtn" onClick={sendTestAnnouncement} disabled={busy||!canConfigure}><Send/>{busy?"Sending…":"Send test announcement"}</button>
    </div>
   </div>
   <Notice value={announceNotice}/>
   {locks.announce&&<UpgradeHint message={locks.announce} onUpgrade={onUpgrade}/>}

   {/* ---------------------------------------------------- level-up card */}
   <div className="lvSubHead"><span className="eyebrow">LEVEL-UP CARD</span></div>
   {/* V3.1 — compact TWO-COLUMN card builder: the editor sits LEFT (~50%)
       and the live Discord preview RIGHT (~50%), sticky under the fixed
       Control Center header while the editor scrolls. The preview renders
       through the SAME renderLevelUpCard() payload the worker sends — it
       updates as fields change: no save, no Discord message. */}
   <div className="lvCardBuilder">
   <div className="lvCardEdit">
   <div className="lvCardModes">
    <button type="button" className={"lvModeBtn"+(card.mode!=="custom"?" on":"")} aria-pressed={card.mode!=="custom"} disabled={!canConfigure} onClick={()=>setCardMode("ready")}><b>🏆 Ready-made card</b><small>The polished BalticM default — server name, next reward and placeholders built in.</small></button>
    <button type="button" className={"lvModeBtn"+(card.mode==="custom"?" on":"")} aria-pressed={card.mode==="custom"} disabled={!canConfigure} onClick={()=>setCardMode("custom")}><b>🎨 Custom card{locked&&" 🔒"}</b><small>Design your own title, color, emoji, image and footer.</small></button>
   </div>
   {card.mode==="custom"?(
    <div className="lvCardGroups">
     <div className="lvCardGroup">
      <span className="lvGroupTitle">ANNOUNCEMENT DESIGN</span>
      <div className="lvCardGrid">
       <label className="lvField lvCardWide"><span>EMBED TITLE</span>
        <input value={card.title} maxLength={256} placeholder="🏆 LEVEL UP!" disabled={!canConfigure} onChange={e=>setCard({title:e.target.value})}/></label>
       <label className="lvField"><span>EMOJI — TOP OF CARD</span>
        <input value={card.emoji} maxLength={32} placeholder="🎉" disabled={!canConfigure} onChange={e=>setCard({emoji:e.target.value})}/></label>
       <div className="lvField"><span>ACCENT COLOR</span>
        <div className="lvColorRow">
         <input type="color" aria-label="Embed accent color" value={/^#[0-9a-fA-F]{6}$/.test(card.color)?card.color:"#e8892c"} disabled={!canConfigure} onChange={e=>setCard({color:e.target.value})}/>
         <input value={card.color} maxLength={7} placeholder="#e8892c" disabled={!canConfigure} onChange={e=>{const v=e.target.value;if(v===""||/^#[0-9a-fA-F]{0,6}$/.test(v))setCard({color:v})}}/>
        </div>
        {card.color&&!/^#[0-9a-fA-F]{6}$/.test(card.color)&&<small className="lvFieldError">Use a hex color like #e8892c.</small>}
       </div>
       <label className="lvField lvCardWide"><span>FOOTER TEXT</span>
        <input value={card.footer} maxLength={100} placeholder="Custom footer (optional)" disabled={!canConfigure} onChange={e=>setCard({footer:e.target.value})}/>
        <small>Premium may use any footer — or none. Free servers always show the BalticM footer.</small></label>
       <label className="lvField lvCardWide"><span>DESCRIPTION / MESSAGE</span>
        <textarea ref={descRef} value={card.description} maxLength={600} placeholder="🎉 Congratulations, {user}!" disabled={!canConfigure} onChange={e=>setCard({description:e.target.value})}/>
       </label>
      </div>
     </div>
     <div className="lvCardGroup">
      <span className="lvGroupTitle">PLACEHOLDERS</span>
      <div className="lvPhRow">{ALLOWED_ANNOUNCE_PLACEHOLDERS.map(p=>{const token="{"+p+"}";return <button type="button" key={p} className="lvPhChip" title={"Insert "+token+" at the cursor"} disabled={!canConfigure} onClick={()=>insertPlaceholder(token)}>{token}</button>})}</div>
      <small>Click into the description above, then a placeholder to insert it at the cursor — raw mentions are stripped automatically.</small>
     </div>
     <div className="lvCardGroup">
      <span className="lvGroupTitle">CARD ELEMENTS</span>
      <div className="lvCardToggles">
       <button type="button" className={"lvToggle"+(card.thumbnail?" on":"")} aria-pressed={card.thumbnail} disabled={!canConfigure} onClick={()=>setCard({thumbnail:!card.thumbnail})}><i/>{card.thumbnail?"Member avatar: on":"Member avatar: off"}</button>
       <button type="button" className={"lvToggle"+(card.serverIcon?" on":"")} aria-pressed={card.serverIcon} disabled={!canConfigure} onClick={()=>setCard({serverIcon:!card.serverIcon})}><i/>{card.serverIcon?"Server icon: on":"Server icon: off"}</button>
       <button type="button" className={"lvToggle"+(card.showNextReward?" on":"")} aria-pressed={card.showNextReward} disabled={!canConfigure} onClick={()=>setCard({showNextReward:!card.showNextReward})}><i/>{card.showNextReward?"Next reward: on":"Next reward: off"}</button>
      </div>
     </div>
     <div className="lvCardGroup">
      <span className="lvGroupTitle">OPTIONAL IMAGE</span>
      <label className="lvField">
       <span>IMAGE URL (OPTIONAL)</span>
       <input value={card.image} maxLength={512} placeholder="https://…" disabled={!canConfigure} onChange={e=>setCard({image:e.target.value})}/>
       {card.image&&!/^https:\/\/\S+$/.test(card.image.trim())&&<small className="lvFieldError">Enter a full https:// image URL.</small>}
       <small>Large image at the bottom of the card — only https:// links are accepted.</small>
      </label>
     </div>
    </div>   ):(
    <div className="lvReadyBox">
     <b>🏆 LEVEL UP!</b>
     <span>🎉 Congratulations, {"{user}"}! — the ready-made BalticM card celebrates every level with the amber accent, your server name, the next reward role and instant placeholders.</span>
     <span>Placeholders: {"{user}"} · {"{username}"} · {"{level}"} · {"{server}"}</span>
    </div>
   )}
   {/* ACTIONS: reset (confirmed) and save sit with the editor, so the card
       controls and their feedback stay in one compact left column. */}
   <div className="lvCardActions lvFormActions">
    <button type="button" className="lvGhost" disabled={!canConfigure} onClick={resetCard}>Reset to Default</button>
    <button type="submit" className="lvPrimary" disabled={busy||!canConfigure}>{busy?"Saving…":"Save settings"}</button>
    {!canConfigure&&<span className="lvHint">You need Configure access on Leveling to change these settings.</span>}
   </div>
   <Notice value={settingsNotice}/>
   {locks.settings&&<UpgradeHint message={locks.settings} onUpgrade={onUpgrade}/>}
   </div>
   {/* ----------------------------------- live Discord preview (V3.1) --
       RIGHT column — rendered by the SAME renderLevelUpCard() the worker
       uses for the real payload: literally the embed object that gets sent.
       Sticky on desktop so it stays beside the editor while you scroll. */}
   <div className="lvCardPreviewCol">
   <div className="lvField"><span>DISCORD LIVE PREVIEW — SAMPLE LEVEL 10</span>
    <div className="lvPreview lvPreviewBig" aria-label="Level-up announcement preview">
     <div className="lvPreviewHead"><span>LIVE PREVIEW</span><small>{guildName||"this server"} • announce mode: {form.announceMode==="off"?"disabled":form.announceMode==="channel"?"specific channel":"same channel"}</small></div>
     <div className="lvPreviewMsg">
      <i>{sampleName.slice(0,1).toUpperCase()}</i>
      <div className="lvPreviewBody">
       <b>BalticM <em>BOT</em></b>
       <div className="lvDiscordEmbed" style={{borderLeftColor:"#"+Number(previewEmbed.color||0xe8892c).toString(16).padStart(6,"0")}}>
        {previewEmbed.author&&<span className="lvEmbAuthor">{previewEmbed.author.name}</span>}
        <div className="lvEmbTop">
         <div className="lvEmbMain">
          {previewEmbed.title&&<b className="lvEmbTitle">{previewEmbed.title}</b>}
          {previewDesc&&<p className="lvEmbDesc">{md(previewDesc)}</p>}
          {previewEmbed.footer&&<span className="lvEmbFoot">{previewEmbed.footer.icon_url&&<img src={previewEmbed.footer.icon_url} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>}{previewEmbed.footer.text}</span>}
         </div>
         {previewEmbed.thumbnail&&<img className="lvEmbThumb" src={previewEmbed.thumbnail.url} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>}
        </div>
        {previewEmbed.image&&<img className="lvEmbImage" src={previewEmbed.image.url} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>}
       </div>
      </div>
     </div>
    </div>
    <small className="lvHint">Rendered by the exact same code that sends the real Discord message.</small>
    {!isPremium&&<small className="lvHint">Free servers always include: {ANNOUNCE_BRANDING}</small>}
   </div>
   </div>
   </div>
  </form>

  {/* -------------------------------------------------------- Rewards */}
  <section className="lvPanel">
   <div className="lvPanelHead"><div><span className="eyebrow">REWARD ROLES{locked&&<em> 🔒 Premium beyond 3</em>}</span><h3>Automatic level rewards</h3></div>
    <span className="lvCount">{(state.rewards||[]).length}{locked?" / 3":""}</span>
   </div>
   <p className="lvHint">When a member reaches a level, the bot grants the matching role (validated: role exists, bot has Manage Roles, bot's top role is above it). Granted roles are never removed by leveling.</p>
   {(state.rewards||[]).length?<div className="lvRewards">{(state.rewards||[]).map(r=>{const rc=hexColor((roles.find(x=>String(x.id)===String(r.roleId))||{}).color);return <div className="lvRewardRow" key={r.id}><span className="lvRewardLevel">LEVEL {fmt(r.level)}</span>{rc&&<i className="lvChipDot" style={{background:rc}}/>}<span className="lvRewardRole">@{r.roleName||roleName(r.roleId)}</span>{canConfigure&&<span className="lvRewardBtns"><button type="button" className="lvGhost" aria-label={"Edit Level "+r.level+" reward"} onClick={()=>startEdit(r)}>Edit</button><button type="button" className="lvDanger" onClick={()=>removeReward(r)}>Remove</button></span>}</div>})}</div>:<div className="lvEmpty">No reward roles configured yet — add one below to auto-assign a role when members hit a level.</div>}
   <div className="lvRewardAdd">
    <label className="lvField"><span>LEVEL</span><input type="number" min="1" max="1000" placeholder="5" value={rewardLevel} disabled={!canConfigure} onChange={e=>setRewardLevel(e.target.value)}/></label>
    <div className="lvField"><span>ROLE</span>
     {Select&&<Select id="lv-reward-role" label="Reward role" search flip value={rewardRoleId} onChange={v=>{if(locked&&(state.rewards||[]).length>=3){lock("rewards","Free servers can configure up to 3 reward roles. Premium unlocks unlimited reward roles.");return}setRewardRoleId(v)}} options={[{value:"",label:"Choose a role…"},...rewardOptions.map(r=>({value:String(r.id),label:"@"+r.name,color:hexColor(r.color)}))]}/>}
    </div>
    <div className="lvRewardAddBtns">
     <button type="button" className="lvPrimary lvAddReward" onClick={editingId?updateReward:addReward} disabled={busy||!canConfigure}>{editingId?<>Update reward</>:<><Plus/>Add reward</>}</button>
     {editingId&&<button type="button" className="lvGhost" onClick={cancelEdit}>Cancel</button>}
    </div>
   </div>
   {editingId&&<small className="lvHint">Editing the Level {rewardLevel||"…"} reward — change the level or role, then Update. Nothing changes until you confirm.</small>}
   <Notice value={rewardNotice}/>
   {locks.rewards&&<UpgradeHint message={locks.rewards} onUpgrade={onUpgrade}/>}
  </section>

  {/* ---------------------------------------------------- Leaderboard */}
  <section className="lvPanel">
   <div className="lvPanelHead"><div><span className="eyebrow">LEADERBOARD</span><h3>Top members</h3></div>
    <form className="lvSearch" onSubmit={e=>{e.preventDefault();loadBoard(boardQ)}}><Search/><input value={boardQ} onChange={e=>setBoardQ(e.target.value)} placeholder="Search members…" aria-label="Search leaderboard"/>{boardQ&&<button type="button" className="lvSearchClear" aria-label="Clear search" onClick={()=>{setBoardQ("");loadBoard("")}}><X/></button>}</form>
   </div>
   <div className="lvBoard" role="table" aria-label="Leveling leaderboard">
    <div className="lvBoardRow lvBoardHead" role="row"><span>#</span><span>MEMBER</span><span>LEVEL</span><span>TOTAL XP</span><span>MESSAGE XP</span><span>VOICE XP</span></div>
    {board.length?board.map(m=><div className="lvBoardRow" role="row" key={m.userId}>
     <span className="lvPos">{m.position<=3?["🥇","🥈","🥉"][m.position-1]:m.position}</span>
     <span className="lvMember"><i>{m.avatar?<img src={m.avatar} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>:(m.displayName||"?").slice(0,1).toUpperCase()}</i><b>{m.displayName}</b></span>
     <span data-label="Level"><b>{fmt(m.level)}</b></span>
     <span data-label="Total XP">{fmt(m.totalXp)}</span>
     <span data-label="Message XP">{fmt(m.messageXp)}</span>
     <span data-label="Voice XP">{fmt(m.voiceXp)}</span>
    </div>):<div className="lvEmpty">{boardBusy?"Loading…":boardQ?"No members match that search.":"No XP has been awarded yet."}</div>}
    <div className="lvBoardFoot">{board.length} of {fmt(boardTotal)} ranked member{boardTotal===1?"":"s"}</div>
   </div>
  </section>

  {/* ----------------------------------------------------- Admin XP */}
  {canConfigure&&<section className="lvPanel">
   <div className="lvPanelHead"><div><span className="eyebrow">ADMIN XP</span><h3>Manage a member's XP</h3></div></div>
   <p className="lvHint">Add, remove, set or reset XP. Every change is recorded in Logs with the member, staff member, previous and new XP.</p>
   <div className="lvAdmin">
    <div className="lvField"><span>FIND MEMBER</span>
     <div className="lvSearch"><Search/><input value={memberQuery} onChange={e=>{setMemberQuery(e.target.value);setPicked(null);setXpNotice(null)}} placeholder="Search name or username…" aria-label="Search members"/></div>
     {memberResults.length>0&&<div className="lvMemberResults">{memberResults.map(m=><button type="button" key={m.id} className={picked&&picked.id===m.id?"selected":""} onClick={()=>{setPicked(m);setMemberQuery("");setXpNotice(null)}}>{avatarSrc(m)?<span className="lvResultAvatar"><img src={avatarSrc(m)} alt="" onError={e=>{e.currentTarget.style.display="none"}}/></span>:<span>{(m.globalName||m.username||"?").slice(0,1).toUpperCase()}</span>}<b>{m.globalName||m.username}</b><small>@{m.username}</small></button>)}</div>}
     {memberQuery.trim()&&!memberResults.length&&<div className="lvMemberNo">No members match “{memberQuery.trim()}”.</div>}
    </div>
    {picked&&<div className="lvPicked"><b>{picked.globalName||picked.username}</b><small>@{picked.username}</small></div>}
   </div>
   {picked&&<>
    <div className="lvAdminActions">
     <label className="lvField"><span>XP AMOUNT</span><input type="number" min="1" max="1000000" placeholder="100" value={xpAmount} onChange={e=>{setXpAmount(e.target.value);setXpNotice(null)}}/></label>
     <label className="lvField"><span>REASON (OPTIONAL)</span><input value={xpReason} maxLength={120} placeholder="Why is this changing?" onChange={e=>{setXpReason(e.target.value);setXpNotice(null)}}/></label>
     <div className="lvAdminButtons">
      <button type="button" className="lvPrimary" disabled={busy} onClick={()=>runXpAction("add",picked)}>Add XP</button>
      <button type="button" disabled={busy} onClick={()=>runXpAction("remove",picked)}>Remove XP</button>
      <button type="button" disabled={busy} onClick={()=>runXpAction("set",picked)}>Set XP</button>
      <button type="button" className="lvDanger" disabled={busy} onClick={()=>runXpAction("reset",picked)}>Reset XP</button>
     </div>
    </div>
    {/* Admin XP feedback lives HERE — right under the buttons, never at the
        top of the page, and the scroll position never moves. */}
    <Notice value={xpNotice}/>
   </>}
  </section>}
 </div>;
}
