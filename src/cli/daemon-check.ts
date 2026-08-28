// Prova del daemon da capo a fondo: perimetro di sicurezza, apertura di una sessione,
// flusso SSE, comando, e coerenza fra ciò che è arrivato dal flusso e ciò che sta sul
// disco. Le prove di sicurezza non costano quota; il turno finale costa pochissimo.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { CanonicalEvent } from '../core/events.ts'

// ─── la prova non scrive fra le conversazioni vere ──────────────────────────
//
// Prima questa prova girava sulla `STARK_HOME` vera, e ogni esecuzione lasciava due
// chat fantasma nell'elenco dell'utente: la sessione-sandbox qui sotto, e un journal
// orfano dalla verifica «una cartella inesistente non apre una sessione». Non era un
// dettaglio estetico — erano conversazioni finte in mezzo a quelle vere, in un elenco
// che serve a sapere cosa sta succedendo.
//
// L'ordine di queste righe è **obbligatorio**, non stilistico: `registry.ts` risolve
// `STARK_HOME` una volta sola, al momento in cui il modulo viene valutato. Un `import`
// statico di `startDaemon` verrebbe issato in cima al file dal motore ES, cioè
// eseguito **prima** di questa assegnazione, e il registro leggerebbe l'ambiente
// sbagliato. Per questo l'import è dinamico e sta dopo: è l'unico modo di far arrivare
// la variabile in tempo senza cambiare `registry.ts`.
const CASA = resolve(tmpdir(), 'stark-daemon-check-home')
rmSync(CASA, { recursive: true, force: true })   // deterministica: niente resti del giro prima
process.env['STARK_HOME'] = CASA

const { startDaemon } = await import('../daemon/server.ts')

/**
 * `fetch` non lascia falsificare l'header `Host`: lo standard lo vieta. È esattamente
 * il motivo per cui quel controllo protegge — nemmeno la pagina di un attaccante può
 * cambiarlo. Per provarlo serve una socket grezza, che è ciò che un attaccante userebbe
 * se potesse; il browser, che non può, resta fermo al proprio dominio nell'Host.
 */
function richiestaGrezza(porta: number, host: string, token: string): Promise<number> {
  return new Promise(res => {
    const s = connect(porta, '127.0.0.1', () => {
      s.write(`GET /api/sessions HTTP/1.1\r\nHost: ${host}\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`)
    })
    let buf = ''
    s.on('data', d => { buf += d })
    s.on('close', () => res(Number(/^HTTP\/1\.\d (\d{3})/.exec(buf)?.[1] ?? 0)))
    s.on('error', () => res(0))
  })
}

/**
 * Come sopra, ma restituisce anche le intestazioni: serve per l'`Origin` (che `fetch`
 * lascia scrivere, ma qui si vuole la stessa socket per non mescolare due meccanismi) e
 * per leggere il `set-cookie` di una pagina servita con un `Host` esterno.
 */
function grezza(porta: number, opts: { host: string; token: string; path?: string; origin?: string; xff?: string })
  : Promise<{ stato: number; testa: string }> {
  return new Promise(res => {
    const s = connect(porta, '127.0.0.1', () => {
      s.write(`GET ${opts.path ?? '/api/sessions'} HTTP/1.1\r\n`
        + `Host: ${opts.host}\r\n`
        + `Authorization: Bearer ${opts.token}\r\n`
        + (opts.origin ? `Origin: ${opts.origin}\r\n` : '')
        + (opts.xff ? `X-Forwarded-For: ${opts.xff}\r\n` : '')
        + 'Connection: close\r\n\r\n')
    })
    let buf = ''
    s.on('data', d => { buf += d })
    s.on('close', () => res({
      stato: Number(/^HTTP\/1\.\d (\d{3})/.exec(buf)?.[1] ?? 0),
      testa: buf.split('\r\n\r\n')[0] ?? '',
    }))
    s.on('error', () => res({ stato: 0, testa: '' }))
  })
}

// Porta 0, token usa e getta e casa in `/tmp`: una prova non deve litigare con il
// daemon vero — che ha una porta fissa e un token su disco — né scrivere fra le sue
// conversazioni.
const daemon = await startDaemon({
  port: 0,
  token: 'prova'.padEnd(64, '0'),
  ...(process.env['STARK_MODEL'] ? { model: process.env['STARK_MODEL'] } : {}),
})
const { url, token } = daemon
const auth = { authorization: `Bearer ${token}` }
const esiti: [string, boolean, string][] = []
const check = (nome: string, ok: boolean, dettaglio = ''): void => { esiti.push([nome, ok, dettaglio]) }

