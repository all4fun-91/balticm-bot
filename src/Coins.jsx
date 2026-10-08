import React,{useEffect,useRef,useState}from"react";
import {AlertTriangle,Coins as CoinsIcon,Loader2,Plus,RefreshCw,Search,X}from"lucide-react";
import {TX_SOURCES}from"../coins.js";
import"./coins.css";

/* Control Center → 🪙 Baltic Coins (guild scoped). Every request carries the
   selected guild id; the worker validates session, membership and RBAC, and
   all wallet math happens server-side on the atomic ledger engine — this UI
   only reflects it. Per-section feedback, no page-level banners, no
   auto-scrolling, no horizontal overflow. */

const fmt=n=>Number(n||0).toLocaleString("en-US");
const num=(v,min,max)=>{const n=Math.floor(Number(v));return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min};
const avatarSrc=w=>w&&w.avatar?w.avatar:null;
const SOURCE_LABEL={
 starting_balance:"Starting balance",discord_daily:"Daily reward",discord_message:"Message reward",
 discord_voice:"Voice reward",discord_transfer:"Transfer",discord_shop:"Shop purchase",shop_refund:"Shop refund",
 game_reward:"Game reward",game_purchase:"Game purchase",admin_adjustment:"Admin adjustment",future_paid_purchase:"Coins purchase"
};
const SOURCE_OPTIONS=[{value:"",label:"All sources"},...TX_SOURCES.map(s=>({value:s,label:SOURCE_LABEL[s]||s}))];

/* Section tabs — the page stays ONE route (/coins); the selected section is
   mirrored in the `?tab=` query param so a refresh (or shared URL) lands on
   the same section. Overview is the default; unknown values fall back. */
const TABS=[
 {id:"overview",label:"Overview"},
 {id:"earning",label:"Earning Settings"},
 {id:"shop",label:"Shop"},
 {id:"wallets",label:"Members & Wallets"},
 {id:"transactions",label:"Transactions"},
 {id:"leaderboard",label:"Leaderboard"},
 {id:"games",label:"Game Integrations"}
];
const TAB_IDS=TABS.map(t=>t.id);
const readTabFromUrl=()=>{try{const t=new URLSearchParams(window.location.search).get("tab");return TAB_IDS.includes(t)?t:"overview"}catch{return "overview"}};
const when=iso=>{if(!iso)return"—";const d=new Date(iso);return Number.isNaN(d.getTime())?"—":d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})};

function Notice({value}){return value?<div className={"cnNotice "+(value.ok?"ok":"error")} role={value.ok?"status":"alert"}>{value.text}</div>:null}
function Toggle({label,value,onChange,disabled}){return <button type="button" className={"cnToggle"+(value?" on":"")} aria-pressed={value} disabled={disabled} onClick={()=>onChange(!value)}><span/>{label}</button>}

async function api(url,options){
 // The worker marks failed Discord access lookups as a retryable 503
 // (accessUnknown) — absorb one of them instead of flashing an error at the
 // admin; the page fires several loads at once on mount.
 for(let attempt=0;attempt<=1;attempt++){
  const r=await fetch(url,{cache:"no-store",...options});
  const data=await r.json().catch(()=>({}));
  if(r.status===503&&data.accessUnknown&&attempt===0){await new Promise(res=>setTimeout(res,1200));continue;}
  if(!r.ok)throw new Error(String(data&&data.error||"Request could not be completed."));
  return data;
 }
}

