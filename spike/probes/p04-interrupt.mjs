// P04 — il bottone STOP: interrompe il turno a meta' E la sessione sopravvive?
import { spawn } from 'node:child_process';
const child=spawn('claude',['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
 '--model','claude-haiku-4-5-20251001','--strict-mcp-config','--no-session-persistence','--include-partial-messages'],
 {cwd:'/root/DevsMachna/stark/spike/sandbox',stdio:['pipe','pipe','pipe']});
let buf='',stderr='',deltas=0,turn=0,interrupted=false,sid=null;
const t0=Date.now(); const T=()=>((Date.now()-t0)/1000).toFixed(1)+'s';
child.stderr.on('data',d=>stderr+=d);
child.stdout.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);
 if(!l.trim())continue;let e;try{e=JSON.parse(l)}catch{continue}
 if(e.session_id)sid=e.session_id;
 if(e.type==='stream_event'&&e.event?.type==='content_block_delta'){deltas++;
   if(deltas===1)console.log(`[${T()}] primo delta: l'agent ha iniziato a scrivere`);
   if(deltas===25&&!interrupted){interrupted=true;
     console.log(`[${T()}] --> INVIO INTERRUPT dopo ${deltas} delta`);
     child.stdin.write(JSON.stringify({type:'control_request',request_id:'stop1',request:{subtype:'interrupt'}})+'\n');}}
 if(e.type==='control_response')console.log(`[${T()}]     <<< control_response:`,JSON.stringify(e.response).slice(0,200));
 if(e.type==='result'){turn++;
   console.log(`[${T()}] RESULT turno ${turn}: subtype=${e.subtype} stop_reason=${e.stop_reason} terminal_reason=${e.terminal_reason}`);
   console.log(`          delta ricevuti: ${deltas} | testo: ${JSON.stringify((e.result||'').slice(0,120))}`);
   if(turn===1){console.log(`[${T()}] --> la sessione e' ancora viva? invio un secondo prompt`);
     deltas=0;
     child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',text:'Quanto fa 2+2? Rispondi solo con il numero.'}]}})+'\n');}
   else child.stdin.end();}
}});
child.on('close',c=>{console.log('\n──── P04 ────');console.log('exit',c,'| turni:',turn,'| session_id:',sid);
 console.log(turn>=2?'ESITO: SI — interrupt funziona E la sessione sopravvive (secondo turno completato)'
                    :'ESITO: PARZIALE/NO — la sessione non ha retto un secondo turno dopo lo stop');
 if(stderr.trim())console.log('STDERR:',stderr.slice(0,1200));});
child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',
  text:'Scrivi i numeri da 1 a 400, uno per riga, senza altro testo.'}]}})+'\n');
setTimeout(()=>{console.log('TIMEOUT 180s');child.kill('SIGKILL')},180000);