console.log(`daemon su ${url}\n`)

// ─── perimetro ──────────────────────────────────────────────────────────────

check('senza token → 403', (await fetch(`${url}/api/sessions`)).status === 403)
check('token errato → 403',
  (await fetch(`${url}/api/sessions`, { headers: { authorization: 'Bearer ' + 'a'.repeat(64) } })).status === 403)
check('Origin estraneo → 403',
  (await fetch(`${url}/api/sessions`, { headers: { ...auth, origin: 'https://sito-cattivo.example' } })).status === 403)
const porta = Number(new URL(url).port)
check('Host falsificato (DNS rebinding) → 403',
  (await richiestaGrezza(porta, 'sito-cattivo.example', token)) === 403)
check('Host locale con token → 200',
  (await richiestaGrezza(porta, '127.0.0.1', token)) === 200)
check('token giusto → 200', (await fetch(`${url}/api/sessions`, { headers: auth })).status === 200)
check('Origin nostro → 200',
  (await fetch(`${url}/api/sessions`, { headers: { ...auth, origin: url } })).status === 200)

// ─── perimetro dichiarato: STARK_PUBLIC_HOST ────────────────────────────────
//
// Gli host si passano **per parametro**, non per ambiente: una prova non deve dire cose
// diverse a seconda di come è configurata la macchina che la esegue, e `perimetro()`
// legge l'ambiente solo quando nessuno gli dice niente.
const NOME = 'stark.esempio.test'

check(`Host esterno NON dichiarato → 403 (il default resta solo-localhost)`,
  (await richiestaGrezza(porta, NOME, token)) === 403)

{
  const aperto = await startDaemon({ port: 0, token, publicHosts: [NOME] })
  const p2 = Number(new URL(aperto.url).port)
  try {
    check('Host esterno dichiarato → 200',
      (await grezza(p2, { host: NOME, token })).stato === 200)
    check('Host esterno maiuscolo → 200 (gli hostname sono case-insensitive)',
      (await grezza(p2, { host: 'STARK.Esempio.TEST', token })).stato === 200)
    check('Host esterno col punto finale (forma assoluta) → 200',
      (await grezza(p2, { host: `${NOME}.`, token })).stato === 200)
    check('Origin https dell\'host dichiarato → 200',
      (await grezza(p2, { host: NOME, token, origin: `https://${NOME}` })).stato === 200)
    check('Origin http sullo stesso nome → 403 (lo schema non si deduce)',
      (await grezza(p2, { host: NOME, token, origin: `http://${NOME}` })).stato === 403)
    // Il bug canonico di una lista di host: `endsWith` invece di `===`.
    check('Origin con l\'host dichiarato come prefisso di un altro dominio → 403',
      (await grezza(p2, { host: NOME, token, origin: `https://${NOME}.attaccante.example` })).stato === 403)
    check('X-Forwarded-For non cambia niente: con token → 200',
      (await grezza(p2, { host: NOME, token, xff: '1.2.3.4' })).stato === 200)
    check('X-Forwarded-For non cambia niente: senza token → 403',
      (await grezza(p2, { host: NOME, token: 'x'.repeat(64), xff: '1.2.3.4' })).stato === 403)
    // Il cookie ha `Secure`: con un dominio pubblico non è più teorico, è ciò che
    // permette al browser di tenerselo dopo il primo caricamento.
    const pagina = await grezza(p2, { host: NOME, token, path: `/?token=${token}` })
    check('pagina servita con Host esterno → set-cookie stark=… Secure',
      /set-cookie: stark=[^\r\n]*Secure/i.test(pagina.testa), pagina.testa.split('\r\n')[0] ?? '')
    // `/api/system` non può più dire «localhost only» mentre il perimetro è aperto:
    // era il bug che c'era già con Tailscale acceso.
    const sys = await fetch(`${aperto.url}/api/system`, { headers: auth })
      .then(r => r.json()) as { listening: string; perimeter: { open: boolean; hosts: { host: string }[] } }
    check('/api/system dice il vero sul perimetro aperto',
      sys.perimeter.open && sys.perimeter.hosts.some(h => h.host === NOME) && !sys.listening.includes('only'),
      sys.listening)
  } finally { await aperto.stop() }
}

