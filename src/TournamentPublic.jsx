import React,{useEffect,useState}from"react";
import {ArrowLeft,CheckCircle2,Clock3,Loader2,Lock,ShieldCheck,Trophy,UserPlus,Users,X}from"lucide-react";
import TournamentBracket from"./TournamentBracket.jsx";
import"./tournaments.css";
import {ANNOUNCEMENT_FOOTER}from"../tournaments.js";

/* Public tournament page — read-only event page. The only write action is the
   authenticated registration flow (individual or team), enforced server-side. */

const statusLabel=s=>({DRAFT:"DRAFT",REGISTRATION:"REGISTRATION",UPCOMING:"UPCOMING",LIVE:"LIVE",FINISHED:"FINISHED"}[s]||s||"");
const when=v=>{try{return new Date(v).toLocaleString()}catch{return v||""}};
const emptyMember=()=>({displayName:"",discordId:""});

/* Team logo with graceful fallback: a broken/missing URL falls back to the
   seed badge — it never breaks the card or the page layout. */
function TeamLogo({src,seed}){
 const[ok,setOk]=useState(true);
 useEffect(()=>{setOk(true)},[src]);
 if(!src||!ok)return <span className="tPubTeamSeed">#{seed}</span>;
 return <img className="tPubTeamLogo" src={src} alt="" onError={()=>setOk(false)}/>;
}

/* Optional logo preview inside the registration form — https-only, and a
   broken image is reported without blocking registration. */
function FormLogoPreview({url}){
 const v=String(url||"").trim();
 const[failed,setFailed]=useState(false);
 useEffect(()=>{setFailed(false)},[v]);
 if(!v)return null;
 if(!/^https:\/\/\S+$/i.test(v))return <small className="tPubLogoHint">Logo must be a direct https:// image URL.</small>;
 if(failed)return <small className="tPubLogoHint">That image could not be loaded — it will be hidden on the page.</small>;
 return <span className="tPubLogoPreview"><img src={v} alt="" onError={()=>setFailed(true)}/></span>;
}

