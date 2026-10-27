'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function dotenv(){const p=path.join(root,'.env');if(!fs.existsSync(p))return;for(const line of fs.readFileSync(p,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^(["'])(.*)\1$/,'$2');}}
function validate(c){
 if(!Number.isSafeInteger(c.roomId)||c.roomId<0)throw Error('roomId must be a positive integer or 0');
 if(!Number.isInteger(c.batchSize)||c.batchSize<1||c.batchSize>10)throw Error('batchSize: 1..10');
 for(const [key,min,max] of [['quietMs',1000,60000],['messageMaxAgeMs',10000,600000]])if(!Number.isFinite(c[key])||c[key]<min||c[key]>max)throw Error(key+' out of range');
 for(const key of ['autoCollect','liveOnly'])if(typeof c[key]!=='boolean')throw Error(key+' must be boolean');
 if(!Array.isArray(c.partitions)||!c.partitions.length||c.partitions.length>30||c.partitions.some(v=>typeof v!=='string'||v.length>50))throw Error('invalid partitions');
 if(!c.partitions.includes(c.partition))throw Error('unknown partition');
 if(!Array.isArray(c.blockedPhrases)||c.blockedPhrases.some(v=>typeof v!=='string'||v.length>100))throw Error('invalid blockedPhrases');
 for(const [key,min,max] of [['width',200,1000],['avatarHeight',100,1000],['thoughtHeight',70,600],['chatHeight',70,600],['fontSize',14,60]])if(!Number.isFinite(c.overlay[key])||c.overlay[key]<min||c.overlay[key]>max)throw Error('invalid overlay.'+key);
 for(const key of ['color','background'])if(!/^#[0-9a-f]{6}$/i.test(c.overlay[key]))throw Error('invalid color');
 if(!['placeholder','image','web'].includes(c.avatar.mode))throw Error('invalid avatar mode');
 if(c.avatar.url&&!/^(https?:\/\/|\/user-assets\/)/.test(c.avatar.url))throw Error('avatar URL must be http(s) or /user-assets/');
 for(const key of ['llm','voice']){if(typeof c[key].enabled!=='boolean')throw Error('invalid enabled flag');const u=new URL(c[key].url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('invalid service URL');if(typeof c[key].model!=='string'||c[key].model.length>200)throw Error('invalid model');}
 if(typeof c.llm.system!=='string'||c.llm.system.length>6000)throw Error('system too long');
 if(!['wav','mp3','opus'].includes(c.voice.format))throw Error('invalid speech format');
 if(!Number.isFinite(c.voice.timeoutMs)||c.voice.timeoutMs<1000||c.voice.timeoutMs>300000)throw Error('invalid voice timeout');
 return c;
}
function setup(dir=path.join(root,'data')){
 dotenv();fs.mkdirSync(dir,{recursive:true});
 const defaults=JSON.parse(fs.readFileSync(path.join(root,'config.example.json'),'utf8'));
 const cfg=path.join(dir,'config.json');let config=fs.existsSync(cfg)?JSON.parse(fs.readFileSync(cfg,'utf8')):defaults;validate(config);
 const kp=path.join(dir,'keys.json');let keys=fs.existsSync(kp)?JSON.parse(fs.readFileSync(kp,'utf8')):{control:crypto.randomBytes(32).toString('hex'),player:crypto.randomBytes(32).toString('hex')};
 if(!fs.existsSync(kp))fs.writeFileSync(kp,JSON.stringify(keys),{mode:0o600});
 return {dir,keys,get config(){return config;},save(next){validate(next);config=structuredClone(next);const tmp=cfg+'.tmp';fs.writeFileSync(tmp,JSON.stringify(config,null,2),{mode:0o600});fs.renameSync(tmp,cfg);return config;}};
}
module.exports={setup,validate,root};
