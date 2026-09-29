import React,{useEffect,useRef,useState}from"react";
import {Activity,Bell,CheckCircle2,ChevronDown,ExternalLink,Pencil,Plus,Radio,Search,Trash2,Users,Wifi,X}from"lucide-react";
import { streamingProfileNoticeFromSearch, strippedStreamingOAuthSearch } from "../streaming-oauth.js";

const PLATFORM_LABEL={twitch:"Twitch",youtube:"YouTube",kick:"Kick",tiktok:"TikTok"};
async function readApiJson(r,fallback){
 const text=await r.text();
 const ct=String(r.headers.get("content-type")||"").toLowerCase();
 const trimmed=String(text||"").trim();
 const looksJson=trimmed.startsWith("{")||trimmed.startsWith("[");
 if(trimmed.startsWith("<")||(!ct.includes("application/json")&&!looksJson)||!looksJson)throw new Error(fallback);
 try{return JSON.parse(text)}catch{throw new Error(fallback)}
}

function StreamingStatusBadge({on,children}){
 return <span className={"streamersLinkBadge"+(on?" on":"")}><i aria-hidden="true"/>{children}</span>;
}

function statusLabel(s){
 if(s==="live")return"LIVE";
 if(s==="offline")return"OFFLINE";
 return"UNKNOWN";
}

function memberAvatar(m){
 if(!m)return null;
 if(m.avatar)return `https://cdn.discordapp.com/avatars/${m.id}/${m.avatar}.png?size=64`;
 return null;
}