export default function TournamentPublic({slug}){
 const[data,setData]=useState(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
 const[user,setUser]=useState(null);
 const[brandLogoOk,setBrandLogoOk]=useState(true);
 const[regOpen,setRegOpen]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(null);
 const[teamName,setTeamName]=useState(""),[logoUrl,setLogoUrl]=useState(""),[members,setMembers]=useState([emptyMember()]);

 const load=()=>{setLoading(true);setError("");setBrandLogoOk(true);fetch(`/api/tournament-public/${encodeURIComponent(slug)}`,{cache:"no-store"}).then(r=>r.json().then(j=>({ok:r.ok,j}))).then(({ok,j})=>{if(!ok)throw new Error(j.error||"Tournament not found");setData(j)}).catch(e=>setError(e.message||"Tournament not found")).finally(()=>setLoading(false))};
 useEffect(()=>{load()},[slug]);
 useEffect(()=>{fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(j=>setUser(j?.user||null)).catch(()=>{})},[]);

 const setMember=(i,k,v)=>setMembers(ms=>ms.map((m,idx)=>idx===i?{...m,[k]:v}:m));
 const startRegister=()=>{if(!user){window.location.href="/api/auth/login";return}setNotice(null);setRegOpen(true)};
 const register=async()=>{
  setBusy(true);setNotice(null);
  try{
   const t=data.tournament;
   const body=t.participantType==="teams"
    ?{teamName:teamName.trim(),logoUrl:logoUrl.trim(),members:members.filter(m=>m.displayName.trim()||m.discordId.trim()).map(m=>({displayName:m.displayName.trim(),discordId:m.discordId.trim()}))}
    :{};
   const r=await fetch(`/api/tournament-public/${encodeURIComponent(slug)}/register`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   const j=await r.json().catch(()=>({}));
   if(r.status===401){window.location.href="/api/auth/login";return}
   if(!r.ok)throw new Error(j.error||"Registration failed");
   setNotice({ok:true,text:`You are registered — good luck, ${j.participant?.name||"player"}!`});
   setRegOpen(false);setTeamName("");setLogoUrl("");setMembers([emptyMember()]);load();
  }catch(e){setNotice({ok:false,text:e.message})}finally{setBusy(false)}
 };

 if(loading)return <div className="tPub"><div className="tPubState"><Loader2 className="spin"/><b>Opening tournament…</b></div></div>;
 if(error||!data)return <div className="tPub"><div className="tPubState"><Lock/><b>Tournament not found</b><span>{error||"This public link is not valid."}</span><a href="/"><ArrowLeft/>Back to BalticM</a></div></div>;

 const t=data.tournament,reg=data.registration,participants=data.participants||[],matches=data.matches||[],names=data.names||{};
 const isTeams=t.participantType==="teams";
 // Premium guilds replace the BALTICM header identity; free/expired guilds
 // fall back to standard BalticM branding (server decides — payload only ever
 // contains the EFFECTIVE branding).
 const branding=data.branding||{name:"BALTICM",logoUrl:"",logoSource:"",custom:false};
 const brandName=branding.name||"BALTICM";
 const brandLogo=branding.logoUrl||"";
 const champ=isTeams?participants.find(p=>p.id===t.championId):null;
 const champion=t.championId?(names[t.championId]||t.championId):"";
 const championRoster=champ?(champ.members||[]).filter(Boolean):[];
 const championLogo=champ&&champ.logoUrl?champ.logoUrl:"";
 const youRegistered=!!(reg.you&&reg.you.registered);
 const upcoming=matches.filter(m=>m.status==="READY").slice(0,8);
 const results=matches.filter(m=>m.status==="COMPLETED").sort((a,b)=>b.roundIndex-a.roundIndex||b.slotIndex-a.slotIndex).slice(0,24);
 const hasBracket=(data.roundLabels||[]).length>0;

 const registrationBlock=()=>{
  if(youRegistered)return <div className="tPubRegDone"><CheckCircle2/><span>You're registered as <b>{reg.you.name}</b> — good luck!</span></div>;
  if(!reg.open)return <p className="tPubRegClosed">{reg.reason}</p>;
  if(!regOpen)return <div className="tPubRegCta">
    <p>{isTeams?"Register your team — your Discord account becomes the captain.":"Register with your Discord account — your display name is used as the participant."}</p>
    <button type="button" className="tPubBtn primary" onClick={startRegister}><UserPlus/>{user?(isTeams?"Register your team":"Register now"):"Login with Discord to register"}</button>
   </div>;
  return <div className="tPubRegForm">
   {isTeams?<>
    <label><span>TEAM NAME</span><input value={teamName} maxLength={80} placeholder="NightWolves" onChange={e=>setTeamName(e.target.value)}/></label>
    <label><span>TEAM LOGO URL (OPTIONAL)</span><input value={logoUrl} maxLength={300} placeholder="https://…" onChange={e=>setLogoUrl(e.target.value)}/><small className="tPubLogoHelp">Upload your team logo to Imgur and paste the direct image URL here.</small></label>
    <FormLogoPreview url={logoUrl}/>
    <div className="tPubMembersEdit">
     <span>TEAM MEMBERS (OPTIONAL)</span>
     {members.map((m,i)=><div className="tPubMemberRow" key={i}>
      <input value={m.displayName} maxLength={80} placeholder="Display name" aria-label={`Member ${i+1} display name`} onChange={e=>setMember(i,"displayName",e.target.value)}/>
      <input value={m.discordId} maxLength={22} inputMode="numeric" placeholder="Discord ID (optional)" aria-label={`Member ${i+1} Discord ID`} onChange={e=>setMember(i,"discordId",e.target.value.replace(/[^0-9]/g,""))}/>
      <button type="button" aria-label={`Remove member ${i+1}`} onClick={()=>setMembers(ms=>ms.filter((_,idx)=>idx!==i))}><X/></button>
     </div>)}
     <button type="button" className="tPubMemberAdd" onClick={()=>setMembers(ms=>[...ms,emptyMember()])}><UserPlus/>Add member</button>
    </div>
    <p className="tPubIdentity"><ShieldCheck/>Captain: <b>{user?(user.global_name||user.username):"…"}</b> (your Discord account)</p>
   </>:<p className="tPubIdentity"><CheckCircle2/>Registering as <b>{user?(user.global_name||user.username):"…"}</b></p>}
   <div className="tPubRegActions">
    <button type="button" className="tPubBtn primary" disabled={busy||(isTeams&&!teamName.trim())} onClick={register}>{busy?"Registering…":"Confirm registration"}</button>
    <button type="button" className="tPubBtn" onClick={()=>setRegOpen(false)}>Cancel</button>
   </div>
  </div>;
 };

 return <div className="tPub">
  <header className="tPubBar">
   <a className="tPubBrand" href="/">
    {brandLogo&&brandLogoOk?<img className="tPubBrandLogo" src={brandLogo} alt="" onError={()=>setBrandLogoOk(false)}/>:<span className="tPubLogo"/>}
    <b>{brandName}</b><small>TOURNAMENTS</small>
   </a>
   <a className="tPubHome" href="/"><ArrowLeft/>Control Center</a>
  </header>

  <section className={"tPubHero"+(t.bannerUrl?" hasBanner":"")}>
   {t.bannerUrl?<img className="tPubHeroBg" src={t.bannerUrl} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>:null}
   <div className="tPubHeroMain">
    <div className="tPubEyebrow">
     <span>SINGLE ELIMINATION • {isTeams?"TEAMS / CLANS":"INDIVIDUAL PLAYERS"}</span>
     <em className={"tPubStatus "+String(t.status||"").toLowerCase()}>{statusLabel(t.status)}</em>
    </div>
    <h1>{t.name}</h1>
    <p className="tPubGame">{t.game}</p>
    {t.description?<p className="tPubDesc">{t.description}</p>:null}
    <div className="tPubChips">
     <span><Users/>{participants.length} / {t.maxParticipants} {isTeams?"teams":"players"}</span>
     <span><Clock3/>{t.startAt?`Starts ${when(t.startAt)}`:"Start time TBA"}</span>
     <span><Trophy/>Single elimination</span>
     {reg.open?<span className="open"><i/>Registration open</span>:null}
    </div>
   </div>
   <aside className="tPubHeroStats">
    <div><small>STATUS</small><b className={"dot "+String(t.status||"").toLowerCase()}>{statusLabel(t.status)}</b></div>
    <div><small>{isTeams?"TEAMS":"ENTRANTS"}</small><b>{participants.length}<i>/{t.maxParticipants}</i></b></div>
    <div><small>START</small><b>{t.startAt?new Date(t.startAt).toLocaleDateString(undefined,{day:"2-digit",month:"short",year:"numeric"}):"TBA"}</b></div>
    <div><small>FORMAT</small><b>Single elim.</b></div>
   </aside>
  </section>

  {champion?<section className="tPubChamp">
   {championLogo?<img className="tPubChampLogo" src={championLogo} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>:<span className="tPubChampIcon"><Trophy/></span>}
   <div className="tPubChampCopy">
    <small>CHAMPION</small>
    <b>{champion}</b>
    {championRoster.length?<span className="tPubChampRoster">{championRoster.join(" • ")}</span>:null}
   </div>
   <span className="tPubChampTrophy">🏆</span>
  </section>:null}

  <div className="tPubGrid tPubMain">
   <div className="tPubCol">
   <section className="tPubCard tPubEventCard">
    <div className="tPubCardHead"><span><ShieldCheck/></span><div><small>REGISTRATION & EVENT</small><h2>{reg.open?"Registration is open":"Event details"}</h2></div></div>
    <ul className="tPubFacts">
     <li><small>GAME</small><b>{t.game}</b></li>
     <li><small>FORMAT</small><b>Single Elimination • {isTeams?"Teams":"Individuals"}</b></li>
     <li><small>START</small><b>{t.startAt?when(t.startAt):"TBA"}</b></li>
     {t.registrationDeadline?<li><small>REGISTRATION CLOSES</small><b>{when(t.registrationDeadline)}</b></li>:null}
     <li><small>{isTeams?"CAPACITY":"CAPACITY"}</small><b>{participants.length} / {t.maxParticipants} {isTeams?"teams":"players"}</b></li>
    </ul>
    {notice?<div className={"tPubNotice "+(notice.ok?"ok":"error")} role={notice.ok?"status":"alert"}>{notice.text}</div>:null}
    {registrationBlock()}
   </section>

   {upcoming.length?<section className="tPubCard tPubMainUpcoming">
    <div className="tPubCardHead"><span><Clock3/></span><div><small>UPCOMING MATCHES</small><h2>Next up</h2></div></div>
    <ul className="tPubMatches">{upcoming.map(m=><li key={`${m.roundIndex}-${m.slotIndex}`}>
      <span className="tPubRound">{data.roundLabels[m.roundIndex]||""}</span>
      <b>{names[m.participantA]||"TBD"}</b><em>vs</em><b>{names[m.participantB]||"TBD"}</b>
     </li>)}</ul>
   </section>:null}

   {results.length?<section className="tPubCard tPubMainResults">
    <div className="tPubCardHead"><span><CheckCircle2/></span><div><small>RESULTS</small><h2>Completed matches</h2></div></div>
    <ul className="tPubResults">{results.map(m=>{const winA=m.winnerId===m.participantA;const win=names[m.winnerId]||"—";const lose=names[winA?m.participantB:m.participantA]||"—";return <li key={`${m.roundIndex}-${m.slotIndex}:res`}>
      <span className="tPubRound">{data.roundLabels[m.roundIndex]||""}</span>
      <b className="won">{win}</b>
      <span className="tPubScore">{winA?m.scoreA:m.scoreB}<i>—</i>{winA?m.scoreB:m.scoreA}</span>
      <b className="lost">{lose}</b>
     </li>})}</ul>
   </section>:null}
   </div>

   <section className="tPubCard tPubMainTeams">
    <div className="tPubCardHead"><span><Users/></span><div><small>{isTeams?"TEAMS":"PARTICIPANTS"}</small><h2>{participants.length} {isTeams?"teams":"entered"}</h2></div></div>
    {participants.length
      ?isTeams
        ?<div className="tPubTeams">{participants.map(p=><article className="tPubTeam" key={p.id}>
           <header><TeamLogo src={p.logoUrl} seed={p.seed}/><b>{p.name}</b></header>
           {p.captainName?<small className="tPubTeamCaptain">Captain: {p.captainName}</small>:null}
           {p.members&&p.members.length?<ul>{p.members.filter(Boolean).map((m,i)=><li key={i}>{m}</li>)}</ul>:<small className="tPubTeamCaptain">Roster not listed</small>}
          </article>)}</div>
        :<div className="tPubPeople">{participants.map(p=><span key={p.id}><i>#{p.seed}</i><b>{p.name}</b></span>)}</div>
      :<p className="tPubEmpty">No {isTeams?"teams":"participants"} yet.</p>}
   </section>
  </div>

  <section className="tPubCard tPubBracket">
   <div className="tPubCardHead"><span><Trophy/></span><div><small>BRACKET</small><h2>Single elimination</h2></div></div>
   {hasBracket
     ?<TournamentBracket roundLabels={data.roundLabels} matches={matches} names={names} championId={t.championId} championRoster={championRoster} championLogo={championLogo}/>
     :<p className="tPubEmpty">The bracket is not generated yet — it appears here as soon as seeding is complete.</p>}
  </section>

  {!upcoming.length&&!results.length&&hasBracket?<p className="tPubCompact">No matches ready yet — results appear here once play begins.</p>:null}

  <footer className="tPubFooter">{(()=>{const[before,after]=String(ANNOUNCEMENT_FOOTER).split("Bot.BalticM.eu");return <>{before}<a href="https://bot.balticm.eu" target="_blank" rel="noreferrer">Bot.BalticM.eu</a>{after}</>})()}</footer>
 </div>;
}
