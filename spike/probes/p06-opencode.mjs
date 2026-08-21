// P06 — modello di OpenCode a confronto con quello di Claude Code.
// Serve a validare (o smentire) il "modello di eventi canonico" di STARK.
const BASE='http://127.0.0.1:4599';
const CWD='/root/DevsMachna/stark/spike/sandbox';
const types=new Map(); const samples=new Map();
const j=async(p,o)=>{const r=await fetch(BASE+p,{headers:{'content-type':'application/json'},...o});
  const t=await r.text(); if(!r.ok)throw new Error(p+' -> '+r.status+' '+t.slice(0,400));
  try{return JSON.parse(t)}catch{return t}};

const ses=await j('/api/session',{method:'POST',body:JSON.stringify({location:{directory:CWD}})});
console.log('sessione creata');
const sid=(ses.data||ses).id;

// SSE della sessione
const es=await fetch(`${BASE}/api/session/${sid}/event`,{headers:{accept:'text/event-stream'}});
const reader=es.body.getReader(); const dec=new TextDecoder(); let buf='';
let idle=false;
(async()=>{ while(true){ const {done,value}=await reader.read(); if(done)break;
  buf+=dec.decode(value,{stream:true});
  let i; while((i=buf.indexOf('\n'))>=0){ const line=buf.slice(0,i); buf=buf.slice(i+1);
    if(!line.startsWith('data:'))continue;
    let e; try{e=JSON.parse(line.slice(5).trim())}catch{continue}
    const t=e.type||'?'; types.set(t,(types.get(t)||0)+1);
    if(!samples.has(t))samples.set(t,JSON.stringify(e).slice(0,300));
    if(t==='session.idle')idle=true;
  }}})();

await new Promise(r=>setTimeout(r,1500));
console.log('invio prompt...');
try{
  await j(`/api/session/${sid}/prompt`,{method:'POST',body:JSON.stringify({
    prompt:{text:"Crea il file oc-hello.txt con dentro la parola ciao, poi esegui ls. Sii conciso."}})});
}catch(err){ console.log('PROMPT FALLITO:',err.message); }

for(let k=0;k<60 && !idle;k++) await new Promise(r=>setTimeout(r,1000));
console.log('\n──── P06 ────');
console.log('idle raggiunto:',idle);
console.log('\nEVENTI OSSERVATI:');
for(const [t,c] of [...types].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(c).padStart(4)} x ${t}`);
console.log('\nESEMPI:');
for(const [t,s] of samples) console.log(`  ${t}\n     ${s}`);
process.exit(0);