{
  const { perimetro } = await import('../daemon/security.ts')
  const p = perimetro(['*.esempio.test', '', 'non un hostname', `https://${NOME}/qualcosa`])
  check('wildcard scartata, e detta',
    p.ammessi.every(a => !a.host.includes('*')) && p.scartate.some(s => s.voce === '*.esempio.test'))
  check('schema e percorso si tolgono da soli',
    p.ammessi.some(a => a.host === NOME && a.origin === `https://${NOME}`))
  check('una voce che non è un hostname finisce fra le scartate',
    p.scartate.some(s => s.voce === 'non un hostname'))
  // Senza `STARK_VAPID_SUBJECT`, il `sub` è il primo nome pubblico: un dominio vero,
  // che è l'unica cosa che Apple accetta (`403 BadJwtToken` altrimenti).
  const { soggetto } = await import('../daemon/push.ts')
  const prima = process.env['STARK_VAPID_SUBJECT']
  delete process.env['STARK_VAPID_SUBJECT']
  // Il perimetro si costruisce a mano invece di riusare `p`: `perimetro()` ci somma
  // l'hostname Tailscale della macchina, e su una macchina che ce l'ha quello finisce
  // **primo**, quindi la prova cadeva qui e restava verde altrove. Non era il push a
  // sbagliare — era la prova a dipendere da com'è messa la macchina che la esegue.
  const soloEnv = { ammessi: [{ host: NOME, origin: `https://${NOME}`, fonte: 'env' as const }],
    scartate: [] }
  check('sub VAPID = il primo host del perimetro',
    soggetto(soloEnv) === `https://${NOME}`, soggetto(soloEnv))
  check('sub VAPID senza perimetro = il mailto: di ripiego',
    soggetto({ ammessi: [], scartate: [] }).startsWith('mailto:'))
  if (prima !== undefined) process.env['STARK_VAPID_SUBJECT'] = prima
}

// ─── Finder di sistema: native-browse ───────────────────────────────────────
//
// Il modulo si prova in isolamento, senza aprire nessun dialogo vero: un vero click
// su `FolderBrowserDialog`/`choose folder`/`zenity` bloccherebbe questo script in
// attesa di un umano, che è esattamente il difetto che la regola di `--reveal` (più
// sotto) esiste per evitare — qui però non c'è nemmeno un flag che lo sblocca, perché
// un `explorer.exe /select,` ritorna subito (fire-and-forget), un dialogo di scelta
// cartella no: bloccherebbe fino alla chiusura manuale.
const { commandExists, nativeFolderPickerAvailable } = await import('../daemon/native-browse.ts')
check('commandExists: un comando reale (`ls`) c\'è', await commandExists('ls'))
check('commandExists: un comando inventato non c\'è',
  !(await commandExists('comando-che-non-esiste-davvero-xyz123')))
{
  // L'attesa è coerente con la piattaforma vera che sta eseguendo la prova, qualunque
  // essa sia — non si assume WSL: si ricalcola cosa ci si aspetta con la stessa logica
  // del modulo sotto test, per restare vero su qualunque macchina di sviluppo.
  const { WSL } = await import('../core/platform.ts')
  const atteso = WSL ? await commandExists('powershell.exe')
    : process.platform === 'darwin' ? true
    : await commandExists('zenity')
  check('nativeFolderPickerAvailable coerente con la piattaforma corrente',
    (await nativeFolderPickerAvailable()) === atteso)
}

// ─── F3: arrivare a un file citato in chat ──────────────────────────────────
//
// Costa zero quota: è una rotta di sistema, non un turno. Sta dietro le stesse
// quattro difese di ogni altra — provato qui, non dedotto dal fatto che `route()`
// gira per tutte allo stesso modo.
check('senza token → 403 anche per /api/reveal',
  (await fetch(`${url}/api/reveal`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: import.meta.url }),
  })).status === 403)
const rivelaSenzaPath = await fetch(`${url}/api/reveal`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}',
})
check('senza `path` → 400', rivelaSenzaPath.status === 400, String(rivelaSenzaPath.status))
const rivelaSconosciuto = await fetch(`${url}/api/reveal`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ path: '/non/esiste/davvero.txt' }),
})
const corpoSconosciuto = await rivelaSconosciuto.json() as { ok: boolean; error?: string }
check('un file che non c\'è → 404, non un\'eccezione',
  rivelaSconosciuto.status === 404 && corpoSconosciuto.ok === false,
  `${rivelaSconosciuto.status} ${JSON.stringify(corpoSconosciuto)}`)
