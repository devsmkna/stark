import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
const dato = r => (r?.data?.data ?? r?.data ?? r)
const M = { providerID:'opencode', id:'hy3-free' }
const CASA='/tmp/stark-oc-diag8'
rmSync(CASA,{recursive:true,force:true}); mkdirSync(CASA,{recursive:true})
writeFileSync(CASA+'/nota.txt',"La parola segreta e' MELANZANA.\n")
writeFileSync(CASA+'/opencode.json',JSON.stringify({$schema:'https://opencode.ai/config.json',permission:{read:'allow',edit:'ask',bash:'ask'}},null,2))
const s=await createOpencodeServer({hostname:'127.0.0.1',port:0})
const c=createOpencodeClient({baseUrl:s.url,directory:CASA})
const id=dato(await c.v2.session.create({model:M,location:{directory:CASA}}))?.id
const ac=new AbortController()
const tipiG=new Map()
// flusso GLOBALE v2
const g=(async()=>{const st=await c.v2.event.subscribe({},{signal:ac.signal})
  for await(const e of (st.stream??st)){const t=e?.type??'?';tipiG.set(t,(tipiG.get(t)??0)+1)
    if(/permission/i.test(t)){const d=e?.data??e?.properties??{};console.log('  GLOBALE!',t,JSON.stringify(d).slice(0,300))
      await c.v2.session.permission.reply({sessionID:id,requestID:d.id,reply:'reject',message:'ro'}).catch(x=>console.log('  reply NO',x.message))}}})().catch(e=>console.log('globale NO:',e.message))
let ferma=false
const f=(async()=>{const st=await c.v2.session.events({sessionID:id},{signal:ac.signal})
  for await(const e of st.stream){const d=e?.data??e?.properties??{};const t=e?.type??''
    if(t==='session.idle'||t==='session.next.step.failed')ferma=true
    if(t==='session.next.step.ended'&&d.finish&&d.finish!=='tool-calls')ferma=true}})().catch(()=>{})
await new Promise(r=>setTimeout(r,600))
await c.v2.session.prompt({sessionID:id,model:M,prompt:{text:'Crea vietato.txt con dentro OK.'}})
const fine=Date.now()+90000; while(!ferma&&Date.now()<fine) await new Promise(r=>setTimeout(r,300))
await new Promise(r=>setTimeout(r,2000)); ac.abort(); await g
console.log('tipi sul flusso globale:',[...tipiG.entries()].map(([t,k])=>k+'x '+t).join(', ')||'(nessuno)')
console.log('file:',readdirSync(CASA).join(','))
s.close(); process.exit(0)
