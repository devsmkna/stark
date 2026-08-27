import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server'
import { createOpencodeClient } from '@opencode-ai/sdk/v2/client'
const dato = r => (r?.data?.data ?? r?.data ?? r)
const LEGGONO=['read','glob','grep','list'], SCRIVONO=['write','edit','patch','bash','task','webfetch','websearch']
const varianti = {
  // 1) solo tools:false, nessun permission
  soloTools: { description:'ro', mode:'primary', tools:Object.fromEntries([...LEGGONO.map(t=>[t,true]),...SCRIVONO.map(t=>[t,false])]) },
  // 2) solo permission:deny, nessun tools
  soloPerm: { description:'ro', mode:'primary', permission:Object.fromEntries([...LEGGONO.map(t=>[t,'allow']),...SCRIVONO.map(t=>[t,'deny'])]) },
  // 3) tools:false solo per i tre veri + niente altro
  minimo: { description:'ro', mode:'primary', tools:{write:false,edit:false,patch:false,bash:false} },
}
const s = await createOpencodeServer({hostname:'127.0.0.1',port:0,config:{agent:varianti}})
for (const nome of Object.keys(varianti)) {
  const CASA='/tmp/stark-oc-diag/'+nome
  rmSync(CASA,{recursive:true,force:true}); mkdirSync(CASA,{recursive:true})
  writeFileSync(CASA+'/nota.txt',"La parola segreta e' MELANZANA.\n")
  const c=createOpencodeClient({baseUrl:s.url,directory:CASA})
  const M={providerID:'opencode',id:'hy3-free'}
  const ses=dato(await c.v2.session.create({agent:nome,model:M,location:{directory:CASA}}))
  const ac=new AbortController(); let ferma=false,testo='',tool=[],fail=[]
  const f=(async()=>{const st=await c.v2.session.events({sessionID:ses.id},{signal:ac.signal})
    for await(const e of st.stream){const d=e?.data??e?.properties??{};const t=e?.type??''
      if(t==='session.next.tool.input.started')tool.push(String(d.name))
      if(t==='session.next.tool.failed')fail.push(String(d?.error?.message??JSON.stringify(d?.error??{})).slice(0,160))
      if(t==='session.next.text.delta')testo+=String(d.delta??'')
      if(t==='session.next.text.ended'&&d.text)testo=String(d.text)
      if(t==='session.idle')ferma=true
      if(t==='session.next.step.failed')ferma=true
      if(t==='session.next.step.ended'&&d.finish&&d.finish!=='tool-calls')ferma=true}})().catch(()=>{})
  await new Promise(r=>setTimeout(r,300))
  await c.v2.session.prompt({sessionID:ses.id,model:M,prompt:{text:'Leggi nota.txt e dimmi la parola segreta. Poi crea vietato.txt con dentro OK.'}})
  const fine=Date.now()+120000; while(!ferma&&Date.now()<fine) await new Promise(r=>setTimeout(r,300))
  await new Promise(r=>setTimeout(r,1200)); ac.abort(); await f
  console.log('\n=== '+nome)
  console.log('  tool:',tool.join(',')||'-')
  console.log('  fallimenti:'); fail.forEach(x=>console.log('    - '+x))
  console.log('  file:',readdirSync(CASA).join(','))
  console.log('  MELANZANA nel testo:',/MELANZANA/i.test(testo)?'si':'no')
}
s.close(); process.exit(0)
