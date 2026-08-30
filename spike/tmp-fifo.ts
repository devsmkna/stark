import { createOpencodeClient } from '@opencode-ai/sdk'
const D='/tmp/stark-legacy'
const c:any = createOpencodeClient({ baseUrl:'http://127.0.0.1:4611', directory: D })
const dato=(r:any)=>{const a=r??{};const b=a.data??a;return b.data??b}
const ses:any = dato(await c.session.create({ body:{}, query:{directory:D} }))
console.log('sessione:', ses?.id ?? JSON.stringify(ses).slice(0,150))
const sid = ses.id
const modello = { providerID:'opencode', modelID:'gpt-5-nano' }

// 1) prompt_async torna subito?
const t0=performance.now()
const r1 = await c.session.promptAsync?.({ path:{id:sid}, query:{directory:D},
  body:{ model:modello, parts:[{type:'text',text:'Di UNO e basta'}] } })
  ?? await c.session.prompt_async?.({ path:{id:sid}, query:{directory:D},
     body:{ model:modello, parts:[{type:'text',text:'Di UNO e basta'}] } })
console.log(`prompt_async tornato in ${(performance.now()-t0).toFixed(0)}ms →`, JSON.stringify(dato(r1)).slice(0,180))

// 2) un secondo prompt subito dopo: si accoda o si fonde?
const t1=performance.now()
const r2 = await c.session.promptAsync({ path:{id:sid}, query:{directory:D},
  body:{ model:modello, parts:[{type:'text',text:'Di DUE e basta'}] } })
console.log(`secondo prompt in ${(performance.now()-t1).toFixed(0)}ms →`, JSON.stringify(dato(r2)).slice(0,180))

await new Promise(r=>setTimeout(r,35000))
const msg:any = dato(await c.session.messages({ path:{id:sid}, query:{directory:D} }))
console.log('\n--- messaggi nella sessione:', Array.isArray(msg)?msg.length:'?')
for(const m of (Array.isArray(msg)?msg:[])) {
  const info=m.info??m
  const testi=(m.parts??[]).filter((p:any)=>p.type==='text').map((p:any)=>p.text.slice(0,45))
  console.log(`  ${info.role}: ${testi.join(' | ')}`)
}
process.exit(0)
