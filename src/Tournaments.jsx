import React,{useEffect,useMemo,useState}from"react";
import {Calendar,ChevronLeft,Clock3,Crown,ExternalLink,Loader2,Plus,RefreshCw,Search,Settings2,ShieldCheck,Trophy,UserPlus,Users,X}from"lucide-react";
import TournamentBracket from"./TournamentBracket.jsx";
import {announceChannelOptions}from"../tournaments.js";
import"./tournaments.css";

/* Control Center → Tournaments (guild scoped). Every request carries the
   selected guild id; the worker validates session, membership and RBAC. */

const STATUSES=["ALL","DRAFT","REGISTRATION","UPCOMING","LIVE","FINISHED"];
const MAX_OPTIONS=[4,8,16,32];
const emptyForm={name:"",game:"",description:"",bannerUrl:"",participantType:"individuals",maxParticipants:"8",startAt:"",registrationOpen:true,registrationDeadline:"",publicRegistration:false,announceChannelId:""};

const humanError=(status,raw)=>{
 if(status===403)return"You do not have permission to do that.";
 if(status===401)return"Your session has expired. Please sign in again.";
 if(status===404)return"That tournament could not be found.";
 if(status===409)return String(raw||"That action conflicts with the current tournament state.");
 if(status===429)return"Too many requests. Please wait a moment and try again.";
 const text=typeof raw==="string"?raw.trim():"";
 if(status>=500)return"The server could not complete that request. Please try again.";
 if(text&&text!=="Forbidden"&&text!=="[object Object]"&&!/^\d{3}$/.test(text))return text;
 return"Request could not be completed. Please try again.";
};
async function api(url,options){
 const r=await fetch(url,{cache:"no-store",...options});
 const data=await r.json().catch(()=>({}));
 if(!r.ok){
  if(data&&data.code==="premium_required"){const e=new Error(data.error||"This requires an active Premium subscription for this server.");e.premiumRequired=true;throw e}
  throw new Error(humanError(r.status,data&&data.error));
 }
 return data;
}
const when=v=>{try{const d=new Date(v);if(Number.isNaN(d.getTime()))return v||"Date TBA";return d.toLocaleString()}catch{return v||"Date TBA"}};

/* Native fallback for the shared TicketOptionSelect (never used in production,
   but the channel selector must keep working even without the shared widget). */
function ChanSelectFallback({label,value,onChange,options,disabled}){
 return <select aria-label={label} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}
