// P02 — che eventi arrivano in una sessione REALE (write + edit + bash)?
// Serve a definire il modello dati interno di STARK.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
const CAP='/root/DevsMachna/stark/spike/captures/p02.jsonl';
const cap=createWriteStream(CAP);
const child=spawn('claude',[
  '-p','--input-format','stream-json','--output-format','stream-json','--verbose',
  '--model','claude-haiku-4-5-20251001',
  '--strict-mcp-config',                 // niente MCP: superficie tool pulita
  '--include-partial-messages',          // streaming token-per-token
  '--allowedTools','Write','Edit','Read','Bash',
  '--permission-mode','acceptEdits',
  '--no-session-persistence',
],{cwd:'/root/DevsMachna/stark/spike/sandbox',stdio:['pipe','pipe','pipe']});
const types=new Map(); const streamSub=new Map(); let buf=''; let stderr='';
child.stderr.on('data',d=>stderr+=d);
child.stdout.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);
 if(!l.trim())continue;cap.write(l+'\n');let e;try{e=JSON.parse(l)}catch{continue}
 const k=e.type+(e.subtype?':'+e.subtype:'');types.set(k,(types.get(k)||0)+1);
 if(e.type==='stream_event'){const st=e.event?.type+(e.event?.content_block?.type?'/'+e.event.content_block.type:'');streamSub.set(st,(streamSub.get(st)||0)+1);}
 if(e.type==='result'){console.log('RESULT:',JSON.stringify((e.result||'').slice(0,300)));console.log('costo:',e.total_cost_usd);child.stdin.end();}
}});
child.on('close',c=>{console.log('\n──── P02 ────\nexit',c);
 console.log('EVENTI TOP-LEVEL:',JSON.stringify(Object.fromEntries([...types].sort((a,b)=>b[1]-a[1])),null,1));
 console.log('SOTTOTIPI stream_event:',JSON.stringify(Object.fromEntries([...streamSub].sort((a,b)=>b[1]-a[1])),null,1));
 if(stderr.trim())console.log('STDERR:',stderr.slice(0,1500));});
child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',text:"Nella cartella corrente fai esattamente questo, in ordine: 1) crea il file hello.txt con dentro la parola ciao; 2) modifica hello.txt sostituendo ciao con 'ciao mondo'; 3) esegui il comando ls -la e dimmi quanti file vedi. Sii conciso."}]}})+'\n');
setTimeout(()=>{console.log('TIMEOUT');child.kill('SIGKILL')},300000);
