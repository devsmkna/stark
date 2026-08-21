// P03-bis — dichiarando un hook PreToolUse nell'handshake, l'agent CI CHIEDE il permesso?
// E' l'ultimo punto aperto: decide se le card di approvazione sono realizzabili su Claude Code.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
const CAP='/root/DevsMachna/stark/spike/captures/p03bis.jsonl';
const cap=createWriteStream(CAP);
const child=spawn('claude',['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
 '--model','claude-haiku-4-5-20251001','--strict-mcp-config','--no-session-persistence',
 '--permission-mode','manual','--include-hook-events'],
 {cwd:'/root/DevsMachna/stark/spike/sandbox',stdio:['pipe','pipe','pipe']});
let buf='',stderr='',sent=false,asked=0;const types=new Map();
child.stderr.on('data',d=>stderr+=d);
child.stdout.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);
 if(!l.trim())continue;cap.write(l+'\n');let e;try{e=JSON.parse(l)}catch{continue}
 const k=e.type+(e.subtype?':'+e.subtype:'');types.set(k,(types.get(k)||0)+1);

 if(e.type==='control_response'&&!sent){
   const r=e.response||{};
   console.log('handshake ->',r.subtype, r.error?('ERRORE: '+r.error):'ok');
   if(r.subtype==='success'){sent=true;
     child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',
       text:"Esegui questo comando shell: touch /tmp/stark-p03bis.txt && echo creato"}]}})+'\n');
     console.log('--> prompt con comando a effetti collaterali inviato');}}

 // *** il pezzo decisivo: l'agent apre una richiesta VERSO DI NOI ***
 if(e.type==='control_request'){asked++;
   console.log('\n*** L\'AGENT CI CHIEDE QUALCOSA ***');
   console.log(JSON.stringify(e,null,1).slice(0,2000));
   const sub=e.request?.subtype;
   let response;
   if(sub==='hook_callback'){
     response={async:false,decision:'approve',
       hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',
         permissionDecisionReason:'Approvato da STARK (utente ha cliccato Consenti)'}};
   } else { response={behavior:'allow',updatedInput:e.request?.input}; }
   child.stdin.write(JSON.stringify({type:'control_response',
     response:{subtype:'success',request_id:e.request_id,response}})+'\n');
   console.log('--> risposto ALLOW:',JSON.stringify(response).slice(0,250));}

 if(e.type==='system'&&e.subtype==='permission_denied')
   console.log('\n!!! auto-negato (non ci ha chiesto):',JSON.stringify(e).slice(0,300));
 if(e.type==='system'&&e.subtype==='hook_event')
   console.log('[hook_event]',JSON.stringify(e).slice(0,300));
 if(e.type==='result'){
   console.log('\nRESULT:',JSON.stringify((e.result||'').slice(0,250)));
   console.log('permission_denials:',JSON.stringify(e.permission_denials||[]).slice(0,300));
   child.stdin.end();}
}});
child.on('close',c=>{console.log('\n──── P03-bis ────\nexit',c,'| richieste ricevute dall\'agent:',asked);
 console.log('eventi:',JSON.stringify(Object.fromEntries(types)));
 console.log(asked>0?'ESITO: SI — le CARD DI APPROVAZIONE sono realizzabili su Claude Code'
                    :'ESITO: NO — con questo handshake l\'agent non ci delega la decisione');
 if(stderr.trim())console.log('STDERR:',stderr.slice(0,1200));});
// handshake con hook PreToolUse dichiarato (forma accettata in P03c)
child.stdin.write(JSON.stringify({type:'control_request',request_id:'init-1',request:{subtype:'initialize',
  hooks:{PreToolUse:[{matcher:'Bash',hookCallbackIds:['stark-pretooluse-1']}]}}})+'\n');
setTimeout(()=>{console.log('TIMEOUT 180s');child.kill('SIGKILL')},180000);
