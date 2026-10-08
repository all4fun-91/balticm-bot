import React,{useEffect,useRef,useState}from"react";
import {CheckCircle2,ChevronLeft,ChevronRight,Trophy}from"lucide-react";

/* Single-elimination bracket renderer shared by the Control Center module and
   the public tournament page.
   Desktop/tablet: all rounds side by side inside a bracket-only scroll area.
   Mobile: round chips + prev/next jump the scroll position — the page itself
   never scrolls horizontally, only this frame does. */

const statusLabel=s=>({PENDING:"Waiting",READY:"Ready",BYE:"Bye",COMPLETED:"Completed"}[s]||s||"");

function MatchCard({match,names,label,canEdit,busy,onResult}){
 const[nameA,nameB]=[match.participantA,match.participantB].map(id=>id?(names[id]||id):"");
 const decided=match.status==="COMPLETED"||match.status==="BYE";
 const[winner,setWinner]=useState(match.winnerId||"");
 const[scoreA,setScoreA]=useState(match.status==="COMPLETED"?String(match.scoreA):"");
 const[scoreB,setScoreB]=useState(match.status==="COMPLETED"?String(match.scoreB):"");
 useEffect(()=>{setWinner(match.winnerId||"");setScoreA(match.status==="COMPLETED"?String(match.scoreA):"");setScoreB(match.status==="COMPLETED"?String(match.scoreB):"")},[match.winnerId,match.scoreA,match.scoreB,match.status]);
 const ready=match.status==="READY"||match.status==="COMPLETED";
 const submit=()=>{
  if(!canEdit||!ready||busy)return;
  const w=winner||(Number(scoreA)>Number(scoreB)?match.participantA:match.participantB);
  onResult(match,{winnerId:w,scoreA:Number(scoreA)||0,scoreB:Number(scoreB)||0});
 };
 const row=(id,score,setScore,other)=>{
  const isWinner=decided&&match.winnerId===id;
  const isPicked=winner===id;
  return <div className={"tMatchRow"+(isWinner?" won":"")+(isPicked&&canEdit?" picked":"")+(id?"":" empty")}>
   {canEdit&&ready?<button type="button" className="tMatchPick" aria-label={id?("Select "+(names[id]||id)+" as winner"):"Empty slot"} disabled={!id||busy} onClick={()=>setWinner(id||"")}><span/></button>:null}
   <span className="tMatchName" title={id||undefined}>{id?(names[id]||id):(match.roundIndex===0?"BYE":"TBD")}</span>
   {canEdit&&ready?<input className="tMatchScore" type="number" min="0" max="999" inputMode="numeric" aria-label="Score" value={score} disabled={busy} onChange={e=>setScore(e.target.value.replace(/[^0-9]/g,"").slice(0,3))}/>:<b className="tMatchScoreView">{decided?score:""}</b>}
  </div>;
 };
 return <article className={"tMatch "+String(match.status||"").toLowerCase()}>
  <header><span>{label}</span><em className={"tMatchStatus "+String(match.status||"").toLowerCase()}>{statusLabel(match.status)}</em></header>
  {row(match.participantA,scoreA,setScoreA,scoreB)}
  {row(match.participantB,scoreB,setScoreB,scoreA)}
  {match.scheduledAt?<time dateTime={match.scheduledAt}>{new Date(match.scheduledAt).toLocaleString()}</time>:null}
  {canEdit&&ready?<button type="button" className="tMatchConfirm" disabled={busy||(!winner&&Number(scoreA)===Number(scoreB))} onClick={submit}>{busy?"Saving…":match.status==="COMPLETED"?"Update result":"Confirm result"}</button>:null}
 </article>;
}

export default function TournamentBracket({roundLabels=[],matches=[],names={},championId="",championRoster=[],championLogo="",canEdit=false,busyKey="",onResult}){
 const scrollRef=useRef(null);
 const[active,setActive]=useState(0);
 const rounds=(roundLabels||[]).map((label,index)=>({label,index,matches:(matches||[]).filter(m=>Number(m.roundIndex)===index)}));
 if(!rounds.length)return <div className="tBracketEmpty"><b>No bracket yet</b><span>Seed the participants and generate the bracket to see matches here.</span></div>;
 const first=rounds[0].matches.length||1;
 const go=index=>{
  const box=scrollRef.current;if(!box)return;
  const next=Math.max(0,Math.min(rounds.length-1,index));
  setActive(next);
  const col=box.querySelector(`[data-round="${next}"]`);
  if(col)box.scrollTo({left:col.offsetLeft-box.offsetLeft,behavior:"smooth"});
 };
 return <div className="tBracketFrame">
  <div className="tBracketNav">
   <div className="tBracketChips" role="tablist" aria-label="Bracket rounds">
    {rounds.map(r=><button key={r.index} type="button" role="tab" aria-selected={active===r.index} className={active===r.index?"on":""} onClick={()=>go(r.index)}>{r.label}</button>)}
    <button key="champ" type="button" role="tab" aria-selected={active===rounds.length} className={active===rounds.length?"on":""} onClick={()=>go(rounds.length)}>Champion</button>
   </div>
   <div className="tBracketSteps">
    <button type="button" aria-label="Previous round" onClick={()=>go(active-1)} disabled={active<=0}><ChevronLeft/></button>
    <button type="button" aria-label="Next round" onClick={()=>go(active+1)} disabled={active>=rounds.length}><ChevronRight/></button>
   </div>
  </div>
  <div className="tBracketScroll" ref={scrollRef} tabIndex={0} aria-label="Tournament bracket">
   <div className="tBracketRounds" style={{"--tRoundMin":`${Math.max(120,first*104)}px`}}>
    {rounds.map(r=><section className="tBracketRound" data-round={r.index} key={r.index}>
     <h4>{r.label}</h4>
     <div className="tBracketRoundBody">{r.matches.length?r.matches.map(m=><MatchCard key={m.id||`${m.roundIndex}-${m.slotIndex}`} match={m} names={names} label={`Match ${Number(m.slotIndex)+1}`} canEdit={canEdit} busy={busyKey===`${m.roundIndex}-${m.slotIndex}`} onResult={onResult}/>):<p className="tBracketTbd">No matches</p>}</div>
    </section>)}
    <section className="tBracketRound tBracketChampion" data-round={rounds.length}>
     <h4>Champion</h4>
     <div className="tBracketRoundBody">
      <article className="tMatch tChampion">
       {championLogo?<img className="tChampLogo" src={championLogo} alt="" onError={e=>{e.currentTarget.style.display="none"}}/>:<Trophy/>}
       <b>{championId?(names[championId]||championId):"To be decided"}</b>
       {championId&&championRoster&&championRoster.length
         ?<span className="tChampRoster">{championRoster.join(" • ")}</span>
         :<span>{championId?"Tournament winner":"Win the final to lift the trophy"}</span>}
      </article>
     </div>
    </section>
   </div>
  </div>
 </div>;
}
