// P03b — esiste un canale di CONTROLLO bidirezionale (initialize handshake)?
// Se si, e' li' che vivono canUseTool/hook -> card di approvazione.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
const CAP='/root/DevsMachna/stark/spike/captures/p03b.jsonl';
const cap=createWriteStream(CAP);
const child=spawn('claude',['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
 '--model','claude-haiku-4-5-20251001','--strict-mcp-config','--no-session-persistence',
 '--permission-mode','manual','--include-hook-events'],
 {cwd:'/root/DevsMachna/stark/spike/sandbox',stdio:['pipe','pipe','pipe']});
let buf='',stderr='',sentPrompt=false;const types=new Map();let ctrl=0;
child.stderr.on('data',d=>stderr+=d);
child.stdout.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);
 if(!l.trim())continue;cap.write(l+'\n');let e;try{e=JSON.parse(l)}catch{continue}
 const k=e.type+(e.subtype?':'+e.subtype:'');types.set(k,(types.get(k)||0)+1);
 if(e.type==='control_response'){ctrl++;console.log('\n*** CONTROL_RESPONSE ***\n'+JSON.stringify(e,null,1).slice(0,2500));
   if(!sentPrompt){sentPrompt=true;
     child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',
       text:"Esegui questo comando shell: rm -f /tmp/stark-p03-test.txt && touch /tmp/stark-p03-test.txt && echo creato. Poi dimmi l'output."}]}})+'\n');
     console.log('--> prompt inviato (comando con effetti collaterali)');}}
 if(e.type==='control_request'){ctrl++;console.log('\n*** CONTROL_REQUEST (l\'agent chiede A NOI) ***\n'+JSON.stringify(e,null,1).slice(0,2000));
   child.stdin.write(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:e.request_id,
     response:{behavior:'allow',updatedInput:e.request?.input}}})+'\n');
   console.log('--> risposto ALLOW');}
 if(e.type==='system'&&e.subtype==='permission_denied')console.log('\n!!! permission_denied:',JSON.stringify(e).slice(0,500));
 if(e.type==='result'){console.log('\nRESULT:',JSON.stringify((e.result||'').slice(0,300)));
   console.log('permission_denials:',JSON.stringify(e.permission_denials||[]).slice(0,600));child.stdin.end();}
}});
child.on('close',c=>{console.log('\n──── P03b ────\nexit',c,'| messaggi di controllo scambiati:',ctrl);
 console.log('eventi:',JSON.stringify(Object.fromEntries(types)));
 if(stderr.trim())console.log('STDERR:',stderr.slice(0,1500));});
// handshake in stile SDK
const init={type:'control_request',request_id:'init-1',request:{subtype:'initialize',
  hooks:{PreToolUse:[{matchers:['Bash']}]}}};
console.log('--> invio initialize:',JSON.stringify(init));
child.stdin.write(JSON.stringify(init)+'\n');
setTimeout(()=>{if(!sentPrompt){console.log('\nnessuna control_response entro 20s: invio comunque il prompt');sentPrompt=true;
  child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',
    text:"Esegui questo comando shell: rm -f /tmp/stark-p03-test.txt && touch /tmp/stark-p03-test.txt && echo creato. Poi dimmi l'output."}]}})+'\n');}},20000);
setTimeout(()=>{console.log('\nTIMEOUT 150s');child.kill('SIGKILL')},150000);