function StreamerMemberSelect({members,value,onChange}){
 const[open,setOpen]=useState(false),[query,setQuery]=useState("");
 const root=useRef(null);
 useEffect(()=>{if(!open)return;const close=e=>{if(!root.current?.contains(e.target))setOpen(false)};const onKey=e=>{if(e.key==="Escape")setOpen(false)};document.addEventListener("pointerdown",close);document.addEventListener("keydown",onKey);return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",onKey)}},[open]);
 const selected=(members||[]).find(m=>m.id===value);
 const q=query.trim().toLowerCase();
 const shown=(members||[]).filter(m=>!q||String(m.globalName||"").toLowerCase().includes(q)||String(m.username||"").toLowerCase().includes(q));
 const pick=m=>{onChange(m.id);setOpen(false);setQuery("")};
 return <div className={"modMemberPicker"+(open?" open":"")} ref={root}>
  <button type="button" className={"modMemberTrigger"+(selected?" hasMember":"")} aria-expanded={open} aria-haspopup="listbox" aria-label="Discord member" onClick={()=>{setOpen(v=>!v);setQuery("")}}>
   {selected?<>
    <span className="modMemberAvatar">{memberAvatar(selected)?<img src={memberAvatar(selected)} alt=""/>:(selected.globalName||selected.username||"?").slice(0,1).toUpperCase()}</span>
    <span className="modMemberTriggerText"><b>{selected.globalName||selected.username}</b><small>@{selected.username}</small></span>
   </>:<span className="modMemberTriggerText">Select member</span>}
   <ChevronDown className={open?"chev open":"chev"}/>
  </button>
  {open&&<div className="modMemberDropdown">
   <div className="modMemberSearch"><Search/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name or username…" aria-label="Search Discord members"/></div>
   <div className="modMemberResults" role="listbox">
    {shown.map(m=><button type="button" key={m.id} className={value===m.id?"selected":""} onClick={()=>pick(m)}>
     <span className="modMemberAvatar">{memberAvatar(m)?<img src={memberAvatar(m)} alt=""/>:(m.globalName||m.username||"?").slice(0,1).toUpperCase()}</span>
     <span><b>{m.globalName||m.username}</b><small>@{m.username}</small></span>
     {value===m.id&&<CheckCircle2/>}
    </button>)}
    {!shown.length&&<div className="modMemberNoResult">No members found</div>}
   </div>
  </div>}
 </div>;
}

export default function Streamers({user,guild,selectedGuild,canConfigure=true,TicketOptionSelect}){
 const g=(user.guilds||[]).find(x=>x.id===selectedGuild);
 const[data,setData]=useState({streamers:[],stats:{managed:0,live:0,offline:0,announcements:0},members:[],channels:[],providers:[],settings:{announcementChannelId:""},profileAccounts:{},canMutate:false,premium:false,isOwner:false});
 const[loading,setLoading]=useState(false),[busy,setBusy]=useState(""),[notice,setNotice]=useState("");
 const[formOpen,setFormOpen]=useState(false),[editingId,setEditingId]=useState(""),[editingSource,setEditingSource]=useState("owner");
 const[memberId,setMemberId]=useState(""),[provider,setProvider]=useState("twitch"),[channelInput,setChannelInput]=useState("");
 const[announceId,setAnnounceId]=useState(""),[autoAnnounce,setAutoAnnounce]=useState(true),[enabled,setEnabled]=useState(true),[customMessage,setCustomMessage]=useState("");
 const[guildAnnounceId,setGuildAnnounceId]=useState("");
 const canMutate=!!data.canMutate;
 const load=async()=>{if(!selectedGuild)return;setLoading(true);try{const r=await fetch("/api/streamers?guildId="+encodeURIComponent(selectedGuild),{cache:"no-store"}),x=await readApiJson(r,"Could not load streamers");if(!r.ok)throw new Error(x.error||"Could not load streamers");setData({streamers:x.streamers||[],stats:x.stats||{managed:0,live:0,offline:0,announcements:0},members:x.members||[],channels:x.channels||[],providers:x.providers||[],settings:x.settings||{announcementChannelId:""},profileAccounts:x.profileAccounts||{},canMutate:!!x.canMutate,premium:!!x.premium,isOwner:!!x.isOwner});setGuildAnnounceId(x.settings?.announcementChannelId||"")}catch(e){setNotice(e.message)}finally{setLoading(false)}};
 useEffect(()=>{setNotice("");setFormOpen(false);setEditingId("");load()},[selectedGuild]);
 const providerMeta=id=>(data.providers||[]).find(p=>p.id===id)||{};
 const resetForm=()=>{setEditingId("");setEditingSource("owner");setMemberId("");setProvider("twitch");setChannelInput("");setAnnounceId("");setAutoAnnounce(true);setEnabled(true);setCustomMessage("")};
 const openCreate=()=>{resetForm();setFormOpen(true);setNotice("")};
 const openEdit=s=>{setEditingId(s.id);setEditingSource(s.source==="auto"?"auto":"owner");setMemberId(s.discordMemberId);setProvider(s.provider);setChannelInput(s.profileUrl||s.providerLogin||"");setAnnounceId(s.announcementChannelId);setAutoAnnounce(s.autoAnnounce!==false);setEnabled(s.enabled!==false);setCustomMessage(s.customMessage||"");setFormOpen(true);setNotice("")};
 const saveGuildChannel=async()=>{setBusy("settings");setNotice("");try{const r=await fetch("/api/streamers/settings?guildId="+encodeURIComponent(selectedGuild),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({announcementChannelId:guildAnnounceId,autoAnnounce:true})}),x=await readApiJson(r,"Could not save announcement channel");if(!r.ok)throw new Error(x.error||"Could not save announcement channel");setNotice("LIVE announcement channel saved.");await load()}catch(err){setNotice(err.message)}finally{setBusy("")}};
 const save=async e=>{e.preventDefault();setBusy("save");setNotice("");try{const url=editingId?"/api/streamers/"+encodeURIComponent(editingId)+"?guildId="+encodeURIComponent(selectedGuild):"/api/streamers?guildId="+encodeURIComponent(selectedGuild);const r=await fetch(url,{method:editingId?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({discordMemberId:memberId,provider,channel:channelInput,announcementChannelId:announceId,autoAnnounce,enabled,customMessage})}),x=await readApiJson(r,"Could not save streamer");if(!r.ok)throw new Error(x.error||"Could not save streamer");setNotice(editingId?"Streamer updated.":"Streamer added.");setFormOpen(false);resetForm();await load()}catch(err){setNotice(err.message)}finally{setBusy("")}};
 const remove=async id=>{if(!window.confirm("Remove this streamer configuration?"))return;setBusy("del-"+id);setNotice("");try{const r=await fetch("/api/streamers/"+encodeURIComponent(id)+"?guildId="+encodeURIComponent(selectedGuild),{method:"DELETE"}),x=await readApiJson(r,"Could not remove streamer");if(!r.ok)throw new Error(x.error||"Could not remove streamer");setNotice("Streamer removed.");await load()}catch(err){setNotice(err.message)}finally{setBusy("")}};
 const refresh=async id=>{setBusy(id?"chk-"+id:"refresh");setNotice("");try{const url=id?"/api/streamers/"+encodeURIComponent(id)+"/check?guildId="+encodeURIComponent(selectedGuild):"/api/streamers/refresh?guildId="+encodeURIComponent(selectedGuild);const r=await fetch(url,{method:"POST"}),x=await readApiJson(r,"Could not refresh status");if(!r.ok)throw new Error(x.error||"Could not refresh status");setNotice(id?"Status updated.":"Status checks finished.");await load()}catch(err){setNotice(err.message)}finally{setBusy("")}};
 const stats=data.stats||{};
 const detection=providerMeta(provider);
 const platformOptions=(data.providers||[]).map(p=>({value:p.id,label:p.label+(p.liveDetectionAvailable?"":" · no auto LIVE")}));
 const channelOptions=[{value:"",label:"Select channel"},...(data.channels||[]).map(c=>({value:c.id,label:(c.type===5?"📣 ":"# ")+c.name}))];
 return <div className="featurePage streamersPage">
  <div className="featureTop"><div className="sectionLead"><span className="sectionIcon"><Radio/></span><span><b>Streamers</b><small>Track live broadcasts and send Discord LIVE announcements for this server.</small></span></div><span className="featureServer">{g?.name||"Select a server"}</span></div>
  <div className="featureStats">
   <div><Users/><span>MANAGED STREAMERS</span><b>{stats.managed||0}</b><small>Configured profiles</small></div>
   <div><Wifi/><span>LIVE NOW</span><b className={stats.live?"ok":""}>{stats.live||0}</b><small>Detected live</small></div>
   <div><Activity/><span>OFFLINE</span><b>{stats.offline||0}</b><small>Confirmed offline</small></div>
   <div><Bell/><span>ANNOUNCEMENTS</span><b>{stats.announcements||0}</b><small>Auto LIVE alerts</small></div>
  </div>
  <div className="featureToolbar"><div><span className="eyebrow">LIVE TRACKING</span><h3>Managed Streamers</h3><small>Premium servers automatically include members with Profile streaming accounts. UNKNOWN never pretends to be offline.{!data.premium?" Non-Premium: only the Discord Server Owner can add streamers.":""}</small></div><div className="featureActions"><button type="button" onClick={()=>refresh()} disabled={!!busy||loading}><Activity/>{busy==="refresh"?"Checking…":"Refresh status"}</button>{canMutate&&<button type="button" className="primary" onClick={openCreate} disabled={!!busy}><Plus/>Add streamer</button>}</div></div>
  {canMutate&&<div className="streamersForm streamersGuildChannel"><label><span>GUILD LIVE ANNOUNCEMENT CHANNEL</span><TicketOptionSelect id="st-guild-channel" label="Guild LIVE announcement channel" search value={guildAnnounceId} onChange={setGuildAnnounceId} options={channelOptions}/></label><button type="button" onClick={saveGuildChannel} disabled={!!busy}>{busy==="settings"?"Saving…":"Save channel"}</button></div>}
  {notice&&<div className="memberNotice">{notice}</div>}
  {canMutate&&formOpen&&<form className="streamersForm" onSubmit={save}>
   <div className="voiceConfigHead"><div className="sectionLead"><span className="sectionIcon"><Radio/></span><span><b>{editingId?"Edit streamer":"Add streamer"}</b><small>Normalize channel URLs server-side. Credentials never leave the Worker.</small></span></div><button type="button" className="roleEditClose" onClick={()=>{setFormOpen(false);resetForm()}} aria-label="Close"><X/></button></div>
   <div className="voiceConfigGrid">
    <div className="streamersField"><span>DISCORD MEMBER</span>{editingSource==="auto"?<div className="modMemberTrigger hasMember"><span className="modMemberTriggerText"><b>{(data.members||[]).find(m=>m.id===memberId)?.globalName||"Premium member"}</b><small>Linked from Profile</small></span></div>:<StreamerMemberSelect members={data.members||[]} value={memberId} onChange={id=>{setMemberId(id);const linked=((data.profileAccounts||{})[id]||[]).find(a=>a.provider===provider);if(linked)setChannelInput(linked.profileUrl||linked.providerLogin||"")}}/>}</div>
    <div className="streamersField"><span>PLATFORM</span><TicketOptionSelect id="st-platform" label="Platform" value={provider} onChange={id=>{setProvider(id);if(editingSource==="auto")return;const linked=((data.profileAccounts||{})[memberId]||[]).find(a=>a.provider===id);if(linked)setChannelInput(linked.profileUrl||linked.providerLogin||"")}} options={platformOptions.length?platformOptions:[{value:"twitch",label:"Twitch"}]}/></div>
    <div className="streamersField wide"><span>STREAMER CHANNEL / PROFILE</span><input value={channelInput} onChange={e=>setChannelInput(e.target.value)} placeholder="URL or username" required={editingSource!=="auto"} readOnly={editingSource==="auto"}/></div>
    <div className="streamersField wide"><span>ANNOUNCEMENT CHANNEL</span><TicketOptionSelect id="st-channel" label="Announcement channel" search flip value={announceId} onChange={setAnnounceId} options={channelOptions}/></div>
   </div>
   <div className="streamersToggles">
    <label className={"roleToggle"+(autoAnnounce?" on":"")}><input type="checkbox" checked={autoAnnounce} onChange={e=>setAutoAnnounce(e.target.checked)}/><i/><span>Automatic LIVE announcements</span></label>
    <label className={"roleToggle"+(enabled?" on":"")}><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/><i/><span>Streamer enabled</span></label>
   </div>
   {!detection.liveDetectionAvailable&&<small className="streamersHint">{detection.liveDetectionReason||"Automatic LIVE detection unavailable"}{detection.liveDetectionDetail?" — "+detection.liveDetectionDetail:""}</small>}
   <label className="streamersMessage"><span>OPTIONAL ANNOUNCEMENT MESSAGE</span><textarea value={customMessage} maxLength={1000} onChange={e=>setCustomMessage(e.target.value)} placeholder="Optional extra text. @everyone and @here are never sent."/></label>
   <div className="voiceConfigActions"><button type="button" onClick={()=>{setFormOpen(false);resetForm()}}>Cancel</button><button type="submit" className="primary" disabled={busy==="save"}><CheckCircle2/>{busy==="save"?"Saving…":"Save Streamer"}</button></div>
  </form>}
  {loading&&!data.streamers.length?<div className="featureEmpty"><Radio/><b>Loading streamers…</b></div>:data.streamers.length?<div className="streamersList">{data.streamers.map(s=>{const st=s.liveStatus||"unknown";return <article className={"streamersCard"+(st==="live"?" isLive":st==="unknown"?" isUnknown":"")} key={s.id}>
   <div className="streamersIdentity">{s.member?.avatar?<img src={`https://cdn.discordapp.com/avatars/${s.member.id}/${s.member.avatar}.png?size=64`} alt=""/>:<span>{(s.member?.globalName||"?").slice(0,1).toUpperCase()}</span>}<div><b>{s.member?.globalName||"Member left"}</b><small>{s.member?"@"+s.member.username:(s.memberMissing?"Discord member left this server":"Unknown member")}</small><em className={"streamersSource "+(s.source==="auto"?"auto":"owner")}>{s.source==="auto"?"AUTO — PREMIUM":"OWNER ADDED"}</em></div></div>
   <div className="streamersMeta"><span className="streamersPlatform">{PLATFORM_LABEL[s.provider]||s.provider}</span><b className="streamersChannel">{s.displayName||s.providerLogin}</b><span className={"streamersStatus "+st}><i/>{statusLabel(st)}</span></div>
   <div className="streamersDetails">{st==="live"&&s.streamTitle?<small>{s.streamTitle}</small>:null}{st==="live"&&s.streamCategory?<small>{s.streamCategory}</small>:null}{st==="live"&&s.viewerCount!=null?<small>{s.viewerCount} viewers</small>:null}{!s.liveDetectionAvailable?<small className="streamersUnknownNote">Automatic LIVE detection unavailable</small>:null}{s.lastError?<small className="streamersUnknownNote">{s.lastError}</small>:null}<small>#{s.announcementChannelName||s.announcementChannelId}</small><small>{s.enabled?"Enabled":"Disabled"} · {s.lastCheckedAt?new Date(s.lastCheckedAt).toLocaleString():"Never checked"}</small></div>
   <div className="featureActions">{s.watchUrl&&<a className="streamersWatch" href={s.watchUrl} target="_blank" rel="noreferrer"><ExternalLink/>Watch Stream</a>}<button type="button" onClick={()=>refresh(s.id)} disabled={!!busy}><Search/>Check</button>{canMutate&&<button type="button" onClick={()=>openEdit(s)} disabled={!!busy}><Pencil/>Edit</button>}{canMutate&&s.source!=="auto"&&<button type="button" className="danger" onClick={()=>remove(s.id)} disabled={!!busy}><Trash2/>Remove</button>}</div>
  </article>})}</div>:<div className="featureEmpty"><div><Radio/></div><b>No streamers yet</b><span>{canMutate?"Add a Twitch, YouTube, Kick or TikTok profile for this Discord server.":"No streamer profiles are configured for this server."}</span></div>}
 </div>;
}

export function StreamerSelfService(){
 const[accounts,setAccounts]=useState([]);
 const[oauth,setOauth]=useState({});
 const[busy,setBusy]=useState(""),[notice,setNotice]=useState("");
 const byProvider=Object.fromEntries((accounts||[]).map(s=>[s.provider,s]));
 const load=async({keepNotice=false}={})=>{try{const r=await fetch("/api/streaming-accounts",{cache:"no-store"}),x=await readApiJson(r,"Could not load streaming accounts");if(!r.ok)throw new Error(x.error||"Could not load streaming accounts");setAccounts(x.accounts||[]);setOauth(x.oauth||{});if(!keepNotice)setNotice("")}catch(e){setNotice(e.message)}};
 useEffect(()=>{const {notice,shouldClean}=streamingProfileNoticeFromSearch(window.location.search);if(notice)setNotice(notice);if(shouldClean){const qs=strippedStreamingOAuthSearch(window.location.search);window.history.replaceState({},"",window.location.pathname+(qs?"?"+qs:"")+window.location.hash)}load({keepNotice:!!notice})},[]);
 const connect=provider=>{window.location.href="/api/profile/streaming/"+encodeURIComponent(provider)+"/connect"};
 const remove=async provider=>{const existing=byProvider[provider];if(!existing)return;if(!window.confirm("Disconnect your "+(PLATFORM_LABEL[provider]||provider)+" account?"))return;setBusy("del-"+provider);setNotice("");try{const r=await fetch("/api/streaming-accounts/"+encodeURIComponent(provider),{method:"DELETE"}),x=await readApiJson(r,"Could not disconnect account");if(!r.ok)throw new Error(x.error||"Could not disconnect account");setNotice("Account disconnected.");await load()}catch(e){setNotice(e.message)}finally{setBusy("")}};
 return <div className="profileStreamerCard"><div className="profileCardHead"><div className="sectionLead"><span className="sectionIcon"><Radio/></span><span><b>My streaming accounts</b><small>Connect your real Twitch, YouTube, TikTok and Kick accounts. Premium servers include verified accounts automatically.</small></span></div></div>{notice&&<div className="memberNotice">{notice}</div>}<div className="streamersSelfGrid">{["twitch","youtube","tiktok","kick"].map(provider=>{const row=byProvider[provider];const cap=oauth[provider]||{};const label=PLATFORM_LABEL[provider];const available=cap.available!==false;if(row?.verified)return <div className="streamersSelfRow connected" key={provider}><div className="streamersSelfHead"><b>{label}</b><StreamingStatusBadge on>CONNECTED</StreamingStatusBadge></div><div className="streamersSelfIdentity">{row.profileImageUrl?<img src={row.profileImageUrl} alt=""/>:<span>{(row.displayName||"?").slice(0,1).toUpperCase()}</span>}<div><b>{row.displayName||row.providerLogin}</b>{row.providerLogin?<small>@{String(row.providerLogin).replace(/^@/,"")}</small>:null}</div></div><div className="featureActions">{row.profileUrl||row.watchUrl?<a className="streamersWatch" href={row.profileUrl||row.watchUrl} target="_blank" rel="noreferrer"><ExternalLink/>View Channel</a>:null}<button type="button" className="danger" disabled={!!busy} onClick={()=>remove(provider)}>Disconnect</button></div></div>;if(row&&!row.verified)return <div className="streamersSelfRow" key={provider}><div className="streamersSelfHead"><b>{label}</b><StreamingStatusBadge>UNVERIFIED</StreamingStatusBadge></div><div className="streamersSelfIdentity">{row.profileImageUrl?<img src={row.profileImageUrl} alt=""/>:<span>{(row.displayName||"?").slice(0,1).toUpperCase()}</span>}<div><b>{row.displayName||row.providerLogin}</b><small>{row.profileUrl||row.providerLogin}</small></div></div><div className="featureActions">{available?<button type="button" className="primary" disabled={!!busy} onClick={()=>connect(provider)}>Connect to verify</button>:<small className="streamersHint">Connection temporarily unavailable</small>}<button type="button" className="danger" disabled={!!busy} onClick={()=>remove(provider)}>Disconnect</button></div></div>;return <div className="streamersSelfRow" key={provider}><div className="streamersSelfHead"><b>{label}</b><StreamingStatusBadge>NOT CONNECTED</StreamingStatusBadge></div>{available?<div className="featureActions"><button type="button" className="primary" disabled={!!busy} onClick={()=>connect(provider)}>Connect {label}</button></div>:<small className="streamersHint">Connection temporarily unavailable</small>}</div>})}</div></div>;
}
