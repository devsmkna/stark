import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
const dato = r => (r?.data?.data ?? r?.data ?? r)
const M = { providerID: 'opencode', id: 'hy3-free' }
const P = 'Leggi nota.txt e dimmi la parola segreta. Poi crea vietato.txt con dentro OK.'
const DENY = { read:'allow', glob:'allow', grep:'allow', list:'allow', edit:'deny', bash:'deny', webfetch:'deny', websearch:'deny', task:'deny' }
const REG = [{permission:'read',pattern:'*',action:'allow'},{permission:'edit',pattern:'*',action:'deny'},{permission:'bash',pattern:'*',action:'deny'}]

async function giro(nome, { fileConfig, ruleset, rispondi }) {
  const CASA='/tmp/stark-oc-diag7/'+nome.replace(/\W+/g,'_')
  rmSync(CASA,{recursive:true,force:true}); mkdirSync(CASA,{recursive:true})
  writeFileSync(CASA+'/nota.txt',"La parola segreta e' MELANZANA.\n")
  if(fileConfig) writeFileSync(CASA+'/opencode.json',JSON.stringify({$schema:'https://opencode.ai/config.json',...fileConfig},null,2))
  const s=await createOpencodeServer({hostname:'127.0.0.1',port:0})
  const c=createOpencodeClient({baseUrl:s.url,directory:CASA})
  const id=dato(await c.v2.session.create({model:M,location:{directory:CASA}}))?.id
  if(ruleset) await c.session.update({sessionID:id,permission:ruleset})
  const ac=new AbortController(); let ferma=false,testo='',tool=[],perm=[]
  const tipi=new Map()
  const f=(async()=>{const st=await c.v2.session.events({sessionID:id},{signal:ac.signal})
    for await(const e of st.stream){const d=e?.data??e?.properties??{};const t=e?.type??''
      tipi.set(t,(tipi.get(t)??0)+1)
      if(t==='session.next.tool.input.started')tool.push(String(d.name))
      if(t==='session.next.text.delta')testo+=String(d.delta??'')
      if(t==='session.next.text.ended'&&d.text)testo=String(d.text)
      if(/permission/i.test(t)&&!/replied/.test(t)){
        perm.push(t+':'+String(d.action??d.permission??'?'))
        console.log('    ! evento permesso:',t,JSON.stringify(d).slice(0,260))
        if(rispondi) await c.v2.session.permission.reply({sessionID:id,requestID:d.id,reply:rispondi,message:'sola lettura'}).catch(e=>console.log('    reply NO',e.message))
      }
      if(t==='session.idle'||t==='session.next.step.failed')ferma=true
      if(t==='session.next.step.ended'&&d.finish&&d.finish!=='tool-calls')ferma=true}})().catch(()=>{})
  await new Promise(r=>setTimeout(r,400))
  await c.v2.session.prompt({sessionID:id,model:M,prompt:{text:P}})
  const fine=Date.now()+120000; while(!ferma&&Date.now()<fine) await new Promise(r=>setTimeout(r,300))
  await new Promise(r=>setTimeout(r,1500)); ac.abort(); await f
  console.log('=== '+nome)
  console.log('  tool:',tool.join(',')||'-','| eventi permesso:',perm.join(' ')||'-')
  console.log('  file:',readdirSync(CASA).join(','),'| MELANZANA:',/MELANZANA/i.test(testo)?'si':'no')
  console.log('  tipi:',[...tipi.keys()].filter(t=>!/text|reasoning|step|tool/.test(t)).join(', '))
  s.close()
}
await giro('A ask + rifiuto esplicito', { fileConfig:{permission:{...DENY,edit:'ask',bash:'ask'}}, rispondi:'reject' })
await giro('A2 ask + nessuno risponde', { fileConfig:{permission:{...DENY,edit:'ask',bash:'ask'}} })
await giro('B2 ruleset su config permissiva', { ruleset:REG })
await giro('B3 ruleset sopra una config ask', { fileConfig:{permission:{...DENY,edit:'ask',bash:'ask'}}, ruleset:REG })
process.exit(0)
