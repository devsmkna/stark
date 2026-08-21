// P03c — scopre la superficie del canale di controllo (senza spendere token: nessun prompt inviato).
import { spawn } from 'node:child_process';
const child=spawn('claude',['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
 '--model','claude-haiku-4-5-20251001','--strict-mcp-config','--no-session-persistence','--permission-mode','manual'],
 {cwd:'/root/DevsMachna/stark/spike/sandbox',stdio:['pipe','pipe','pipe']});
const variants=[
 ['A: initialize senza hooks', {subtype:'initialize'}],
 ['B: initialize hooks {matcher, hookCallbackIds}', {subtype:'initialize',hooks:{PreToolUse:[{matcher:'Bash',hookCallbackIds:['h1']}]}}],
 ['C: initialize hooks {matchers[], hookCallbackIds[]}', {subtype:'initialize',hooks:{PreToolUse:[{matchers:['Bash'],hookCallbackIds:['h1']}]}}],
 ['D: subtype inesistente (per farci elencare i validi)', {subtype:'__inesistente__'}],
 ['E: interrupt', {subtype:'interrupt'}],
 ['F: set_permission_mode', {subtype:'set_permission_mode',mode:'acceptEdits'}],
 ['G: set_model', {subtype:'set_model',model:'claude-haiku-4-5-20251001'}],
 ['H: can_use_tool', {subtype:'can_use_tool'}],
 ['I: mcp_message', {subtype:'mcp_message'}],
];
let idx=0,buf='',stderr='';
child.stderr.on('data',d=>stderr+=d);
function next(){ if(idx>=variants.length){ setTimeout(()=>child.kill('SIGKILL'),1500); return; }
  const [label,req]=variants[idx];
  console.log('\n>>> '+label);
  child.stdin.write(JSON.stringify({type:'control_request',request_id:'r'+idx,request:req})+'\n');
  idx++; setTimeout(()=>{ if(idx<=variants.length) next(); },2500); }
child.stdout.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);
 if(!l.trim())continue;let e;try{e=JSON.parse(l)}catch{continue}
 if(e.type==='control_response'){const r=e.response||{};
   console.log('    <<< '+(r.subtype||'?')+(r.error?(' | '+r.error):' | '+JSON.stringify(r.response||{}).slice(0,500)));}
 else if(e.type!=='system'||e.subtype!=='thinking_tokens'){console.log('    [evt] '+e.type+(e.subtype?':'+e.subtype:''));}
}});
child.on('close',()=>{console.log('\n──── P03c fine ────'); if(stderr.trim())console.log('STDERR:',stderr.slice(0,1500));});
setTimeout(next,1500);
setTimeout(()=>child.kill('SIGKILL'),60000);