// Un file vero di questo repo: prova che il comando di sistema gira davvero sulla
// macchina, non solo che il codice compila. Il pregio è reale — ed è anche il motivo
// per cui **non** gira di default.
//
// Perché è dietro un flag (segnalato dall'utente, 26 agosto 2026: «ogni tanto mi si
// apre la directory del progetto con package.json evidenziato»): riuscire, qui, vuol
// dire **aprire una finestra di Esplora Risorse addosso a chi sta lavorando**. Non era
// «ogni tanto» in modo misterioso: era ogni `npm run daemon`, compresi quelli lanciati
// da un agent dentro STARK mentre l'utente stava facendo altro sullo stesso desktop.
//
// È lo stesso errore delle chat fantasma, in un altro vestito: una prova che tocca il
// mondo vero invece del proprio. Lì scriveva nella `STARK_HOME` dell'utente, qui gli
// ruba il fuoco delle finestre. La regola che ne esce vale per tutte e due: una prova
// automatica non ha il permesso di farsi notare da chi non l'ha lanciata.
//
// Non è nascosta, è **spenta con la spiegazione** — come le voci non ancora fatte nelle
// impostazioni. La riga qui sotto lo dice a schermo a ogni esecuzione.
const VUOLE_FINESTRA = process.argv.includes('--reveal')
if (VUOLE_FINESTRA) {
  const rivelaVero = await fetch(`${url}/api/reveal`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ path: resolve('package.json') }),
  })
  const corpoVero = await rivelaVero.json() as { ok: boolean; error?: string }
  check('un file vero del repo si rivela sul serio',
    rivelaVero.status === 200 && corpoVero.ok === true,
    `${rivelaVero.status} ${JSON.stringify(corpoVero)}`)
} else {
  console.log('· saltata: «un file vero si rivela sul serio» aprirebbe una finestra')
  console.log('  di Esplora Risorse. Per farla davvero: npm run daemon -- --reveal\n')
}

// ─── F1: aprire un link con la sua app ──────────────────────────────────────
//
// Solo il perimetro qui: `serviceFor` rifiuta prima ancora di controllare se
// l'app c'è, quindi queste prove non toccano il filesystem né lanciano niente.
// Il lancio vero — «l'app si apre davvero sulla pagina giusta» — non è
// automatizzabile senza far comparire Notion sullo schermo di chi esegue
// `npm run daemon`: provato dal vivo il 26 agosto 2026, con conferma dell'utente
// che la pagina giusta si è aperta due volte su due (vedi Notion, F1).
check('senza `url`/`scheme` → 400',
  (await fetch(`${url}/api/open-app`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}',
  })).status === 400)
check('schema sconosciuto → 400, non un tentativo di lancio',
  (await fetch(`${url}/api/open-app`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://notion.so/qualcosa', scheme: 'zzz-mai-sentito' }),
  })).status === 400)
check('dominio che non appartiene allo schema dichiarato → 400',
  (await fetch(`${url}/api/open-app`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    // Un client che chiedesse di aprire un dominio qualunque spacciandolo per
    // Notion non deve poterlo fare: il daemon ricontrolla da sé, non si fida
    // di ciò che il client dichiara.
    body: JSON.stringify({ url: 'https://sito-cattivo.example', scheme: 'notion' }),
  })).status === 400)
check('un url malformato → 400, non un\'eccezione che porta giù la richiesta',
  (await fetch(`${url}/api/open-app`, {
    method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'not-a-url', scheme: 'notion' }),
  })).status === 400)

// ─── il Finder di sistema: rotta ─────────────────────────────────────────────
//
// Solo perimetro e forma della risposta: **non** si chiama davvero un click reale
// sul dialogo nativo (bloccherebbe questo script in attesa di un umano). Il click
// vero si verifica a mano, sulla macchina, come già per F1.
check('senza token → 403 anche per /api/browse-native',
  (await fetch(`${url}/api/browse-native`, { method: 'POST' })).status === 403)
const sistema = await (await fetch(`${url}/api/system`, { headers: auth })).json() as
  { nativeFolderPicker?: unknown }
check('/api/system espone `nativeFolderPicker` come booleano',
  typeof sistema.nativeFolderPicker === 'boolean', JSON.stringify(sistema.nativeFolderPicker))

