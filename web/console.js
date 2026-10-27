'use strict';
const $=s=>document.getElementById(s);let token=sessionStorage.getItem('control')||'',state=null,config=null,task=null,renderKey='';const feedNodes=new Map();$('token').value=token;
async function api(path,data){const r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(data===undefined?{}:{body:JSON.stringify(data)})});const j=await r.json();if(!r.ok)throw Error(j.error);return j;}
function run(fn){return async()=>{try{$('error').textContent='';await fn();}catch(e){$('error').textContent=e.message;}};}
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
function button(label,fn){const b=text('button',label);b.onclick=run(fn);return b;}
async function privateState(){const p=await api('private');config=p.config;$('config').value=JSON.stringify(config,null,2);$('player').href=p.playerUrl;$('credentials').textContent='已配置：'+JSON.stringify(p.credentials);}
$('unlock').onclick=run(async()=>{token=$('token').value.trim();sessionStorage.setItem('control',token);await privateState();});
$('connect').onclick=run(()=>api('connect',{}));$('disconnect').onclick=run(()=>api('disconnect',{}));
$('save').onclick=run(async()=>{config=JSON.parse($('config').value);await api('config',config);});
$('demo').onclick=run(()=>api('demo',{text:$('demoText').value||'今天准备走什么路线？'}));
$('auto').onchange=run(async()=>{if(!config)await privateState();config.autoCollect=$('auto').checked;await api('config',config);$('config').value=JSON.stringify(config,null,2);});
$('partition').onchange=run(async()=>{if(!config)await privateState();config.partition=$('partition').value;await api('config',config);$('config').value=JSON.stringify(config,null,2);});
$('send').onclick=run(async()=>{await api('operator',{mode:$('mode').value,text:$('operator').value});$('operator').value='';});
$('thoughtSend').onclick=run(()=>api('thought',{text:$('thought').value,state:{}}));
$('claim').onclick=run(async()=>{task=(await api('tasks/claim',{worker:'console-manual'})).task;$('task').textContent=task?JSON.stringify({id:task.id,partition:task.partition,message:task.message},null,2):'没有待答任务';});
$('reply').onclick=run(async()=>{if(!task)throw Error('先领取任务');await api('reply',{id:task.id,lease:task.lease,text:$('answer').value});task=null;$('task').textContent='已提交';$('answer').value='';});
$('skip').onclick=run(async()=>{if(!task)throw Error('先领取任务');await api('skip',{id:task.id,lease:task.lease});task=null;$('task').textContent='已跳过';});
const events=new EventSource('/events');events.addEventListener('state',e=>{state=JSON.parse(e.data);const s=state;
 $('status').textContent=`房间 ${s.config.roomId||'未设置'} · ${s.receiver.connected?'弹幕已连接':'弹幕未连接'} · ${s.receiver.live?'直播中':'下播/未知'} · ${s.receiver.error||''}`;
 $('auto').checked=s.config.autoCollect;const old=$('partition');if([...old.options].map(x=>x.value).join('\n')!==s.config.partitions.join('\n')){old.replaceChildren(...s.config.partitions.map(p=>{const o=text('option',p);o.value=p;return o;}));}old.value=s.config.partition;
 $('metrics').textContent=JSON.stringify(s.metrics);
 const visible=s.feed.slice(-200),ids=new Set(visible.map(r=>r.id));for(const [id,node] of feedNodes)if(!ids.has(id)){node.remove();feedNodes.delete(id);}
 for(const r of visible)if(!feedNodes.has(r.id)){const row=document.createElement('div');row.className='item';row.append(text('b',r.name),text('p',r.text),button('加入语音待答',()=>api('select',{id:r.id,mode:'voice'})),button('只回文字',()=>api('select',{id:r.id,mode:'text'})));feedNodes.set(r.id,row);$('feed').prepend(row);}
 const key=JSON.stringify(s.jobs);if(key===renderKey)return;renderKey=key;
 const terminal=new Set(['done','text_done','skipped','error']);const ordered=[...s.jobs.filter(j=>!terminal.has(j.status)),...s.jobs.filter(j=>terminal.has(j.status)).reverse().slice(0,10)];
 $('jobs').replaceChildren(...ordered.map(j=>{const row=document.createElement('div');row.className='item';row.append(text('b',j.message.name),text('small',j.status+' · '+j.mode+' · '+j.partition),text('p',j.message.text));if(j.answer)row.append(text('p',j.answer));if(j.error)row.append(text('p',j.error));if(!j.audioStartedAt&&!['done','text_done','skipped','error','playing'].includes(j.status))for(const [label,action] of [['插队','front'],['上移','up'],['下移','down'],['移除','remove']])row.append(button(label,()=>api('edit',{id:j.id,action})));return row;}));
});events.onerror=()=>{$('status').textContent='本机服务连接中断，正在重连…';};if(token)privateState().catch(()=>{});
