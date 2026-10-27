'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {setup,root}=require('./src/config.cjs'),{Queue,terminal}=require('./src/queue.cjs'),{Receiver}=require('./src/bilibili.cjs'),{Workers}=require('./src/workers.cjs');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.wasm':'application/wasm'};
const same=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function createApp({dir,port=17980,demo=false}={}){
 const store=setup(dir),q=new Queue(store),receiver=new Receiver(),workers=new Workers(q),clients=new Set();let tick;let lastPush=0;
 receiver.on('chat',r=>q.ingest(r));receiver.on('status',s=>{q.receiver={...s};q.changed();});
 const publish=()=>{const now=Date.now();lastPush=now;const message='id: '+q.revision+'\nevent: state\ndata: '+JSON.stringify(q.snapshot())+'\n\n';for(const res of clients){if(res.writableLength>262144){res.destroy();clients.delete(res);}else res.write(message);}q.metrics.lastSsePublishAt=now;};q.on('change',publish);
 q.on('meter',level=>{for(const r of clients)if(r.writableLength<262144)r.write('event: meter\ndata: '+JSON.stringify({level})+'\n\n');});
 const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
 async function body(req){let n=0,parts=[];for await(const chunk of req){n+=chunk.length;if(n>65536)throw Error('request too large');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
 const bearer=req=>(req.headers.authorization||'').replace(/^Bearer /,'');
 function asset(res,base,name){let target;try{target=fs.realpathSync(path.join(base,name));const realBase=fs.realpathSync(base);if(target!==realBase&&!target.startsWith(realBase+path.sep))throw Error();if(!fs.statSync(target).isFile())throw Error();}catch{return json(res,404,{error:'not found'});}res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'});fs.createReadStream(target).pipe(res);}
 function privateState(){return {config:store.config,playerUrl:`http://127.0.0.1:${actualPort()}/player#key=${store.keys.player}`,credentials:{bilibiliCookieConfigured:!!process.env.BILI_COOKIE,llmKeyConfigured:!!process.env.LLM_API_KEY,ttsKeyConfigured:!!process.env.TTS_API_KEY}};}
 function player(data){const now=Date.now();if(!data.client||String(data.client).length>80)throw Error('client required');if(q.player&&q.player.client!==data.client&&q.player.until>now)return {busy:true};q.player={client:data.client,until:now+15000};
  const j=q.pending()[0];if(!j||!['ready','playing'].includes(j.status))return {waiting:true};
  if(data.action==='meter'){if(j.status==='playing')q.emit('meter',Math.max(0,Math.min(1,Number(data.level)||0)));return {ok:true};}
  const segment=j.segments[j.segmentIndex];if(!segment){if(j.synthesisDone){j.status='done';q.releaseAudio(j);q.finishBatch();q.changed();}return {waiting:true};}
  if(data.action==='start'){if(data.id!==segment.id)throw Error('stale segment');j.status='playing';j.audioStartedAt||=now;j.segmentStartedAt=now;q.metrics.selectedToPlaybackMs=now-j.createdAt;q.changed();}
  if(data.action==='done'){if(data.id!==segment.id||j.status!=='playing')throw Error('stale playback');segment.durationMs=now-j.segmentStartedAt;j.segmentIndex++;if(j.segmentIndex>=j.segments.length&&j.synthesisDone){j.status='done';q.releaseAudio(j);q.finishBatch();}else j.status='ready';q.changed();return {ok:true};}
  if(data.action==='error'){q.error(j,'player_blocked_or_audio_error');return {ok:true};}
  return {jobId:j.id,id:segment.id,url:'/audio/'+segment.id,text:segment.text};
 }
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; frame-src http: https:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; object-src 'none'");
  const expected=new Set(['127.0.0.1:'+actualPort(),'localhost:'+actualPort()]);if(!expected.has(req.headers.host))return json(res,403,{error:'loopback host required'});
  if(req.headers.origin&&!new Set([...expected].map(h=>'http://'+h)).has(req.headers.origin))return json(res,403,{error:'foreign origin'});
  let u;try{u=new URL(req.url,'http://127.0.0.1');}catch{return json(res,400,{error:'bad URL'});}
  try{
   if(req.method==='GET'){
    if(u.pathname==='/api/state')return json(res,200,q.snapshot());
    if(u.pathname==='/api/private'){if(!same(bearer(req),store.keys.control))return json(res,401,{error:'control token required'});return json(res,200,privateState());}
    if(u.pathname==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});clients.add(res);res.write('event: state\ndata: '+JSON.stringify(q.snapshot())+'\n\n');req.on('close',()=>clients.delete(res));return;}
    if(u.pathname.startsWith('/audio/')){const a=q.audio.get(u.pathname.slice(7));if(!a)return json(res,404,{error:'audio expired'});res.writeHead(200,{'Content-Type':a.type});return res.end(a.bytes);}
    if(u.pathname.startsWith('/user-assets/'))return asset(res,path.join(root,'user-assets'),decodeURIComponent(u.pathname.slice(13)));
    const file={'/':'console.html','/console':'console.html','/overlay':'overlay.html','/player':'player.html'}[u.pathname]||u.pathname.slice(1);if(!/^[a-z.-]+$/.test(file))return json(res,404,{error:'not found'});return asset(res,path.join(root,'web'),file);
   }
   if(req.method!=='POST')return json(res,405,{error:'method not allowed'});
   const playback=u.pathname==='/api/player';if(!same(bearer(req),playback?store.keys.player:store.keys.control))return json(res,401,{error:'token required'});const d=await body(req);let result;
   switch(u.pathname){
    case '/api/player':result=player(d);break;
    case '/api/config':store.save(d);q.changed();result={ok:true,reconnectRequired:true};break;
    case '/api/connect':receiver.start(store.config.roomId).catch(()=>{});result={starting:true};break;
    case '/api/disconnect':receiver.stop();result={ok:true};break;
    case '/api/demo':q.ingest({name:'演示观众',text:String(d.text||'今天准备走什么路线？'),id:crypto.randomUUID()});result={ok:true};break;
    case '/api/select':result=q.select(d.id,d.mode||'voice');break;
    case '/api/edit':q.edit(d.id,d.action);result={ok:true};break;
    case '/api/tasks/claim':result={task:q.claim(d.worker||'external')};break;
    case '/api/reply':result=q.reply(d.id,d.lease,d.text);break;
    case '/api/skip':q.skip(d.id,d.lease);result={ok:true};break;
    case '/api/operator':if(d.mode==='note'){const row={id:crypto.randomUUID(),partition:store.config.partition,text:String(d.text||'').slice(0,4000),createdAt:Date.now()};fs.appendFileSync(path.join(store.dir,'notes.jsonl'),JSON.stringify(row)+'\n');result={saved:true};}else{const id=crypto.randomUUID();q.ingest({name:'主播',source:'operator',text:String(d.text||'').slice(0,400),id});result=q.select(id,d.mode==='text'?'text':'voice');}break;
    case '/api/thought':if(typeof d.text!=='string'||d.text.length>4000||JSON.stringify(d.state||{}).length>16000)throw Error('thought too large');q.thought={text:d.text,state:d.state||{},updatedAt:Date.now()};q.changed();result={ok:true};break;
    default:return json(res,404,{error:'unknown API'});
   }return json(res,200,result);
  }catch(e){const safe=['token','lease','batch','pending','playing','message','answer','mode','action','roomId','overlay','partition','voice','invalid','config','unknown','large'].some(k=>e.message.includes(k));return json(res,400,{error:safe?e.message:'request_failed'});}
 });
 const actualPort=()=>server.address()?.port||port;
 return {q,store,receiver,workers,server,async start(){await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});tick=setInterval(()=>{workers.tick();if(q.player&&q.player.until<Date.now()){const j=q.jobs.find(j=>j.status==='playing');if(j)q.error(j,'player_disconnected');q.player=null;}if(Date.now()-lastPush>15000)for(const r of clients)r.write(': heartbeat\n\n');},250);if(demo)q.ingest({id:crypto.randomUUID(),name:'演示观众',text:'这里是演示弹幕，不会调用模型或播放声音。'});return actualPort();},async close(){clearInterval(tick);workers.stop();receiver.stop();for(const r of clients)r.end();server.closeAllConnections();await new Promise(ok=>server.close(ok));}};
}
if(require.main===module){const app=createApp({port:Number(process.env.PORT)||17980,demo:process.argv.includes('--demo')});app.start().then(port=>{console.log(`Console: http://127.0.0.1:${port}/console\nOverlay: http://127.0.0.1:${port}/overlay\nControl token (local only): ${app.store.keys.control}\nPlayer: http://127.0.0.1:${port}/player#key=${app.store.keys.player}\nReal danmaku/model/voice are opt-in. Ctrl+C stops this process only.`);});process.on('SIGINT',()=>app.close().then(()=>process.exit(0)));}
module.exports={createApp};