// ─── una sessione che non parte ─────────────────────────────────────────────

// Costa zero quota, e prova la cosa che conta di più in un daemon che deve
// sopravvivere: **una conversazione nata male non porta giù le altre**. È successo il
// contrario — una cartella che non esisteva chiudeva il journal mentre il ciclo dei
// messaggi girava ancora, e l'eccezione, che nessuno stava aspettando, spegneva tutto.
const nata = await fetch(`${url}/api/sessions`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ cwd: '/non/esiste/davvero' }),
})
// Il nome di prima — «una cartella inesistente non apre una sessione» — era **falso**,
// ed è il genere di bugia che una prova verde nasconde meglio di nessuna prova. La
// cartella inesistente una sessione la apriva eccome: journal creato, processo figlio
// lanciato, fallimento in fondo alla catena. Solo la **risposta HTTP** era un errore,
// ed era l'unica cosa che questa riga guardava. Adesso il rifiuto arriva al confine,
// prima di aprire qualsiasi cosa, e il nome dice quello che succede davvero.
check('una cartella inesistente è respinta con 400', nata.status === 400, String(nata.status))
check('e il motivo dice qual è il problema, non incolpa la libc',
  ((await nata.json()) as { error?: string }).error?.includes('/non/esiste/davvero') === true)
// L'eccezione arrivava da un ciclo che gira per conto suo: senza aspettare un attimo
// si guarderebbe il daemon prima che il colpo lo raggiunga.
await new Promise(r => setTimeout(r, 1500))
check('e il daemon resta in piedi',
  (await fetch(`${url}/api/sessions`, { headers: auth })).status === 200)
// La parte che mancava del tutto, ed è quella che il bug aveva: un rifiuto non deve
// lasciare **niente** dietro di sé. Prima ogni giro di questa prova depositava una chat
// «no folder / stopped» nell'elenco vero dell'utente.
check('e non lascia una conversazione fantasma nell\'elenco',
  ((await (await fetch(`${url}/api/sessions`, { headers: auth })).json()) as
    { sessions: unknown[] }).sessions.length === 0)

// ─── sessione ───────────────────────────────────────────────────────────────

// La cartella va creata: sta in /tmp, che prima o poi viene svuotata. Senza, la prova
// falliva con un errore che non c'entrava niente con quello che stava provando.
const SANDBOX = '/tmp/stark-daemon-check'
mkdirSync(SANDBOX, { recursive: true })
const aperta = await fetch(`${url}/api/sessions`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ cwd: SANDBOX }),
})
const { id } = await aperta.json() as { id: string }
check('sessione aperta', aperta.status === 201 && !!id, String(aperta.status))

// ─── le citazioni con `@` ───────────────────────────────────────────────────
//
// Non costano quota: `file_suggestions` è una domanda sul filesystem, non un turno.
// L'attesa invece è vera e va rispettata invece di aggirata — il CLI ci mette ~1,5s
// dall'apertura a saper rispondere a una ricerca (misurato). Si ritenta per un tempo
// dichiarato: se scade, la prova **fallisce**, non passa in silenzio.
writeFileSync(resolve(SANDBOX, 'ricordami.txt'), 'niente di interessante\n')
// Con un file dentro, e non per scrupolo: una cartella **vuota** il CLI non la
// suggerisce affatto (verificato — la prova era rossa proprio così). È coerente con
// cosa serve a un `@`, cioè arrivare a del contenuto, ma non si indovina.
mkdirSync(resolve(SANDBOX, 'sottocartella'), { recursive: true })
writeFileSync(resolve(SANDBOX, 'sottocartella', 'dentro.txt'), 'ci sono\n')
const cerca = async (q: string): Promise<string[]> => {
  const r = await fetch(`${url}/api/sessions/${id}/files?q=${encodeURIComponent(q)}`, { headers: auth })
  return (await r.json() as { files: string[] }).files
}
let trovati: string[] = []
for (let i = 0; i < 30 && trovati.length === 0; i++) {
  trovati = await cerca('ricorda')
  if (trovati.length === 0) await new Promise(r => setTimeout(r, 200))
}
check('`@` trova un file del progetto', trovati.includes('ricordami.txt'), JSON.stringify(trovati))
check('e anche una cartella, che si riconosce dalla barra finale',
  (await cerca('sottocart')).some(f => f.endsWith('/')))
