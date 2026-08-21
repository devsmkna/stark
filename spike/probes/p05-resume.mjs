// P05 — le sessioni si riprendono dopo che il processo e' morto? (riavvio di STARK)
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const SID=randomUUID();
function run(extraArgs, prompt, label){ return new Promise(res=>{
  const child=spawn('claude',['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
   '--model','claude-haiku-4-5-20251001','--strict-mcp-config',...extraArgs],
   {cwd:'/root/DevsMachna/stark/spike/sandbox',stdio:['pipe','pipe','pipe']});
  let buf='',out='',err='';
  child.stderr.on('data',d=>err+=d);
  child.stdout.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);
   if(!l.trim())continue;let e;try{e=JSON.parse(l)}catch{continue}
   if(e.type==='result'){out=(e.result||'').trim();console.log(`[${label}] sid=${e.session_id} -> ${JSON.stringify(out.slice(0,120))}`);child.stdin.end();}}});
  child.on('close',()=>{ if(err.trim())console.log(`[${label}] STDERR: ${err.slice(0,400)}`); res(out);});
  child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',text:prompt}]}})+'\n');
  setTimeout(()=>child.kill('SIGKILL'),120000);});}
(async()=>{
 console.log('session-id scelto da noi:',SID);
 await run(['--session-id',SID],'Ricorda questa parola chiave: TROMBONE. Rispondi solo con OK.','FASE 1 (nuova)');
 console.log('--- processo terminato, simuliamo il riavvio di STARK ---');
 const a=await run(['--resume',SID],'Qual era la parola chiave? Rispondi solo con la parola.','FASE 2 (resume)');
 console.log('\n──── P05 ────');
 console.log(/TROMBONE/i.test(a)?'ESITO: SI — ripresa sessione da processo NUOVO confermata (--session-id + --resume)'
                                :'ESITO: NO — la ripresa non ha mantenuto il contesto. Risposta: '+JSON.stringify(a));
})();
