import { createOpencodeClient } from '@opencode-ai/sdk'
import { writeFileSync } from 'node:fs'
const D='/tmp/stark-cattura'
const c:any = createOpencodeClient({ baseUrl:'http://127.0.0.1:4611', directory:D })
const dato=(r:any)=>{const a=r??{};const b=a.data??a;return b.data??b}
const ses:any = dato(await c.session.create({ body:{}, query:{directory:D} }))
const ac=new AbortController()
const ev:any = await c.event.subscribe({ query:{directory:D}, signal:ac.signal })
const righe:string[]=[]
;(async()=>{ for await (const e of (ev.stream ?? ev.data ?? ev) as AsyncIterable<any>) {
  righe.push(JSON.stringify({type:e.type, p:e.properties??e.data}))
}})().catch(e=>righe.push('STREAM ROTTO '+String(e).slice(0,120)))
await new Promise(r=>setTimeout(r,1200))
await c.session.promptAsync({ path:{id:ses.id}, query:{directory:D}, body:{
  model:{providerID:'opencode',modelID:'gpt-5-nano'},
  parts:[{type:'text',text:'Leggi nota.txt e dimmi solo la parola che contiene.'}]}})
await new Promise(r=>setTimeout(r,45000)); ac.abort()
writeFileSync('/tmp/cattura2.jsonl', righe.join('\n'))
console.log('eventi catturati:', righe.length)
process.exit(0)
