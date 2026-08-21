import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child=spawn('claude',['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
 '--model','claude-haiku-4-5-20251001','--strict-mcp-config','--no-session-persistence'],
 {cwd:'/root/DevsMachna/stark/spike/sandbox',stdio:['pipe','pipe','pipe']});
let buf='';
child.stdout.on('data',c=>{buf+=c;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);
 if(!l.trim())continue;let e;try{e=JSON.parse(l)}catch{continue}
 if(e.type==='control_response'&&e.response?.subtype==='success'){
   writeFileSync('/root/DevsMachna/stark/spike/captures/init-response.json',JSON.stringify(e.response.response,null,2));
   console.log('CHIAVI initialize:',Object.keys(e.response.response||{}));
   child.kill('SIGKILL');}
 if(e.type==='system'&&e.subtype==='init'){
   writeFileSync('/root/DevsMachna/stark/spike/captures/system-init.json',JSON.stringify(e,null,2));
   console.log('CHIAVI system:init:',Object.keys(e));}
}});
child.stdin.write(JSON.stringify({type:'control_request',request_id:'i1',request:{subtype:'initialize'}})+'\n');
setTimeout(()=>child.kill('SIGKILL'),25000);
