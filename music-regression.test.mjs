import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const source=readFileSync(new URL('./BalticM-Music-v1.7.4-kerit-direct.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
function fixture(){
 const players=new Map(),lavaPlayers=new Map(),calls=[];
 const makeLava=()=>Object.assign(new EventEmitter(),{node:{name:'test'},async playTrack(options){calls.push(['play',options]);},async setGlobalVolume(v){calls.push(['volume',v]);},async stopTrack(){calls.push(['stop']);},async setPaused(p){calls.push(['pause',p]);}});
 const channels=new Map([['a',{name:'A',type:2}],['b',{name:'B',type:2}]]);
 const context=vm.createContext({players,randomUUID,console:{log(){}},ChannelType:{GuildVoice:2,GuildStageVoice:13},client:{isReady:()=>true,guilds:{cache:new Map([['g',{channels:{cache:channels},shardId:0}],['h',{channels:{cache:channels},shardId:0}]])}},shoukaku:{players:lavaPlayers,async joinVoiceChannel({guildId}){const lava=makeLava();lavaPlayers.set(guildId,lava);return lava;},async leaveVoiceChannel(id){lavaPlayers.delete(id);}},voiceLog(){},lavaDiag(){},setLastError(){},getGuildState:id=>({connected:players.has(id)}),resolveTrack:async query=>({title:query,lavalinkEncoded:query}),resolveLavalinkTrack:async track=>({encoded:track.title}),Date});
 vm.runInContext(section('const guildOperations =','/*\n * ============================================================\n * DISCONNECT PLAYER')+section('function disconnectPlayer(', '/*\n * ============================================================\n * HTML METADATA')+section('async function playNext(', '/*\n * ============================================================\n * MUSIC CONFIG'),context);
 return {context,players,lavaPlayers,calls};
}
test('simultaneous play requests start once and preserve queue order; guilds stay independent',async()=>{
 const f=fixture();await Promise.all([f.context.connectPlayer('g','a'),f.context.connectPlayer('h','a')]);
 await Promise.all([f.context.addTrack('g','first'),f.context.addTrack('g','second'),f.context.addTrack('h','other')]);
 assert.equal(f.calls.filter(x=>x[0]==='play').length,2);assert.equal(f.players.get('g').currentTrack.title,'first');assert.equal(f.players.get('g').queue[0].title,'second');assert.equal(f.players.get('h').currentTrack.title,'other');
});
test('zero volume is preserved when starting a new song',async()=>{
 const f=fixture();await f.context.connectPlayer('g','a');f.players.get('g').volume=0;await f.context.addTrack('g','first');assert.deepEqual(f.calls.find(x=>x[0]==='volume'),['volume',0]);
});
test('replaced/stopped and stale track events cannot skip the current song',async()=>{
 const f=fixture();await f.context.connectPlayer('g','a');await f.context.addTrack('g','first');await f.context.addTrack('g','second');const lava=f.lavaPlayers.get('g');
 for(const reason of ['replaced','stopped','cleanup'])lava.emit('end',{reason,track:{encoded:'first'}});
 lava.emit('end',{reason:'finished',track:{encoded:'stale'}});await f.context.withGuild('g',async()=>{});assert.equal(f.players.get('g').currentTrack.title,'first');
 const id=f.players.get('g').currentTrack.playbackId;lava.emit('end',{reason:'finished',track:{encoded:'first',userData:{playbackId:id}}});await f.context.withGuild('g',async()=>{});assert.equal(f.players.get('g').currentTrack.title,'second');
 lava.emit('end',{reason:'finished',track:{encoded:'first',userData:{playbackId:id}}});await f.context.withGuild('g',async()=>{});assert.equal(f.players.get('g').currentTrack.title,'second');
});
test('track and queue loop modes stay isolated per guild',async()=>{
 const f=fixture();await Promise.all([f.context.connectPlayer('g','a'),f.context.connectPlayer('h','a')]);
 await f.context.addTrack('g','repeat');await f.context.addTrack('h','other');
 f.players.get('g').loopMode='track';const gLava=f.lavaPlayers.get('g'),firstId=f.players.get('g').currentTrack.playbackId;
 gLava.emit('end',{reason:'finished',track:{encoded:'repeat',userData:{playbackId:firstId}}});await f.context.withGuild('g',async()=>{});
 assert.equal(f.players.get('g').currentTrack.title,'repeat');assert.equal(f.players.get('h').currentTrack.title,'other');assert.equal(f.players.get('h').loopMode,'off');
 f.players.get('g').loopMode='queue';await f.context.addTrack('g','next');const repeatedId=f.players.get('g').currentTrack.playbackId;
 gLava.emit('end',{reason:'finished',track:{encoded:'repeat',userData:{playbackId:repeatedId}}});await f.context.withGuild('g',async()=>{});
 assert.equal(f.players.get('g').currentTrack.title,'next');assert.equal(f.players.get('g').queue[0].title,'repeat');assert.equal(f.players.get('h').currentTrack.title,'other');
});
test('moving channels binds a new player and ignores the old player',async()=>{
 const f=fixture();await f.context.connectPlayer('g','a');const old=f.lavaPlayers.get('g');await f.context.addTrack('g','first');await f.context.connectPlayer('g','b');const current=f.lavaPlayers.get('g');assert.notEqual(old,current);assert.equal(current.listenerCount('end'),1);await f.context.addTrack('g','second');old.emit('end',{reason:'finished',track:{encoded:'second'}});await f.context.withGuild('g',async()=>{});assert.equal(f.players.get('g').currentTrack.title,'second');
});
test('failed start returns an error instead of claiming playback succeeded',async()=>{
 const f=fixture();await f.context.connectPlayer('g','a');f.lavaPlayers.get('g').playTrack=async()=>{throw Error('source failure')};await assert.rejects(f.context.addTrack('g','broken'),/could not be played/);assert.equal(f.players.get('g').currentTrack,null);
});
test('voice channel cache miss is fetched inside the selected guild',async()=>{
 const f=fixture();const guild=f.context.client.guilds.cache.get('g');guild.channels.fetch=async id=>id==='c'?{name:'C',type:2,guildId:'g'}:null;
 await f.context.connectPlayer('g','c');assert.equal(f.players.get('g').channelId,'c');
 guild.channels.fetch=async()=>({name:'Foreign',type:2,guildId:'h'});
 await assert.rejects(f.context.connectPlayer('g','foreign'),/does not belong to this guild/);
});
test('track exception retries once through resolver fallback',async()=>{
 const f=fixture();await f.context.connectPlayer('g','a');await f.context.addTrack('g','first');const lava=f.lavaPlayers.get('g');
 const firstId=f.players.get('g').currentTrack.playbackId;lava.emit('exception',{exception:{message:'source failed'},track:{userData:{playbackId:firstId}}});await f.context.withGuild('g',async()=>{});
 assert.equal(f.calls.filter(x=>x[0]==='play').length,2);assert.equal(f.players.get('g').currentTrack.title,'first');assert.equal(f.players.get('g').currentTrack.playbackRecoveryAttempts,1);
});
test('YouTube URL lookup falls back to video-id search',async()=>{
 const calls=[];const context=vm.createContext({URL,cleanText:value=>String(value||'').trim().replace(/\s+/g,' '),shoukaku:{players:new Map(),getIdealNode:()=>({rest:{resolve:async id=>{calls.push(id);return id.startsWith('https://')?{loadType:'error',data:{message:'lookup failed'}}:{loadType:'search',data:[{encoded:'fallback',info:{title:'Recovered'}}]};}}})}});
 vm.runInContext(section('async function resolveLavalinkTrack(', '/*\n * ============================================================\n * PLAY NEXT'),context);
 const result=await context.resolveLavalinkTrack({title:'YouTube',source:'YouTube',playbackUrl:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'});
 assert.equal(result.encoded,'fallback');assert.deepEqual(calls,['https://www.youtube.com/watch?v=dQw4w9WgXcQ','ytsearch:dQw4w9WgXcQ']);
});
const worker=readFileSync(new URL('./worker.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
test('proxy pins authorized guild and requester and validates player controls',async()=>{
 const calls=[];const context=vm.createContext({AbortSignal,json:(data,status=200)=>({data,status}),cachedGuildChannels:async()=>[{id:'voice-a',name:'A',type:2}],fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({ok:true})}}});
 const start=worker.indexOf('async function musicProxy('),end=worker.indexOf('\n}',start)+2;vm.runInContext(worker.slice(start,end),context);const env={BALTICM_MUSIC_SERVICE_SECRET:'test-only'};
 for(const [action,body] of [['connect',{channelId:'voice-a'}],['disconnect',{}],['play',{query:'test'}],['pause',{}],['resume',{}],['skip',{}],['stop',{}],['volume',{volume:35}],['queue/remove',{trackId:'track-a'}],['queue/clear',{}],['queue/shuffle',{}],['loop',{mode:'queue'}]]){
 const r=await context.musicProxy({json:async()=>({guildId:'other',requestedBy:'other',...body})},env,'authorized',action,{id:'user'});assert.equal(r.status,200);assert.equal(calls.at(-1).body.guildId,'authorized');if(action==='play')assert.equal(calls.at(-1).body.requestedBy,'user');}
 assert.equal(calls.find(x=>x.url.endsWith('/music/loop')).body.mode,'queue');
 for(const [action,body] of [['connect',{channelId:'foreign'}],['volume',{volume:-1}],['volume',{volume:null}],['queue/remove',{}],['loop',{mode:'forever'}]]){assert.equal((await context.musicProxy({json:async()=>body},env,'authorized',action,{id:'user'})).status,400);}
});
