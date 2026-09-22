import http from "node:http";
import { WebSocket } from "ws";

const PORT=Number(process.env.PORT||3000);
const TOKEN=process.env.DISCORD_BOT_TOKEN||"";
const CONTROL_CENTER_URL=String(process.env.BALTICM_CONTROL_CENTER_URL||"").replace(/\/$/,"");
const SERVICE_SECRET=process.env.BALTICM_REACTION_SERVICE_SECRET||"";
const GATEWAY="wss://gateway.discord.gg/?v=10&encoding=json";
const INTENTS=(1<<0)|(1<<10);
let ws=null,heartbeat=null,seq=null,sessionId=null,resumeGatewayUrl=null,botUserId=null,readyAt=null,lastEventAt=null,reconnects=0;
const log=(...a)=>console.log(new Date().toISOString(),...a);
const emojiKey=e=>e?.id?(e.name+":"+e.id):String(e?.name||"");
async function postReactionEvent(d,action){
 if(!CONTROL_CENTER_URL||!SERVICE_SECRET){log("Reaction event skipped: service config missing");return}
 if(!d?.guild_id||!d?.channel_id||!d?.message_id||!d?.user_id||d.user_id===botUserId)return;
 const emoji=emojiKey(d.emoji);if(!emoji)return;
 const payload={guildId:String(d.guild_id),channelId:String(d.channel_id),messageId:String(d.message_id),userId:String(d.user_id),action,emoji};
 try{const r=await fetch(CONTROL_CENTER_URL+"/api/reaction-roles/service/event",{method:"POST",headers:{"Content-Type":"application/json","X-BalticM-Service-Secret":SERVICE_SECRET},body:JSON.stringify(payload)});const body=await r.text();if(!r.ok)log("Reaction API error",r.status,body.slice(0,500));else log("Reaction",action,payload.guildId,payload.userId,emoji,body.slice(0,300));}catch(e){log("Reaction API unavailable",String(e?.message||e))}
}
function identify(){ws.send(JSON.stringify({op:2,d:{token:TOKEN,intents:INTENTS,properties:{os:process.platform,browser:"balticm-reactions",device:"balticm-reactions"}}}))}
function resume(){ws.send(JSON.stringify({op:6,d:{token:TOKEN,session_id:sessionId,seq}}))}
function startHeartbeat(interval){clearInterval(heartbeat);heartbeat=setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({op:1,d:seq}))},interval);setTimeout(()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({op:1,d:seq}))},Math.floor(Math.random()*interval))}
function connect(url=GATEWAY){
 if(!TOKEN){log("DISCORD_BOT_TOKEN missing");return}
 ws=new WebSocket(url);
 ws.on("open",()=>log("Discord Gateway connected"));
 ws.on("message",raw=>{let p;try{p=JSON.parse(raw.toString())}catch{return}if(p.s!==null&&p.s!==undefined)seq=p.s;if(p.op===10){startHeartbeat(p.d.heartbeat_interval);sessionId?resume():identify();return}if(p.op===7){reconnects++;try{ws.close()}catch{}return}if(p.op===9){if(!p.d){sessionId=null;seq=null;resumeGatewayUrl=null}setTimeout(()=>connect(resumeGatewayUrl||GATEWAY),1500);return}if(p.op!==0)return;lastEventAt=new Date().toISOString();if(p.t==="READY"){sessionId=p.d.session_id;resumeGatewayUrl=p.d.resume_gateway_url?(p.d.resume_gateway_url+"/?v=10&encoding=json"):null;botUserId=p.d.user?.id||null;readyAt=new Date().toISOString();log("READY",p.d.user?.username,p.d.user?.id,"guilds",p.d.guilds?.length||0);return}if(p.t==="RESUMED"){log("Gateway resumed");return}if(p.t==="MESSAGE_REACTION_ADD")void postReactionEvent(p.d,"add");if(p.t==="MESSAGE_REACTION_REMOVE")void postReactionEvent(p.d,"remove")});
 ws.on("close",code=>{clearInterval(heartbeat);log("Gateway closed",code);setTimeout(()=>{reconnects++;connect(resumeGatewayUrl||GATEWAY)},1500)});
 ws.on("error",e=>log("Gateway error",String(e?.message||e)));
}
const server=http.createServer((req,res)=>{res.setHeader("Content-Type","application/json");if(["/","/health","/reactions","/reactions/"].includes(req.url)){res.end(JSON.stringify({ok:true,service:"BalticM Reaction Roles Gateway",version:"2.0.0-multiguild",discord:ws?.readyState===WebSocket.OPEN?"connected":"disconnected",readyAt,lastEventAt,reconnects,configured:{token:!!TOKEN,controlCenterUrl:!!CONTROL_CENTER_URL,serviceSecret:!!SERVICE_SECRET}}));return}res.statusCode=404;res.end(JSON.stringify({error:"Not found"}))});
server.listen(PORT,()=>{log("Reaction Roles Gateway listening on",PORT);connect()});
