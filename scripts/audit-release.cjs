'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');const root=path.resolve(__dirname,'..');
function walk(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(d=>['.git','data','node_modules','__pycache__','.venv'].includes(d.name)||d.name==='.env'?[]:d.isDirectory()?walk(path.join(p,d.name)):[path.join(p,d.name)]);}
const paths=walk(root).filter(p=>!p.startsWith(path.join(root,'user-assets')+path.sep)||path.basename(p)==='.gitkeep');const errors=[];
for(const file of paths){const relative=path.relative(root,file).replaceAll('\\','/');if(/\.(png|jpe?g|webp|gif|wav|mp3|moc3|cmo3|psd|zip)$/i.test(file)){errors.push(relative+': media/binary not allowed');continue;}const text=fs.readFileSync(file,'utf8');for(const re of [/gh[pousr]_[A-Za-z0-9]{20,}/g,/sk-[A-Za-z0-9_-]{24,}/g,/(?:SESSDATA|bili_jct)\s*=\s*[^\s;]{5,}/g,/[A-Z]:[\\/]Users[\\/][^\s"']+/g])if(re.test(text))errors.push(relative+': potential credential/personal path');}
try{const tracked=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).split(/\r?\n/);for(const p of tracked)if(/^(data\/|\.env$|user-assets\/(?!\.gitkeep$))/.test(p))errors.push('private file tracked: '+p);}catch{/* Pre-git packaging is supported. */}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Release audit passed: '+paths.length+' allowlisted text files; no character art, voice, account config or runtime data.');
module.exports={walk};
