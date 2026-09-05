// Il daemon: HTTP più SSE su 127.0.0.1.
//
// Perché SSE e non WebSocket. Il flusso che conta va in una direzione sola, dal daemon
// alla UI; i comandi risalgono come normali POST. SSE è uno standard che sta già in
// Node e nel browser, quindi non introduce dipendenze, e per giunta è la stessa forma
// che usa OpenCode — il che risparmierà lavoro al secondo adapter invece di crearne.

import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { SO } from '../core/platform.ts'
import { createGuard, type Perimetro } from './security.ts'
import { Telefono } from './telefono.ts'
import { collega, pubblica, statoTailscale } from './tailscale.ts'
import { paginaAccoppiamento } from './pagina-pair.ts'
import { serveUi, UI_DIR } from './static.ts'
import { Registry, STARK_HOME, isDir, type OpenSpec } from './registry.ts'
import { apriCartella, reveal } from './reveal.ts'
import { ramoDi } from './git.ts'
import { nativeFolderPickerAvailable, pickFolderNative } from './native-browse.ts'
import { Push, type Subscription } from './push.ts'
import { vigila } from './chiamate.ts'
import { leggiTodo, guardaTodo, leggiTodoDiTutti } from './todo.ts'
import { boardCloud, boardInitCloud, boardTaskCloud, boardEditCloud, originRepo, cloudUrl, tokenCloud } from './cloud.ts'
import { loginCloud, logoutCloud, cloudStatus } from './cloud.ts'
import { creaUsageSync, type UsageSync } from './usage-sync.ts'
import { creaTunnel, type TunnelClient } from './tunnel.ts'
import { openApp } from './launch.ts'
import { serviceFor } from '../core/services.ts'
import type { Settings } from './settings.ts'
import { agentiDisponibili, agentIds, backendFor, catalogoCompleto, scaldaCatalogo } from '../adapters/index.ts'
import { logPath, readToken } from './identity.ts'
import { avviaRicambio, RADICE } from './riavvio.ts'
import {
  aggiornamentoNoto, alberoSporco, controlla, controllaAllAvvio, notaAggiornamento, versioneInstallata,
} from './aggiornamenti.ts'
import { eseguiHandoff, type ViaBriefing } from './handoff.ts'
import type { Command } from '../core/events.ts'
import type { MemoryOutcome } from '../core/adapter.ts'
import type { Periodo } from '../core/stats.ts'

/**
 * «Scrivi una `description` quando lanci un comando», chiesto all'agent.
 *
 * Passa dal backend perché **come** si ottiene non è la stessa cosa per due agent: su
 * Claude Code quel campo lo scrive il modello, quindi l'unico modo è una regola nel suo
 * `CLAUDE.md` globale — che è anche il motivo per cui il pannello dichiara che la
 * regola vale pure fuori da STARK. Un agent che non ha il concetto non implementa il
 * metodo, e allora non c'è niente da dire: `undefined`, e la UI non mostra la riga.
 */
function descrizioniComandi(profile: string | undefined, accesa: boolean): MemoryOutcome | undefined {
  return backendFor().setCommandDescriptions?.(profile, accesa)
}

export type DaemonOptions = {
  port?: number
  model?: string
  configDir?: string
  /** Il token da usare. Omesso: usa **quello di questa macchina**, che è persistente. */
  token?: string
  /**
   * Gli hostname ammessi oltre a localhost, come li direbbe `STARK_PUBLIC_HOST`.
   * Omesso: si legge l'ambiente. `[]`: nessuno, qualunque cosa dica l'ambiente — è la
   * forma che serve alle prove, che non devono dipendere da com'è configurata la
   * macchina su cui girano.
   */
  publicHosts?: string[]
}

/**
 * La porta di default, e il fatto che ce ne sia una fissa è il punto.
 *
 * Era `0`, cioè «una qualunque»: con un daemon che nasceva e moriva col terminale
 * andava bene, perché l'indirizzo lo leggevi lì sopra. Ma un indirizzo che cambia a
 * ogni avvio non si può mettere fra i preferiti né lasciare aperto in una scheda, che
 * è esattamente come si usa una cosa che deve sopravvivere.
 *
 * Come mutua esclusione: due daemon sulla stessa `STARK_HOME` si contenderebbero i
 * journal delle stesse conversazioni. Il secondo non riesce a mettersi in ascolto, e
 * fallire è il comportamento giusto.
 */
export const PORTA = 4571

export type Daemon = {
  url: string
  token: string
  registry: Registry
  stop(): Promise<void>
}

/**
 * Il perimetro si dice a voce alta all'avvio. Chi apre STARK oltre localhost lo sta
 * facendo di proposito, ma il costo va scritto dove lo si legge senza cercarlo — e le
 * voci scartate vanno dette, altrimenti una configurazione sbagliata è indistinguibile
 * da una che funziona finché non arriva il 403 che sembra un problema di token.
 */
function annunciaPerimetro(p: Perimetro): void {
  for (const s of p.scartate) {
    console.error(`[perimetro] scartata «${s.voce}»: ${s.perche}`)
  }
  if (p.ammessi.length === 0) return
  for (const a of p.ammessi) {
    console.log(`[perimetro] raggiungibile anche come ${a.host} (${a.fonte})`)
  }
  console.log('[perimetro] chiunque raggiunga questi nomi e abbia il token può far\n'
    + '            eseguire comandi come root su questa macchina.')
}

export async function startDaemon(opts: DaemonOptions = {}): Promise<Daemon> {
  let port = opts.port ?? PORTA
  // Il telefono nasce **prima** della guardia: è la guardia a chiedergli se una
  // credenziale vale, e se un codice è vivo.
  const telefono = new Telefono(STARK_HOME)
  const guard = createGuard(
    () => port, opts.token ?? readToken(STARK_HOME), opts.publicHosts, telefono,
  )
  annunciaPerimetro(guard.perimetro)
  const guardToken = guard.token
  const registry = new Registry({
    ...(opts.model ? { model: opts.model } : {}),
    // Le sessioni dell'utente possono vivere fuori da ~/.claude. Se non si propaga
    // questa, i processi figli guardano nella cartella sbagliata: nessuna
    // conversazione da riprendere e forse nemmeno il login, con l'aria di essere rotti.
    // `CLAUDE_CONFIG_DIR` si legge **qui**, al confine col mondo, e da qui in giù è
    // solo «il profilo»: una stringa opaca che il registro passa e non interpreta.
    profile: opts.configDir ?? process.env['CLAUDE_CONFIG_DIR'] ?? undefined,
  })

  // Le statistiche d'uso che salgono al cloud, per unirle a quelle degli altri
  // dispositivi della stessa persona. Spente finché non le si accende (`usageSync`):
  // dopo il Web Push, è la seconda cosa che esce dalla macchina.
  //
  // `accesa` rilegge le impostazioni a ogni giro invece di catturare il valore adesso:
  // l'interruttore si può spegnere mentre il daemon è acceso, e uno che lo spegne si
  // aspetta che smetta di mandare — non alla prossima riaccensione.
  const usage = creaUsageSync({
    home: STARK_HOME,
    snapshots: () => registry.tuttiGliSnapshot().values(),
    accesa: () => registry.settings().usageSync,
  })
  registry.onTurnEnded = () => usage.turnoFinito()

  // Il tunnel verso tunnel.starkapp.dev, spento finché non lo si accende
  // (`settings.tunnel`): stessa disciplina viva di `usageSync` qui sopra —
  // l'interruttore si rilegge a ogni giro, spegnerlo spegne davvero. Vedi
  // `tunnel.ts` per cosa apre e cosa no.
  const tunnel = creaTunnel({
    home: STARK_HOME,
    porta: () => port,
    accesa: () => registry.settings().tunnel,
  })

  // La versione del CLI si chiede a un processo e ci mette qualche secondo: si scalda
  // adesso, mentre nessuno la sta aspettando.
  backendFor().warmDiagnostics?.()

  // C'è una release più nuova di quella installata? Stesso momento e stessa ragione
  // degli altri riscaldamenti qui sopra: è un giro di rete, e non deve stare fra chi
  // accende STARK e STARK acceso. Il risultato lo legge `GET /api/update`.
  //
  // Va detto perché è l'unica altra cosa che esce dalla macchina oltre al Web Push: a
  // ogni accensione parte un `git ls-remote` verso il remoto del repo. Non manda
  // niente — chiede quali tag esistono — ed è lo stesso posto da cui STARK è stato
  // installato, ma è traffico che prima non c'era.
  controllaAllAvvio(RADICE)

  // Stessa idea, stesso momento: il catalogo dei modelli costa un handshake per agent
  // (~3s in tutto) e la prima apertura del menu e' l'unica che lo pagherebbe intero.
  // Si scalda adesso, che non lo sta aspettando nessuno.
  scaldaCatalogo(opts.configDir ?? process.env['CLAUDE_CONFIG_DIR'])

  // La regola sulle descrizioni dei comandi va riallineata **all'avvio**, non solo
  // quando si tocca l'impostazione: il `CLAUDE.md` globale è un file dell'utente, e
  // fra un'accensione e l'altra può averlo modificato a mano, cambiato profilo, o
  // ripristinato da un backup. Senza questo giro, la spunta direbbe una cosa e il
  // file un'altra — cioè l'impostazione mentirebbe.
  {
    const configDir = opts.configDir ?? process.env['CLAUDE_CONFIG_DIR']
    const esito = descrizioniComandi(configDir, registry.settings().toolDescriptions)
    // `undefined` non è un guasto: è un agent che quel concetto non ce l'ha, e allora
    // non c'è niente da allineare e niente da dire.
    if (esito?.error) console.error('memoria globale non scrivibile:', esito.path, esito.error)
    else if (esito?.cambiato) console.log('memoria globale allineata:', esito.path)
  }

  // Le notifiche sul telefono. Vive nel daemon e non nella pagina perché è **l'unico**
  // posto da cui si può avvisare un telefono che non ti sta guardando: a schermo
  // spento nella scheda del browser non gira niente. Senza iscrizioni non fa nulla e
  // non costa nulla — vedi `push.ts`.
  const push = new Push(STARK_HOME, guard.perimetro)

  // Un osservatore solo, e i canali dentro — vedi `chiamate.ts`.
  vigila(registry, [push])

  const server = createServer((req, res) => {
    void route(req, res, guard, registry, guardToken, () => port, opts.configDir ?? process.env['CLAUDE_CONFIG_DIR'], push, telefono, usage, tunnel)
  })
  // Ascolto esplicito su 127.0.0.1: il default di Node è tutte le interfacce, che qui
  // significherebbe esporre alla LAN un processo che esegue comandi come root.
  await new Promise<void>(r => server.listen(port, '127.0.0.1', r))
  const addr = server.address()
  port = typeof addr === 'object' && addr ? addr.port : port

  return {
    url: `http://127.0.0.1:${port}`,
    token: guard.token,
    registry,
    async stop() {
      tunnel.ferma()
      await registry.shutdown()
      await closeServer(server)
    },
  }
}

