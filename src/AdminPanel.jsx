import React,{useEffect,useMemo,useRef,useState}from"react";
import{Activity,ArrowLeft,ChevronRight,Clock3,Inbox,LifeBuoy,Menu,MessageCircle,RefreshCw,Send,Server,Settings,Shield,TicketCheck,Users,X}from"lucide-react";
import{AssistantModule,CodesModule,LogsModule,SettingsModule,SubscriptionsModule,TebexModule}from"./admin-modules.jsx";
import"./admin.css";

const statusLabel=s=>({open:"OPEN",waiting_staff:"WAITING FOR STAFF",waiting_customer:"WAITING FOR CUSTOMER",closed:"CLOSED"}[s]||String(s||"OPEN").toUpperCase());
const when=v=>{try{return new Date(v).toLocaleString()}catch{return v||""}};
const humanError=(status,raw)=>{
 if(status===403)return"You do not have permission to do that.";
 if(status===401)return"Your session has expired. Please connect Discord again.";
 if(status===404)return"That item could not be found.";
 if(status===429)return"Too many requests. Please wait a moment and try again.";
 const text=typeof raw==="string"?raw.trim():"";
 if(status>=500)return"The server could not complete that request. Please try again.";
 if(text&&text!=="Forbidden"&&text!=="[object Object]"&&!/^\d{3}$/.test(text))return text;
 return"Request could not be completed. Please try again.";
};
const nav=[["Dashboard",Activity],["Support Inbox",Inbox],["Subscriptions",Users],["Codes",TicketCheck],["Tebex",Server],["Assistant",MessageCircle],["Logs",Clock3],["Settings",Settings]];
const quickLinks=[["Support Inbox",Inbox],["Subscriptions",Users],["Codes",TicketCheck],["Tebex",Server],["Logs",Clock3],["Settings",Settings]];

function AdminDashboard({threads,unread,health,vipCount,openSection,openThread}){
 const open=threads.filter(t=>t.status!=="closed").length;
 const services=health&&Array.isArray(health.services)?health.services:[];
 const online=services.filter(s=>s&&s.ok).length;
 const recent=threads.slice(0,5);
 const vipLabel=vipCount===null?"…":vipCount<0?"—":vipCount;
 return <section className="adminDashboard">
  <div className="adminStatGrid">
   <div className="adminStat"><span className="adminStatIcon"><LifeBuoy/></span><span className="adminStatCopy"><small>OPEN SUPPORT</small><b>{open}</b><em>Conversations awaiting reply</em></span></div>
   <div className="adminStat"><span className="adminStatIcon"><Inbox/></span><span className="adminStatCopy"><small>UNREAD MESSAGES</small><b>{unread}</b><em>Waiting for staff</em></span></div>
   <div className="adminStat"><span className="adminStatIcon"><Users/></span><span className="adminStatCopy"><small>ACTIVE VIP</small><b>{vipLabel}</b><em>Paid subscriptions</em></span></div>
   <div className="adminStat"><span className="adminStatIcon"><Activity/></span><span className="adminStatCopy"><small>SERVICE STATUS</small><b>{health===null?"…":services.length?online+"/"+services.length:"—"}</b><em>{health===null?"Checking services":services.length&&online===services.length?"All systems online":services.length?"Attention needed":"Status unavailable"}</em></span></div>
  </div>
  <div className="adminDashCols">
   <article className="adminPanelCard">
    <div className="adminPanelCardHead"><div><small>RECENT SUPPORT</small><h3>Latest conversations</h3></div><button type="button" onClick={()=>openSection("Support Inbox")}>Open inbox<ChevronRight/></button></div>
    {recent.length?<div className="adminRecentList">{recent.map(t=><button type="button" key={t.id} className="adminRecentRow" onClick={()=>openThread(t.id)}>
      <span className="adminRecentWho"><b>{t.userName||t.userId}</b><small>{t.guildName||"BalticM Bot"}</small></span>
      <span className={"adminStatus "+t.status}>{statusLabel(t.status)}</span>
      <time>{when(t.updatedAt)}</time>
      <ChevronRight/>
     </button>)}</div>:<div className="adminEmpty"><Inbox/><b>No support conversations</b><span>New customer conversations appear here.</span></div>}
   </article>
   <article className="adminPanelCard">
    <div className="adminPanelCardHead"><div><small>QUICK ACTIONS</small><h3>Jump to a section</h3></div></div>
    <div className="adminQuickGrid">{quickLinks.map(([label,Icon])=><button type="button" key={label} onClick={()=>openSection(label)}><Icon/><span>{label}</span><ChevronRight/></button>)}</div>
   </article>
  </div>
  <article className="adminPanelCard">
   <div className="adminPanelCardHead"><div><small>PLATFORM</small><h3>Service health</h3></div></div>
   <div className="adminServiceList">{services.length?services.map(s=><div key={s.name}><span className={s.ok?"ok":"bad"} aria-hidden="true"/><b>{s.name}</b><small>{s.kind}</small><em className={s.ok?"ok":"bad"}>{s.ok?"ONLINE":`HTTP ${s.status||"ERROR"}`}</em></div>):<span className="adminMuted">{health===null?"Checking services…":"Service status is unavailable right now."}</span>}</div>
  </article>
 </section>
}