const localInput=v=>{if(!v)return"";try{const d=new Date(v);if(Number.isNaN(d.getTime()))return"";const p=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`}catch{return""}};
function Notice({value}){return value?<div className={"tNotice "+(value.ok?"ok":"error")} role={value.ok?"status":"alert"}>{value.text}</div>:null}
function StatusPill({status}){return <span className={"tPill "+String(status||"").toLowerCase()}>{status||"—"}</span>}

function Field({label,hint,children}){return <label className="tField"><span>{label}</span>{children}{hint?<small>{hint}</small>:null}</label>}

/* Small image preview for a pasted logo URL: https-only, graceful when the
   remote image is broken (never breaks the form or layout). */
function LogoPreview({url}){
 const v=String(url||"").trim();
 const[failed,setFailed]=useState(false);
 useEffect(()=>{setFailed(false)},[v]);
 if(!v)return null;
 if(!/^https:\/\/\S+$/i.test(v))return <small className="tLogoHint">Logo must be a direct https:// image URL.</small>;
 if(failed)return <small className="tLogoHint">That image could not be loaded — it will be hidden on the page.</small>;
 return <span className="tLogoPreview"><img src={v} alt="" onError={()=>setFailed(true)}/><em>Preview</em></span>;
}

/* Guild Tournament branding (public-page header identity). Premium
   authorization is enforced server-side — this UI only reflects it. */
function BrandingSection({guildId,canConfigure}){
 const[brand,setBrand]=useState(null),[form,setForm]=useState({name:"",logoUrl:""});
 const[busy,setBusy]=useState(false),[notice,setNotice]=useState(null),[failedLogos,setFailedLogos]=useState(()=>new Set());
 const load=()=>api(`/api/tournaments/branding?guildId=${encodeURIComponent(guildId)}`).then(j=>{setBrand(j);setForm({name:j.branding?.name||"",logoUrl:j.branding?.logoUrl||""});setFailedLogos(new Set())}).catch(e=>setNotice({ok:false,text:e.message}));
 useEffect(()=>{setBrand(null);setNotice(null);if(guildId)load()},[guildId]);
 if(!brand)return null;
 const premium=!!brand.premium,active=!!brand.active;
 const name=form.name.trim(),logo=form.logoUrl.trim();
 const save=async payload=>{
  setBusy(true);setNotice(null);
  try{
   const body=payload!==undefined?payload:{name,logoUrl:logo};
   if(body.name&&body.name.length>48)throw new Error("Branding name must be 48 characters or fewer.");
   if(body.logoUrl&&!/^https:\/\/\S+$/i.test(body.logoUrl))throw new Error("Logo must be a direct https:// image URL.");
   const j=await api(`/api/tournaments/branding?guildId=${encodeURIComponent(guildId)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   setBrand(x=>({...x,branding:j.branding,active:j.active,premium:j.premium!==false}));
   setForm({name:j.branding?.name||"",logoUrl:j.branding?.logoUrl||""});
   setNotice({ok:true,text:j.active?"Branding saved — it is live on your public Tournament pages.":j.branding?.name?"Saved. Public pages use standard BalticM branding until Premium is active.":"Standard BalticM branding restored."});
  }catch(e){setNotice({ok:false,text:e.message})}finally{setBusy(false)}
 };
 const previewName=premium?name:"";
 // Preview mirrors the public header: premium custom logo → active Discord
 // guild icon → BalticM gradient. A broken image falls through the chain.
 const customLogo=premium&&name?logo:"";
 const guildLogo=(brand.resolved&&brand.resolved.logoUrl)||"";
 const candidates=[...new Set([customLogo,guildLogo].filter(Boolean))];
 const previewLogo=candidates.find(u=>!failedLogos.has(u))||"";
 return <section className="tPanel tBrandPanel">
  <div className="tPanelHead"><div><small>TOURNAMENT BRANDING</small><h3>Tournament branding</h3></div>
   {!premium&&<span className="tBrandBadge"><Crown/>Premium</span>}</div>
  <p className="tHint">{premium?<>Sets the name and logo shown in the header of this server's public Tournament pages. The footer always keeps BalticM attribution.</>:<>Free servers use the standard BalticM branding on public Tournament pages. Custom name and logo are a Premium feature for this server.</>}</p>
  <div className="tBrandGrid">
   <div className="tBrandPreviewBlock">
    <span className="tBrandPreviewLabel">PUBLIC PAGE HEADER PREVIEW</span>
    <div className="tBrandPreview">
     {previewLogo?<img className="tBrandMark" src={previewLogo} alt="" onError={()=>setFailedLogos(s=>new Set(s).add(previewLogo))}/>:<span className="tBrandMark"/>}
     <span className="tBrandPreviewText"><b>{previewName||"BALTICM"}</b><small>TOURNAMENTS</small></span>
    </div>
    {!premium&&brand.branding?.name&&<small className="tBrandExpired">Your saved configuration ("{brand.branding.name}") is kept — public pages fall back to BalticM branding while Premium is inactive.</small>}
    {!premium&&!brand.branding?.name&&<small className="tBrandLocked"><Crown/> Unlock a custom name and logo with Premium for this server.</small>}
   </div>
   <div className="tBrandForm">
    {notice&&<Notice value={notice}/>} 
    <Field label="BRANDING NAME" hint="Shown instead of BALTICM in the public header. Up to 48 characters.">
     <input value={form.name} maxLength={48} disabled={!premium||!canConfigure} placeholder="BALTICM" onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
    </Field>
    <Field label="LOGO URL (OPTIONAL)" hint="Direct https:// image URL (for example uploaded to Imgur). Falls back to the standard logo if broken.">
     <input value={form.logoUrl} maxLength={300} disabled={!premium||!canConfigure} placeholder="https://…" onChange={e=>setForm(f=>({...f,logoUrl:e.target.value}))}/>
    </Field>
    <LogoPreview url={previewLogo}/>
    {premium&&<div className="tBrandActions">
     <button type="button" className="primary" disabled={busy||!canConfigure||(active&&!name&&!logo)||(!name&&!!logo)} onClick={()=>save()}>{busy?"Saving…":"Save branding"}</button>
     {active&&<button type="button" disabled={busy||!canConfigure} onClick={()=>save({name:"",logoUrl:""})}>Reset to standard</button>}
    </div>}
    {premium&&!canConfigure&&<p className="tHint">You need Configure access on Tournaments to change branding.</p>}
   </div>
  </div>
 </section>;
}

function CreateTournament({guildId,onClose,onCreated,channels,channelsFailed,Select,premium,onUpgrade}){
 const[form,setForm]=useState(()=>premium?emptyForm:{...emptyForm,maxParticipants:"4"}),[busy,setBusy]=useState(false),[error,setError]=useState(""),[lockMsg,setLockMsg]=useState("");
 useEffect(()=>{setLockMsg("")},[premium]);
 const set=(k,v)=>setForm(f=>({...f,[k]:v}));
 /* Free servers: locked Premium options never silently change the value —
    they show the existing upgrade CTA instead (server enforces it too). */
 const lockTeam=()=>setLockMsg("Team tournaments are a Premium feature for this server. Upgrade to Premium to run team tournaments.");
 const lockMax=()=>setLockMsg("8, 16 and 32 participant tournaments are a Premium feature for this server. Upgrade to Premium to raise the participant limit.");
 const submit=async e=>{
  e.preventDefault();setBusy(true);setError("");
  try{
   const payload={
    name:form.name.trim(),game:form.game.trim(),description:form.description.trim(),bannerUrl:form.bannerUrl.trim(),
    format:"single_elimination",participantType:form.participantType,maxParticipants:Number(form.maxParticipants),
    startAt:form.startAt?new Date(form.startAt).toISOString():"",
    registrationOpen:!!form.registrationOpen,
    registrationDeadline:form.registrationDeadline?new Date(form.registrationDeadline).toISOString():"",
    publicRegistration:!!form.publicRegistration,
    announceChannelId:form.announceChannelId.trim()
   };
   const data=await api(`/api/tournaments?guildId=${encodeURIComponent(guildId)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   onCreated(data.tournament);
  }catch(e){if(e.premiumRequired){setError("");setLockMsg(e.message)}else setError(e.message)}finally{setBusy(false)}
 };
 return <div className="tModalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <form className="tModal" onSubmit={submit}>
   <header><div><span className="tModalIcon"><Trophy/></span><div><small>NEW TOURNAMENT</small><h3>Create tournament</h3></div></div><button type="button" className="tClose" aria-label="Close" onClick={onClose}><X/></button></header>
   <div className="tModalBody">
    <Notice value={error?{text:error}:null}/>
    {lockMsg&&<div className="tBrandLocked tPlanLock" role="status"><Crown/><span>{lockMsg}</span><button type="button" className="tBtn" onClick={()=>{if(onUpgrade)onUpgrade()}}>View Premium plans</button></div>}
    <Field label="TOURNAMENT NAME"><input value={form.name} maxLength={80} required placeholder="BalticM Summer Cup" onChange={e=>set("name",e.target.value)}/></Field>
    <Field label="GAME"><input value={form.game} maxLength={80} required placeholder="Counter-Strike 2" onChange={e=>set("game",e.target.value)}/></Field>
    <Field label="DESCRIPTION (OPTIONAL)"><textarea rows={3} maxLength={1000} value={form.description} onChange={e=>set("description",e.target.value)}/></Field>
    <Field label="BANNER / IMAGE URL (OPTIONAL)" hint="https:// links only."><input type="url" value={form.bannerUrl} placeholder="https://…" onChange={e=>set("bannerUrl",e.target.value)}/></Field>
    <div className="tFormRow">
     <Field label="FORMAT"><input value="Single Elimination" readOnly/></Field>
     <Field label="PARTICIPANT TYPE"><Select id="t-create-participant-type" label="Participant type" flip value={form.participantType} onChange={v=>{if(!premium&&v==="teams"){lockTeam();return}set("participantType",v)}} options={[{value:"individuals",label:"Individual players"},{value:"teams",label:"Teams"}]} locked={premium?[]:["teams"]} onLocked={lockTeam}/></Field>
    </div>
    <div className="tFormRow">
     <Field label="MAXIMUM PARTICIPANTS"><Select id="t-create-max-participants" label="Maximum participants" flip value={form.maxParticipants} onChange={v=>{if(!premium&&Number(v)>4){lockMax();return}set("maxParticipants",v)}} options={MAX_OPTIONS.map(n=>({value:String(n),label:String(n)}))} locked={premium?[]:["8","16","32"]} onLocked={lockMax}/></Field>
     <Field label="START DATE / TIME"><input type="datetime-local" required value={form.startAt} onChange={e=>set("startAt",e.target.value)}/></Field>
    </div>
    <div className="tFormRow">
     <Field label="REGISTRATION DEADLINE (OPTIONAL)"><input type="datetime-local" value={localInput(form.registrationDeadline)||form.registrationDeadline} onChange={e=>set("registrationDeadline",e.target.value)}/></Field>
     <div className="tField"><span>ANNOUNCEMENT CHANNEL (OPTIONAL)</span><Select id="t-create-channel" label="Announcement channel" search flip value={form.announceChannelId} onChange={v=>set("announceChannelId",v)} options={announceChannelOptions(channels,form.announceChannelId)}/><small>{channelsFailed?"Channels could not be loaded — the saved selection is kept.":"Where lifecycle announcements are posted. Announcements only fire on explicit actions."}</small></div>
    </div>
    <div className="tToggles">
     <button type="button" className={"tToggle"+(form.registrationOpen?" on":"")} aria-pressed={form.registrationOpen} onClick={()=>set("registrationOpen",!form.registrationOpen)}><i/>Registration enabled</button>
     <button type="button" className={"tToggle"+(form.publicRegistration?" on":"")} aria-pressed={form.publicRegistration} onClick={()=>set("publicRegistration",!form.publicRegistration)}><i/>Public registration enabled</button>
    </div>
   </div>
   <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={busy||!form.name.trim()||!form.game.trim()}>{busy?"Creating…":"Create tournament"}</button></footer>
  </form>
 </div>;
}

function ParticipantEditor({guildId,tournament,participants,onChanged,notice,setNotice}){
 const teams=tournament.participantType==="teams";
 const[busy,setBusy]=useState(false);
 const[editing,setEditing]=useState(null); // {id?,name,logoUrl,captainName,members:[{displayName,discordId}]}
 const open=p=>setEditing(p?{id:p.id,name:p.name,logoUrl:p.logoUrl||"",captainName:p.captainName||"",members:(p.members||[]).map(m=>({displayName:m.displayName||"",discordId:m.discordId||""}))}:{id:"",name:"",logoUrl:"",captainName:"",members:[]});
 const setMember=(i,k,v)=>setEditing(x=>({...x,members:x.members.map((m,idx)=>idx===i?{...m,[k]:v}:m)}));
 const addMember=()=>setEditing(x=>({...x,members:[...x.members,{displayName:"",discordId:""}]}));
 const dropMember=i=>setEditing(x=>({...x,members:x.members.filter((_,idx)=>idx!==i)}));
 const save=async e=>{
  e.preventDefault();if(!editing)return;setBusy(true);setNotice(null);
  const base=`/api/tournaments/${encodeURIComponent(tournament.id)}/participants${editing.id?"/"+encodeURIComponent(editing.id):""}?guildId=${encodeURIComponent(guildId)}`;
  const members=editing.members.filter(m=>m.displayName.trim()||m.discordId.trim()).map(m=>({displayName:m.displayName.trim(),discordId:m.discordId.trim()}));
  const payload=teams
   ?{teamName:editing.name.trim(),logoUrl:editing.logoUrl.trim(),captainName:editing.captainName.trim(),members}
   :{name:editing.name.trim()};
  try{
   await api(base,{method:editing.id?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   setEditing(null);setNotice({ok:true,text:editing.id?(teams?"Team updated.":"Participant updated."):(teams?"Team added.":"Participant added.")});onChanged();
  }catch(err){setNotice({ok:false,text:err.message})}finally{setBusy(false)}
 };
 const remove=async p=>{
  if(!window.confirm(`Remove ${teams?"team ":""}${p.name} from this tournament?`))return;
  setBusy(true);setNotice(null);
  try{await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/participants/${encodeURIComponent(p.id)}?guildId=${encodeURIComponent(guildId)}`,{method:"DELETE"});setNotice({ok:true,text:teams?"Team removed.":"Participant removed."});onChanged()}
  catch(err){setNotice({ok:false,text:err.message})}finally{setBusy(false)}
 };
 const move=async order=>{
  setBusy(true);setNotice(null);
  try{await api(`/api/tournaments/${encodeURIComponent(tournament.id)}/seeds?guildId=${encodeURIComponent(guildId)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({order})});onChanged()}
  catch(err){setNotice({ok:false,text:err.message})}finally{setBusy(false)}
 };
 const reorder=(index,dir)=>{
  const ids=participants.map(p=>p.id),next=[...ids],to=index+dir;
  if(to<0||to>=next.length)return;
  [next[index],next[to]]=[next[to],next[index]];
  move(next);
 };
 const hasBracket=(tournament.rounds||0)>0;
 return <section className="tPanel">
  <div className="tPanelHead"><div><small>{teams?"TEAMS & SEEDING":"SEEDING"}</small><h3>{teams?"Teams":"Participants"} <span>{participants.length} / {tournament.maxParticipants}</span></h3></div>
   <button type="button" className="primary" disabled={busy||participants.length>=tournament.maxParticipants} onClick={()=>open(null)}><UserPlus/>{teams?"Add team":"Add participant"}</button></div>
  <Notice value={notice}/>
  {hasBracket&&<p className="tHint">A bracket exists — remove or reseed {teams?"teams":"participants"}, then regenerate the bracket.</p>}
  {editing&&<form className="tPartForm" onSubmit={save}>
   <Field label={teams?"TEAM NAME":"PARTICIPANT NAME"}><input value={editing.name} maxLength={80} required onChange={e=>setEditing(x=>({...x,name:e.target.value}))}/></Field>
   {teams&&<>
    <Field label="TEAM LOGO URL (OPTIONAL)" hint="Upload your team logo to Imgur and paste the direct image URL here. Optional — https:// links only."><input value={editing.logoUrl} maxLength={300} placeholder="https://…" onChange={e=>setEditing(x=>({...x,logoUrl:e.target.value}))}/></Field>
    <LogoPreview url={editing.logoUrl}/>
    <Field label="CAPTAIN NAME (OPTIONAL)"><input value={editing.captainName} maxLength={80} onChange={e=>setEditing(x=>({...x,captainName:e.target.value}))}/></Field>
    <div className="tMembersEdit">
     <span className="tMembersLabel">TEAM MEMBERS (OPTIONAL)</span>
     {editing.members.map((m,i)=><div className="tMemberRow" key={i}>
      <input value={m.displayName} maxLength={80} placeholder="Display name" aria-label={`Member ${i+1} display name`} onChange={e=>setMember(i,"displayName",e.target.value)}/>
      <input value={m.discordId} maxLength={22} inputMode="numeric" placeholder="Discord ID (optional)" aria-label={`Member ${i+1} Discord ID`} onChange={e=>setMember(i,"discordId",e.target.value.replace(/[^0-9]/g,""))}/>
      <button type="button" aria-label={`Remove member ${i+1}`} onClick={()=>dropMember(i)}><X/></button>
     </div>)}
     <button type="button" className="tMemberAdd" onClick={addMember}><UserPlus/>Add member</button>
    </div>
   </>}
   <div className="tPartFormActions"><button type="button" onClick={()=>setEditing(null)}>Cancel</button><button type="submit" className="primary" disabled={busy||!editing.name.trim()}>{busy?"Saving…":editing.id?"Save changes":teams?"Add team":"Add participant"}</button></div>
  </form>}
  {participants.length?<ol className="tPartList">{participants.map((p,i)=><li key={p.id}>
    <span className="tSeed">#{i+1}</span>
    <span className="tPartName"><b>{teams&&p.logoUrl?<img className="tPartLogo" src={p.logoUrl} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>:null}{p.name}</b>{p.captainName?<small>Captain {p.captainName}</small>:null}{p.members?.length?<small>{p.members.map(m=>m.displayName||m.discordId).filter(Boolean).join(" • ")}</small>:null}{p.source==="public"?<i className="tSource">registered</i>:null}</span>
    <span className="tPartActions">
     <button type="button" aria-label={`Move ${p.name} up`} disabled={busy||i===0} onClick={()=>reorder(i,-1)}>↑</button>
     <button type="button" aria-label={`Move ${p.name} down`} disabled={busy||i===participants.length-1} onClick={()=>reorder(i,1)}>↓</button>
     <button type="button" disabled={busy} onClick={()=>open(p)}>Edit</button>
     <button type="button" className="danger" disabled={busy} onClick={()=>remove(p)}>Remove</button>
    </span>
   </li>)}</ol>:<div className="tEmpty"><Users/><b>{teams?"No teams yet":"No participants yet"}</b><span>{teams?"Add teams manually, or open public team registration.":"Add players manually, or open public registration."}</span></div>}
 </section>;
}

function DetailView({guildId,tournament,onBack,onChanged,canConfigure,channels,channelsFailed,Select}){
 const[id,setId]=useState(tournament.id);
 const[data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const[busyKey,setBusyKey]=useState(""),[notice,setNotice]=useState(null);
 const[settings,setSettings]=useState({registrationOpen:tournament.registrationOpen,publicRegistration:tournament.publicRegistration,announceChannelId:tournament.announceChannelId||"",registrationDeadline:localInput(tournament.registrationDeadline)});
 const load=async tid=>{setLoading(true);setError("");try{const j=await api(`/api/tournaments/${encodeURIComponent(tid)}?guildId=${encodeURIComponent(guildId)}`);setData(j);setSettings(s=>({...s,registrationOpen:j.tournament.registrationOpen,publicRegistration:j.tournament.publicRegistration,announceChannelId:j.tournament.announceChannelId||"",registrationDeadline:localInput(j.tournament.registrationDeadline)||s.registrationDeadline}))}catch(e){setError(e.message)}finally{setLoading(false)}};
 useEffect(()=>{load(id)},[id,guildId]);
 if(loading)return <div className="tState"><Loader2 className="spin"/><b>Loading tournament…</b></div>;
 if(error)return <div className="tState"><X/><b>Could not load this tournament</b><span>{error}</span><button type="button" onClick={()=>load(id)}>Try again</button></div>;

 const t=data.tournament,participants=data.participants||[],matches=data.matches||[],names=data.names||{};
 const bracketed=(data.roundLabels||[]).length>0;
 const act=async(label,key,fn)=>{
  setBusyKey(key||"__");setNotice(null);
  try{await fn();if(label)setNotice({ok:true,text:label});await load(id);onChanged()}
  catch(e){setNotice({ok:false,text:e.message})}finally{setBusyKey("")}
 };
 const transition=status=>act(`Status set to ${status}.`,"status",()=>api(`/api/tournaments/${encodeURIComponent(id)}/status?guildId=${encodeURIComponent(guildId)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})}));
 const saveSettings=e=>{
  e.preventDefault();
  act("Settings saved.","settings",()=>api(`/api/tournaments/${encodeURIComponent(id)}?guildId=${encodeURIComponent(guildId)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({
   registrationOpen:settings.registrationOpen,publicRegistration:settings.publicRegistration,
   announceChannelId:settings.announceChannelId.trim(),
   registrationDeadline:settings.registrationDeadline?new Date(settings.registrationDeadline).toISOString():""
  })}));
 };
 const generate=()=>{if(!window.confirm("Generate the bracket from the current seeding?"))return;act("Bracket generated.","bracket",()=>api(`/api/tournaments/${encodeURIComponent(id)}/bracket?guildId=${encodeURIComponent(guildId)}`,{method:"POST"}))};
 const submitResult=(m,result)=>act("Result saved.","m-"+m.roundIndex+"-"+m.slotIndex,()=>api(`/api/tournaments/${encodeURIComponent(id)}/matches/${m.roundIndex}-${m.slotIndex}?guildId=${encodeURIComponent(guildId)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(result)}));
 const removeTournament=async()=>{
  if(!window.confirm(`Delete "${t.name}"? This removes its participants, bracket and results permanently.`))return;
  await act("","",()=>api(`/api/tournaments/${encodeURIComponent(id)}?guildId=${encodeURIComponent(guildId)}`,{method:"DELETE"}));
  onBack();
 };
 const nextStatus={DRAFT:["REGISTRATION","UPCOMING"],REGISTRATION:["UPCOMING"],UPCOMING:["LIVE"],LIVE:[],FINISHED:[]}[t.status]||[];
 const championParticipant=participants.find(p=>p.id===t.championId);
 const championRoster=championParticipant?(championParticipant.members||[]).map(m=>m.displayName||m.discordId).filter(Boolean):[];
 const championLogo=championParticipant&&championParticipant.logoUrl?championParticipant.logoUrl:"";

 return <div className="tDetail">
  <div className="tDetailHead">
   <button type="button" className="tBack" onClick={onBack}><ChevronLeft/>All tournaments</button>
   <div className="tDetailTitle">
    <div><span className="tDetailIcon"><Trophy/></span><div><small>{t.game}</small><h2>{t.name}</h2><p>{t.format==="single_elimination"?"Single Elimination":t.format} • {t.participantType==="teams"?"Teams":"Individual players"} • {when(t.startAt)}</p></div></div>
    <div className="tDetailStatus"><StatusPill status={t.status}/><span>{participants.length} / {t.maxParticipants} participants</span></div>
   </div>
   <div className="tDetailActions">
    <a className="tBtn" href={`/tournaments/${encodeURIComponent(t.publicSlug)}`} target="_blank" rel="noreferrer"><ExternalLink/>Public page</a>
    {canConfigure&&nextStatus.map(s=><button key={s} type="button" disabled={busyKey==="status"} onClick={()=>transition(s)}>{s==="LIVE"?"Start tournament":s==="REGISTRATION"?"Open registration":"Move to "+s}</button>)}
    {canConfigure&&<button type="button" className="danger" disabled={busyKey==="__"} onClick={removeTournament}>Delete</button>}
   </div>
  </div>
  <Notice value={notice}/>

  <div className="tDetailGrid">
   <ParticipantEditor guildId={guildId} tournament={t} participants={participants} notice={notice} setNotice={setNotice} onChanged={()=>load(id)}/>
   <section className="tPanel">
    <div className="tPanelHead"><div><small>SETTINGS</small><h3>Registration & announcements</h3></div></div>
    <form className="tSettings" onSubmit={saveSettings}>
     <div className="tToggles">
      <button type="button" className={"tToggle"+(settings.registrationOpen?" on":"")} aria-pressed={settings.registrationOpen} onClick={()=>setSettings(s=>({...s,registrationOpen:!s.registrationOpen}))}><i/>Registration enabled</button>
      <button type="button" className={"tToggle"+(settings.publicRegistration?" on":"")} aria-pressed={settings.publicRegistration} onClick={()=>setSettings(s=>({...s,publicRegistration:!s.publicRegistration}))}><i/>Public registration</button>
     </div>
     <Field label="REGISTRATION DEADLINE (OPTIONAL)"><input type="datetime-local" value={settings.registrationDeadline} onChange={e=>setSettings(s=>({...s,registrationDeadline:e.target.value}))}/></Field>
     <div className="tField"><span>ANNOUNCEMENT CHANNEL (OPTIONAL)</span><Select id="t-settings-channel" label="Announcement channel" search flip value={settings.announceChannelId} onChange={v=>setSettings(s=>({...s,announceChannelId:v}))} options={announceChannelOptions(channels,settings.announceChannelId)}/><small>{channelsFailed?"Channels could not be loaded — the saved selection is kept.":"Where lifecycle announcements are posted. Announcements only fire on explicit actions."}</small></div>
     <p className="tHint"><ShieldCheck/>Announcements are only sent by explicit actions: create, open registration, start, recorded results and the champion — never on page load.</p>
     <button type="submit" className="primary" disabled={busyKey==="settings"}>{busyKey==="settings"?"Saving…":"Save settings"}</button>
    </form>
   </section>
  </div>

  <section className="tPanel tBracketPanel">
   <div className="tPanelHead"><div><small>BRACKET</small><h3>{bracketed?(data.roundLabels[data.roundLabels.length-1]==="Final"?"Single elimination bracket":"Bracket"):"Bracket not generated"}</h3></div>
    {canConfigure&&<button type="button" className="primary" disabled={busyKey==="bracket"||participants.length<2} onClick={generate}><RefreshCw/>{bracketed?"Regenerate bracket":"Generate bracket"}</button>}</div>
   {bracketed
    ?<TournamentBracket roundLabels={data.roundLabels} matches={matches} names={names} championId={t.championId} championRoster={championRoster} championLogo={championLogo} canEdit={canConfigure&&t.status!=="FINISHED"} busyKey={busyKey.startsWith("m-")?busyKey.slice(2):""} onResult={submitResult}/>
    :<div className="tEmpty"><Trophy/><b>No bracket yet</b><span>Seed at least 2 participants, then generate the single-elimination bracket.</span></div>}
   {t.championId?<div className="tChampionBanner">{championLogo?<img className="tChampLogo" src={championLogo} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>:<Trophy/>}<div><small>CHAMPION</small><b>{names[t.championId]||t.championId}</b>{championRoster.length?<span className="tChampRoster">{championRoster.join(" • ")}</span>:null}</div></div>:null}
  </section>
 </div>;
}

export default function Tournaments({user,selectedGuild,canConfigure,TicketOptionSelect,premium,onUpgrade}){
 const[items,setItems]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const[query,setQuery]=useState(""),[status,setStatus]=useState("ALL");
 const[creating,setCreating]=useState(false),[openId,setOpenId]=useState(""),[reload,setReload]=useState(0);
 const[channels,setChannels]=useState([]),[channelsFailed,setChannelsFailed]=useState(false);
 const Select=TicketOptionSelect||ChanSelectFallback;
 useEffect(()=>{setChannels([]);setChannelsFailed(false);if(!selectedGuild)return;fetch(`/api/discord/guild?guildId=${encodeURIComponent(selectedGuild)}`,{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject(new Error("channels"))).then(j=>setChannels(Array.isArray(j.channels)?j.channels:[])).catch(()=>setChannelsFailed(true))},[selectedGuild]);

 const load=()=>{
  if(!selectedGuild)return;
  setLoading(true);setError("");
  const qs=new URLSearchParams({guildId:selectedGuild,q:query,status});
  api("/api/tournaments?"+qs.toString()).then(j=>setItems(j.tournaments||[])).catch(e=>setError(e.message)).finally(()=>setLoading(false));
 };
 useEffect(()=>{setOpenId("")},[selectedGuild]);
 useEffect(()=>{load()},[selectedGuild,reload]);

 const filtered=useMemo(()=>items.filter(t=>{
  const needle=query.trim().toLowerCase();
  const byText=!needle||(t.name+" "+t.game).toLowerCase().includes(needle);
  const byStatus=status==="ALL"||t.status===status;
  return byText&&byStatus;
 }),[items,query,status]);

 if(!user)return <div className="tState"><Users/><b>Discord login required</b><span>Connect your Discord account to manage tournaments.</span><a className="login" href="/api/auth/login">Login with Discord</a></div>;
 if(!selectedGuild)return <div className="tState"><Users/><b>Select a Discord server</b><span>Tournaments are managed per server — pick one from the Servers page first.</span></div>;

 if(openId){
  const t=items.find(x=>x.id===openId);
  if(t)return <DetailView guildId={selectedGuild} tournament={t} canConfigure={canConfigure} onChanged={()=>setReload(r=>r+1)} onBack={()=>setOpenId("")} channels={channels} channelsFailed={channelsFailed} Select={Select}/>;
 }

 return <div className="tournamentsPage">
  <div className="tToolbar">
   <div className="tSearch"><Search aria-hidden="true"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name or game" aria-label="Search tournaments"/></div>
   <label className="tFilter"><span>STATUS</span><Select id="t-status-filter" label="Status" flip value={status} onChange={setStatus} options={STATUSES.map(s=>({value:s,label:s==="ALL"?"All statuses":s}))}/></label>
   <button type="button" onClick={()=>setReload(r=>r+1)}><RefreshCw/>Refresh</button>
   <button type="button" className="primary" disabled={!canConfigure} onClick={()=>setCreating(true)}><Plus/>Create tournament</button>
  </div>
  <Notice value={!canConfigure?{text:"You need Operate access on Tournaments in this server."}:null}/>
  {error&&<Notice value={{text:error}}/>}
  <BrandingSection guildId={selectedGuild} canConfigure={canConfigure}/>
  {loading
   ?<div className="tState"><Loader2 className="spin"/><b>Loading tournaments…</b></div>
   :filtered.length
    ?<div className="tCardGrid">{filtered.map(t=><article className="tCard" key={t.id}>
      {t.bannerUrl? <img className="tCardBanner" src={t.bannerUrl} alt="" onError={e=>{e.currentTarget.style.display="none"}}/> : null}
      <div className="tCardBody">
       <div className="tCardTop"><StatusPill status={t.status}/><span className={"tVis "+(t.publicRegistration?"public":"private")}>{t.publicRegistration?"Public registration":"Private"}</span></div>
       <h3>{t.name}</h3>
       <p className="tCardGame">{t.game}</p>
       <ul className="tCardMeta">
        <li><Users/>{t.participantCount} / {t.maxParticipants} participants</li>
        <li><Calendar/>{when(t.startAt)}</li>
        <li><Trophy/>Single Elimination • {t.participantType==="teams"?"Teams":"Players"}</li>
        {t.registrationOpen?<li><Clock3/>Registration open</li>:null}
       </ul>
      </div>
      <div className="tCardActions">
       <button type="button" className="primary" onClick={()=>setOpenId(t.id)}>Manage</button>
       <a className="tBtn" href={`/tournaments/${encodeURIComponent(t.publicSlug)}`} target="_blank" rel="noreferrer"><ExternalLink/>Public page</a>
      </div>
     </article>)}</div>
    :<div className="tEmpty"><Trophy/><b>{query||status!=="ALL"?"No tournaments match this search":"No tournaments yet"}</b><span>{query||status!=="ALL"?"Adjust the search or status filter.":"Create your first single-elimination tournament for this server."}</span></div>}
  {creating&&<CreateTournament guildId={selectedGuild} onClose={()=>setCreating(false)} onCreated={t=>{setCreating(false);setReload(r=>r+1);setOpenId(t.id)}} channels={channels} channelsFailed={channelsFailed} Select={Select} premium={!!premium} onUpgrade={onUpgrade}/>} 
 </div>;
}