// ─── instradamento ──────────────────────────────────────────────────────────

async function route(
  req: IncomingMessage, res: ServerResponse,
  guard: ReturnType<typeof createGuard>, registry: Registry, token: string,
  // La porta e la cartella di configurazione servono a una rotta sola — quella della
  // diagnostica — ma sono fatti del daemon, non del registro: passano da qui.
  port: () => number, configDir?: string, push?: Push, telefono?: Telefono,
  usage?: UsageSync, tunnel?: TunnelClient,
): Promise<void> {
  const motivo = guard.reject(req)
  if (motivo) {
    // Nessun dettaglio nel corpo: a chi bussa senza titolo non si spiega quale delle
    // difese l'ha fermato. Il motivo resta nei log del daemon — il commento lo diceva
    // da prima, ma la riga che lo scrive per davvero mancava: trovato debuggando dal
    // vivo un rifiuto da telefono senza nessun modo di sapere quale delle quattro
    // difese fosse stata.
    console.error(`[guard] ${motivo} — ${req.method ?? 'GET'} ${req.url ?? ''}`)
    // Un telefono che non è ancora entrato apre il **link fisso**, cioè la radice: è
    // quello che il pannello gli dice di aprire, e rispondergli 403 lo lasciava davanti
    // a un muro bianco (difetto trovato provando il giro da un telefono mai accoppiato,
    // 28 agosto 2026 — l'indirizzo pubblicizzato non funzionava).
    //
    // Si trasforma **questo** rifiuto in un rimando, e non si allarga il perimetro: la
    // pagina del codice era già raggiungibile a queste stesse condizioni, e ci si arriva
    // solo mentre un codice è vivo. Fuori da quella finestra resta il 403 di prima —
    // niente rimando, niente indizio che dietro ci sia uno STARK acceso.
    const radice = (req.url ?? '/').split('?')[0] === '/'
    if (radice && (req.method ?? 'GET') === 'GET' && telefono?.codiceVivo()) {
      res.writeHead(302, { location: '/pair', 'cache-control': 'no-store' })
      res.end()
      return
    }
    // Un telefono scollegato — o mai collegato, fuori dalla finestra di un codice —
    // atterrava su `{"error":"vietato"}` grezzo, subito dopo aver premuto «Disconnect
    // this phone». Lo status resta **403** e la superficie non si allarga di un byte:
    // quell'indirizzo rispondeva già, cambia solo che adesso risponde a un umano.
    // Non dice niente di più di prima — chi bussa sapeva già che qui c'è qualcosa.
    if (radice && (req.method ?? 'GET') === 'GET'
        && (req.headers.accept ?? '').includes('text/html')) {
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end('<!doctype html><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>STARK</title><style>body{margin:0;min-height:100dvh;display:flex;'
        + 'align-items:center;justify-content:center;font:15px/1.6 system-ui,sans-serif;'
        + 'background:#FBFBFD;color:#171A22;padding:24px;text-align:center}'
        + '@media(prefers-color-scheme:dark){body{background:#0E1118;color:#E8EAF0}}'
        + 'p{max-width:300px;color:#767D90}b{letter-spacing:.14em}</style>'
        + '<div><p><b>S T A R K</b><br><br>This device is not connected.<br>'
        + 'Ask for a code on your computer, then open this page again.</p></div>')
      return
    }
    send(res, 403, { error: 'forbidden' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  const method = req.method ?? 'GET'

  try {
    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true })

    // Spegnersi con garbo, chiesto dal di dentro invece che con un segnale.
    //
    // Esiste per **Windows**, dove `process.kill(pid, 'SIGTERM')` non consegna un
    // segnale: Node lo traduce in `TerminateProcess`, che ammazza il daemon senza far
    // girare nessun handler. Costo reale, non teorico: i journal restano aperti a metà
    // turno e i processi degli agent restano orfani, perché su Windows i figli non
    // muoiono col padre. Su POSIX il segnale funziona ed è la via provata, quindi lì
    // `stark stop` non passa di qui.
    //
    // `process.emit('SIGTERM')` e non una seconda procedura di chiusura: il codice che
    // chiude gli agent e i journal è quello registrato in `stark.ts`, e averne due
    // vorrebbe dire che un giorno divergono e una delle due chiusure perde qualcosa.
    //
    // La rotta sta dietro le stesse quattro difese di ogni altra — token, `Origin`,
    // `Host`, bind sul loopback — e non allarga niente: chi ha il token può già far
    // eseguire comandi arbitrari all'agent, cioè può già fermare questo processo.
    if (method === 'POST' && path === '/api/shutdown') {
      send(res, 200, { ok: true })
      // Dopo la risposta, non prima: chi ha chiesto lo spegnimento deve ricevere il 200
      // da un socket ancora vivo, se no `stark stop` legge un errore di rete e lo
      // riporta come un fallimento di una cosa che invece sta funzionando.
      setTimeout(() => { process.emit('SIGTERM' as NodeJS.Signals, 'SIGTERM' as NodeJS.Signals) }, 50)
      return
    }

    // ─── notifiche sul telefono ──────────────────────────────────────────────
    //
    // Tre rotte e nient'altro: dire la chiave pubblica, prendere un'iscrizione,
    // toglierla. Il resto lo fa `push.ts`. Stanno dietro lo stesso guard di tutto,
    // quindi un'altra pagina non può iscrivere il proprio telefono alle notifiche
    // di questo STARK.
    if (path === '/api/push') {
      if (!push?.disponibile) {
        // Spento **con la spiegazione**, non nascosto: la UI ne fa una riga che dice
        // cosa manca, invece di un interruttore che non fa niente.
        return send(res, 200, { disponibile: false, motivo: 'web-push is not installed', iscritti: 0 })
      }
      if (method === 'GET') {
        return send(res, 200, { disponibile: true, key: push.chiavePubblica, iscritti: push.quanti })
      }
    }
    if (method === 'POST' && path === '/api/push/subscribe') {
      if (!push?.disponibile) return send(res, 503, { error: 'notifications unavailable' })
      const b = await readJson<Subscription>(req)
      if (!b?.endpoint || !b.keys?.p256dh || !b.keys?.auth) {
        return send(res, 400, { error: 'incomplete subscription' })
      }
      push.iscrivi(b)
      return send(res, 200, { ok: true, iscritti: push.quanti })
    }
    if (method === 'POST' && path === '/api/push/unsubscribe') {
      if (!push?.disponibile) return send(res, 503, { error: 'notifications unavailable' })
      const b = await readJson<{ endpoint?: string }>(req)
      if (!b?.endpoint) return send(res, 400, { error: 'endpoint required' })
      push.disiscrivi(b.endpoint)
      return send(res, 200, { ok: true, iscritti: push.quanti })
    }
    // Provare **davvero** che arriva, senza aspettare la fine di un turno vero. Non è
    // un lusso: fra il telefono e qui ci sono i server di Apple, la VAPID e la
    // schermata Home, e senza un modo di provarlo si scopre che non funziona la prima
    // volta che serviva.
    if (method === 'POST' && path === '/api/push/test') {
      if (!push?.disponibile) return send(res, 503, { error: 'notifications unavailable' })
      await push.manda({
        kind: 'done', title: 'STARK · test',
        body: 'If you can read this, notifications on your phone are working.', sessionId: '',
      })
      return send(res, 200, { ok: true, iscritti: push.quanti })
    }

    if (method === 'GET' && path === '/api/sessions') {
      return send(res, 200, { sessions: registry.list() })
    }

    // Cercare. Non è un comando di sessione (§18): non cambia niente e non riguarda
    // una conversazione sola, quindi è una GET sul registro come `/api/sessions`.
    // Non tiene stato fra una richiesta e l'altra — chi scrive nella casella ne manda
    // una per pausa di digitazione, e ognuna deve poter essere l'ultima.
    // Quanto è stato usato STARK. Gli estremi sono in ms; assenti vuol dire «da
    // sempre», che è la domanda a cui la schermata risponde di default. Un numero
    // illeggibile si ignora invece di rifiutare la richiesta: il peggio che può fare
    // è allargare il periodo, e una schermata di sole letture non ha niente da
    // proteggere da un parametro storto.
    if (method === 'GET' && path === '/api/stats') {
      const ms = (k: string): number | undefined => {
        const n = Number(url.searchParams.get(k))
        return Number.isFinite(n) && n > 0 ? n : undefined
      }
      const p: Periodo = {}
      const from = ms('from'); const to = ms('to')
      if (from !== undefined) p.from = from
      if (to !== undefined) p.to = to
      return send(res, 200, { stats: registry.stats(p) })
    }

    // L'uso **unito** fra i dispositivi, dal cloud. Una rotta a parte e non un
    // parametro di `/api/stats` di proposito: quella è una lettura locale che non può
    // fallire e non tocca la rete, e mescolarle vorrebbe dire che la schermata delle
    // statistiche smette di funzionare quando cade il server. Qui invece un `null` è
    // un esito previsto — sync spenta, non loggati, cloud giù — e la UI ricade sul
    // locale dicendolo, invece di mostrare una schermata vuota.
    if (method === 'GET' && path === '/api/usage') {
      if (!usage || !registry.settings().usageSync) {
        return send(res, 200, { uso: null, motivo: 'sincronizzazione spenta' })
      }
      const ms = (k: string): number | undefined => {
        const n = Number(url.searchParams.get(k))
        return Number.isFinite(n) && n > 0 ? n : undefined
      }
      const uso = await usage.leggi({ from: ms('from'), to: ms('to') })
      return send(res, 200, uso
        ? { uso }
        : { uso: null, motivo: 'cloud non raggiungibile o non loggato' })
    }

    // «Manda adesso», per chi ha appena acceso l'interruttore e non vuole aspettare la
    // fine del prossimo turno per vedere se funziona. Qui l'esito **si dice**, al
    // contrario dell'invio automatico: questo l'utente l'ha chiesto.
    if (method === 'POST' && path === '/api/usage/sync') {
      if (!usage) return send(res, 200, { ok: false, motivo: 'sincronizzazione non disponibile' })
      return send(res, 200, await usage.sincronizza())
    }

    if (method === 'GET' && path === '/api/search') {
      return send(res, 200, { results: registry.search(url.searchParams.get('q') ?? '') })
    }

    // Il flusso dell'**elenco**, non di una sessione. Esiste perché senza, per sapere
    // che una chat diversa da quella aperta è cambiata, alla barra laterale non
    // restava che richiedere `/api/sessions` a ripetizione.
    if (method === 'GET' && path === '/api/stream') {
      return listStream(req, res, registry)
    }

    // Le liste di **tutti** i progetti conosciuti, per il toggle «All» della colonna.
    // I percorsi non arrivano dal browser: li deriva il daemon dalle conversazioni che
    // ha, esattamente come fa `/api/sessions/<id>/todo` con una sola.
    if (method === 'GET' && path === '/api/todos') {
      return send(res, 200, { projects: leggiTodoDiTutti(cartelleNote(registry)) })
    }
    if (method === 'GET' && path === '/api/todostream') {
      return todosStream(req, res, registry)
    }

    // Le conversazioni nate nella CLI. Non è una rotta sulle sessioni di STARK: sono
    // cose che STARK non ha ancora, e che l'SDK sa elencare al posto nostro.
    if (method === 'GET' && path === '/api/importable') {
      return send(res, 200, { sessions: await registry.importable() })
    }
    if (method === 'POST' && path === '/api/importable') {
      const body = await readJson<{ sessionId?: string }>(req)
      if (!body?.sessionId) return send(res, 400, { error: 'sessionId required' })
      const esito = await registry.importSession(body.sessionId)
      return send(res, esito.ok ? 201 : 409, esito)
    }

    // ─── le impostazioni, che non sono di una sessione ma della macchina ─────
    if (method === 'GET' && path === '/api/settings') {
      // Anche in lettura, e non solo dopo un salvataggio: *quale* file di memoria si
      // sta guardando è la cosa che il browser non può sapere da sé, e la sezione
      // Agent lo mostra prima ancora che l'utente tocchi l'interruttore.
      const s = registry.settings()
      return send(res, 200, { settings: s, memoria: descrizioniComandi(configDir, s.toolDescriptions) })
    }
    if (method === 'PUT' && path === '/api/settings') {
      const body = await readJson<Settings>(req)
      if (!body) return send(res, 400, { error: 'malformed settings' })
      // Si risponde con ciò che è stato **davvero** scritto, non con ciò che è
      // arrivato: il registro butta via quello che non riconosce, e la UI deve
      // mostrare lo stato vero invece di quello che sperava di aver impostato.
      const salvate = registry.saveSettings(body)
      // Il file dell'agent segue la spunta subito, non al prossimo riavvio: una
      // preferenza che ha effetto «più tardi» è una preferenza che sembra rotta.
      const memoria = descrizioniComandi(configDir, salvate.toolDescriptions)
      // L'esito torna al client perché è l'unica cosa che l'utente non può dedurre:
      // *quale* file è stato toccato, e se non non si è potuto scriverlo.
      return send(res, 200, { settings: salvate, memoria })
    }
    // ─── il cloud: login, logout, stato ────────────────────────────────────────
    // Il server cloud (VPS + Traefik) gestisce l'identità; il daemon tiene il token in
    // `~/.stark/cloud-token` e lo usa per le feature cloud (la board sincronizzata).
    if (method === 'GET' && path === '/api/cloud/status') {
      return send(res, 200, await cloudStatus(STARK_HOME))
    }
    if (method === 'POST' && path === '/api/cloud/login') {
      const body = await readJson<{ email?: string; password?: string }>(req)
      if (!body?.email || !body?.password) return send(res, 400, { error: 'email e password obbligatorie' })
      const esito = await loginCloud(STARK_HOME, body.email, body.password)
      return send(res, esito.ok ? 200 : 401, esito)
    }
    if (method === 'POST' && path === '/api/cloud/logout') {
      await logoutCloud(STARK_HOME)
      return send(res, 200, { ok: true })
    }
    // Su quale ramo sta la cartella di una chat. Sta qui e non nel journal perché è un
    // fatto del filesystem, non dell'agent: chi fa `git checkout` in un terminale
    // accanto non manda nessun evento a STARK, quindi la risposta si chiede quando
    // serve invece di ricordarla. La `cwd` arriva dal client e non ci si fida:
    // `ramoDi` la passa a `isDir` prima di eseguire qualunque cosa.
    // ─── collegare un telefono ───────────────────────────────────────────────
    //
    // Il giro completo sta in `telefono.ts`; qui c'è solo l'instradamento. Le due rotte
    // che si attraversano **senza credenziale** sono `/pair` e `/api/phone/claim`, e
    // solo mentre un codice è vivo: a deciderlo è il guard, non queste righe — se ne
    // occupa `ROTTE_ACCOPPIAMENTO` in `security.ts`, perché una porta aperta va aperta
    // in un posto solo.
    if (method === 'GET' && path === '/pair') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      res.end(paginaAccoppiamento())
      return
    }
    if (method === 'POST' && path === '/api/phone/claim') {
      if (!telefono) return send(res, 503, { ok: false, error: 'unavailable' })
      const body = await readJson<{ code?: string }>(req)
      const esito = telefono.riscatta(body?.code ?? '', String(req.headers['user-agent'] ?? ''))
      if (!esito.ok) return send(res, 200, esito)   // 200: è una risposta, non un guasto
      // Il cookie qui e non solo al caricamento della pagina: la richiesta subito dopo è
      // `GET /`, cioè l'HTML nudo, che non ha né intestazioni né JavaScript — senza
      // questo si becherebbe un 403 un istante dopo aver accoppiato.
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'set-cookie': `stark=${esito.token}; Path=/; SameSite=Strict; HttpOnly; Secure; Max-Age=${400 * 86400}`,
      })
      res.end(JSON.stringify(esito))
      return
    }

    // Da qui in giù serve il token: sono le rotte che si usano **dal computer**.
    if (method === 'GET' && path === '/api/phone') {
      if (!telefono) return send(res, 503, { error: 'unavailable' })
      // `questo` e `conTokenMacchina` descrivono **chi sta chiedendo**, non lo stato
      // della macchina: sono l'unico modo perché il pannello, aperto da un telefono,
      // sappia quale riga dell'elenco è quella da cui lo stai guardando.
      const mia = guard.credenziale(req)
      const questo = mia ? telefono.idDi(mia) : null
      return send(res, 200, {
        tailscale: await statoTailscale(port()),
        // Il tunnel sta nello stesso payload perché il pannello risponde a UNA
        // domanda — «da dove mi raggiunge il telefono?» — e le strade sono due.
        tunnel: tunnel?.stato() ?? null,
        // Su che sistema gira **questa** macchina. Serve a una cosa sola: scegliere il
        // comando di installazione giusto da mostrare quando Tailscale non c'è. Va qui
        // e non nella UI perché il browser non lo sa — e non può dedurlo dal proprio
        // `userAgent`, che dice del telefono da cui stai guardando, non del computer su
        // cui STARK sta girando. Il daemon manda il fatto, la UI decide come si dice.
        so: SO,
        codice: telefono.codiceVivo(),
        devices: telefono.dispositivi,
        questo,
        conTokenMacchina: mia !== null && questo === null,
      })
    }
    if (method === 'POST' && path === '/api/phone/code') {
      if (!telefono) return send(res, 503, { error: 'unavailable' })
      return send(res, 200, telefono.apri())
    }
    if (method === 'DELETE' && path === '/api/phone/code') {
      telefono?.annulla()
      return send(res, 200, { ok: true })
    }
    if (method === 'DELETE' && path === '/api/phone/device') {
      const id = url.searchParams.get('id')
      if (!id) return send(res, 400, { ok: false, error: 'id required' })
      return send(res, 200, { ok: telefono?.revoca(id) ?? false })
    }
    // I due passi che STARK può fare al posto tuo. Gli altri tre no, e non è una
    // mancanza: abilitare i certificati è un'azione sulla console web del tuo account, e
    // installare l'app sul telefono non si fa da qui.
    if (method === 'POST' && path === '/api/phone/tailscale-up') {
      return send(res, 200, await collega())
    }
    if (method === 'POST' && path === '/api/phone/publish') {
      return send(res, 200, await pubblica(port()))
    }

    // Il tunnel: stato, e interruttore. L'interruttore scrive `settings.tunnel` e
    // sveglia il client subito — un toggle che aspetta il prossimo giro di lancette
    // sembrerebbe rotto a chi lo guarda.
    if (method === 'GET' && path === '/api/tunnel') {
      if (!tunnel) return send(res, 503, { error: 'unavailable' })
      return send(res, 200, tunnel.stato())
    }
    if (method === 'POST' && path === '/api/tunnel') {
      if (!tunnel) return send(res, 503, { error: 'unavailable' })
      const body = await readJson<{ on?: boolean }>(req)
      if (typeof body?.on !== 'boolean') return send(res, 400, { error: 'on: boolean richiesto' })
      registry.saveSettings({ ...registry.settings(), tunnel: body.on })
      tunnel.tick()
      return send(res, 200, tunnel.stato())
    }

    if (method === 'GET' && path === '/api/git') {
      const cwd = url.searchParams.get('cwd')
      if (!cwd) return send(res, 400, { error: 'cwd required' })
      return send(res, 200, await ramoDi(cwd))
    }
    if (method === 'GET' && path === '/api/browse') {
      return send(res, 200, registry.browse(url.searchParams.get('path') ?? undefined))
    }
    // Il Finder di sistema (spec: docs/superpowers/specs/2026-08-27-native-folder-
    // picker-design.md), accanto al browser manuale sopra — non al suo posto. Un
    // annullo dell'utente non è un errore: sempre 200, `{ok:false}` a dirlo.
    if (method === 'POST' && path === '/api/browse-native') {
      return send(res, 200, await pickFolderNative())
    }
    // Arrivare a un file citato in chat (F3): apre il gestore di file della macchina
    // sulla cartella giusta, col file selezionato quando l'ambiente lo consente. Non
    // allarga il perimetro — il daemon esegue già comandi come root — ma sta dietro
    // le stesse quattro difese di ogni altra rotta, perché è di quelle rotte che è
    // comodo aggiungere «al volo» fuori dalla guardia, ed è così che se ne apre uno.
    if (method === 'POST' && path === '/api/reveal') {
      const body = await readJson<{ path?: string; sessionId?: string }>(req)
      if (!body?.path) return send(res, 400, { error: 'path required' })
      // Un percorso relativo si legge rispetto alla **chat**, non al daemon, la cui
      // cartella è `/`. Chi manda un percorso assoluto (il blocco di un file, la riga
      // di un tool) non passa nessun `sessionId` e non cambia niente per lui:
      // `resolve` con una base ignora la base quando il percorso è già assoluto.
      const base = body.sessionId ? registry.snapshot(body.sessionId)?.cwd : undefined
      const esito = await reveal(body.path, base)
      return send(res, esito.ok ? 200 : 404, esito)
    }
    // Il nome del progetto nel menu del dock: apre la cartella del progetto **come
    // cartella**, non selezionata in quella sopra — è la differenza fra questa rotta
    // e `/api/reveal`, non un secondo modo di fare la stessa cosa. `path` arriva già
    // assoluto (il `cwd` della sessione), quindi non serve un `sessionId` per una
    // base relativa come sopra.
    if (method === 'POST' && path === '/api/open-folder') {
      const body = await readJson<{ path?: string }>(req)
      if (!body?.path) return send(res, 400, { error: 'path required' })
      const esito = await apriCartella(body.path)
      return send(res, esito.ok ? 200 : 404, esito)
    }
    // Apre un link con l'app dedicata invece che nel browser (F1). Il perimetro non
    // si fida del client: `url` deve appartenere davvero a un dominio che STARK
    // riconosce per `scheme`, altrimenti la rotta diventerebbe «lancia qualunque
    // schema il client chieda con qualunque URL» — un primitivo più potente di
    // quanto serva, e comodo da bucare proprio perché sembra innocuo.
    if (method === 'POST' && path === '/api/open-app') {
      const body = await readJson<{ url?: string; scheme?: string }>(req)
      if (!body?.url || !body.scheme) return send(res, 400, { error: 'url and scheme required' })
      let host: string
      try { host = new URL(body.url).hostname } catch { return send(res, 400, { error: 'invalid url' }) }
      if (serviceFor(host)?.scheme !== body.scheme) {
        return send(res, 400, { error: 'domain not recognized for this scheme' })
      }
      const esito = await openApp(body.url, body.scheme)
      return send(res, esito.ok ? 200 : 404, esito)
    }
    if (method === 'GET' && path === '/api/storage') {
      return send(res, 200, registry.storage())
    }
    if (method === 'GET' && path === '/api/system') {
      // La diagnostica: chiede la versione all'eseguibile, quindi non è istantanea.
      // È la pagina che si guarda quando qualcosa sembra rotto senza motivo.
      return send(res, 200, {
        url: `http://127.0.0.1:${port()}`,
        port: port(),
        home: STARK_HOME,
        // Non una stringa fissa: con Tailscale acceso «localhost only» mentiva già.
        listening: guard.perimetro.ammessi.length === 0
          ? 'localhost only'
          : `localhost + ${guard.perimetro.ammessi.map(a => a.host).join(', ')}`,
        perimeter: {
          open: guard.perimetro.ammessi.length > 0,
          hosts: guard.perimetro.ammessi.map(a => ({ host: a.host, source: a.fonte })),
        },
        agent: await backendFor().diagnostics?.(configDir),
        // La diagnostica di **tutti** gli agent installati, chiave = id agent: la
        // pagina System dice la versione di ciascuno, e chiederla solo all'agent di
        // default lasciava OpenCode senza numero. `null` per chi non sa rispondere.
        diagnosticaAgenti: Object.fromEntries(await Promise.all(
          agentIds().map(async id => [id, (await backendFor(id).diagnostics?.()) ?? null])
        )) as Record<string, unknown>,
        nativeFolderPicker: await nativeFolderPickerAvailable(),
        // Quali agent questa macchina sa guidare. La UI ne fa una scelta **solo se ce
        // n'è più di uno**: una tendina con una voce sola è un ostacolo, non una scelta
        // (stessa regola del profilo in «New chat»).
        agents: await agentiDisponibili(),
      })
    }

    /**
     * Riavvia il daemon — è come si prende un aggiornamento senza tornare al terminale.
     *
     * Tre cose in un ordine che non è scambiabile. Si risponde **prima** di morire: se
     * il daemon si spegnesse qui dentro, il browser vedrebbe cadere la connessione
     * senza sapere se il riavvio era partito o se era esploso qualcosa. Si accende il
     * ricambio **prima** di fermarsi, perché un processo non può riaccendere sé stesso.
     * E ci si ferma **dopo** aver risposto, con un respiro, se no la risposta resta nel
     * socket di un processo che non c'è più.
     *
     * Chi preme sa cosa costa: la UI lo chiede dicendo quante conversazioni si fermano
     * (i processi agent sono figli di questo, quindi muoiono tutti). La scheda aperta
     * si ricollega da sola, che è la stessa cosa che fa dopo un riavvio da terminale.
     */
    /**
     * C'è una versione più nuova? È la risposta del controllo fatto **all'accensione**
     * (`aggiornamenti.ts`), non una domanda al remoto: chiederlo qui vorrebbe dire un
     * giro di rete a ogni caricamento della pagina, e la risposta cambierebbe solo se
     * qualcuno rilascia proprio in quel momento.
     *
     * `null` — controllo non ancora tornato — si serve come «niente da aggiornare»
     * invece che come stato a sé: al primo secondo dopo l'accensione la risposta onesta
     * è che non lo sappiamo, e non sapere non è una cosa da mostrare a schermo.
     */
    if (method === 'GET' && path === '/api/update') {
      return send(res, 200, aggiornamentoNoto() ?? {
        installata: versioneInstallata(RADICE), ultima: null, tag: null, disponibile: false,
      })
    }

    /**
     * Rifà il controllo **adesso**, invece di rileggere quello dell'avvio. È il
     * «Check for updates» della pagina System: un giro di rete che chiede i tag al
     * remoto, e la risposta vale come una letta all'accensione — stessa forma, stesso
     * posto. Si aspetta: chi ha premuto vuole la risposta, non un «forse più tardi».
     */
    if (method === 'POST' && path === '/api/update/check') {
      const stato = await controlla(RADICE)
      notaAggiornamento(stato)
      return send(res, 200, stato)
    }

    /**
     * Aggiorna e riparti. È il bottone del banner, ed è `stark update` fatto partire da
     * qui invece che da un terminale — letteralmente lo stesso comando, vedi
     * `riavvio.ts`.
     *
     * I due rifiuti prima di muovere qualcosa non sono ridondanti rispetto ai controlli
     * che `stark update` rifà per conto suo: **lì** fallirebbero dentro un processo
     * staccato, dopo che questo daemon è già morto, cioè in un log che nessuno sta
     * guardando. Qui invece la risposta torna al browser, che può dirlo a chi ha
     * premuto. Il controllo doppio è voluto: `update` deve restare corretto anche
     * quando lo si digita a mano.
     */
    if (method === 'POST' && path === '/api/update') {
      const stato = aggiornamentoNoto()
      if (!stato?.disponibile || !stato.tag) {
        return send(res, 409, { error: 'no newer release to install' })
      }
      if (await alberoSporco(RADICE)) {
        return send(res, 409, {
          error: 'there are uncommitted changes to tracked files in ' + RADICE
            + ': STARK will not overwrite them. Resolve them yourself, then try again.',
        })
      }
      const esito = avviaRicambio(STARK_HOME, { aggiorna: true, log: logPath(STARK_HOME) })
      if (!esito.ok) return send(res, 500, { error: esito.error })
      send(res, 200, { ok: true, tag: stato.tag, ...(esito.pid ? { pid: esito.pid } : {}) })
      // Stesso ritardo e stessa ragione del riavvio qui sotto: `send` scrive nel socket,
      // e chiudere subito strapperebbe la connessione prima che il corpo arrivi.
      setTimeout(() => {
        void (async () => {
          try { await registry.shutdown() } catch { /* stiamo morendo comunque */ }
          process.exit(0)
        })()
      }, 250)
      return
    }

    if (method === 'POST' && path === '/api/restart') {
      const body = await readJson<{ rebuildUi?: boolean }>(req)
      const esito = avviaRicambio(STARK_HOME, {
        rebuildUi: body?.rebuildUi !== false,
        log: logPath(STARK_HOME),
      })
      if (!esito.ok) return send(res, 500, { error: esito.error })
      send(res, 200, { ok: true, ...(esito.pid ? { pid: esito.pid } : {}) })
      // Il ritardo non è scaramanzia: `send` scrive nel socket, e chiudere subito il
      // server strapperebbe la connessione prima che il corpo arrivi davvero.
      setTimeout(() => {
        void (async () => {
          try { await registry.shutdown() } catch { /* stiamo morendo comunque */ }
          process.exit(0)
        })()
      }, 250)
      return
    }

    // ─── l'helper (§17) ──────────────────────────────────────────────────────
    //
    // Tre rotte e non una dentro `/api/sessions`, perche' l'helper **non e' una
    // sessione dell'elenco**: non ha un progetto, non si risveglia, non si rinomina, e
    // ce n'e' uno solo. Passarlo dalla rotta delle chat vere vorrebbe dire aggiungere
    // a quella una manciata di casi speciali che valgono per un solo chiamante.

    /** Tutti i modelli guidabili sulla macchina, per agent. Costa un handshake per
     *  agent la prima volta (misurato: ~1,6s Claude Code, ~1,5s OpenCode) e poi e'
     *  in cache: chi apre il menu due volte non lo paga due volte. */
    /**
     * Passare il lavoro da un agent a un altro.
     *
     * Rotta sua e non `session.setModel`: quel comando cambia un parametro dentro una
     * conversazione, questo ne apre **un'altra** e ci travasa il lavoro con un file.
     * Farli passare dalla stessa porta vorrebbe dire che «cambio modello» a volte costa
     * un turno e apre una chat, e a volte no, a seconda di cosa hai scelto.
     *
     * `via` omesso su una chat che non ha un processo dietro non è un errore: torna
     * `serveScelta`, perché svegliarla costa e la decisione è dell'utente.
     */
    if (method === 'POST' && path === '/api/handoff') {
      const body = await readJson<{ id?: string; agent?: string; model?: string; via?: string }>(req)
      if (!body?.id || !body.agent || !body.model) {
        return send(res, 400, { error: 'id, agent and model required' })
      }
      if (body.via && body.via !== 'agent' && body.via !== 'journal') {
        return send(res, 400, { error: `unknown via: ${body.via}` })
      }
      const esito = await eseguiHandoff(registry, {
        id: body.id, agent: body.agent, model: body.model,
        ...(body.via ? { via: body.via as ViaBriefing } : {}),
      })
      if (esito.ok) return send(res, 201, { id: esito.id, file: esito.file, snapshot: registry.snapshot(esito.id) })
      // `serveScelta` non è un fallimento: è una domanda. 409 e non 400, perché la
      // richiesta è corretta — è lo stato della conversazione a non permetterla ancora.
      if ('serveScelta' in esito) return send(res, 409, { serveScelta: true, state: esito.state })
      return send(res, 400, { error: esito.error })
    }

    if (method === 'GET' && path === '/api/models') {
      return send(res, 200, { agents: await catalogoCompleto() })
    }

    if (method === 'GET' && path === '/api/helper') {
      // Riagganciarsi all'helper **già vivo**, senza ricrearlo: dopo un reload il
      // pannello non deve ripagare l'handshake (l'«Avvio…») né avviare un secondo
      // processo. `registry.helper` dice se esiste; `404` = non c'è, e chi chiama
      // fa il POST che lo crea.
      const id = registry.helper
      if (!id) return send(res, 404, { error: 'no helper alive' })
      const snap = registry.snapshot(id)
      if (!snap) return send(res, 404, { error: 'no helper alive' })
      return send(res, 200, { id, snapshot: snap })
    }

    if (method === 'POST' && path === '/api/helper') {
      const body = await readJson<{ agent?: string; model?: string }>(req)
      try {
        const id = await registry.openHelper({
          // Una cartella **sua**, non quella della chat che si sta guardando: l'helper
          // e' un'istanza a parte, e ereditare il progetto lo renderebbe una seconda
          // chat di quel progetto. Sta sotto `STARK_HOME` e non in `/tmp` perche' un
          // `/tmp` ripulito a meta' sessione farebbe fallire l'apertura successiva con
          // un errore che non c'entra niente con quello che l'utente stava facendo.
          cwd: helperDir(),
          ...(body?.agent ? { agent: body.agent } : {}),
          ...(body?.model ? { model: body.model } : {}),
          // Sola lettura, e non per prudenza: in un pannello largo un sesto di schermo
          // non c'e' posto per una card di permesso, e un permesso che chiede senza
          // avere dove rispondere non e' cauto — e' una chat piantata.
          deny: ['shell', 'edit', 'net', 'agents', 'external'],
          // L'helper e' per domande veloci, non per un lavoro profondo: a differenza
          // della chat grande (thinking on, effort high — i default del CLI), qui si
          // parte spenti e al minimo. Chi vuole di piu' lo sceglie dal pannello
          // (AgentPanel.svelte); un agent che non conosce queste due opzioni le ignora
          // (vedi extraOptions in core/adapter.ts).
          extraOptions: { reasoning: 'off', effort: 'low' },
        })
        return send(res, 201, { id, snapshot: registry.snapshot(id) })
      } catch (e) {
        return send(res, 400, { error: (e as Error).message })
      }
    }

    if (method === 'DELETE' && path === '/api/helper') {
      await registry.closeHelper()
      return send(res, 200, { ok: true })
    }

    if (method === 'POST' && path === '/api/sessions') {
      const body = await readJson<OpenSpec>(req)
      if (!body?.cwd) return send(res, 400, { error: 'cwd required' })
      // Che la cartella esista si controlla **qui**, prima di aprire qualunque cosa.
      // Senza, si arrivava a far partire il processo figlio e a fallire là in fondo: e
      // fallire là in fondo aveva due prezzi. Il primo è il messaggio, che veniva
      // dall'SDK e incolpava la libc («il binario nativo non corrisponde a questo
      // sistema, forse musl contro glibc») — una pista completamente sbagliata per chi
      // ha solo sbagliato a scrivere un percorso. Il secondo è che a quel punto il
      // journal era già nato, e restava lì: senza `session.created` non aveva `cwd`,
      // quindi compariva nell'elenco come una chat «no folder / stopped» che nessuno
      // aveva aperto. Un input non valido deve fermarsi al confine, non lasciare
      // residui dentro.
      if (!isDir(body.cwd)) {
        return send(res, 400, { error: `the folder does not exist: ${body.cwd}` })
      }
      const id = await registry.open(body)
      return send(res, 201, { id, snapshot: registry.snapshot(id) })
    }

    // Gli allegati: `<ref>` è uno sha256, e il controllo vero lo rifà il registro —
    // qui la forma serve solo a non far entrare niente che somigli a un percorso.
    // L'id di sessione non e' un uuid: e' qualunque cosa l'agent generi. La classe
    // `[0-9a-f-]` sotto era scritta per gli uuid di Claude Code, e con il secondo
    // adapter e' diventata un muro invisibile: gli id di OpenCode portano `_` e
    // maiuscole (`ses_fad3a59e…USIn…`), non ci entravano, e **tutta** la superficie
    // per-sessione — snapshot, stream, comandi — rispondeva 404 a quell'agent.
    // Misurato il 30 agosto con una conversazione importata che non si apriva.
    // Il contenuto dell'id non e' un permesso: chi spara un id finto riceve comunque
    // un 404 da `registry.snapshot`, qui si decide solo che forma ha la rotta.
    const b = /^\/api\/sessions\/([0-9a-zA-Z_-]{8,})\/blob\/([0-9a-f]{64})$/.exec(path)
    if (b && method === 'GET') {
      const found = registry.attachment(b[1]!, b[2]!)
      if (!found) return send(res, 404, { error: 'unknown attachment' })
      // Immutabile per costruzione: il nome **è** l'impronta del contenuto, quindi la
      // cache del browser non può servire una cosa per un'altra.
      res.writeHead(200, {
        'content-type': found.mediaType,
        'cache-control': 'private, max-age=31536000, immutable',
      })
      createReadStream(found.path).pipe(res)
      return
    }

    const m = /^\/api\/sessions\/([0-9a-zA-Z_-]{8,})(\/[a-z]+)?$/.exec(path)
    if (m) {
      const id = m[1]!
      const sub = m[2] ?? ''

      if (method === 'GET' && sub === '') {
        const s = registry.snapshot(id)
        return s ? send(res, 200, { snapshot: s }) : send(res, 404, { error: 'unknown' })
      }
      // Le citazioni con `@`: i file del progetto che somigliano a quello che si sta
      // scrivendo. GET e non `/command`, perché qui serve una **risposta** — il canale
      // dei comandi torna `{ok}`, che è giusto per «fai» e inutile per «dimmi».
      if (method === 'GET' && sub === '/files') {
        const q = url.searchParams.get('q') ?? ''
        // Un tetto sulla domanda, non solo sulla risposta: la stringa arriva dal
        // browser e finisce in un processo figlio, e non c'è nessuna query di 500
        // caratteri che sia una domanda vera.
        return send(res, 200, { files: await registry.fileSuggestions(id, q.slice(0, 200)) })
      }
      if (method === 'GET' && sub === '/events') {
        const from = Number(url.searchParams.get('from') ?? 0)
        return send(res, 200, { events: registry.events(id, Number.isFinite(from) ? from : 0) })
      }
      if (method === 'GET' && sub === '/stream') {
        const from = Number(url.searchParams.get('from') ?? 0)
        return stream(req, res, registry, id, Number.isFinite(from) ? from : 0)
      }
      // Le liste di task del **progetto** di questa chat. Il `cwd` lo risolve il daemon
      // dall'id: una rotta che accettasse un percorso dal browser sarebbe «leggi un file
      // in qualunque cartella di questa macchina» (stessa ragione di `/files`).
      if (method === 'GET' && sub === '/todo') {
        const cwd = registry.snapshot(id)?.cwd
        if (!cwd) return send(res, 404, { error: 'this conversation has no folder' })
        return send(res, 200, { cwd, ...leggiTodo(cwd) })
      }
      if (method === 'GET' && sub === '/todostream') {
        const cwd = registry.snapshot(id)?.cwd
        if (!cwd) return send(res, 404, { error: 'this conversation has no folder' })
        return todoStream(req, res, cwd)
      }
      if (method === 'DELETE' && sub === '') {
        const esito = await registry.remove(id)
        return send(res, esito.ok ? 200 : 404, esito)
      }
      // Quali percorsi citati in chat esistono davvero. Una domanda sola per messaggio,
      // non una per percorso: il costo di questa rotta è una `existsSync` per candidato,
      // e farne una richiesta HTTP ciascuna sarebbe il modo di renderlo caro senza
      // renderlo più utile. È una POST e non una GET perché l'elenco sta nel corpo — una
      // query string con quaranta percorsi dentro non ci starebbe.
      if (method === 'POST' && sub === '/paths') {
        const body = await readJson<{ paths?: unknown }>(req)
        const paths = Array.isArray(body?.paths) ? body.paths as string[] : []
        return send(res, 200, { exist: registry.pathsThatExist(id, paths) })
      }
      if (method === 'POST' && sub === '/command') {
        // 32 MB: un prompt può portarsi dietro qualche schermata, e in base64 ognuna
        // pesa un terzo in più dei suoi byte. Il tetto resta perché un corpo senza
        // limite è il modo più semplice di finire la memoria di un daemon.
        const cmd = await readJson<Command>(req, 32 * 1024 * 1024)
        if (!cmd?.c) return send(res, 400, { error: 'malformed command' })
        const esito = await registry.command(id, cmd)
        return send(res, esito.ok ? 200 : 409, esito)
      }
    }

    // ─── la board del progetto ──────────────────────────────────────────────────
    // Come `/todo`: il `cwd` lo risolve il daemon dall'id, mai un percorso dal browser.
    // Le rotte hanno forme diverse (`/board`, `/boardstream`, `/board/init`,
    // `/board/task`, `/board/task/<n>/edit`), quindi si leggono a parte dalla regex
    // delle sessioni, che accetta un solo segmento di lettere.
    const bm = /^\/api\/sessions\/([0-9a-f-]{8,})\/board(.*)$/.exec(path)
    if (bm) {
      const bid = bm[1]!
      const resto = bm[2] ?? ''
      const cwd = registry.snapshot(bid)?.cwd
      const senzaCwd = (): boolean => {
        if (cwd) return false
        send(res, 404, { error: 'questa conversazione non ha una cartella' })
        return true
      }
      if (method === 'GET' && resto === '') {
        if (senzaCwd()) return
        // La board è cloud: il daemon risale l'origin della repo e inoltra.
        const origin = await originRepo(cwd!)
        if (!origin) return send(res, 200, { origin: null, columns: [], assente: true, motivo: 'nessun origin git' })
        return send(res, 200, await boardCloud(STARK_HOME, origin))
      }
      if (method === 'GET' && resto === 'stream') {
        if (senzaCwd()) return
        const origin = await originRepo(cwd!)
        if (!origin) return send(res, 404, { error: 'nessun origin git' })
        return boardStream(req, res, origin)
      }
      if (method === 'POST' && resto === '/init') {
        if (senzaCwd()) return
        const origin = await originRepo(cwd!)
        if (!origin) return send(res, 400, { error: 'nessun origin git' })
        return send(res, 200, await boardInitCloud(STARK_HOME, origin))
      }
      if (method === 'POST' && resto === '/task') {
        if (senzaCwd()) return
        const origin = await originRepo(cwd!)
        if (!origin) return send(res, 400, { error: 'nessun origin git' })
        const body = await readJson<{ title?: string; priority?: string; body?: string }>(req)
        if (!body?.title) return send(res, 400, { error: 'titolo obbligatorio' })
        return send(res, 200, await boardTaskCloud(STARK_HOME, origin, {
          title: body.title.slice(0, 500), priority: body.priority, body: body.body,
        }))
      }
      const em = /^\/task\/(\d+)\/edit$/.exec(resto)
      if (method === 'POST' && em) {
        if (senzaCwd()) return
        const origin = await originRepo(cwd!)
        if (!origin) return send(res, 400, { error: 'nessun origin git' })
        const body = await readJson<{ status?: string; title?: string; priority?: string; claimed_by?: string; position?: number }>(req)
        return send(res, 200, await boardEditCloud(STARK_HOME, origin, Number(em[1]), body ?? {}))
      }
    }

    // Il manifest si compone qui invece di essere servito com'è, e la ragione è una
    // riga sola: `start_url`.
    //
    // Aggiungendo STARK alla schermata Home, iOS non salva l'indirizzo che stai
    // guardando — salva `start_url` del manifest, e da lì in poi l'app parte **sempre**
    // da quello. Con `"/"` scritto nel file, l'app partiva su una pagina senza token e
    // il daemon rispondeva 403: l'icona c'era, e non si collegava. Segnalato dall'utente
    // il 26 agosto 2026, e verificato: `GET /` senza token → 403.
    //
    // Perché il cookie non salva la situazione: su iOS un'app della schermata Home ha
    // una **memoria sua**, separata da quella di Safari. Il cookie preso nella scheda
    // non è lì, e nemmeno il `sessionStorage`. La prima richiesta deve bastare a sé.
    //
    // Il token finisce quindi dentro il manifest — e non è un peggioramento: il manifest
    // sta dietro lo stesso guard di tutto il resto, quindi lo riceve solo chi è già
    // autenticato, ed è lo stesso token che sta già nell'indirizzo che l'utente apre.
    // Costo vero, e va detto: iOS congela `start_url` al momento in cui aggiungi l'app,
    // quindi rigenerando il token (`stark token --new`) l'icona va rifatta.
    if (method === 'GET' && path === '/manifest.webmanifest') {
      const file = resolve(UI_DIR, 'manifest.webmanifest')
      if (existsSync(file)) {
        const m = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
        m['start_url'] = `/?token=${token}`
        res.writeHead(200, {
          'content-type': 'application/manifest+json; charset=utf-8',
          // Mai in cache: se il token cambia, il manifest vecchio manderebbe l'app su
          // un indirizzo che non funziona più, e nessuno saprebbe perché.
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify(m))
        return
      }
    }

    // Tutto ciò che non è /api è la UI. Sta in fondo di proposito: l'API ha la
    // precedenza, così un file compilato non potrà mai oscurare una rotta vera.
    // La credenziale con cui si è entrati, non quella della macchina: vedi `serveUi`.
    // `?? token` copre il caso in cui la pagina passi da una via che il guard non conta
    // come credenziale — non succede oggi, ma un 403 silenzioso sarebbe peggio.
    const mia = guard.credenziale(req) ?? token
    if (!path.startsWith('/api/') && serveUi(req, res, mia, mia !== token)) return

    send(res, 404, { error: 'not found' })
  } catch (e) {
    const msg = String((e as Error).message ?? e)
    // Un corpo oltre il tetto non è un guasto del daemon: è la richiesta a essere
    // troppo grande, e il codice che lo dice esiste apposta. Si riconosce dal **tipo**
    // e non dal testo: un confronto di stringhe risponderebbe 413 a qualunque altro
    // errore che un domani si trovasse a dire la stessa frase.
    send(res, e instanceof CorpoTroppoGrande ? 413 : 500, { error: msg })
  }
}

