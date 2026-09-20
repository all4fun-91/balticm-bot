import http from "node:http";
import { Innertube } from "youtubei.js";

const PORT = Number(process.env.PORT || 10000);
const SERVICE_SECRET = process.env.RESOLVER_SECRET || "";
let youtubePromise = null;

function youtube() {
  if (!youtubePromise) youtubePromise = Innertube.create({ retrieve_player: true });
  return youtubePromise;
}
function json(res,status,data){
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});
  res.end(JSON.stringify(data));
}
function videoId(value){
  try{
    const u=new URL(value);
    if(u.hostname==="youtu.be") return u.pathname.split("/").filter(Boolean)[0]||null;
    if(u.hostname.endsWith("youtube.com")){
      if(u.pathname==="/watch") return u.searchParams.get("v");
      const m=u.pathname.match(/^\/(?:shorts|live|embed)\/([^/?#]+)/);
      if(m) return m[1];
    }
  }catch{}
  return /^[A-Za-z0-9_-]{11}$/.test(value||"") ? value : null;
}
async function readBody(req){
  let body="";
  for await(const chunk of req){ body+=chunk; if(body.length>65536) throw new Error("Body too large"); }
  return body ? JSON.parse(body) : {};
}
async function testYouTube(value){
  const id=videoId(String(value||""));
  if(!id) return {status:400,data:{ok:false,error:"Valid YouTube URL or videoId required"}};

  const yt=await youtube();
  const info=await yt.getInfo(id);
  const title=info?.basic_info?.title||null;

  try{
    const stream=await yt.download(id,{type:"audio",quality:"best",format:"webm",codec:"opus"});
    const reader=stream.getReader();
    const first=await reader.read();
    try{await reader.cancel();}catch{}
    return {status:200,data:{ok:true,videoId:id,title,streamReadable:!first.done,firstChunkBytes:first.value?.byteLength||0}};
  }catch(error){
    return {status:502,data:{ok:false,videoId:id,title,error:String(error?.message||error)}};
  }
}
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,"http://localhost");
    if(req.method==="GET" && (u.pathname==="/"||u.pathname==="/health")){
      return json(res,200,{ok:true,service:"BalticM YouTube Resolver",version:"1.0.1",youtube:"youtubei.js"});
    }
    if(req.method==="GET" && u.pathname==="/test"){
      const result=await testYouTube(u.searchParams.get("url")||u.searchParams.get("videoId")||"");
      return json(res,result.status,result.data);
    }
    if(req.method==="POST" && u.pathname==="/test"){
      if(SERVICE_SECRET && req.headers["x-balticm-resolver-secret"]!==SERVICE_SECRET) return json(res,401,{ok:false,error:"Unauthorized"});
      const body=await readBody(req);
      const result=await testYouTube(body.url||body.videoId||"");
      return json(res,result.status,result.data);
    }
    return json(res,404,{ok:false,error:"Not found"});
  }catch(error){ return json(res,500,{ok:false,error:String(error?.message||error)}); }
});
server.listen(PORT,"0.0.0.0",()=>console.log("[BalticM Resolver] listening on",PORT));
