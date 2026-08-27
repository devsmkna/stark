import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
const dato = r => (r?.data?.data ?? r?.data ?? r)
const M = { providerID: 'opencode', id: 'hy3-free' }
const P = 'Leggi nota.txt e dimmi la parola segreta. Poi crea vietato.txt con dentro OK.'
const LEGGONO = ['read','glob','grep','list'], SCRIVONO = ['write','edit','patch','bash','task','webfetch','websearch']

async function giro(nome, {config, apri, promptV1}) {
  const CASA = '/tmp/stark-oc-diag5/' + nome.replace(/\W+/g,'_')
  rmSync(CASA,{recursive:true,force:true}); mkdirSync(CASA,{recursive:true})
  writeFileSync(CASA+'/nota.txt', "La parola segreta e' MELANZANA.\n")
  const s = await createOpencodeServer({hostname:'127.0.0.1',port:0,...(config?{config}:{})})
  const c = createOpencodeClient({baseUrl:s.url,directory:CASA})
  const id = await apri(c, CASA)
  const ac=new AbortController(); let ferma=false,testo='',tool=[],fail=[],perm=[]
  const f=(async()=>{const st=await c.v2.session.events({sessionID:id},{signal:ac.signal})
    for await(const e of st.stream){const d=e?.data??e?.properties??{};const t=e?.type??''
      if(t==='session.next.tool.input.started')tool.push(String(d.name))
      if(t==='session.next.tool.failed')fail.push(String(d?.error?.message??'').slice(0,90))
      if(t==='session.next.text.delta')testo+=String(d.delta??'')
      if(t==='session.next.text.ended'&&d.text)testo=String(d.text)
      if(/permission/.test(t)&&/asked/.test(t)){perm.push(String(d.action??d.permission??'?'))
        await c.v2.session.permission.reply({sessionID:id,requestID:d.id,reply:'reject',message:'sola lettura'}).catch(()=>{})}
      if(t==='session.idle'||t==='session.next.step.failed')ferma=true
      if(t==='session.next.step.ended'&&d.finish&&d.finish!=='tool-calls')ferma=true}})().catch(()=>{})
  await new Promise(r=>setTimeout(r,400))
  if (promptV1) await c.session.prompt({sessionID:id, model:{providerID:M.providerID,modelID:M.id}, tools:promptV1, parts:[{type:'text',text:P}]}).catch(e=>console.log('  prompt v1 NO:',e.message))
  else await c.v2.session.prompt({sessionID:id,model:M,prompt:{text:P}})
  const fine=Date.now()+120000; while(!ferma&&Date.now()<fine) await new Promise(r=>setTimeout(r,300))
  await new Promise(r=>setTimeout(r,1500)); ac.abort(); await f
  console.log('\n=== '+nome)
  console.log('  tool:',tool.join(',')||'-')
  console.log('  fail:',fail.slice(0,5).join(' | ')||'(nessuno)')
  console.log('  permessi chiesti:',perm.join(',')||'(nessuno)')
  console.log('  file:',readdirSync(CASA).join(','),'| MELANZANA:',/MELANZANA/i.test(testo)?'si':'no')
  console.log('  testo:',testo.trim().slice(0,220).replace(/\n/g,' / '))
  s.close()
}

// E — permission GLOBALE nella config del server
await giro('E permission globale deny', {
  config: { permission: Object.fromEntries([...LEGGONO.map(t=>[t,'allow']),...SCRIVONO.map(t=>[t,'deny'])]) },
  apri: async (c,casa)=>dato(await c.v2.session.create({model:M,location:{directory:casa}}))?.id,
})
// F — tools per-prompt sulla rotta v1
await giro('F tools per-prompt (rotta v1)', {
  apri: async (c,casa)=>dato(await c.v2.session.create({model:M,location:{directory:casa}}))?.id,
  promptV1: Object.fromEntries([...LEGGONO.map(t=>[t,true]),...SCRIVONO.map(t=>[t,false])]),
})
process.exit(0)