// ─── flusso degli eventi ────────────────────────────────────────────────────

/**
 * Un evento si serializza UNA volta, chiunque stia guardando: due pannelli sulla
 * stessa chat erano due `JSON.stringify` per ogni delta di testo — lavoro identico
 * fatto due volte sul percorso più caldo che c'è. La `WeakMap` muore con gli eventi:
 * niente da ripulire.
 */
const serializzati = new WeakMap<object, string>()
function jsonDi(e: object): string {
  let s = serializzati.get(e)
  if (s === undefined) { s = JSON.stringify(e); serializzati.set(e, s) }
  return s
}

function stream(
  req: IncomingMessage, res: ServerResponse, registry: Registry, id: string, from: number,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // Nessuna intestazione CORS, di proposito: chi non è servito da qui non deve
    // poter leggere questo flusso.
  })
  res.write(': collegato\n\n')

  const unsubscribe = registry.subscribe(id, from, e => {
    // `id:` è il numero di sequenza: se la connessione cade, il client sa da dove
    // ripartire senza rileggere tutto e senza saltare niente.
    res.write(`id: ${e.seq}\nevent: canonical\ndata: ${jsonDi(e)}\n\n`)
  })

  // Un proxy o un firewall di mezzo chiude le connessioni mute. Il commento periodico
  // le tiene aperte senza inquinare il flusso: le righe che iniziano con `:` sono
  // ignorate dal client per specifica.
  const battito = setInterval(() => res.write(': .\n\n'), 15000)

  const chiudi = (): void => { clearInterval(battito); unsubscribe(); res.end() }
  req.on('close', chiudi)
  req.on('error', chiudi)
}

