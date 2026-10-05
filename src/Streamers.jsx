import React,{useEffect,useRef,useState}from"react";
import {Activity,Bell,CheckCircle2,ChevronDown,ExternalLink,Pencil,Plus,Radio,Search,Trash2,Users,Wifi,X}from"lucide-react";
import { streamingProfileNoticeFromSearch, strippedStreamingOAuthSearch } from "../streaming-oauth.js";
import { STREAMER_PANEL_ACCESS_UNKNOWN_ERROR, STREAMER_PANEL_BRANDING_URL, STREAMER_PANEL_BOT_PERMISSION_ERROR, buildStreamerPanelFooter, composeStreamerPanelDescription, normalizeStreamerPanelConfig, streamerPanelErrorText } from "../streamers.js";

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
const[panel,setPanel]=useState(null),[panelChannel,setPanelChannel]=useState(""),[panelBusy,setPanelBusy]=useState(""),[panelNotice,setPanelNotice]=useState(""),[panelDraft,setPanelDraft]=useState(null),[panelEditing,setPanelEditing]=useState(false),[panelDirty,setPanelDirty]=useState(false);
 const[deleteTarget,setDeleteTarget]=useState(null),[deleteError,setDeleteError]=useState(""),[toast,setToast]=useState("");
 const canMutate=!!data.canMutate;
 const load=async()=>{if(!selectedGuild)return;setLoading(true);try{const r=await fetch("/api/streamers?guildId="+encodeURIComponent(selectedGuild),{cache:"no-store"}),x=await readApiJson(r,"Could not load streamers");if(!r.ok)throw new Error(streamerPanelErrorText(r,x,"Could not load streamers","You do not have permission to manage Streamers for this server."));setData({streamers:x.streamers||[],stats:x.stats||{managed:0,live:0,offline:0,announcements:0},members:x.members||[],channels:x.channels||[],providers:x.providers||[],settings:x.settings||{announcementChannelId:""},profileAccounts:x.profileAccounts||{},canMutate:!!x.canMutate,premium:!!x.premium,isOwner:!!x.isOwner});setGuildAnnounceId(x.settings?.announcementChannelId||"")}catch(e){setNotice(e.message)}finally{setLoading(false)}};
 useEffect(()=>{setNotice("");setFormOpen(false);setEditingId("");setPanel(null);setData(prev=>({...prev,streamers:[],stats:{managed:0,live:0,offline:0,announcements:0}}));load()},[selectedGuild]);
 const guildAutoRefilled=useRef(false);
 useEffect(()=>{guildAutoRefilled.current=false},[selectedGuild]);
 useEffect(()=>{if(guildAutoRefilled.current||loading||!selectedGuild||!data.premium||data.streamers.length>0)return;guildAutoRefilled.current=true;const t=setTimeout(()=>{load()},1800);return()=>clearTimeout(t)},[selectedGuild,loading,data.premium,data.streamers.length]);
 const loadPanel=async()=>{if(!selectedGuild||!canMutate)return;try{const r=await fetch("/api/streamers/panel?guildId="+encodeURIComponent(selectedGuild),{cache:"no-store"}),x=await readApiJson(r,"Could not load streamer panel");if(!r.ok)throw new Error(streamerPanelErrorText(r,x,"Could not load the Streamer Info Panel"));setPanel(x);setPanelDraft(normalizeStreamerPanelConfig(x.config));setPanelDirty(false);setPanelChannel(x.panel?.channelId||"")}catch(e){setPanel({error:e.message})}};
 const panelAct=async action=>{if(action==="delete"&&!window.confirm("Delete the Streamer Info Panel message from Discord?"))return;if(action!=="delete"&&panelDirty){setPanelNotice("Save your changes before publishing.");return;}setPanelBusy(action);setPanelNotice("");try{const url="/api/streamers/panel?guildId="+encodeURIComponent(selectedGuild);const init=action==="publish"?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channelId:panelChannel})}:{method:action==="update"?"PUT":"DELETE"};const r=await fetch(url,init),x=await readApiJson(r,"Could not update the Streamer Info Panel");if(!r.ok){setPanelNotice(streamerPanelErrorText(r,x,"Could not update the Streamer Info Panel"));if(x.deleted)await loadPanel()}else{setPanelNotice(action==="publish"?"Panel published to Discord.":action==="update"?"Panel updated.":"Panel removed from Discord.");await loadPanel()}}catch(e){setPanelNotice(e.message)}finally{setPanelBusy("")}};
 const setDraftField=(key,value)=>{setPanelDraft(d=>({...normalizeStreamerPanelConfig(d),[key]:value}));setPanelDirty(true)};
 const savePanelConfig=async()=>{if(!panelDraft||!panelDirty||!!panelBusy)return;setPanelBusy("save");setPanelNotice("");try{const r=await fetch("/api/streamers/panel/config?guildId="+encodeURIComponent(selectedGuild),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({guildId:selectedGuild,...panelDraft})}),x=await readApiJson(r,"Could not save the Streamer Info Panel");if(!r.ok)throw new Error(streamerPanelErrorText(r,x,"Could not save the Streamer Info Panel"));setPanel(p=>({...p,config:x.config}));setPanelDraft(normalizeStreamerPanelConfig(x.config));setPanelDirty(false);setPanelNotice("Panel customization saved.")}catch(e){setPanelNotice(e.message)}finally{setPanelBusy("")}};
 const resetPanelConfig=async()=>{if(!!panelBusy)return;if(!window.confirm("Reset the Streamer Info Panel to the default template? This overwrites this server's customization."))return;setPanelBusy("reset");setPanelNotice("");try{const r=await fetch("/api/streamers/panel/config?guildId="+encodeURIComponent(selectedGuild),{method:"DELETE"}),x=await readApiJson(r,"Could not reset the Streamer Info Panel");if(!r.ok)throw new Error(streamerPanelErrorText(r,x,"Could not reset the Streamer Info Panel"));setPanel(p=>({...p,config:x.config}));setPanelDraft(normalizeStreamerPanelConfig(x.config));setPanelDirty(false);setPanelNotice("Panel reset to the default template.")}catch(e){setPanelNotice(e.message)}finally{setPanelBusy("")}};
 const closePanelEditor=()=>{if(panelDirty&&!window.confirm("Discard unsaved panel changes?"))return;setPanelDraft(normalizeStreamerPanelConfig(panel&&panel.config));setPanelDirty(false);setPanelEditing(false)};
 const togglePanelEdit=()=>{if(panelEditing){closePanelEditor();return}setPanelEditing(true)};
 useEffect(()=>{setPanelDraft(null);setPanelEditing(false);setPanelDirty(false)},[selectedGuild]);
 useEffect(()=>{setPanelNotice("");loadPanel()},[selectedGuild,canMutate]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(""),3000);return()=>clearTimeout(t)},[toast]);
 useEffect(()=>{if(!deleteTarget)return;const onKey=e=>{if(e.key==="Escape"&&!busy)setDeleteTarget(null)};document.addEventListener("keydown",onKey);return()=>document.removeEventListener("keydown",onKey)},[deleteTarget,busy]);
 const providerMeta=id=>(data.providers||[]).find(p=>p.id===id)||{};
 const resetForm=()=>{setEditingId("");setEditingSource("owner");setMemberId("");setProvider("twitch");setChannelInput("");setAnnounceId("");setAutoAnnounce(true);setEnabled(true);setCustomMessage("")};
 const openCreate=()=>{resetForm();setFormOpen(true);setNotice("")};
 const openEdit=s=>{setEditingId(s.id);setEditingSource(s.source==="auto"?"auto":"owner");setMemberId(s.discordMemberId);setProvider(s.provider);setChannelInput(s.profileUrl||s.providerLogin||"");setAnnounceId(s.announcementChannelId);setAutoAnnounce(s.autoAnnounce!==false);setEnabled(s.enabled!==false);setCustomMessage(s.customMessage||"");setFormOpen(true);setNotice("")};
 const saveGuildChannel=async()=>{setBusy("settings");setNotice("");try{const r=await fetch("/api/streamers/settings?guildId="+encodeURIComponent(selectedGuild),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({announcementChannelId:guildAnnounceId,autoAnnounce:true})}),x=await readApiJson(r,"Could not save announcement channel");if(!r.ok)throw new Error(x.error||"Could not save announcement channel");setNotice("LIVE announcement channel saved.");await load()}catch(err){setNotice(err.message)}finally{setBusy("")}};
 const save=async e=>{e.preventDefault();setBusy("save");setNotice("");try{const url=editingId?"/api/streamers/"+encodeURIComponent(editingId)+"?guildId="+encodeURIComponent(selectedGuild):"/api/streamers?guildId="+encodeURIComponent(selectedGuild);const r=await fetch(url,{method:editingId?"PUT":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({discordMemberId:memberId,provider,channel:channelInput,announcementChannelId:announceId,autoAnnounce,enabled,customMessage})}),x=await readApiJson(r,"Could not save streamer");if(!r.ok)throw new Error(x.error||"Could not save streamer");setNotice(editingId?"Streamer updated.":"Streamer added.");setFormOpen(false);resetForm();await load()}catch(err){setNotice(err.message)}finally{setBusy("")}};
 const cancelDelete=()=>{if(busy)return;setDeleteTarget(null);setDeleteError("")};
 const confirmDelete=async()=>{const target=deleteTarget;if(!target)return;setBusy("del-"+target.id);setDeleteError("");try{const r=await fetch("/api/streamers/"+encodeURIComponent(target.id)+"?guildId="+encodeURIComponent(selectedGuild),{method:"DELETE"}),x=await readApiJson(r,"Could not remove streamer");if(!r.ok)throw new Error(x.error||"Could not remove streamer");setData(prev=>{const streamers=prev.streamers.filter(s=>s.id!==target.id);let live=0,offline=0,announcements=0;for(const s of streamers){const st=s.liveStatus;if(st==="live")live++;else if(st==="offline")offline++;if(s.autoAnnounce===true||Number(s.auto_announce)===1)announcements++;}return{...prev,streamers,stats:{...(prev.stats||{}),managed:streamers.length,live,offline,announcements}}});setDeleteTarget(null);setToast("Streamer removed")}catch(err){setDeleteError(err.message)}finally{setBusy("")}};
 const refresh=async id=>{setBusy(id?"chk-"+id:"refresh");setNotice("");try{const url=id?"/api/streamers/"+encodeURIComponent(id)+"/check?guildId="+encodeURIComponent(selectedGuild):"/api/streamers/refresh?guildId="+encodeURIComponent(selectedGuild);const r=await fetch(url,{method:"POST"}),x=await readApiJson(r,"Could not refresh status");if(!r.ok)throw new Error(x.error||"Could not refresh status");setNotice(id?"Status updated.":"Status checks finished.");await load()}catch(err){setNotice(err.message)}finally{setBusy("")}};
 const stats=data.stats||{};
 const deleteName=deleteTarget?(deleteTarget.member?.globalName||deleteTarget.member?.username||deleteTarget.displayName||deleteTarget.providerLogin||"this streamer"):"";
 const detection=providerMeta(provider);
 const platformOptions=(data.providers||[]).map(p=>({value:p.id,label:p.label+(p.liveDetectionAvailable?"":" · no auto LIVE")}));
 const channelOptions=[{value:"",label:"Select channel"},...(data.channels||[]).map(c=>({value:c.id,label:(c.type===5?"📣 ":"# ")+c.name}))];
 const draft=panelDraft;
 const previewTitle=draft?draft.title:(panel&&panel.embed?panel.embed.title:"");
 const previewDesc=draft?composeStreamerPanelDescription(draft):(panel&&panel.embed?panel.embed.description:"");
 const previewFooter=draft?buildStreamerPanelFooter(draft):(panel&&panel.embed&&panel.embed.footer?panel.embed.footer.text:"");
 const previewColor=draft?"#"+Number(draft.color||0).toString(16).padStart(6,"0"):"";
 const previewButtonLabel=draft?draft.buttonLabel:"🎥 Manage Streaming Accounts";
 const previewButtonUrl=draft?(draft.buttonUrl||panel?.manageUrl||""):(panel?.manageUrl||"");
 const previewButtonEnabled=draft?draft.buttonEnabled!==false:true;
 const colorHex=draft?"#"+Number(draft.color||0).toString(16).padStart(6,"0"):"#e8892c";
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
  {canMutate&&panel&&<div className="streamersForm streamerPanelCard">
   <div className="voiceConfigHead"><div className="sectionLead"><span className="sectionIcon"><Radio/></span><span><b>Streamer Info Panel</b><small>Publish an informational panel that explains automatic stream announcements.</small></span></div><div className="panelHeadActions"><StreamingStatusBadge on={!!panel.panel?.published}>{panel.panel?.published?"Published":"Not Published"}</StreamingStatusBadge><button type="button" onClick={togglePanelEdit} disabled={!!panelBusy}>{panelEditing?"Close Editor":"Edit Panel"}</button></div></div>
   {panelNotice&&<div className="memberNotice">{panelNotice}</div>}
   {panel.error?<small className="streamersHint">{panel.error}</small>:<>
    {panelEditing&&panelDraft&&<div className="panelEditor">
     <div className="voiceConfigGrid">
      <div className="streamersField"><span>PANEL TITLE</span><input value={panelDraft.title} maxLength={256} onChange={e=>setDraftField("title",e.target.value)}/></div>
      <div className="streamersField"><span>FOOTER TEXT</span><input value={panelDraft.footerText} maxLength={1500} placeholder="Optional custom footer" onChange={e=>setDraftField("footerText",e.target.value)}/></div>
      <div className="streamersField"><span>ACCENT COLOR</span><input className="panelColorInput" type="color" value={colorHex} onChange={e=>setDraftField("color",parseInt(e.target.value.slice(1),16)||0)}/></div>
     </div>
     <label className="streamersMessage"><span>MAIN DESCRIPTION</span><textarea value={panelDraft.description} maxLength={4000} onChange={e=>setDraftField("description",e.target.value)}/></label>
     <label className="streamersMessage"><span>HOW IT WORKS</span><textarea value={panelDraft.howItWorks} maxLength={2000} onChange={e=>setDraftField("howItWorks",e.target.value)}/></label>
     <label className="streamersMessage"><span>ADDITIONAL INFORMATION</span><textarea value={panelDraft.additionalText} maxLength={2000} onChange={e=>setDraftField("additionalText",e.target.value)}/></label>
     <div className="voiceConfigGrid">
      <div className="streamersField"><span>BUTTON LABEL</span><input value={panelDraft.buttonLabel} maxLength={80} onChange={e=>setDraftField("buttonLabel",e.target.value)}/></div>
      <div className="streamersField"><span>BUTTON URL</span><input value={panelDraft.buttonUrl} maxLength={512} placeholder="https://… (empty = default)" onChange={e=>setDraftField("buttonUrl",e.target.value)}/></div>
     </div>
     <div className="streamersToggles"><label className={"roleToggle"+(panelDraft.buttonEnabled!==false?" on":"")}><input type="checkbox" checked={panelDraft.buttonEnabled!==false} onChange={e=>setDraftField("buttonEnabled",e.target.checked)}/><i/><span>Panel button enabled</span></label></div>
     <div className="voiceConfigActions"><button type="button" onClick={resetPanelConfig} disabled={!!panelBusy}>{panelBusy==="reset"?"Resetting…":"Reset to default"}</button><button type="button" onClick={closePanelEditor} disabled={!!panelBusy}>Cancel</button><button type="button" className="primary" onClick={savePanelConfig} disabled={!!panelBusy||!panelDirty}>{panelBusy==="save"?"Saving…":"Save"}</button></div>
    </div>}
    <div className="panelEmbed" style={previewColor?{borderLeftColor:previewColor}:undefined}>
     <b className="panelEmbedTitle">{previewTitle}</b>
     <span className="panelEmbedDesc">{previewDesc}</span>
     <small className="panelEmbedBrandLink">Powered by <a href={STREAMER_PANEL_BRANDING_URL} target="_blank" rel="noreferrer">Bot.BalticM.eu</a> • PLAY TOGETHER</small>
     {previewFooter?<small className="panelEmbedFooter">{previewFooter}</small>:null}
     {previewButtonEnabled?(previewButtonUrl?<a className="panelEmbedButton" href={previewButtonUrl} target="_blank" rel="noreferrer">{previewButtonLabel}</a>:<span className="panelEmbedButton isDisabled">{previewButtonLabel}</span>):<span className="panelEmbedButton isDisabled">{previewButtonLabel}</span>}
    </div>
    {!panel.panel?.published?<div className="panelControls">
     <label><span>DISCORD CHANNEL</span><TicketOptionSelect id="st-panel-channel" label="Select channel" search flip value={panelChannel} onChange={setPanelChannel} options={[{value:"",label:"Select channel"},...(panel.channels||[]).map(c=>({value:c.id,label:(c.type===5?"📣 ":"# ")+c.name}))]}/></label>
     <button type="button" className="primary" disabled={!!panelBusy||!panelChannel||(panel.channels||[]).length===0} onClick={()=>panelAct("publish")}>{panelBusy==="publish"?"Publishing…":"Publish Panel"}</button>
    </div>
    :<div className="panelPublished">
     <div className="panelPublishedMeta"><span>PUBLISHED CHANNEL</span><b>#{panel.panel?.channelName||panel.panel?.channelId||""}</b></div>
     <div className="featureActions"><button type="button" disabled={!!panelBusy} onClick={()=>panelAct("update")}>{panelBusy==="update"?"Updating…":"Update Panel"}</button><button type="button" className="danger" disabled={!!panelBusy} onClick={()=>panelAct("delete")}>{panelBusy==="delete"?"Deleting…":"Delete Panel"}</button></div>
    </div>}
    {!panel.panel?.published&&(panel.channels||[]).length===0&&<small className="streamersHint">{panel.channels===null?STREAMER_PANEL_ACCESS_UNKNOWN_ERROR:STREAMER_PANEL_BOT_PERMISSION_ERROR}</small>}
   </>}
  </div>}
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
   <div className="featureActions">{s.watchUrl&&<a className="streamersWatch" href={s.watchUrl} target="_blank" rel="noreferrer"><ExternalLink/>Watch Stream</a>}<button type="button" onClick={()=>refresh(s.id)} disabled={!!busy}><Search/>{busy==="chk-"+s.id?"Checking\u2026":"Check"}</button>{canMutate&&<button type="button" onClick={()=>openEdit(s)} disabled={!!busy}><Pencil/>Edit</button>}{canMutate&&<button type="button" className="danger" onClick={()=>{setDeleteError("");setDeleteTarget(s)}} disabled={!!busy}><Trash2/>Delete</button>}</div>
  </article>})}</div>:<div className="featureEmpty"><div><Radio/></div><b>No streamers yet</b><span>{canMutate?"Add a Twitch, YouTube, Kick or TikTok profile for this Discord server.":"No streamer profiles are configured for this server."}</span></div>}
  {deleteTarget&&<div className="streamerDeleteBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)cancelDelete()}}>
   <div className="streamerDeleteModal" role="dialog" aria-modal="true" aria-labelledby="streamerDeleteTitle">
    <div className="streamerDeleteHead"><b id="streamerDeleteTitle">Remove streamer?</b></div>
    <div className="streamerDeleteBody">
     <p className="streamerDeleteText">Remove {deleteName} from this server's streamer list?</p>
     <div className="streamerDeleteList"><span>This will:</span><ul><li>remove the streamer from this server</li><li>stop automatic LIVE monitoring for this server</li><li>stop future LIVE announcements for this server</li></ul></div>
     <div className="streamerDeleteList"><span>This will NOT:</span><ul><li>delete their Discord account</li><li>delete their BalticM profile</li><li>disconnect their personal Twitch/TikTok/Kick accounts globally</li><li>affect the streamer on another Discord server</li></ul></div>
     {deleteError&&<div className="memberNotice streamerDeleteError">{deleteError}</div>}
    </div>
    <div className="voiceConfigActions streamerDeleteActions"><button type="button" onClick={cancelDelete} disabled={!!busy}>Cancel</button><button type="button" className="danger" onClick={confirmDelete} disabled={!!busy}>{busy.startsWith("del-")?"Removing\u2026":"Remove Streamer"}</button></div>
   </div>
  </div>}
  {toast&&<div className="streamerToast" role="status">{toast}</div>}
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
 return <div className="profileStreamerCard"><div className="profileCardHead"><div className="sectionLead"><span className="sectionIcon"><Radio/></span><span><b>My streaming accounts</b><small>Connect your real Twitch, TikTok and Kick accounts. Premium servers include verified accounts automatically.</small></span></div></div>{notice&&<div className="memberNotice">{notice}</div>}<div className="streamersSelfGrid">{["twitch","tiktok","kick"].map(provider=>{const row=byProvider[provider];const cap=oauth[provider]||{};const label=PLATFORM_LABEL[provider];const available=cap.available!==false;if(row?.verified)return <div className="streamersSelfRow connected" key={provider}><div className="streamersSelfHead"><b>{label}</b><StreamingStatusBadge on>CONNECTED</StreamingStatusBadge></div><div className="streamersSelfIdentity">{row.profileImageUrl?<img src={row.profileImageUrl} alt=""/>:<span>{(row.displayName||"?").slice(0,1).toUpperCase()}</span>}<div><b>{row.displayName||row.providerLogin}</b>{row.providerLogin&&row.providerLogin!==row.providerUserId?<small>@{String(row.providerLogin).replace(/^@/,"")}</small>:null}</div></div><div className="featureActions">{row.profileUrl||row.watchUrl?<a className="streamersWatch" href={row.profileUrl||row.watchUrl} target="_blank" rel="noreferrer"><ExternalLink/>View Channel</a>:null}<button type="button" className="danger" disabled={!!busy} onClick={()=>remove(provider)}>Disconnect</button></div></div>;if(row&&!row.verified)return <div className="streamersSelfRow" key={provider}><div className="streamersSelfHead"><b>{label}</b><StreamingStatusBadge>UNVERIFIED</StreamingStatusBadge></div><div className="streamersSelfIdentity">{row.profileImageUrl?<img src={row.profileImageUrl} alt=""/>:<span>{(row.displayName||"?").slice(0,1).toUpperCase()}</span>}<div><b>{row.displayName||row.providerLogin}</b><small>{row.profileUrl||row.providerLogin}</small></div></div><div className="featureActions">{available?<button type="button" className="primary" disabled={!!busy} onClick={()=>connect(provider)}>Connect to verify</button>:<small className="streamersHint">Connection temporarily unavailable</small>}<button type="button" className="danger" disabled={!!busy} onClick={()=>remove(provider)}>Disconnect</button></div></div>;return <div className="streamersSelfRow" key={provider}><div className="streamersSelfHead"><b>{label}</b><StreamingStatusBadge>NOT CONNECTED</StreamingStatusBadge></div>{available?<div className="featureActions"><button type="button" className="primary" disabled={!!busy} onClick={()=>connect(provider)}>Connect {label}</button></div>:<small className="streamersHint">Connection temporarily unavailable</small>}</div>})}</div></div>;
}
