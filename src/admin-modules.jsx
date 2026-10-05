import React,{useEffect,useState}from"react";
import{Bot,CheckCircle2,Copy,Database,ExternalLink,KeyRound,RefreshCw,Search,Send,Server,ShieldCheck,Trash2,Wifi,XCircle}from"lucide-react";

const pad=n=>String(n).padStart(2,"0");
export const when=value=>{if(!value)return"—";try{const d=new Date(value);if(Number.isNaN(d.getTime()))return String(value);return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`}catch{return String(value||"—")}};
function errorText(status,raw){
 if(status===403)return"You do not have permission to do that.";
 if(status===401)return"Your session has expired. Please sign in again.";
 if(status===404)return"That item could not be found.";
 if(status===429)return"Too many requests. Please wait a moment and try again.";
 const text=typeof raw==="string"?raw.trim():"";
 if(status>=500)return"The server could not complete that request. Please try again.";
 if(text&&text!=="Forbidden"&&text!=="[object Object]"&&!/^\d{3}$/.test(text))return text;
 return"Request could not be completed. Please try again.";
}
async function api(url,options){
 const response=await fetch(url,{cache:"no-store",...options});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(errorText(response.status,data&&data.error));
 return data;
}
function Notice({value}){return value?<div className={"adminNotice "+(value.ok?"ok":"error")} role={value.ok?"status":"alert"}>{value.text}</div>:null}
function Loading(){return <div className="adminModuleEmpty" role="status"><RefreshCw className="spin" aria-hidden="true"/><b>Loading…</b></div>}
function Empty({children="No stored data yet."}){return <div className="adminModuleEmpty"><Database aria-hidden="true"/><b>{children}</b></div>}
function Badge({children,tone=""}){return <span className={`adminBadge ${tone}`}>{children||"—"}</span>}
/* Name-first cell: the readable Discord name is the primary value, the raw snowflake
   stays as small muted secondary text with a title tooltip, and an unknown name
   falls back to the raw id so nothing is ever hidden. */
function NameId({name,id}){
 const label=String(name||"").trim(),raw=String(id||"").trim();
 if(!label||label===raw)return raw?<span className="adminMono" title={raw}>{raw}</span>:"—";
 return <span className="adminNameWrap"><b title={raw||undefined}>{label}</b>{raw&&<small className="adminCellSub" title={raw}>{raw}</small>}</span>;
}

/* Reusable responsive data view: table on desktop/tablet, cards on mobile.
   Columns are declared once; the same render functions feed both layouts. */
function useIsMobile(){
 const[mobile,setMobile]=useState(()=>typeof window!=="undefined"&&typeof window.matchMedia==="function"?window.matchMedia("(max-width: 760px)").matches:false);
 useEffect(()=>{
  if(typeof window==="undefined"||typeof window.matchMedia!=="function")return;
  const mq=window.matchMedia("(max-width: 760px)");
  const on=e=>setMobile(e.matches);
  setMobile(mq.matches);
  mq.addEventListener?mq.addEventListener("change",on):mq.addListener(on);
  return()=>{mq.removeEventListener?mq.removeEventListener("change",on):mq.removeListener(on)};
 },[]);
 return mobile;
}
function cell(row,column){return column.render?column.render(row):row[column.key]??"—"}
function rowKey(row,index){return row.id||row.paymentId||row.codeId||row.reference||row.eventId||index}
function Table({columns,rows,empty="No stored data yet.",cardTitle,scroll=false}){
 const mobile=useIsMobile();
 if(mobile){
  const fields=columns.filter(c=>c.key!=="actions"&&(!cardTitle||c.card!==false));
  const actions=columns.find(c=>c.key==="actions");
  return <div className="adminCards">{rows.length?rows.map((row,index)=><article className="adminCard" key={rowKey(row,index)}>
   <div className="adminCardHead">{cardTitle?cardTitle(row):<b>{String(columns[0]?.label?cell(row,columns[0]):"Record")}</b>}</div>
   <div className="adminCardBody">{fields.map(c=><div className="adminCardField" key={c.key}><span>{c.label}</span><div>{cell(row,c)}</div></div>)}</div>
   {actions&&<div className="adminCardActions">{actions.render(row)}</div>}
  </article>):<Empty>{empty}</Empty>}</div>;
 }
 return <div className={"adminTableWrap"+(scroll?" scroll":"")}><table className="adminTable"><thead><tr>{columns.map(c=><th key={c.key} scope="col">{c.label}</th>)}</tr></thead><tbody>{rows.length?rows.map((row,index)=><tr key={rowKey(row,index)}>{columns.map(c=><td key={c.key}>{cell(row,c)}</td>)}</tr>):<tr><td colSpan={columns.length}><Empty>{empty}</Empty></td></tr>}</tbody></table></div>
}

export function SubscriptionsModule(){
 const[rows,setRows]=useState([]),[query,setQuery]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(""),[notice,setNotice]=useState(null);
 const load=async(q=query)=>{setLoading(true);setNotice(null);try{const data=await api("/api/admin/subscriptions?q="+encodeURIComponent(q));setRows(data.servers||[])}catch(error){setNotice({text:error.message})}finally{setLoading(false)}};
 useEffect(()=>{load("")},[]);
 const change=async(row,action)=>{let days;if(action!=="revoke"){const raw=window.prompt(`${action==="grant"?"Grant":"Extend"} VIP for how many days?`,"30");if(raw===null)return;days=Number(raw);if(!Number.isFinite(days)||days<1)return setNotice({text:"Enter a valid number of days."})}else if(!window.confirm(`Revoke VIP from ${row.guildName||row.guildId}?`))return;setBusy(row.guildId+action);setNotice(null);try{await api(`/api/admin/subscriptions/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({guildId:row.guildId,days})});setNotice({ok:true,text:`VIP ${action} completed.`});await load()}catch(error){setNotice({text:error.message})}finally{setBusy("")}};
 const columns=[
  {key:"server",label:"SERVER",card:false,render:r=><div className="adminIdentity"><span>{r.icon?<img src={`https://cdn.discordapp.com/icons/${r.guildId}/${r.icon}.png?size=64`} alt=""/>:(r.guildName||"?").slice(0,1)}</span><div><b>{r.guildName||"Unknown server"}</b><small title={r.guildId||undefined}>{r.guildId}</small></div></div>},
  {key:"owner",label:"OWNER",render:r=><><b>{r.ownerName||"—"}</b><small className="adminCellSub" title={r.ownerId||undefined}>{r.ownerId||""}</small></>},
  {key:"plan",label:"PLAN",render:r=><Badge tone={String(r.status||"").toLowerCase()}>{r.plan}</Badge>},
  {key:"expiresAt",label:"EXPIRES",render:r=><><span>{when(r.expiresAt)}</span><small className="adminCellSub">{r.remaining||r.status}</small></>},
  {key:"actions",label:"ACTIONS",render:r=><div className="adminRowActions">{r.status!=="ACTIVE"&&<button type="button" disabled={!!busy} onClick={()=>change(r,"grant")}>Grant VIP</button>}<button type="button" disabled={!!busy} onClick={()=>change(r,"extend")}>Extend</button>{r.status==="ACTIVE"&&<button type="button" className="danger" disabled={!!busy} onClick={()=>change(r,"revoke")}>Revoke</button>}</div>}
 ];
 return <section className="adminModule">
  <div className="adminModuleToolbar"><div className="adminField"><label className="adminFieldLabel" htmlFor="admin-sub-q">SEARCH</label><div className="adminSearch"><Search aria-hidden="true"/><input id="admin-sub-q" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load()} placeholder="Server name or Discord ID"/></div></div><button type="button" onClick={()=>load(query)}><RefreshCw aria-hidden="true"/>Refresh</button></div>
  <Notice value={notice}/>{loading?<Loading/>:<Table columns={columns} rows={rows} empty="No servers match this search." cardTitle={r=><div className="adminIdentity"><span>{r.icon?<img src={`https://cdn.discordapp.com/icons/${r.guildId}/${r.icon}.png?size=64`} alt=""/>:(r.guildName||"?").slice(0,1)}</span><div><b>{r.guildName||"Unknown server"}</b><small>{r.guildId}</small></div><Badge tone={String(r.status||"").toLowerCase()}>{r.plan}</Badge></div>}/>}
 </section>
}