/**
 * Le righe dell'elenco, ogni volta che cambiano.
 *
 * Manda la lista intera e non un delta: sono poche decine di righe corte, e un
 * protocollo di differenze fra client e server sarebbe una seconda copia dello stato
 * da tenere allineata — cioè un altro posto in cui la UI può divergere dal journal.
 *
 * Il ritardo non è una comodità: un solo turno produce decine di eventi al secondo,
 * e ognuno cambia `lastSeq`. Senza, si ricalcolerebbe l'elenco — che rilegge da disco
 * i journal delle sessioni non vive — a ogni delta di testo.
 */
/**
 * Il flusso dei todo di un progetto.
 *
 * Un flusso **suo**, e non un evento in più dentro quello della sessione: là dentro
 * passano eventi canonici con un `seq` che nasce dal journal, e questo file nel journal
 * non c'è (vedi `todo.ts`). Infilarcelo vorrebbe dire mettere in quel flusso qualcosa
 * che il journal non può ricostruire — cioè rompere il §4 nell'unico punto in cui è
 * comodo farlo.
 *
 * Si manda lo stato **intero** a ogni cambio, come fa il flusso dell'elenco: un file di
 * qualche riga non vale un protocollo di differenze, e mandare tutto rende impossibile
 * che il client resti disallineato dopo una riconnessione.
 */
