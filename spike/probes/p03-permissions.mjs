// P03 — in stream-json, quando serve un permesso arriva un evento a cui possiamo RISPONDERE?
// E' la sonda che decide se le "card di approvazione" di STARK sono realizzabili.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
const CAP='/root/DevsMachna/stark/spike/captures/p03.jsonl';
const cap=createWriteStream(CAP);
const mode=process.argv[2]||'default';
const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
  '--model','claude-haiku-4-5-20251001','--strict-mcp-config','--no-session-persistence'];
if(mode!=='default'){args.push('--permission-mode',mode);}
console.log('MODE:',mode,'| args:',args.join(' '));
const child=spawn('claude',args,{cwd:'/root/DevsMachna/stark/spike/sandbox',stdio:['pipe','pipe','pipe']});
let buf='',stderr='';const types=new Map();let controlSeen=false;
child.stderr.on('data',d=>stderr+=d);
child.stdout.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);
 if(!l.trim())continue;cap.write(l+'\n');let e;try{e=JSON.parse(l)}catch{continue}
 const k=e.type+(e.subtype?':'+e.subtype:'');types.set(k,(types.get(k)||0)+1);

 // ---- il pezzo che ci interessa: una richiesta di controllo dall'agent verso di noi ----
 if(e.type==='control_request'){
   controlSeen=true;
   console.log('\n*** CONTROL_REQUEST RICEVUTA ***');
   console.log(JSON.stringify(e,null,1).slice(0,1500));
   const reply={type:'control_response',response:{subtype:'success',request_id:e.request_id,
     response:{behavior:'allow',updatedInput:e.request?.input}}};
   console.log('--> rispondo ALLOW:',JSON.stringify(reply).slice(0,300));
   child.stdin.write(JSON.stringify(reply)+'\n');
 }
 if(e.type==='system'&&e.subtype==='permission_denied'){
   console.log('\n!!! permission_denied (auto-negato, nessuna richiesta a noi):',JSON.stringify(e).slice(0,400));
 }
 if(e.type==='result'){console.log('\nRESULT:',JSON.stringify((e.result||'').slice(0,300)));
   console.log('permission_denials:',JSON.stringify(e.permission_denials||[]).slice(0,500));
   child.stdin.end();}
}});
child.on('close',c=>{console.log('\n──── P03 ('+mode+') ────\nexit',c);
 console.log('eventi:',JSON.stringify(Object.fromEntries(types)));
 console.log(controlSeen?'ESITO: SI — l\'agent CI CHIEDE il permesso e possiamo rispondere -> card di approvazione FATTIBILI'
                       :'ESITO: NO — nessuna control_request; il permesso non ci viene delegato in questa modalita');
 if(stderr.trim())console.log('STDERR:',stderr.slice(0,1200));});
child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',
  text:"Esegui il comando shell: whoami && date. Poi dimmi solo l'output."}]}})+'\n');
setTimeout(()=>{console.log('\nTIMEOUT 150s — probabilmente BLOCCATO in attesa di un permesso che non sa a chi chiedere');child.kill('SIGKILL')},150000);