export function CodesModule(){
 const[codes,setCodes]=useState([]),[loading,setLoading]=useState(true),[notice,setNotice]=useState(null),[form,setForm]=useState({codeMode:"generate",customCode:"",durationPreset:"30",durationDays:"30",maxRedemptions:"1",status:"active",expiresAt:""}),[history,setHistory]=useState(null);
 const load=async()=>{setLoading(true);try{const data=await api("/api/admin/vip-codes");setCodes(data.codes||[])}catch(error){setNotice({text:error.message})}finally{setLoading(false)}};
 useEffect(()=>{load()},[]);
 const create=async e=>{e.preventDefault();setNotice(null);try{const data=await api("/api/admin/vip-codes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});setNotice({ok:true,text:`Code ${data.code.code} created.`});setForm(v=>({...v,customCode:""}));await load()}catch(error){setNotice({text:error.message})}};
 const patch=async(code,status)=>{if(status==="disabled"&&!window.confirm(`Disable code ${code.code}? It can no longer be redeemed.`))return;try{await api(`/api/admin/vip-codes/${encodeURIComponent(code.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})});setNotice({ok:true,text:`Code ${code.code} ${status==="disabled"?"disabled":"enabled"}.`});await load()}catch(error){setNotice({text:error.message})}};
 const remove=async code=>{if(!window.confirm(`Delete ${code.code}? This cannot be undone.`))return;try{await api(`/api/admin/vip-codes/${encodeURIComponent(code.id)}`,{method:"DELETE"});setNotice({ok:true,text:`Code ${code.code} deleted.`});await load()}catch(error){setNotice({text:error.message})}};
 const showHistory=async code=>{try{setHistory(await api(`/api/admin/vip-codes/${encodeURIComponent(code.id)}/history`))}catch(error){setNotice({text:error.message})}};
 const columns=[
  {key:"code",label:"CODE",card:false,render:r=><div className="adminCode"><b>{r.code}</b><button type="button" title="Copy code" aria-label={`Copy code ${r.code}`} onClick={()=>navigator.clipboard?.writeText(r.code)}><Copy aria-hidden="true"/></button></div>},
  {key:"durationDays",label:"DURATION",render:r=>`${r.durationDays} days`},
  {key:"uses",label:"USES",render:r=>`${r.usedCount} / ${r.maxUses}`},
  {key:"status",label:"STATUS",render:r=><Badge tone={r.status}>{r.status}</Badge>},
  {key:"expiresAt",label:"EXPIRES",render:r=>when(r.expiresAt)},
  {key:"actions",label:"ACTIONS",render:r=><div className="adminRowActions"><button type="button" onClick={()=>showHistory(r)}>History</button><button type="button" onClick={()=>patch(r,r.status==="active"?"disabled":"active")}>{r.status==="active"?"Disable":"Enable"}</button><button type="button" className="danger icon" title="Delete code" aria-label={`Delete code ${r.code}`} onClick={()=>remove(r)}><Trash2 aria-hidden="true"/></button></div>}
 ];
 return <section className="adminModule">
  <form className="adminCreateCard" onSubmit={create}>
   <div className="adminCreateHead"><small>NEW VIP CODE</small><h3>Create activation code</h3></div>
   <label className="adminField"><span className="adminFieldLabel">MODE</span><select value={form.codeMode} onChange={e=>setForm({...form,codeMode:e.target.value})}><option value="generate">Generate automatically</option><option value="custom">Custom code</option></select></label>
   {form.codeMode==="custom"&&<label className="adminField"><span className="adminFieldLabel">CUSTOM CODE</span><input value={form.customCode} onChange={e=>setForm({...form,customCode:e.target.value})} placeholder="BALTICM2026"/></label>}
   <label className="adminField"><span className="adminFieldLabel">DURATION</span><select value={form.durationPreset} onChange={e=>setForm({...form,durationPreset:e.target.value,durationDays:e.target.value==="custom"?form.durationDays:e.target.value})}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option><option value="custom">Custom</option></select></label>
   {form.durationPreset==="custom"&&<label className="adminField"><span className="adminFieldLabel">DAYS</span><input type="number" min="1" max="3650" value={form.durationDays} onChange={e=>setForm({...form,durationDays:e.target.value})}/></label>}
   <label className="adminField"><span className="adminFieldLabel">MAX REDEMPTIONS</span><input type="number" min="1" max="100000" value={form.maxRedemptions} onChange={e=>setForm({...form,maxRedemptions:e.target.value})}/></label>
   <label className="adminField"><span className="adminFieldLabel">EXPIRES (OPTIONAL)</span><input type="datetime-local" value={form.expiresAt} onChange={e=>setForm({...form,expiresAt:e.target.value})}/></label>
   <button className="primary adminSubmit" type="submit"><KeyRound aria-hidden="true"/>Create code</button>
  </form>
  <Notice value={notice}/>{loading?<Loading/>:<Table columns={columns} rows={codes} empty="No VIP codes have been created." cardTitle={r=><div className="adminCode"><b>{r.code}</b><Badge tone={r.status}>{r.status}</Badge></div>}/>}
  {history&&<div className="adminModalBackdrop" onClick={()=>setHistory(null)}><div className="adminModal" role="dialog" aria-modal="true" aria-label="Redemption history" onClick={e=>e.stopPropagation()}><header><div><small>REDEMPTION HISTORY</small><h3>{history.code?.code}</h3></div><button type="button" className="icon" aria-label="Close history" onClick={()=>setHistory(null)}><XCircle aria-hidden="true"/></button></header><Table columns={[{key:"discordUsername",label:"USER",render:r=><NameId name={r.discordUsername} id={r.discordUserId}/>},{key:"guildName",label:"SERVER",render:r=><NameId name={r.guildName} id={r.guildId}/>},{key:"redeemedAt",label:"REDEEMED",render:r=>when(r.redeemedAt)},{key:"result",label:"RESULT",render:r=><Badge>{r.result}</Badge>}]} rows={history.history||[]} empty="This code has not been redeemed." cardTitle={r=><b>{r.discordUsername||r.discordUserId}</b>}/></div></div>}
 </section>
}

export function TebexModule(){
 const[data,setData]=useState(null),[loading,setLoading]=useState(true),[notice,setNotice]=useState(null),[query,setQuery]=useState("");
 const load=async()=>{setLoading(true);setNotice(null);try{setData(await api("/api/admin/tebex"))}catch(error){setNotice({text:error.message})}finally{setLoading(false)}};
 useEffect(()=>{load()},[]);
 if(loading)return <section className="adminModule"><Loading/></section>;
 if(!data)return <section className="adminModule"><Notice value={notice}/><Empty>Tebex data could not be loaded.</Empty></section>;
 const payments=(data.payments||[]).filter(r=>JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));
 const paymentColumns=[
  {key:"updatedAt",label:"DATE",render:r=>when(r.updatedAt||r.createdAt)},
  {key:"reference",label:"REFERENCE",render:r=><NameId name={r.referenceLabel} id={r.reference}/>},
  {key:"discordUserId",label:"DISCORD USER",render:r=><NameId name={r.discordUserName} id={r.discordUserId}/>},
  {key:"guildId",label:"SERVER",render:r=><NameId name={r.guildName} id={r.guildId}/>},
  {key:"amountLabel",label:"AMOUNT",render:r=><b>{r.amountLabel||"—"}</b>},
  {key:"status",label:"STATUS",render:r=><Badge tone={r.status}>{r.status}</Badge>}
 ];
 const eventColumns=[
  {key:"receivedAt",label:"RECEIVED",render:r=>when(r.receivedAt)},
  {key:"type",label:"TYPE",render:r=>r.type||"—"},
  {key:"paymentId",label:"PAYMENT",render:r=><span className="adminMono">{r.paymentId||"—"}</span>},
  {key:"handled",label:"HANDLED",render:r=><Badge tone={r.handled}>{String(r.handled)}</Badge>}
 ];
 return <section className="adminModule">
  <div className="adminMetricGrid"><div><Server aria-hidden="true"/><span><small>TEBEX</small><b>{data.config?.statusLabel||"Unknown"}</b><em>{data.config?.packageName}</em></span></div><div><ShieldCheck aria-hidden="true"/><span><small>VIP PACKAGE</small><b>{data.config?.price||"—"}</b><em>ID {data.config?.packageId||"not configured"}</em></span></div><div><Wifi aria-hidden="true"/><span><small>LAST WEBHOOK</small><b>{data.webhook?.label||"No activity"}</b><em>{when(data.webhook?.lastReceivedAt)}</em></span></div></div>
  <Notice value={notice}/>
  <div className="adminModuleToolbar"><div className="adminField"><label className="adminFieldLabel" htmlFor="admin-tebex-q">SEARCH PAYMENTS</label><div className="adminSearch"><Search aria-hidden="true"/><input id="admin-tebex-q" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Reference, name, user or server ID"/></div></div><button type="button" onClick={load}><RefreshCw aria-hidden="true"/>Refresh</button></div>
  <h3 className="adminSectionTitle">Payments</h3><Table columns={paymentColumns} rows={payments} empty="No Tebex payments are stored yet." cardTitle={r=><div className="adminCardTitleRow"><b>{r.amountLabel||"Payment"}</b><Badge tone={r.status}>{r.status}</Badge></div>}/>
  <h3 className="adminSectionTitle">Webhook events</h3><Table columns={eventColumns} rows={data.webhookEvents||[]} empty="No webhook events are stored yet." cardTitle={r=><div className="adminCardTitleRow"><b>{r.type||"Event"}</b><Badge tone={r.handled}>{String(r.handled)}</Badge></div>}/>
 </section>
}

export function AssistantModule(){
 const[question,setQuestion]=useState(""),[answer,setAnswer]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(null);
 const ask=async text=>{const q=(text??question).trim();if(!q)return;setBusy(true);setNotice(null);try{setAnswer(await api("/api/admin/assistant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q})}));setQuestion("")}catch(error){setNotice({text:error.message})}finally{setBusy(false)}};
 const quick=["Platform status","Recent errors","Recent payments","VIP activity","Support overview"];
 return <section className="adminModule adminAssistant">
  <div className="adminAssistantIntro"><Bot aria-hidden="true"/><div><small>READ-ONLY PLATFORM ASSISTANT</small><h3>BalticM Admin Assistant</h3><p>Read-only platform assistant. Answers are built from stored platform information and service checks.</p></div></div>
  <div className="adminQuickActions" role="group" aria-label="Quick prompts">{quick.map(x=><button type="button" key={x} onClick={()=>ask(x)} disabled={busy}>{x}</button>)}</div>
  <div className="adminAssistantAsk"><label className="adminFieldLabel" htmlFor="admin-assistant-input">YOUR QUESTION</label><div className="adminAssistantAskRow"><input id="admin-assistant-input" value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>e.key==="Enter"&&ask()} placeholder="Ask: Which VIP subscriptions expire soon?"/><button type="button" className="primary" onClick={()=>ask()} disabled={busy||!question.trim()}><Send aria-hidden="true"/>{busy?"Checking…":"Ask"}</button></div></div>
  <Notice value={notice}/>{answer&&<div className="adminAssistantAnswer"><small>{answer.intent?.replaceAll("_"," ")||"ANSWER"}</small><h3>{answer.reply}</h3>{answer.cards?.length>0&&<div className="adminMetricGrid compact">{answer.cards.map((card,index)=><div key={card.name||index}><CheckCircle2 aria-hidden="true"/><span><small>{card.name}</small><b>{card.status}</b><em>{card.detail}</em></span></div>)}</div>}{answer.rows?.length>0&&<Table columns={Object.keys(answer.rows[0]).slice(0,6).map(key=>({key,label:key.replace(/([A-Z])/g," $1").toUpperCase(),render:r=>key.toLowerCase().includes("at")?when(r[key]):String(r[key]??"—")}))} rows={answer.rows}/>}</div>}
 </section>
}

export function LogsModule(){
 const[data,setData]=useState(null),[loading,setLoading]=useState(true),[query,setQuery]=useState(""),[category,setCategory]=useState("all"),[status,setStatus]=useState("all"),[notice,setNotice]=useState(null);
 const load=async()=>{setLoading(true);setNotice(null);try{setData(await api(`/api/admin/logs?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}&status=${encodeURIComponent(status)}`))}catch(error){setNotice({text:error.message})}finally{setLoading(false)}};
 useEffect(()=>{load()},[]);
 const columns=[
  {key:"createdAt",label:"DATE",render:r=>when(r.createdAt)},
  {key:"category",label:"CATEGORY",render:r=><Badge tone={String(r.category||"").toLowerCase()}>{r.category}</Badge>},
  {key:"action",label:"ACTION",render:r=><b>{r.action||"—"}</b>},
  {key:"actorDiscordId",label:"ACTOR",render:r=><NameId name={r.actorLabel} id={r.actorDiscordId}/>},
  {key:"guildId",label:"SERVER",render:r=><NameId name={r.guildLabel} id={r.guildId}/>},
  {key:"reference",label:"REFERENCE",render:r=><NameId name={r.referenceLabel} id={r.reference}/>},
  {key:"status",label:"STATUS",render:r=><Badge tone={String(r.status||"").toLowerCase()}>{r.status||"—"}</Badge>},
  {key:"details",label:"DETAILS",render:r=><span className="adminDetails">{r.details||"—"}</span>}
 ];
 return <section className="adminModule">
  <div className="adminModuleToolbar wrap">
   <div className="adminField"><label className="adminFieldLabel" htmlFor="admin-logs-q">SEARCH</label><div className="adminSearch"><Search aria-hidden="true"/><input id="admin-logs-q" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load()} placeholder="Action, name, actor or reference"/></div></div>
   <div className="adminField adminFieldNarrow"><label className="adminFieldLabel" htmlFor="admin-logs-cat">CATEGORY</label><select id="admin-logs-cat" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All categories</option>{(data?.categories||[]).map(x=><option key={x} value={x}>{x}</option>)}</select></div>
   <div className="adminField adminFieldNarrow"><label className="adminFieldLabel" htmlFor="admin-logs-status">STATUS</label><input id="admin-logs-status" className="adminStatusFilter" value={status} onChange={e=>setStatus(e.target.value)} placeholder="Status or all"/></div>
   <button type="button" className="adminApply" onClick={load}><RefreshCw aria-hidden="true"/>Apply</button>
  </div>
  <Notice value={notice}/>{loading?<Loading/>:<Table scroll columns={columns} rows={data?.events||[]} empty="No stored events match these filters." cardTitle={r=><div className="adminCardTitleRow"><b>{r.action||"Event"}</b><Badge tone={String(r.category||"").toLowerCase()}>{r.category}</Badge></div>}/>}
 </section>
}

export function SettingsModule(){
 const[data,setData]=useState(null),[loading,setLoading]=useState(true),[notice,setNotice]=useState(null);
 const load=async()=>{setLoading(true);setNotice(null);try{setData(await api("/api/admin/settings"))}catch(error){setNotice({text:error.message})}finally{setLoading(false)}};
 useEffect(()=>{load()},[]);
 if(loading)return <section className="adminModule"><Loading/></section>;
 if(!data)return <section className="adminModule"><Notice value={notice}/><Empty>Settings could not be loaded.</Empty></section>;
 return <section className="adminModule">
  <div className="adminReadonly"><ShieldCheck aria-hidden="true"/><div><small>GLOBAL OWNER SETTINGS</small><h3>Read-only production configuration</h3><p>{data.general?.note}</p></div><button type="button" onClick={load}><RefreshCw aria-hidden="true"/>Refresh</button></div>
  <div className="adminMetricGrid"><div><Server aria-hidden="true"/><span><small>ENVIRONMENT</small><b>{data.system?.environment||"—"}</b><em>Production runtime</em></span></div><div><Database aria-hidden="true"/><span><small>DATABASE</small><b>{data.system?.database?.status||"—"}</b><em>{data.system?.database?.message||"D1 query status"}</em></span></div><div><Wifi aria-hidden="true"/><span><small>SERVICES</small><b>{data.system?.discord?.ok?"Online":"Attention needed"}</b><em>{data.system?.discord?.services?.length||0} checked</em></span></div><div><ExternalLink aria-hidden="true"/><span><small>TEBEX</small><b>{data.system?.tebex?.configured?"Configured":"Configuration issue"}</b><em>Credentials shown as presence only</em></span></div></div>
  <div className="adminSettingsGrid">
   <article><small>VIP LIMITS</small><h3>Current runtime values</h3><dl><div><dt>Default VIP duration</dt><dd>{data.premium?.defaultVipDurationDays} days</dd></div><div><dt>FREE reaction roles</dt><dd>{data.premium?.freeReactionRolesLimit}</dd></div><div><dt>VIP reaction roles</dt><dd>{data.premium?.vipReactionRolesLimit}</dd></div><div><dt>VIP Voice Create</dt><dd>{data.premium?.vipVoiceCreateLimit}</dd></div></dl></article>
   <article><small>SERVICE HEALTH</small><h3>Live checks</h3><div className="adminServiceList">{(data.system?.discord?.services||[]).map(x=><div key={x.name}><span className={x.ok?"ok":"bad"} aria-hidden="true"/><b>{x.name}</b><small>{x.kind}</small><em className={x.ok?"ok":"bad"}>{x.ok?"ONLINE":`HTTP ${x.status||0}`}</em></div>)}</div></article>
  </div>
 </section>
}