function todoStream(req: IncomingMessage, res: ServerResponse, cwd: string): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  res.write(': collegato\n\n')

  const invia = (): void => {
    res.write(`event: todo\ndata: ${JSON.stringify({ cwd, ...leggiTodo(cwd) })}\n\n`)
  }
  invia()

  // Il watcher spara più volte per una scrittura sola (il temporaneo che compare, il
  // rename che lo sostituisce): senza questa attesa la barra si ridisegnerebbe due o tre
  // volte per ogni modifica, e con essa si legge una volta a file fermo.
  let timer: ReturnType<typeof setTimeout> | null = null
  const stacca = guardaTodo(cwd, () => {
    if (timer === null) timer = setTimeout(() => { timer = null; invia() }, 120)
  })

  // Stesso battito del flusso degli eventi, e per la stessa ragione: un proxy con un
  // timeout corto chiuderebbe una connessione che sta solo aspettando.
  const battito = setInterval(() => res.write(': .\n\n'), 15000)
  req.on('close', () => {
    clearInterval(battito)
    if (timer) clearTimeout(timer)
    stacca()
  })
}

/** Le cartelle distinte delle conversazioni che il registro conosce. */
function cartelleNote(registry: Registry): string[] {
  return [...new Set(registry.list().flatMap(r => (r.cwd ? [r.cwd] : [])))]
}