check('quello che non c\'è torna vuoto, non un errore',
  (await cerca('zzz-non-esiste-zzz')).length === 0)
check('la ricerca dei file è dietro il token come tutto il resto',
  (await fetch(`${url}/api/sessions/${id}/files?q=x`)).status === 403)
// Una chat senza processo dietro non ha nessuno a cui chiedere. Deve rispondere
// «niente» invece di rompersi: è lo stesso caso di una chat che dorme, dove il menu
// semplicemente non si apre.
check('una sessione che non esiste torna vuoto, non un\'eccezione',
  (await (await fetch(`${url}/api/sessions/${'0'.repeat(36)}/files?q=x`,
    { headers: auth })).json() as { files?: string[] }).files?.length === 0)

// ─── flusso ─────────────────────────────────────────────────────────────────

const dalVivo: CanonicalEvent[] = []
// Quando è arrivato ciascun evento, non solo quali. Un proxy che bufferizza consegna
// **lo stesso numero** di eventi — solo tutti insieme alla fine — quindi contarli non
// distingue un flusso vivo da uno morto. Va misurato.
const arrivi: number[] = []
const stream = await fetch(`${url}/api/sessions/${id}/stream?from=0`, { headers: auth })
const lettore = stream.body!.getReader()
const decoder = new TextDecoder()
let buf = ''
let fine: () => void = () => {}
const finito = new Promise<void>(r => { fine = r })

void (async () => {
  try {
  for (;;) {
    const { done, value } = await lettore.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const blocco = buf.slice(0, i); buf = buf.slice(i + 2)
      const riga = blocco.split('\n').find(r => r.startsWith('data: '))
      if (!riga) continue
      const e = JSON.parse(riga.slice(6)) as CanonicalEvent
      dalVivo.push(e)
      arrivi.push(performance.now())
      if (e.payload.k === 'turn.ended') fine()
    }
  }
  } catch { /* il daemon si è fermato: la caduta del flusso è attesa, non un errore */ }
})()

const chiesto = performance.now()
await fetch(`${url}/api/sessions/${id}/command`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ c: 'session.prompt', text: 'Rispondi con una sola parola: pronto' }),
})
await finito
const concluso = performance.now()

// ─── coerenza ───────────────────────────────────────────────────────────────

const daDisco = await (await fetch(`${url}/api/sessions/${id}/events?from=0`, { headers: auth })).json() as { events: CanonicalEvent[] }
const soloVisti = dalVivo.map(e => e.seq)
const soloDisco = daDisco.events.map(e => e.seq).filter(n => n <= (soloVisti[soloVisti.length - 1] ?? 0))

check('il flusso ha consegnato eventi', dalVivo.length > 0, `${dalVivo.length}`)

// ─── il flusso è vivo, non bufferizzato ─────────────────────────────────────
//
// La firma di un proxy che bufferizza è precisa: gli eventi ci sono tutti, ma sono
// arrivati **in blocco alla fine**. Cioè la coda della finestra li contiene quasi
// tutti, e il divario massimo fra due arrivi consecutivi copre quasi tutta la durata.
// Su loopback questa prova è sempre verde per costruzione: serve puntata a un tunnel
// (`--contro`), dove è l'unica cosa che distingue «funziona» da «sembra funzionare».
{
  const durata = concluso - chiesto
  const primo = (arrivi[0] ?? concluso) - chiesto
  const coda = arrivi.filter(t => t > concluso - durata * 0.1).length
  const quota = arrivi.length > 0 ? coda / arrivi.length : 0
  let divario = 0
  for (let i = 1; i < arrivi.length; i++) divario = Math.max(divario, (arrivi[i] ?? 0) - (arrivi[i - 1] ?? 0))
  check('il flusso arriva mentre succede, non tutto alla fine',
    arrivi.length < 3 || quota <= 0.8,
    `primo dato ${primo | 0}ms · ${(quota * 100) | 0}% nell'ultimo 10% · divario max ${divario | 0}ms su ${durata | 0}ms`)
}
check('flusso e disco raccontano la stessa storia',
  JSON.stringify(soloVisti) === JSON.stringify(soloDisco),
  `flusso ${soloVisti.length} · disco ${soloDisco.length}`)
check('i seq sono contigui e senza buchi',
  soloVisti.every((n, i) => n === i + 1), soloVisti.slice(0, 8).join(','))