export default function AdminPanel(){
 const messagesEndRef=useRef(null),vipRef=useRef(false);
 const[access,setAccess]=useState(null),[threads,setThreads]=useState([]),[selected,setSelected]=useState(""),[thread,setThread]=useState(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[section,setSection]=useState("Support Inbox"),[drawer,setDrawer]=useState(false),[chatOpen,setChatOpen]=useState(false),[supportError,setSupportError]=useState(""),[health,setHealth]=useState(null),[vipCount,setVipCount]=useState(null);
 const loadThreads=async()=>{try{const r=await fetch("/api/admin/support/threads",{cache:"no-store"});if(r.status===403){setAccess(false);return}const j=await r.json().catch(()=>({}));if(!r.ok){setSupportError(humanError(r.status,j.error));return}setSupportError("");setThreads(j.threads||[]);setAccess(true);if(!selected&&j.threads?.[0]?.id)setSelected(j.threads[0].id)}catch{setSupportError("Could not load conversations. Check your connection and try again.")}};
 const loadThread=async id=>{if(!id)return setThread(null);try{const r=await fetch("/api/admin/support/thread?id="+encodeURIComponent(id),{cache:"no-store"});if(r.status===403){setAccess(false);return}const j=await r.json().catch(()=>({}));if(r.ok)setThread(j);else setSupportError(humanError(r.status,j.error))}catch{setSupportError("Could not load this conversation. Check your connection and try again.")}};
 useEffect(()=>{fetch("/api/admin/access",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(j=>{const ok=!!j?.admin;setAccess(ok);if(ok)loadThreads()}).catch(()=>setAccess(false))},[]);
 useEffect(()=>{if(selected)loadThread(selected)},[selected]);
 useEffect(()=>{fetch("/api/health",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(j=>setHealth(j||{ok:false,services:[]})).catch(()=>setHealth({ok:false,services:[]}))},[]);
 useEffect(()=>{if(section!=="Dashboard"||vipRef.current)return;vipRef.current=true;fetch("/api/admin/subscriptions?q=",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(j=>setVipCount(j?(j.servers||[]).filter(r=>r.status==="ACTIVE").length:-1)).catch(()=>setVipCount(-1))},[section]);
 useEffect(()=>{if(!drawer)return;const onKey=e=>{if(e.key==="Escape")setDrawer(false)};document.addEventListener("keydown",onKey);const prev=document.body.style.overflow;document.body.style.overflow="hidden";return()=>{document.removeEventListener("keydown",onKey);document.body.style.overflow=prev}},[drawer]);
 const unread=useMemo(()=>threads.reduce((n,t)=>n+Number(t.unreadStaff||0),0),[threads]);
 useEffect(()=>{if(thread?.messages)requestAnimationFrame(()=>messagesEndRef.current?.scrollIntoView({behavior:"smooth",block:"end"}))},[thread?.messages?.length,selected]);
 const reply=async()=>{const text=message.trim();if(!text||!selected||busy)return;setBusy(true);setSupportError("");try{const r=await fetch("/api/admin/support/reply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({threadId:selected,message:text})});const j=await r.json().catch(()=>({}));if(r.ok){setMessage("");await loadThread(selected);await loadThreads()}else setSupportError(humanError(r.status,j.error))}catch{setSupportError("Could not send your reply. Check your connection and try again.")}finally{setBusy(false)}};
 const setStatus=async status=>{if(!selected)return;setBusy(true);setSupportError("");try{const r=await fetch("/api/admin/support/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({threadId:selected,status})});const j=await r.json().catch(()=>({}));if(r.ok){await loadThread(selected);await loadThreads()}else setSupportError(humanError(r.status,j.error))}catch{setSupportError("Could not update this conversation. Check your connection and try again.")}finally{setBusy(false)}};
 const goSection=next=>{setSection(next);setDrawer(false);if(next!=="Support Inbox")setChatOpen(false)};
 const openThread=id=>{setSelected(id);setChatOpen(true);setSection("Support Inbox");setDrawer(false)};
 if(access===null)return <div className="adminGate"><Shield/><b>Opening BalticM Admin…</b><span>Checking your staff access…</span></div>;
 if(!access)return <div className="adminGate"><Shield/><b>Access denied</b><span>This area is restricted to BalticM staff.</span><a href="/"><ArrowLeft/>Back to Control Center</a></div>;
 const modules={Subscriptions:<SubscriptionsModule/>,Codes:<CodesModule/>,Tebex:<TebexModule/>,Assistant:<AssistantModule/>,Logs:<LogsModule/>,Settings:<SettingsModule/>};
 return <div className="adminShell">
  <header className="adminMobileBar">
   <span className="adminMobileBrand"><Shield/><b>BALTICM</b><small>ADMIN PANEL</small></span>
   <span className="adminMobilePage">{section}</span>
   <button type="button" className="adminMenuBtn" aria-label="Open navigation" aria-expanded={drawer} aria-controls="adminNav" onClick={()=>setDrawer(true)}><Menu/></button>
  </header>
  {drawer&&<div className="adminNavBackdrop" onClick={()=>setDrawer(false)} aria-hidden="true"/>}
  <aside className={"adminSide"+(drawer?" open":"")} id="adminNav" aria-label="Admin navigation">
   <div className="adminBrand"><Shield/><span><b>BALTICM</b><small>ADMIN PANEL</small></span><button type="button" className="adminNavClose" aria-label="Close navigation" onClick={()=>setDrawer(false)}><X/></button></div>
   <span className="adminNavLabel">NAVIGATION</span>
   <nav>{nav.map(([n,I])=><button key={n} type="button" className={section===n?"active":""} aria-current={section===n?"page":undefined} onClick={()=>goSection(n)}><I/><span>{n}</span>{n==="Support Inbox"&&unread>0?<i aria-label={unread+" unread messages"}>{unread>99?"99+":unread}</i>:null}</button>)}</nav>
   <a href="/"><ArrowLeft/>Control Center</a>
  </aside>
  <main className="adminMain">
   <header><div><small>BALTICM STAFF</small><h1>{section}</h1></div>{section==="Support Inbox"&&<button type="button" onClick={()=>{loadThreads();if(selected)loadThread(selected)}}><RefreshCw/>Refresh</button>}</header>
   {supportError&&<div className="adminNotice" role="alert">{supportError}</div>}
   {section==="Dashboard"?<AdminDashboard threads={threads} unread={unread} health={health} vipCount={vipCount} openSection={goSection} openThread={openThread}/>:section==="Support Inbox"?<section className={"adminSupport"+(chatOpen?" showChat":"")}>
    <div className="adminThreads"><div className="adminThreadsHead"><b>Conversations</b><span>{threads.length}</span></div>{threads.length?threads.map(t=><button key={t.id} type="button" className={selected===t.id?"selected":""} onClick={()=>{setSelected(t.id);setChatOpen(true)}}><span className="adminThreadTop"><b>{t.userName||t.userId}</b>{Number(t.unreadStaff)>0&&<i>{t.unreadStaff}</i>}</span><small>{t.guildName||"BalticM Bot"}</small><span className={"adminStatus "+t.status}>{statusLabel(t.status)}</span><time>{when(t.updatedAt)}</time></button>):<div className="adminEmpty"><Inbox/><b>No support conversations</b><span>Customer messages will appear here.</span></div>}</div>
    <div className="adminConversation">{thread?.thread?<><div className="adminConversationHead"><button type="button" className="adminChatBack" onClick={()=>setChatOpen(false)}><ArrowLeft/>Conversations</button><div><b>{thread.thread.userName||thread.thread.userId}</b><small><Server/> {thread.thread.guildName||"No server selected"}{thread.thread.userId&&<> • <span className="adminIdMuted" title={thread.thread.userId}>Discord ID {thread.thread.userId}</span></>}</small></div><span className={"adminStatus "+thread.thread.status}>{statusLabel(thread.thread.status)}</span></div><div className="adminMessages">{(thread.messages||[]).map(m=><div key={m.id} className={"adminBubble "+(m.senderType==="staff"?"staff":"customer")}><small>{m.senderType==="staff"?(m.senderName||"BalticM Support"):(m.senderName||"Customer")}</small><p>{m.message}</p><time>{when(m.createdAt)}</time></div>)}<div ref={messagesEndRef}/></div><div className="adminStatusActions">{thread.thread.status==="closed"?<button type="button" onClick={()=>setStatus("open")}>Reopen</button>:<><button type="button" onClick={()=>setStatus("open")}>Open</button><button type="button" onClick={()=>setStatus("waiting_staff")}>Waiting for staff</button><button type="button" onClick={()=>setStatus("waiting_customer")}>Waiting for customer</button><button type="button" className="danger" onClick={()=>setStatus("closed")}><X/>Close</button></>}</div><div className="adminComposer"><textarea disabled={thread.thread.status==="closed"} value={message} maxLength={2000} aria-label="Reply as BalticM Support" placeholder={thread.thread.status==="closed"?"Reopen this conversation to reply":"Reply as BalticM Support…"} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();reply()}}}/><button type="button" disabled={busy||!message.trim()||thread.thread.status==="closed"} aria-label="Send reply" onClick={reply}><Send/></button></div></>:<div className="adminEmpty"><MessageCircle/><b>Select a conversation</b><span>Customer messages will appear here.</span></div>}</div>
   </section>:modules[section]}
  </main>
 </div>
}