/**
 * Il flusso della board di un progetto.
 *
 * Un flusso **suo**, e non un evento in più dentro quello della sessione: là dentro
 * passano eventi canonici con un `seq` che nasce dal journal, e questo file nel journal
 * non c'è (vedi `board.ts`). Infilarcelo vorrebbe dire rompere il §4 nell'unico punto
 * in cui è comodo farlo — la stessa ragione per cui `todoStream` è un flusso a parte.
 *
 * Si manda lo stato **intero** a ogni cambio: è la forma che rende impossibile restare
 * disallineati dopo una riconnessione.
 */
async function boardStream(req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  res.write(': collegato\n\n')

  // La board è cloud: il daemon apre uno stream SSE verso il server cloud e lo ripassa
  // alla UI. Il cloud manda lo stato intero a ogni cambio, quindi qui basta inoltrare.
  const url = cloudUrl()
  const token = tokenCloud(STARK_HOME)
  if (!url || !token) {
    res.write(`event: board\ndata: ${JSON.stringify({ origin, columns: [], assente: true, motivo: 'cloud non configurato o non loggato' })}\n\n`)
    res.end()
    return
  }
  const q = new URLSearchParams({ origin })
  const ctrl = new AbortController()
  try {
    const upstream = await fetch(`${url}/api/board/stream?${q}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    })
    if (!upstream.ok || !upstream.body) throw new Error(`upstream ${upstream.status}`)
    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    const pump = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        // Inoltra gli eventi completi (`event:` ... `data:` ... riga vuota).
        let idx: number
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx + 2)
          buf = buf.slice(idx + 2)
          res.write(chunk)
        }
      }
    }
    void pump().catch(() => {})
  } catch {
    res.write(`event: board\ndata: ${JSON.stringify({ origin, columns: [], assente: true, motivo: 'cloud non raggiungibile' })}\n\n`)
    res.end()
    return
  }

  const battito = setInterval(() => res.write(': .\n\n'), 15000)
  req.on('close', () => {
    clearInterval(battito)
    ctrl.abort()
  })
}

/**
 * Il flusso dei todo di **tutti** i progetti.
 *
 * Un watcher per cartella, e l'elenco delle cartelle si rilegge a ogni giro: aprire una
 * chat su un progetto nuovo mentre la colonna è su «All» deve farlo comparire, e senza
 * questo il flusso resterebbe fermo all'insieme di cartelle che c'era all'iscrizione.
 * Il costo è un `registry.list()` in più per cambio di file, che dopo la cache dell'elenco
 * è una lettura in memoria.
 *
 * Come per il flusso di un progetto solo si manda lo stato **intero**: qui vale ancora di
 * più, perché un protocollo di differenze su N progetti sarebbe N volte l'occasione di
 * restare disallineati.
 */
function todosStream(req: IncomingMessage, res: ServerResponse, registry: Registry): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  res.write(': collegato\n\n')

  let timer: ReturnType<typeof setTimeout> | null = null
  let staccati: (() => void)[] = []
  let chiuso = false

  const invia = (): void => {
    res.write(`event: todo\ndata: ${JSON.stringify({ projects: leggiTodoDiTutti(cartelleNote(registry)) })}\n\n`)
  }
  const cambiato = (): void => {
    if (chiuso || timer !== null) return
    timer = setTimeout(() => { timer = null; riaggancia(); invia() }, 120)
  }
  /** Riattacca i watcher sull'insieme corrente di cartelle. */
  function riaggancia(): void {
    for (const s of staccati) s()
    staccati = chiuso ? [] : cartelleNote(registry).map(cwd => guardaTodo(cwd, cambiato))
  }

  riaggancia()
  invia()

  // L'insieme delle cartelle cambia quando nasce o muore una conversazione, e quello non
  // tocca nessun `.stark/`: senza questo giro, una chat aperta su un progetto nuovo non
  // comparirebbe finché qualcuno non scrive in un todo.json di un altro progetto.
  const ripassa = setInterval(() => { if (!chiuso) { riaggancia(); invia() } }, 10000)
  ripassa.unref?.()

  const battito = setInterval(() => res.write(': .\n\n'), 15000)
  req.on('close', () => {
    chiuso = true
    clearInterval(battito)
    clearInterval(ripassa)
    if (timer) clearTimeout(timer)
    for (const s of staccati) s()
    staccati = []
  })
}

function listStream(req: IncomingMessage, res: ServerResponse, registry: Registry): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })

  let timer: ReturnType<typeof setTimeout> | null = null
  const invia = (): void => {
    timer = null
    res.write(`event: sessions\ndata: ${JSON.stringify({ sessions: registry.list() })}\n\n`)
  }
  invia()

  const unsubscribe = registry.watchAll(() => {
    if (timer === null) timer = setTimeout(invia, 250)
  })
  const battito = setInterval(() => res.write(': .\n\n'), 15000)

  const chiudi = (): void => {
    clearInterval(battito)
    if (timer) clearTimeout(timer)
    unsubscribe()
    res.end()
  }
  req.on('close', chiudi)
  req.on('error', chiudi)
}

// ─── utilità ────────────────────────────────────────────────────────────────

/**
 * `path` è una cartella che esiste? Un file normale non vale: `cwd` di un processo
 * deve essere una directory, e sbagliare fra le due è un errore che si fa davvero
 * (basta scegliere il file invece della cartella che lo contiene).
 */

function send(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(s)
}

/**
 * `max` è un parametro e non una costante perché i corpi non sono tutti uguali: un
 * comando è due righe, ma un prompt con dentro uno schermo incollato viaggia in base64,
 * che cresce di un terzo. Con il limite unico a 4 MB, un'immagine da 3 MB non passava.
 */
/** Il corpo della richiesta ha superato il tetto. Un tipo e non una stringa: chi la
 *  intercetta deve poterla riconoscere senza confrontare messaggi. */
class CorpoTroppoGrande extends Error {
  constructor() { super('corpo troppo grande') }
}

async function readJson<T>(req: IncomingMessage, max = 4 * 1024 * 1024): Promise<T | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    // Un corpo senza limite è un modo di finire la memoria del daemon.
    if (size > max) throw new CorpoTroppoGrande()
    chunks.push(c as Buffer)
  }
  if (chunks.length === 0) return null
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T } catch { return null }
}

/**
 * La cartella in cui gira l'helper.
 *
 * Esiste ed e' vuota, e va bene cosi': l'helper e' in sola lettura, quindi non ci
 * scrivera' niente, e non e' li' per lavorare su un progetto. Serve perche' una
 * sessione **deve** avere una cartella di lavoro — e perche' `open()` rifiuta al
 * confine una `cwd` che non esiste (400), che e' la difesa messa il 26 agosto contro
 * le chat fantasma e che vale anche qui.
 */
function helperDir(): string {
  const d = resolve(STARK_HOME, 'helper')
  mkdirSync(d, { recursive: true })
  return d
}

function closeServer(server: Server): Promise<void> {
  return new Promise(r => { server.closeAllConnections?.(); server.close(() => r()) })
}