const risposta = dalVivo.filter(e => e.payload.k === 'text.ended')
  .map(e => (e.payload as { text: string }).text).join(' ')
check('la risposta del modello è arrivata', risposta.trim().length > 0, risposta.trim().slice(0, 40))

// ─── sonno ──────────────────────────────────────────────────────────────────

const dormi = await fetch(`${url}/api/sessions/${id}/command`, {
  method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ c: 'session.sleep' }),
})
check('la sessione si addormenta', dormi.status === 200, String(dormi.status))
const dopo = await (await fetch(`${url}/api/sessions`, { headers: auth })).json() as { sessions: { id: string; live: boolean }[] }
check('dopo il sonno resta nell\'elenco ma non è più viva',
  dopo.sessions.some(s => s.id === id && !s.live))

// ─── cercare ────────────────────────────────────────────────────────────────
//
// Dopo il sonno di proposito: è il caso vero. Cercare deve funzionare **su una chat
// che non ha più un processo dietro**, perché quelle sono la maggioranza di ciò che
// si cerca — quella aperta ce l'hai già davanti. Qui la risposta arriva dagli
// snapshot che il registro tiene per l'elenco, non da una rilettura del disco.
type Ricerca = { results: { sessionId: string; title: string; total: number
  matches: { snippet: string; at: number; len: number; turnId: string }[] }[] }
const cercaTesto = async (q: string): Promise<Ricerca['results']> => {
  const r = await fetch(`${url}/api/search?q=${encodeURIComponent(q)}`, { headers: auth })
  return (await r.json() as Ricerca).results
}
// La parola sta nel prompt che questa prova ha davvero mandato, quindi non è una
// stringa inventata: se il prompt cambia, la verifica lo dice.
const trovate = await cercaTesto('una sola parola')
check('la ricerca trova una chat che non è più viva',
  trovate.some(r => r.sessionId === id), JSON.stringify(trovate.map(r => r.sessionId)))
const mia = trovate.find(r => r.sessionId === id)
check('e dice dove, con il ritaglio e il punto da evidenziare',
  !!mia?.matches[0]?.turnId
  && mia.matches[0].snippet.slice(mia.matches[0].at, mia.matches[0].at + mia.matches[0].len)
    .toLowerCase() === 'una sola parola',
  JSON.stringify(mia?.matches[0]))
check('quello che non c\'è non si trova',
  (await cercaTesto('zzz-parola-che-non-esiste-zzz')).length === 0)
check('la ricerca è dietro il token come tutto il resto',
  (await fetch(`${url}/api/search?q=pronto`)).status === 403)

// ─── quale conversazione riprende un risveglio ────────────────────────────────
//
// Il bug che queste quattro righe tengono fermo (27 agosto 2026): `spec.resume.ref` fa
// due mestieri — nome del journal e conversazione del CLI da riprendere — e un `/clear`
// li fa divergere, perché il CLI sposta la conversazione su un id nuovo. Riprendere il
// vecchio riportava indietro il contesto appena azzerato. Provato dal vivo con
// `spike/risveglio-dopo-clear.ts` (costa quota); qui resta la regola, che è una scelta
// fra due stringhe e non ha bisogno di una sessione vera per essere sbagliata.
const { refDaRiprendere } = await import('../daemon/registry.ts')
check('risveglio: senza un ref dal journal si riprende l\'id della chat',
  refDaRiprendere({ ref: 'chat-1' }, undefined)?.ref === 'chat-1')
check('risveglio: dopo un /clear vince il ref che il CLI ha dichiarato',
  refDaRiprendere({ ref: 'chat-1' }, 'dopo-il-clear')?.ref === 'dopo-il-clear')
check('risveglio: un fork resta dov\'è, il suo journal è un altro',
  refDaRiprendere({ ref: 'chat-1', fork: true }, 'dopo-il-clear')?.ref === 'chat-1')
check('aprire una chat nuova non riprende niente',
  refDaRiprendere(undefined, 'dopo-il-clear') === undefined)

await lettore.cancel().catch(() => {})
await daemon.stop()

let rotti = 0
for (const [nome, ok, dett] of esiti) {
  if (!ok) rotti++
  console.log(`${ok ? 'OK  ' : 'ROTT'} ${nome}${!ok && dett ? ' — ' + dett : ''}`)
}
console.log(`\n${esiti.length - rotti}/${esiti.length} verifiche passate`)
process.exitCode = rotti === 0 ? 0 : 1
