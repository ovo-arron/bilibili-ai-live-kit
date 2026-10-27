'use strict';
const {EventEmitter}=require('node:events');const {inflateSync,brotliDecompressSync}=require('node:zlib');const {createHash,randomUUID}=require('node:crypto');
const TABLE=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
function sign(params,key,now=Date.now()){const p={...params,wts:Math.floor(now/1000)};const q=Object.keys(p).sort().map(k=>encodeURIComponent(k)+'='+encodeURIComponent(String(p[k]).replace(/[!'()*]/g,''))).join('&');return q+'&w_rid='+createHash('md5').update(q+key).digest('hex');}
function packet(op,text=''){const body=Buffer.from(text),b=Buffer.alloc(16+body.length);b.writeUInt32BE(b.length);b.writeUInt16BE(16,4);b.writeUInt16BE(1,6);b.writeUInt32BE(op,8);b.writeUInt32BE(1,12);body.copy(b,16);return b;}
function decode(raw,depth=0,out=[]){
 if(depth>4||raw.length>2097152)throw Error('packet limit');
 for(let off=0;off<raw.length;){if(raw.length-off<16)throw Error('header');const len=raw.readUInt32BE(off),h=raw.readUInt16BE(off+4),v=raw.readUInt16BE(off+6),op=raw.readUInt32BE(off+8);if(h<16||len<h||off+len>raw.length)throw Error('length');const body=raw.subarray(off+h,off+len);off+=len;
  if(v===2||v===3){decode((v===2?inflateSync:brotliDecompressSync)(body,{maxOutputLength:2097152}),depth+1,out);continue;}
  if(op===8)out.push({kind:'auth',...JSON.parse(body)});
  if(op===5){const d=JSON.parse(body),cmd=String(d.cmd||'').split(':')[0];if(cmd==='LIVE'||cmd==='PREPARING')out.push({kind:'live',live:cmd==='LIVE'});
   if(cmd==='DANMU_MSG'&&Array.isArray(d.info)&&typeof d.info[1]==='string'){const i=d.info;let sentAt=Number(i[0]?.[4]);if(sentAt<1e12)sentAt*=1000;if(Math.abs(Date.now()-sentAt)>86400000)sentAt=null;
    out.push({kind:'chat',id:createHash('sha256').update(String(i[2]?.[0])+':'+String(i[0]?.[4])+':'+i[1]).digest('hex').slice(0,24),name:String(i[2]?.[1]||'观众').slice(0,40),text:i[1].trim().slice(0,500),sentAt});}
  }
 }return out;
}
class Receiver extends EventEmitter{
 constructor(){super();this.running=false;this.generation=0;this.status={connected:false,live:false,roomId:0,received:0,error:null};}
 stop(){this.running=false;this.generation++;clearInterval(this.timer);clearTimeout(this.retry);this.ws?.close();this.status.connected=false;this.emit('status',this.status);}
 async start(roomId){this.stop();if(!roomId)throw Error('Set a roomId first');this.running=true;const generation=this.generation;this.status.roomId=roomId;await this.connect(generation);}
 async connect(generation){
  if(!this.running||generation!==this.generation)return;
  const cookie=process.env.BILI_COOKIE||'';const headers={'User-Agent':'Mozilla/5.0','Referer':'https://live.bilibili.com/'+this.status.roomId,...(cookie?{Cookie:cookie}:{})};
  const get=async u=>{const r=await fetch(u,{headers,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Bilibili HTTP '+r.status);const j=await r.json();if(j.code!==0)throw Error('Bilibili code '+j.code);return j.data;};
  try{
   const room=await get('https://api.live.bilibili.com/room/v1/Room/get_info?room_id='+this.status.roomId);const id=Number(room.room_id);this.status.live=room.live_status===1;
   const nav=await get('https://api.bilibili.com/x/web-interface/nav');const img=nav.wbi_img;const seed=[img.img_url,img.sub_url].map(u=>new URL(u).pathname.split('/').pop().split('.')[0]).join('');if(seed.length!==64)throw Error('WBI material unavailable');
   const key=TABLE.map(i=>seed[i]).join('').slice(0,32);const auth=await get('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?'+sign({id,type:0,web_location:'444.8'},key));
   const host=auth.host_list?.find(v=>/^[a-z0-9.-]+\.chat\.bilibili\.com$/i.test(v.host))?.host;if(!host||!auth.token)throw Error('No authenticated danmaku host');
   if(generation!==this.generation)return;
   const ws=this.ws=new WebSocket('wss://'+host+'/sub');ws.binaryType='arraybuffer';let last=Date.now();let opened=false;
   ws.onopen=()=>ws.send(packet(7,JSON.stringify({uid:Number(nav.mid)||0,roomid:id,protover:2,platform:'web',type:2,key:auth.token,buvid:cookie.match(/(?:^|;\s*)buvid3=([^;]+)/)?.[1]||'',support_ack:true,queue_uuid:randomUUID(),scene:'room'})));
   ws.onmessage=e=>{last=Date.now();if(generation!==this.generation)return;try{for(const row of decode(Buffer.from(e.data))){if(row.kind==='auth'){if(row.code!==0)throw Error('Authentication rejected');opened=true;this.status.connected=true;this.status.error=null;ws.send(packet(2,'[object Object]'));}
     if(row.kind==='chat'){this.status.received++;this.emit('chat',row);}if(row.kind==='live')this.status.live=row.live;this.emit('status',this.status);}}catch{this.status.error='packet_or_auth_error';ws.close();}};
   ws.onerror=()=>{this.status.error='websocket_error';ws.close();};
   ws.onclose=()=>{clearInterval(timer);if(generation!==this.generation)return;this.status.connected=false;this.emit('status',this.status);if(this.running)this.retry=setTimeout(()=>this.connect(generation),5000);};
   const timer=this.timer=setInterval(()=>{if(Date.now()-last>(opened?75000:15000))return ws.close();if(opened&&ws.readyState===1)ws.send(packet(2,'[object Object]'));},25000);
  }catch(e){if(generation!==this.generation)return;this.status.connected=false;this.status.error=String(e.message).startsWith('Bilibili')?e.message:'connection_failed_check_login_or_network';this.emit('status',this.status);if(this.running)this.retry=setTimeout(()=>this.connect(generation),10000);}
 }
}
module.exports={Receiver,packet,decode,sign};