export default function Coins({user,selectedGuild,canConfigure,TicketOptionSelect}){
 const Select=TicketOptionSelect;
 const[loading,setLoading]=useState(true),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const[settingsNotice,setSettingsNotice]=useState(null),[shopNotice,setShopNotice]=useState(null);
 const[walletNotice,setWalletNotice]=useState(null),[buyNotice,setBuyNotice]=useState(null);
 const[state,setState]=useState(null);            // overview payload
 const[range,setRange]=useState(14);
 const[shopItems,setShopItems]=useState([]),[purchases,setPurchases]=useState([]);
 const[wallets,setWallets]=useState([]),[walletTotal,setWalletTotal]=useState(0),[walletQ,setWalletQ]=useState(""),[walletPage,setWalletPage]=useState(0);
 const[txs,setTxs]=useState([]),[txTotal,setTxTotal]=useState(0),[txSource,setTxSource]=useState(""),[txPage,setTxPage]=useState(0);
 const[board,setBoard]=useState([]),[boardLimit,setBoardLimit]=useState(10),[boardQ,setBoardQ]=useState("");
 const[form,setForm]=useState(null);             // settings form
 const[shopForm,setShopForm]=useState(null);     // item create/edit
 const[detail,setDetail]=useState(null);         // wallet detail
 const[adjust,setAdjust]=useState(null);         // {userId,displayName,action}
 const[adjAmount,setAdjAmount]=useState(""),[adjReason,setAdjReason]=useState("");
 const[tab,setTab]=useState(readTabFromUrl);   // visible section (URL ?tab=)
 const[formDirty,setFormDirty]=useState(false); // unsaved economy-settings edits
 const tabsRef=useRef(null);

 const set=(k,v)=>{setForm(f=>f?{...f,[k]:v}:f);setFormDirty(true)};
 const canEdit=!!canConfigure;

 /* Tab switching never resets unsaved edits: the forms' state lives in this
    component (unmounting a section only hides it), and the URL write touches
   ONLY the `tab` param — the selected guild and every other query param are
   left exactly as they were. */
 const selectTab=id=>{
  if(id===tab||!TAB_IDS.includes(id))return;
  setTab(id);
  try{
   const q=new URLSearchParams(window.location.search);
   if(id==="overview")q.delete("tab");else q.set("tab",id);
   const s=q.toString();
   window.history.replaceState({},document.title,window.location.pathname+(s?"?"+s:""));
  }catch{}
 };

 const loadOverview=async(days=range)=>{
  if(!selectedGuild)return;
  try{
   const d=await api(`/api/coins?guildId=${encodeURIComponent(selectedGuild)}&days=${days}`);
   setState(d);
   setForm(d.settings);
   setFormDirty(false);
  }catch(e){setError(e.message)}
 };
 const loadShop=async()=>{
  if(!selectedGuild)return;
  try{
   const[s,p]=await Promise.all([
    api(`/api/coins/shop?guildId=${encodeURIComponent(selectedGuild)}`),
    api(`/api/coins/purchases?guildId=${encodeURIComponent(selectedGuild)}&limit=50`)
   ]);
   setShopItems(s.items||[]);setPurchases(p.purchases||[]);
  }catch(e){setShopNotice({ok:false,text:e.message})}
 };
 const loadWallets=async(q=walletPage)=>{
  if(!selectedGuild)return;
  try{
   const d=await api(`/api/coins/wallets?guildId=${encodeURIComponent(selectedGuild)}&q=${encodeURIComponent(typeof q==="string"?q:walletQ)}&limit=25&offset=${typeof q==="number"?q*25:0}`);
   setWallets(d.wallets||[]);setWalletTotal(d.total||0);
   if(typeof q==="string")setWalletPage(0);
  }catch(e){setWalletNotice({ok:false,text:e.message})}
 };
 const loadTx=async(page=txPage,source=txSource)=>{
  if(!selectedGuild)return;
  try{
   const d=await api(`/api/coins/transactions?guildId=${encodeURIComponent(selectedGuild)}&source=${encodeURIComponent(source)}&limit=25&offset=${page*25}`);
   setTxs(d.entries||[]);setTxTotal(d.total||0);
  }catch(e){setWalletNotice({ok:false,text:e.message})}
 };
 const loadBoard=async(limit=boardLimit,q=boardQ)=>{
  if(!selectedGuild)return;
  try{
   const d=await api(`/api/coins/leaderboard?guildId=${encodeURIComponent(selectedGuild)}&limit=${limit}&q=${encodeURIComponent(q)}`);
   setBoard(d.entries||[]);
  }catch(e){setWalletNotice({ok:false,text:e.message})}
 };

 useEffect(()=>{
  if(!selectedGuild)return;
  let dead=false;(async()=>{
   setLoading(true);setError("");
   try{
    await Promise.all([loadOverview(range),loadShop(),loadWallets(0),loadTx(0,""),loadBoard(10,"")]);
   }catch(e){if(!dead)setError(e.message)}
   if(!dead)setLoading(false);
  })();
  return()=>{dead=true};
 },[selectedGuild]);

 /* Unsaved edits are never discarded silently: switching tabs keeps them in
    memory, and closing/refreshing the page with dirty forms asks first. */
 useEffect(()=>{
  if(!formDirty&&!shopForm&&!(adjust&&(adjAmount||adjReason)))return;
  const warn=e=>{e.preventDefault();e.returnValue=""};
  window.addEventListener("beforeunload",warn);
  return()=>window.removeEventListener("beforeunload",warn);
 },[formDirty,shopForm,adjust,adjAmount,adjReason]);

 /* Keep the active tab visible inside the horizontally scrollable strip (on
    mobile a deep-linked tab can start off-screen). Only the strip moves —
    never the page scroll position. */
 useEffect(()=>{
  const bar=tabsRef.current;if(!bar)return;
  const el=bar.querySelector(".cnTab.sel");if(!el)return;
  const b=bar.getBoundingClientRect(),r=el.getBoundingClientRect();
  if(r.left<b.left)bar.scrollLeft+=r.left-b.left-8;
  else if(r.right>b.right)bar.scrollLeft+=r.right-b.right+8;
 },[tab]);

 /* ---------------------------------------------------------- settings */
 const saveSettings=async e=>{
  e.preventDefault();
  if(!canEdit||!form)return;
  setBusy(true);setSettingsNotice(null);
  try{
   const r=await api(`/api/coins?guildId=${encodeURIComponent(selectedGuild)}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});
   setState(s=>s?{...s,settings:r.settings,configured:true}:s);
   setFormDirty(false);
   setSettingsNotice({ok:true,text:"Economy settings saved."});
  }catch(err){setSettingsNotice({ok:false,text:err.message})}
  finally{setBusy(false)}
 };

 /* -------------------------------------------------------------- shop */
 const saveShopItem=async e=>{
  e.preventDefault();
  if(!canEdit||!shopForm)return;
  setBusy(true);setShopNotice(null);
  try{
   const editing=!!shopForm.id;
   await api(editing?`/api/coins/shop/${encodeURIComponent(shopForm.id)}?guildId=${encodeURIComponent(selectedGuild)}`:`/api/coins/shop?guildId=${encodeURIComponent(selectedGuild)}`,
    {method:editing?"PUT":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(shopForm)});
   setShopForm(null);
   setShopNotice({ok:true,text:editing?"Item updated.":"Item added to the shop."});
   await loadShop();
  }catch(err){setShopNotice({ok:false,text:err.message})}
  finally{setBusy(false)}
 };
 const deleteItem=async item=>{
  if(!canEdit)return;
  if(!window.confirm(`Delete "${item.name}" from the shop? Existing purchases are kept.`))return;
  setBusy(true);setShopNotice(null);
  try{
   await api(`/api/coins/shop/${encodeURIComponent(item.id)}?guildId=${encodeURIComponent(selectedGuild)}`,{method:"DELETE"});
   setShopNotice({ok:true,text:"Item removed."});
   await loadShop();
  }catch(err){setShopNotice({ok:false,text:err.message})}
  finally{setBusy(false)}
 };
 const fulfill=async p=>{
  setBusy(true);setShopNotice(null);
  try{
   await api(`/api/coins/purchases/${encodeURIComponent(p.id)}/fulfill?guildId=${encodeURIComponent(selectedGuild)}`,{method:"POST",headers:{},body:"{}"});
   setShopNotice({ok:true,text:`Marked "${p.itemName}" as fulfilled.`});
   await Promise.all([loadShop(),loadOverview(range)]);
  }catch(err){setShopNotice({ok:false,text:err.message})}
  finally{setBusy(false)}
 };
 const refund=async p=>{
  if(!window.confirm(`Refund ${fmt(p.price)} Coins to <@${p.userId}> for "${p.itemName}"?`))return;
  setBusy(true);setShopNotice(null);
  try{
   const r=await api(`/api/coins/purchases/${encodeURIComponent(p.id)}/refund?guildId=${encodeURIComponent(selectedGuild)}`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
   setShopNotice({ok:true,text:r.refunded===false?(r.note||"Nothing to refund — no Coins were taken."):"Purchase refunded — Coins returned."});
   await Promise.all([loadShop(),loadOverview(range),loadWallets(0),loadTx(0,txSource)]);
  }catch(err){setShopNotice({ok:false,text:err.message})}
  finally{setBusy(false)}
 };

 /* ------------------------------------------------------------ wallets */
 const openDetail=async w=>{
  setWalletNotice(null);
  try{
   const d=await api(`/api/coins/wallets/${encodeURIComponent(w.userId)}?guildId=${encodeURIComponent(selectedGuild)}`);
   setDetail(d);
  }catch(e){setWalletNotice({ok:false,text:e.message})}
 };
 const runAdjust=async()=>{
  if(!adjust)return;
  const amount=Math.floor(Number(adjAmount));
  if(!Number.isFinite(amount)||amount<1){setWalletNotice({ok:false,text:"Enter a whole Coin amount greater than zero."});return}
  const verb=adjust.action==="add"?"add":adjust.action==="remove"?"remove":"set";
  if(!window.confirm(`${verb[0].toUpperCase()+verb.slice(1)} ${fmt(amount)} Coins ${adjust.action==="set"?"as the new balance of":""} ${adjust.displayName||adjust.userId}'s wallet?`))return;
  setBusy(true);setWalletNotice(null);
  try{
   await api(`/api/coins/wallets/${encodeURIComponent(adjust.userId)}/adjust?guildId=${encodeURIComponent(selectedGuild)}`,
    {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:adjust.action,amount,reason:adjReason,confirm:true})});
   setWalletNotice({ok:true,text:`Wallet updated: ${adjust.displayName||adjust.userId}.`});
   setAdjust(null);setAdjAmount("");setAdjReason("");
   await Promise.all([loadWallets(0),loadOverview(range),loadTx(0,txSource)]);
   if(detail&&detail.wallet&&String(detail.wallet.userId)===String(adjust.userId))openDetail({userId:adjust.userId});
  }catch(err){setWalletNotice({ok:false,text:err.message})}
  finally{setBusy(false)}
 };

 /* ----------------------------------------------- overview extras */
 const series=state&&Array.isArray(state.series)?state.series:[];
 const maxBar=Math.max(1,...series.map(d=>Math.max(d.earned,d.spent)));
 const stats=state&&state.stats?state.stats:{};
 const nameOf=(id,entry)=>(entry&&(entry.displayName||entry.username))||wallets.find(w=>String(w.userId)===String(id))?.displayName||`#${String(id).slice(-4)}`;

 if(!selectedGuild)return <section className="cnPanel"><div className="cnEmpty">Select a Discord server to manage its Baltic Coins economy.</div></section>;

 return <div className="cnPage">
  <div className="cnTabs" ref={tabsRef} role="tablist" aria-label="Baltic Coins sections">
   {TABS.map(t=><button key={t.id} type="button" role="tab" aria-selected={tab===t.id} className={tab===t.id?"cnTab sel":"cnTab"} onClick={()=>selectTab(t.id)}>{t.label}</button>)}
  </div>
  {error&&<div className="cnNotice error" role="alert">{error}</div>}
  {loading?<section className="cnPanel"><div className="cnEmpty"><Loader2 className="spin"/>Loading economy…</div></section>:state&&<>

  {/* ---------------------------------------------------- 1. Overview */}
  {tab==="overview"&&<section className="cnPanel">
   <div className="cnPanelHead">
    <div><span className="eyebrow">OVERVIEW</span><h3>Economy at a glance</h3></div>
    <div className="cnHeadActions">
     <span className={"cnStatusPill"+(state.settings.enabled?" on":"")}>{state.settings.enabled?"ENABLED":"DISABLED"}</span>
     <button type="button" className="cnGhost" onClick={()=>{if(formDirty&&!window.confirm("Discard unsaved economy settings changes?"))return;setLoading(true);Promise.all([loadOverview(range),loadShop(),loadWallets(0),loadTx(0,txSource),loadBoard(boardLimit,boardQ)]).finally(()=>setLoading(false))}}><RefreshCw/>Refresh</button>
    </div>
   </div>
   <div className="cnStats">
    <div className="cnStat"><span>COINS IN CIRCULATION</span><b>{fmt(stats.circulation)}</b><small>{state.currency.icon} {state.currency.name}</small></div>
    <div className="cnStat"><span>WALLETS</span><b>{fmt(stats.wallets)}</b><small>{fmt(stats.holders)} holding Coins</small></div>
    <div className="cnStat"><span>EARNED TODAY</span><b>+{fmt(stats.earnedToday)}</b><small>All sources</small></div>
    <div className="cnStat"><span>SPENT TODAY</span><b>−{fmt(stats.spentToday)}</b><small>Shop & transfers out</small></div>
    <div className="cnStat"><span>TRANSACTIONS</span><b>{fmt(stats.totalTransactions)}</b><small>Every change audited</small></div>
    <div className="cnStat"><span>ACTIVE TODAY</span><b>{fmt(stats.activeToday)}</b><small>Members transacting</small></div>
   </div>
   <div className="cnChartWrap">
    <div className="cnChartHead"><span>EARNINGS / SPENDING</span>
     <div className="cnRanges">{[7,14,30].map(d=><button key={d} type="button" className={range===d?"sel":""} onClick={()=>{setRange(d);loadOverview(d)}}>{d}d</button>)}</div>
    </div>
    <div className="cnChart" role="img" aria-label={`Coins earned and spent over the last ${range} days`}>
     {series.map(d=><div className="cnBar" key={d.day} title={`${d.day}: +${fmt(d.earned)} / −${fmt(d.spent)}`}>
      <i className="earn" style={{height:`${Math.round((d.earned/maxBar)*100)}%`}}/>
      <i className="spend" style={{height:`${Math.round((d.spent/maxBar)*100)}%`}}/>
     </div>)}
    </div>
    <div className="cnChartLegend"><span><i className="earn"/>Earned</span><span><i className="spend"/>Spent</span></div>
   </div>
   <div className="cnTwoCol">
    <div className="cnListBlock"><h4>Richest members</h4>
     {state.richest.length?state.richest.map((r,i)=><div className="cnMiniRow" key={r.userId}>
      <b className="cnRank">{i+1}</b>
      {r.avatar?<img src={r.avatar} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>:<i>{(r.displayName||r.username||"?").slice(0,1).toUpperCase()}</i>}
      <span>{r.displayName||r.username||`#${r.userId.slice(-4)}`}</span>
      <strong>{state.currency.icon} {fmt(r.balance)}</strong>
     </div>):<div className="cnSubtle">No wallets yet.</div>}
    </div>
    <div className="cnListBlock"><h4>Recent activity</h4>
     {state.recent.length?state.recent.map(t=><div className="cnMiniRow tx" key={t.id}>
      <span className={"cnAmt"+(t.amount<0?" neg":"")}>{t.amount>=0?"+":"−"}{fmt(Math.abs(t.amount))}</span>
      <span className="cnTxWhat">{SOURCE_LABEL[t.source]||t.source}<small>{nameOf(t.userId)} · {when(t.createdAt)}</small></span>
     </div>):<div className="cnSubtle">No transactions yet.</div>}
    </div>
   </div>
  </section>}

  {/* ---------------------------------------------- 2. Earning settings */}
  {tab==="earning"&&<form className="cnPanel" onSubmit={saveSettings}>
   <div className="cnPanelHead"><div><span className="eyebrow">EARNING SETTINGS</span><h3>How members earn Coins</h3></div></div>
   <p className="cnHint">Every server runs its own independent economy — these values are saved for this guild only. Amounts are whole Coins; cooldowns are in seconds.</p>
   <div className="cnGroup">
    <h4>General</h4>
    <div className="cnRow">
     <Toggle label="Economy enabled" value={form.enabled} onChange={v=>canEdit&&set("enabled",v)} disabled={!canEdit}/>
     <Toggle label="Member transfers" value={form.transfersEnabled} onChange={v=>canEdit&&set("transfersEnabled",v)} disabled={!canEdit}/>
     <Toggle label="Shop enabled" value={form.shopEnabled} onChange={v=>canEdit&&set("shopEnabled",v)} disabled={!canEdit}/>
    </div>
    <label className="cnField"><span>STARTING BALANCE (COINS)</span>
     <input type="number" min="0" max="1000000" value={form.startingBalance} disabled={!canEdit} onChange={e=>set("startingBalance",num(e.target.value,0,1000000))}/></label>
   </div>
   <div className="cnGroup">
    <h4>Daily reward</h4>
    <div className="cnRow">
     <Toggle label="Daily enabled" value={form.dailyEnabled} onChange={v=>canEdit&&set("dailyEnabled",v)} disabled={!canEdit}/>
     <label className="cnField"><span>AMOUNT</span><input type="number" min="1" max="1000000" value={form.dailyAmount} disabled={!canEdit} onChange={e=>set("dailyAmount",num(e.target.value,1,1000000))}/></label>
     <label className="cnField"><span>COOLDOWN (SECONDS)</span><input type="number" min="60" max="604800" value={form.dailyCooldown} disabled={!canEdit} onChange={e=>set("dailyCooldown",num(e.target.value,60,604800))}/></label>
    </div>
    <p className="cnHint">Default cooldown 86400 = 24 hours. Claims are idempotent — a double-claim can never pay twice.</p>
   </div>
   <div className="cnGroup">
    <h4>Message reward</h4>
    <div className="cnRow">
     <Toggle label="Message reward" value={form.messageEnabled} onChange={v=>canEdit&&set("messageEnabled",v)} disabled={!canEdit}/>
     <label className="cnField"><span>AMOUNT</span><input type="number" min="1" max="1000" value={form.messageAmount} disabled={!canEdit} onChange={e=>set("messageAmount",num(e.target.value,1,1000))}/></label>
     <label className="cnField"><span>COOLDOWN (SECONDS)</span><input type="number" min="10" max="86400" value={form.messageCooldown} disabled={!canEdit} onChange={e=>set("messageCooldown",num(e.target.value,10,86400))}/></label>
    </div>
    <p className="cnHint">Bots and webhooks are never paid; repeated identical messages and replayed events are rejected server-side.</p>
    <div className="cnIgnored">
     <div><span>EXCLUDED CHANNELS</span>
      {form.excludedChannels.map(id=><em key={id}>#{id.slice(-4)}<button type="button" aria-label="Remove" onClick={()=>canEdit&&set("excludedChannels",form.excludedChannels.filter(x=>x!==id))}><X/></button></em>)}
      {Select&&<Select id="cn-exch" label="Add excluded channel" search flip value="" onChange={v=>{if(!v||form.excludedChannels.includes(v))return;set("excludedChannels",[...form.excludedChannels,v])}} options={(state.channels||[]).map(c=>({value:c.id,label:"#"+c.name}))}/>}
     </div>
     <div><span>EXCLUDED ROLES</span>
      {form.excludedRoles.map(id=><em key={id}>@{id.slice(-4)}<button type="button" aria-label="Remove" onClick={()=>canEdit&&set("excludedRoles",form.excludedRoles.filter(x=>x!==id))}><X/></button></em>)}
      {Select&&<Select id="cn-exrl" label="Add excluded role" search flip value="" onChange={v=>{if(!v||form.excludedRoles.includes(v))return;set("excludedRoles",[...form.excludedRoles,v])}} options={(state.roles||[]).map(r=>({value:r.id,label:"@"+r.name}))}/>}
     </div>
    </div>
   </div>
   <div className="cnGroup">
    <h4>Voice reward</h4>
    <div className="cnRow">
     <Toggle label="Voice reward" value={form.voiceEnabled} onChange={v=>canEdit&&set("voiceEnabled",v)} disabled={!canEdit}/>
     <label className="cnField"><span>AMOUNT</span><input type="number" min="1" max="10000" value={form.voiceAmount} disabled={!canEdit} onChange={e=>set("voiceAmount",num(e.target.value,1,10000))}/></label>
     <label className="cnField"><span>INTERVAL (SECONDS)</span><input type="number" min="60" max="86400" value={form.voiceInterval} disabled={!canEdit} onChange={e=>set("voiceInterval",num(e.target.value,60,86400))}/></label>
    </div>
    <p className="cnHint">AFK channels and bots never earn; disconnects and restarts reset the participation clock, so voice farming is impossible.</p>
   </div>
   <div className="cnActions">
    <button type="submit" className="cnPrimary" disabled={busy||!canEdit}>{busy?"Saving…":"Save settings"}</button>
    <Notice value={settingsNotice}/>
   </div>
   {!canEdit&&<p className="cnHint">You need Configure permission on this server to change economy settings.</p>}
  </form>}

  {/* ------------------------------------------------------ 3. Shop */}
  {tab==="shop"&&<section className="cnPanel">
   <div className="cnPanelHead">
    <div><span className="eyebrow">SHOP</span><h3>Items & fulfilment</h3></div>
    {canEdit&&<button type="button" className="cnPrimary" onClick={()=>setShopForm({name:"",description:"",price:100,itemType:"role",roleId:"",stock:"",purchaseLimit:"",enabled:true})}><Plus/>Add item</button>}
   </div>
   <Notice value={shopNotice}/>
   {shopForm&&<form className="cnShopForm" onSubmit={saveShopItem}>
    <label className="cnField"><span>ITEM NAME</span><input value={shopForm.name} maxLength={80} required onChange={e=>setShopForm(f=>({...f,name:e.target.value}))}/></label>
    <label className="cnField"><span>DESCRIPTION</span><input value={shopForm.description} maxLength={200} onChange={e=>setShopForm(f=>({...f,description:e.target.value}))}/></label>
    <label className="cnField"><span>PRICE (COINS)</span><input type="number" min="1" max="1000000000" value={shopForm.price} onChange={e=>setShopForm(f=>({...f,price:num(e.target.value,1,1000000000)}))}/></label>
    <div className="cnField"><span>ITEM TYPE</span>
     <div className="cnSeg">
      <button type="button" className={shopForm.itemType==="role"?"sel":""} onClick={()=>setShopForm(f=>({...f,itemType:"role"}))}>Discord role</button>
      <button type="button" className={shopForm.itemType==="manual"?"sel":""} onClick={()=>setShopForm(f=>({...f,itemType:"manual"}))}>Manual reward</button>
     </div>
    </div>
    {shopForm.itemType==="role"&&<div className="cnField"><span>DISCORD ROLE</span>
     {Select&&<Select id="cn-shoprole" label="Role" search flip value={shopForm.roleId} onChange={v=>setShopForm(f=>({...f,roleId:v}))} options={(state.roles||[]).map(r=>({value:r.id,label:"@"+r.name}))}/>}
    </div>}
    <label className="cnField"><span>STOCK (EMPTY = UNLIMITED)</span><input type="number" min="0" value={shopForm.stock} onChange={e=>setShopForm(f=>({...f,stock:e.target.value}))}/></label>
    <label className="cnField"><span>PURCHASE LIMIT / MEMBER (EMPTY = NONE)</span><input type="number" min="1" max="10000" value={shopForm.purchaseLimit} onChange={e=>setShopForm(f=>({...f,purchaseLimit:e.target.value}))}/></label>
    <div className="cnField"><span>STATE</span><Toggle label={shopForm.enabled?"Enabled":"Disabled"} value={shopForm.enabled} onChange={v=>setShopForm(f=>({...f,enabled:v}))}/></div>
    <div className="cnFormBtns">
     <button type="submit" className="cnPrimary" disabled={busy}>{shopForm.id?"Update item":"Add item"}</button>
     <button type="button" className="cnGhost" onClick={()=>setShopForm(null)}>Cancel</button>
    </div>
    <p className="cnHint cnWarn"><AlertTriangle/>Baltic Coins can never purchase BalticM Premium — rewards promising Premium/subscription codes are rejected by the backend.</p>
   </form>}
   <div className="cnTableWrap">
    <table className="cnTable">
     <thead><tr><th>ITEM</th><th>TYPE</th><th className="num">PRICE</th><th className="num">STOCK</th><th className="num">LIMIT</th><th>STATE</th><th/></tr></thead>
     <tbody>
      {shopItems.length?shopItems.map(it=><tr key={it.id}>
       <td data-label="Item"><b>{it.name}</b>{it.description&&<small>{it.description}</small>}</td>
       <td data-label="Type">{it.itemType==="role"?"Discord role":"Manual reward"}</td>
       <td data-label="Price" className="num">{fmt(it.price)}</td>
       <td data-label="Stock" className="num">{it.stock===null||it.stock===undefined?"∞":fmt(it.stock)}</td>
       <td data-label="Limit" className="num">{it.purchaseLimit?fmt(it.purchaseLimit):"—"}</td>
       <td data-label="State"><span className={"cnChip"+(Number(it.enabled)?" on":"")}>{Number(it.enabled)?"Enabled":"Disabled"}</span></td>
       <td className="cnRowBtns">
        {canEdit&&<>
         <button type="button" className="cnGhost" onClick={()=>setShopForm({id:it.id,name:it.name,description:it.description,price:it.price,itemType:it.itemType,roleId:it.roleId,stock:it.stock===null?"":it.stock,purchaseLimit:it.purchaseLimit||"",enabled:Number(it.enabled)===1})}>Edit</button>
         <button type="button" className="cnDanger" onClick={()=>deleteItem(it)}>Remove</button>
        </>}
       </td>
      </tr>):<tr><td colSpan={7} className="cnEmpty">No items yet — add the first shop item above.</td></tr>}
     </tbody>
    </table>
   </div>
   <h4 className="cnSubHead">Purchase queue</h4>
   <div className="cnTableWrap">
    <table className="cnTable">
     <thead><tr><th>MEMBER</th><th>ITEM</th><th className="num">PRICE</th><th>STATUS</th><th>WHEN</th><th/></tr></thead>
     <tbody>
      {purchases.length?purchases.map(p=><tr key={p.id}>
       <td data-label="Member"><span className="cnMono">#{p.userId.slice(-6)}</span></td>
       <td data-label="Item">{p.itemName}</td>
       <td data-label="Price" className="num">{fmt(p.price)}</td>
       <td data-label="Status"><span className={"cnChip st-"+p.status}>{p.status.replace(/_/g," ")}</span></td>
       <td data-label="When">{when(p.createdAt)}</td>
       <td className="cnRowBtns">
        {p.status==="awaiting_fulfillment"&&<button type="button" className="cnPrimary sm" disabled={busy||!canEdit} onClick={()=>fulfill(p)}>Fulfill</button>}
        {["awaiting_fulfillment","failed","pending"].includes(p.status)&&<button type="button" className="cnGhost" disabled={busy||!canEdit} onClick={()=>refund(p)}>Refund</button>}
       </td>
      </tr>):<tr><td colSpan={6} className="cnEmpty">No purchases yet.</td></tr>}
     </tbody>
    </table>
   </div>
  </section>}

  {/* -------------------------------------------- 4. Members & wallets */}
  {tab==="wallets"&&<section className="cnPanel">
   <div className="cnPanelHead">
    <div><span className="eyebrow">MEMBERS & WALLETS</span><h3>Wallet management</h3></div>
    <form className="cnSearch" onSubmit={e=>{e.preventDefault();loadWallets(walletQ)}}>
     <Search/><input value={walletQ} onChange={e=>setWalletQ(e.target.value)} placeholder="Search name, username or id…" aria-label="Search wallets"/>
     {walletQ&&<button type="button" aria-label="Clear" onClick={()=>{setWalletQ("");loadWallets("")}}><X/></button>}
    </form>
   </div>
   <Notice value={walletNotice}/>
   <div className="cnTableWrap">
    <table className="cnTable">
     <thead><tr><th>MEMBER</th><th className="num">BALANCE</th><th className="num">EARNED</th><th className="num">SPENT</th><th>LAST ACTIVITY</th><th/></tr></thead>
     <tbody>
      {wallets.length?wallets.map(w=><tr key={w.userId}>
       <td data-label="Member" className="cnMember">
        {w.avatar?<img src={w.avatar} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>:<i>{(w.displayName||w.username||"?").slice(0,1).toUpperCase()}</i>}
        <span><b>{w.displayName||w.username||`#${w.userId.slice(-4)}`}</b>{w.username&&w.displayName&&w.username!==w.displayName?<small>@{w.username}</small>:null}</span>
       </td>
       <td data-label="Balance" className="num strong">{fmt(w.balance)}</td>
       <td data-label="Earned" className="num">+{fmt(w.totalEarned)}</td>
       <td data-label="Spent" className="num">−{fmt(w.totalSpent)}</td>
       <td data-label="Last activity">{when(w.updatedAt)}</td>
       <td className="cnRowBtns">
        <button type="button" className="cnGhost" onClick={()=>openDetail(w)}>View</button>
        {canEdit&&<>
         <button type="button" className="cnGhost" onClick={()=>{setAdjust({userId:w.userId,displayName:w.displayName||w.username,action:"add"});setAdjAmount("");setAdjReason("")}}>Add</button>
         <button type="button" className="cnGhost" onClick={()=>{setAdjust({userId:w.userId,displayName:w.displayName||w.username,action:"remove"});setAdjAmount("");setAdjReason("")}}>Remove</button>
         <button type="button" className="cnGhost" onClick={()=>{setAdjust({userId:w.userId,displayName:w.displayName||w.username,action:"set"});setAdjAmount("");setAdjReason("")}}>Set</button>
        </>}
       </td>
      </tr>):<tr><td colSpan={6} className="cnEmpty">No wallets in this server yet.</td></tr>}
     </tbody>
    </table>
   </div>
   <div className="cnPager">
    <button type="button" className="cnGhost" disabled={walletPage===0} onClick={()=>loadWallets(walletPage-1)}>Previous</button>
    <span>Page {walletPage+1} · {fmt(walletTotal)} wallets</span>
    <button type="button" className="cnGhost" disabled={(walletPage+1)*25>=walletTotal} onClick={()=>loadWallets(walletPage+1)}>Next</button>
   </div>

   {adjust&&<div className="cnAdjust" role="dialog" aria-label="Change wallet balance">
    <b>{adjust.action==="add"?"Add Coins":adjust.action==="remove"?"Remove Coins":"Set balance"} — {adjust.displayName||adjust.userId}</b>
    <label className="cnField"><span>AMOUNT</span><input type="number" min="1" max="1000000000" value={adjAmount} onChange={e=>setAdjAmount(e.target.value)}/></label>
    <label className="cnField"><span>REASON (AUDIT LOG)</span><input value={adjReason} maxLength={120} placeholder="Why is this changing?" onChange={e=>setAdjReason(e.target.value)}/></label>
    <div className="cnFormBtns">
     <button type="button" className="cnPrimary" disabled={busy} onClick={runAdjust}>Confirm change</button>
     <button type="button" className="cnGhost" onClick={()=>setAdjust(null)}>Cancel</button>
    </div>
    <p className="cnHint">Recorded in the ledger with your admin id, the amount, reason and both balances.</p>
   </div>}

   {detail&&detail.wallet&&<div className="cnDetail">
    <div className="cnDetailHead">
     <span><b>{detail.wallet.displayName||detail.wallet.username||`#${detail.wallet.userId.slice(-4)}`}</b> — balance <strong>{state.currency.icon} {fmt(detail.wallet.balance)}</strong> · earned {fmt(detail.wallet.totalEarned)} · spent {fmt(detail.wallet.totalSpent)}</span>
     <button type="button" className="cnGhost" onClick={()=>setDetail(null)}><X/>Close</button>
    </div>
    <div className="cnTableWrap">
     <table className="cnTable">
      <thead><tr><th>TIME</th><th>SOURCE</th><th className="num">AMOUNT</th><th className="num">BALANCE</th></tr></thead>
      <tbody>
       {detail.transactions.length?detail.transactions.map(t=><tr key={t.id}>
        <td data-label="Time">{when(t.createdAt)}</td>
        <td data-label="Source">{SOURCE_LABEL[t.source]||t.source}{t.reason?<small>{t.reason}</small>:null}</td>
        <td data-label="Amount" className={"num cnAmt"+(t.amount<0?" neg":"")}>{t.amount>=0?"+":"−"}{fmt(Math.abs(t.amount))}</td>
        <td data-label="Balance" className="num">{fmt(t.balanceAfter)}</td>
       </tr>):<tr><td colSpan={4} className="cnEmpty">No transactions yet.</td></tr>}
      </tbody>
     </table>
    </div>
   </div>}
  </section>}

  {/* ------------------------------------------------- 5. Transactions */}
  {tab==="transactions"&&<section className="cnPanel">
   <div className="cnPanelHead">
    <div><span className="eyebrow">TRANSACTIONS</span><h3>Full ledger</h3></div>
    <div className="cnFilters">
     {Select&&<Select id="cn-txsrc" label="Source" search flip value={txSource} onChange={v=>{setTxSource(v);setTxPage(0);loadTx(0,v)}} options={SOURCE_OPTIONS}/>}
    </div>
   </div>
   <div className="cnTableWrap">
    <table className="cnTable">
     <thead><tr><th>TIME</th><th>MEMBER</th><th>SOURCE</th><th className="num">AMOUNT</th><th className="num">BALANCE</th></tr></thead>
     <tbody>
      {txs.length?txs.map(t=><tr key={t.id}>
       <td data-label="Time">{when(t.createdAt)}</td>
       <td data-label="Member">{nameOf(t.userId)}</td>
       <td data-label="Source">{SOURCE_LABEL[t.source]||t.source}{t.actorId?<small>by {nameOf(t.actorId)}</small>:null}{t.reason?<small>{t.reason}</small>:null}</td>
       <td data-label="Amount" className={"num cnAmt"+(t.amount<0?" neg":"")}>{t.amount>=0?"+":"−"}{fmt(Math.abs(t.amount))}</td>
       <td data-label="Balance" className="num">{fmt(t.balanceAfter)}</td>
      </tr>):<tr><td colSpan={5} className="cnEmpty">No transactions match this filter.</td></tr>}
     </tbody>
    </table>
   </div>
   <div className="cnPager">
    <button type="button" className="cnGhost" disabled={txPage===0} onClick={()=>loadTx(txPage-1,txSource)}>Previous</button>
    <span>Page {txPage+1} · {fmt(txTotal)} entries</span>
    <button type="button" className="cnGhost" disabled={(txPage+1)*25>=txTotal} onClick={()=>loadTx(txPage+1,txSource)}>Next</button>
   </div>
  </section>}

  {/* --------------------------------------------------- 6. Leaderboard */}
  {tab==="leaderboard"&&<section className="cnPanel">
   <div className="cnPanelHead">
    <div><span className="eyebrow">LEADERBOARD</span><h3>Richest members</h3></div>
    <div className="cnBoardTools">
     <div className="cnRanges">{[10,50,100].map(n=><button key={n} type="button" className={boardLimit===n?"sel":""} onClick={()=>{setBoardLimit(n);loadBoard(n,boardQ)}}>Top {n}</button>)}</div>
     <form className="cnSearch" onSubmit={e=>{e.preventDefault();loadBoard(boardLimit,boardQ)}}>
      <Search/><input value={boardQ} onChange={e=>setBoardQ(e.target.value)} placeholder="Search member…" aria-label="Search leaderboard"/>
      {boardQ&&<button type="button" aria-label="Clear" onClick={()=>{setBoardQ("");loadBoard(boardLimit,"")}}><X/></button>}
     </form>
    </div>
   </div>
   {/* Alignment contract: header cells use the SAME alignment as the values
       beneath them (rank centered, member left, numbers right) inside ONE
       shared grid — the Leveling alignment bug is not repeated here. */}
   <div className="cnBoard" role="table" aria-label="Baltic Coins leaderboard">
    <div className="cnBoardRow cnBoardHead" role="row"><span>#</span><span>MEMBER</span><span>BALANCE</span><span>TOTAL EARNED</span><span>TOTAL SPENT</span></div>
    {board.length?board.map(m=><div className="cnBoardRow" role="row" key={m.userId}>
     <span className="cnPos">{m.position<=3?["🥇","🥈","🥉"][m.position-1]:m.position}</span>
     <span className="cnMember"><i>{m.avatar?<img src={m.avatar} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>:(m.displayName||m.username||"?").slice(0,1).toUpperCase()}</i><b>{m.displayName||m.username||`#${m.userId.slice(-4)}`}</b></span>
     <span data-label="Balance" className="strong">{fmt(m.balance)}</span>
     <span data-label="Total earned">+{fmt(m.totalEarned)}</span>
     <span data-label="Total spent">−{fmt(m.totalSpent)}</span>
    </div>):<div className="cnEmpty">No wallets to rank yet.</div>}
    <div className="cnBoardFoot">Showing {board.length} of this server's wallets — only members of the selected guild.</div>
   </div>
  </section>}

  {/* -------------------------------------- 7. Game integrations (future) */}
  {tab==="games"&&<section className="cnPanel">
   <div className="cnPanelHead"><div><span className="eyebrow">GAME INTEGRATIONS</span><h3>Future game economy</h3></div>
    <span className="cnStatusPill">COMING SOON</span></div>
   <div className="cnFuture">
    <div className="cnFutureGrid">
     <div><b>One shared wallet</b><small>Future BalticM games (RPG, fishing, racing, mini-games) spend and earn from THIS guild's Baltic Coins wallet — never a per-game wallet.</small></div>
     <div><b>Scoped game access</b><small>Each game gets a per-server connection with explicit credit/debit permissions, reward limits, revocation and a full transaction audit — never unrestricted database access.</small></div>
     <div><b>No public API yet</b><small>V1 ships the internal engine only: no game credentials, no public credit/debit endpoint. Integrations activate per server, later.</small></div>
     <div><b>Future Coins purchases</b><small>Real-money Coin packages can later credit ONLY the selected guild's wallet with payment references and duplicate-payment protection. Coins stay non-withdrawable and can never buy BalticM Premium.</small></div>
    </div>
    <p className="cnHint cnWarn"><AlertTriangle/>Games and integrations can never bypass the Premium firewall: Baltic Coins cannot purchase BalticM Premium under any circumstances.</p>
   </div>
  </section>}
  </>}
 </div>;
}
