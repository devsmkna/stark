// Il daemon: HTTP più SSE su 127.0.0.1.
//
// Perché SSE e non WebSocket. Il flusso che conta va in una direzione sola, dal daemon
// alla UI; i comandi risalgono come normali POST. SSE è uno standard che sta già in
// Node e nel browser, quindi non introduce dipendenze, e per giunta è la stessa forma
// che usa OpenCode — il che risparmierà lavoro al secondo adapter invece di crearne.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createGuard, type Perimetro } from './security.ts'
import { serveUi, UI_DIR } from './static.ts'
import { Registry, STARK_HOME, type OpenSpec } from './registry.ts'
import { reveal } from './reveal.ts'
import { nativeFolderPickerAvailable, pickFolderNative } from './native-browse.ts'
import { Push, vigila, type Subscription } from './push.ts'
import { openApp } from './launch.ts'
import { serviceFor } from '../core/services.ts'
import type { Settings } from './settings.ts'
import { diagnostics, warmDiagnostics } from '../adapters/claude-code/profiles.ts'
import { allineaMemoria } from './memoria.ts'
import { readToken } from './identity.ts'
import type { Command } from '../core/events.ts'

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
  const guard = createGuard(() => port, opts.token ?? readToken(STARK_HOME), opts.publicHosts)
  annunciaPerimetro(guard.perimetro)
  const guardToken = guard.token
  const registry = new Registry({
    ...(opts.model ? { model: opts.model } : {}),
    // Le sessioni dell'utente possono vivere fuori da ~/.claude. Se non si propaga
    // questa, i processi figli guardano nella cartella sbagliata: nessuna
    // conversazione da riprendere e forse nemmeno il login, con l'aria di essere rotti.
    configDir: opts.configDir ?? process.env['CLAUDE_CONFIG_DIR'] ?? undefined,
  })

  // La versione del CLI si chiede a un processo e ci mette qualche secondo: si scalda
  // adesso, mentre nessuno la sta aspettando.
  warmDiagnostics()

  // La regola sulle descrizioni dei comandi va riallineata **all'avvio**, non solo
  // quando si tocca l'impostazione: il `CLAUDE.md` globale è un file dell'utente, e
  // fra un'accensione e l'altra può averlo modificato a mano, cambiato profilo, o
  // ripristinato da un backup. Senza questo giro, la spunta direbbe una cosa e il
  // file un'altra — cioè l'impostazione mentirebbe.
  {
    const configDir = opts.configDir ?? process.env['CLAUDE_CONFIG_DIR']
    const esito = allineaMemoria(configDir, registry.settings().toolDescriptions)
    if (esito.error) console.error('memoria globale non scrivibile:', esito.path, esito.error)
    else if (esito.cambiato) console.log('memoria globale allineata:', esito.path)
  }

  // Le notifiche sul telefono. Vive nel daemon e non nella pagina perché è **l'unico**
  // posto da cui si può avvisare un telefono che non ti sta guardando: a schermo
  // spento nella scheda del browser non gira niente. Senza iscrizioni non fa nulla e
  // non costa nulla — vedi `push.ts`.
  const push = new Push(STARK_HOME, guard.perimetro)
  if (push.disponibile) vigila(registry, push)

  const server = createServer((req, res) => {
    void route(req, res, guard, registry, guardToken, () => port, opts.configDir ?? process.env['CLAUDE_CONFIG_DIR'], push)
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
  port: () => number, configDir?: string, push?: Push,
): Promise<void> {
  const motivo = guard.reject(req)
  if (motivo) {
    // Nessun dettaglio nel corpo: a chi bussa senza titolo non si spiega quale delle
    // difese l'ha fermato. Il motivo resta nei log del daemon — il commento lo diceva
    // da prima, ma la riga che lo scrive per davvero mancava: trovato debuggando dal
    // vivo un rifiuto da telefono senza nessun modo di sapere quale delle quattro
    // difese fosse stata.
    console.error(`[guard] ${motivo} — ${req.method ?? 'GET'} ${req.url ?? ''}`)
    send(res, 403, { error: 'vietato' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  const method = req.method ?? 'GET'

  try {
    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true })

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
        return send(res, 200, { disponibile: false, motivo: 'web-push non è installato', iscritti: 0 })
      }
      if (method === 'GET') {
        return send(res, 200, { disponibile: true, key: push.chiavePubblica, iscritti: push.quanti })
      }
    }
    if (method === 'POST' && path === '/api/push/subscribe') {
      if (!push?.disponibile) return send(res, 503, { error: 'notifiche non disponibili' })
      const b = await readJson<Subscription>(req)
      if (!b?.endpoint || !b.keys?.p256dh || !b.keys?.auth) {
        return send(res, 400, { error: 'iscrizione incompleta' })
      }
      push.iscrivi(b)
      return send(res, 200, { ok: true, iscritti: push.quanti })
    }
    if (method === 'POST' && path === '/api/push/unsubscribe') {
      if (!push?.disponibile) return send(res, 503, { error: 'notifiche non disponibili' })
      const b = await readJson<{ endpoint?: string }>(req)
      if (!b?.endpoint) return send(res, 400, { error: 'endpoint obbligatorio' })
      push.disiscrivi(b.endpoint)
      return send(res, 200, { ok: true, iscritti: push.quanti })
    }
    // Provare **davvero** che arriva, senza aspettare la fine di un turno vero. Non è
    // un lusso: fra il telefono e qui ci sono i server di Apple, la VAPID e la
    // schermata Home, e senza un modo di provarlo si scopre che non funziona la prima
    // volta che serviva.
    if (method === 'POST' && path === '/api/push/test') {
      if (!push?.disponibile) return send(res, 503, { error: 'notifiche non disponibili' })
      await push.manda({
        kind: 'done', title: 'STARK · prova',
        body: 'Se leggi questo, le notifiche sul telefono funzionano.', sessionId: '',
      })
      return send(res, 200, { ok: true, iscritti: push.quanti })
    }

    if (method === 'GET' && path === '/api/sessions') {
      return send(res, 200, { sessions: registry.list() })
    }

    // Il flusso dell'**elenco**, non di una sessione. Esiste perché senza, per sapere
    // che una chat diversa da quella aperta è cambiata, alla barra laterale non
    // restava che richiedere `/api/sessions` a ripetizione.
    if (method === 'GET' && path === '/api/stream') {
      return listStream(req, res, registry)
    }

    // Le conversazioni nate nella CLI. Non è una rotta sulle sessioni di STARK: sono
    // cose che STARK non ha ancora, e che l'SDK sa elencare al posto nostro.
    if (method === 'GET' && path === '/api/importable') {
      return send(res, 200, { sessions: await registry.importable() })
    }
    if (method === 'POST' && path === '/api/importable') {
      const body = await readJson<{ sessionId?: string }>(req)
      if (!body?.sessionId) return send(res, 400, { error: 'sessionId obbligatorio' })
      const esito = await registry.importSession(body.sessionId)
      return send(res, esito.ok ? 201 : 409, esito)
    }

    // ─── le impostazioni, che non sono di una sessione ma della macchina ─────
    if (method === 'GET' && path === '/api/settings') {
      // Anche in lettura, e non solo dopo un salvataggio: *quale* file di memoria si
      // sta guardando è la cosa che il browser non può sapere da sé, e la sezione
      // Agent lo mostra prima ancora che l'utente tocchi l'interruttore.
      const s = registry.settings()
      return send(res, 200, { settings: s, memoria: allineaMemoria(configDir, s.toolDescriptions) })
    }
    if (method === 'PUT' && path === '/api/settings') {
      const body = await readJson<Settings>(req)
      if (!body) return send(res, 400, { error: 'impostazioni malformate' })
      // Si risponde con ciò che è stato **davvero** scritto, non con ciò che è
      // arrivato: il registro butta via quello che non riconosce, e la UI deve
      // mostrare lo stato vero invece di quello che sperava di aver impostato.
      const salvate = registry.saveSettings(body)
      // Il file dell'agent segue la spunta subito, non al prossimo riavvio: una
      // preferenza che ha effetto «più tardi» è una preferenza che sembra rotta.
      const memoria = allineaMemoria(configDir, salvate.toolDescriptions)
      // L'esito torna al client perché è l'unica cosa che l'utente non può dedurre:
      // *quale* file è stato toccato, e se non si è potuto scriverlo.
      return send(res, 200, { settings: salvate, memoria })
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
      const body = await readJson<{ path?: string }>(req)
      if (!body?.path) return send(res, 400, { error: 'path obbligatorio' })
      const esito = await reveal(body.path)
      return send(res, esito.ok ? 200 : 404, esito)
    }
    // Apre un link con l'app dedicata invece che nel browser (F1). Il perimetro non
    // si fida del client: `url` deve appartenere davvero a un dominio che STARK
    // riconosce per `scheme`, altrimenti la rotta diventerebbe «lancia qualunque
    // schema il client chieda con qualunque URL» — un primitivo più potente di
    // quanto serva, e comodo da bucare proprio perché sembra innocuo.
    if (method === 'POST' && path === '/api/open-app') {
      const body = await readJson<{ url?: string; scheme?: string }>(req)
      if (!body?.url || !body.scheme) return send(res, 400, { error: 'url e scheme obbligatori' })
      let host: string
      try { host = new URL(body.url).hostname } catch { return send(res, 400, { error: 'url non valido' }) }
      if (serviceFor(host)?.scheme !== body.scheme) {
        return send(res, 400, { error: 'dominio non riconosciuto per questo schema' })
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
        agent: await diagnostics(configDir),
        nativeFolderPicker: await nativeFolderPickerAvailable(),
      })
    }

    if (method === 'POST' && path === '/api/sessions') {
      const body = await readJson<OpenSpec>(req)
      if (!body?.cwd) return send(res, 400, { error: 'cwd obbligatorio' })
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
        return send(res, 400, { error: `la cartella non esiste: ${body.cwd}` })
      }
      const id = await registry.open(body)
      return send(res, 201, { id, snapshot: registry.snapshot(id) })
    }

    // Gli allegati: `<ref>` è uno sha256, e il controllo vero lo rifà il registro —
    // qui la forma serve solo a non far entrare niente che somigli a un percorso.
    const b = /^\/api\/sessions\/([0-9a-f-]{8,})\/blob\/([0-9a-f]{64})$/.exec(path)
    if (b && method === 'GET') {
      const found = registry.attachment(b[1]!, b[2]!)
      if (!found) return send(res, 404, { error: 'allegato sconosciuto' })
      // Immutabile per costruzione: il nome **è** l'impronta del contenuto, quindi la
      // cache del browser non può servire una cosa per un'altra.
      res.writeHead(200, {
        'content-type': found.mediaType,
        'cache-control': 'private, max-age=31536000, immutable',
      })
      createReadStream(found.path).pipe(res)
      return
    }

    const m = /^\/api\/sessions\/([0-9a-f-]{8,})(\/[a-z]+)?$/.exec(path)
    if (m) {
      const id = m[1]!
      const sub = m[2] ?? ''

      if (method === 'GET' && sub === '') {
        const s = registry.snapshot(id)
        return s ? send(res, 200, { snapshot: s }) : send(res, 404, { error: 'sconosciuta' })
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
      if (method === 'DELETE' && sub === '') {
        const esito = await registry.remove(id)
        return send(res, esito.ok ? 200 : 404, esito)
      }
      if (method === 'POST' && sub === '/command') {
        // 32 MB: un prompt può portarsi dietro qualche schermata, e in base64 ognuna
        // pesa un terzo in più dei suoi byte. Il tetto resta perché un corpo senza
        // limite è il modo più semplice di finire la memoria di un daemon.
        const cmd = await readJson<Command>(req, 32 * 1024 * 1024)
        if (!cmd?.c) return send(res, 400, { error: 'comando malformato' })
        const esito = await registry.command(id, cmd)
        return send(res, esito.ok ? 200 : 409, esito)
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
    if (!path.startsWith('/api/') && serveUi(req, res, token)) return

    send(res, 404, { error: 'non trovato' })
  } catch (e) {
    send(res, 500, { error: String((e as Error).message ?? e) })
  }
}

// ─── flusso degli eventi ────────────────────────────────────────────────────

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
    res.write(`id: ${e.seq}\nevent: canonical\ndata: ${JSON.stringify(e)}\n\n`)
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
function isDir(path: string): boolean {
  try { return statSync(path).isDirectory() } catch { return false }
}

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
async function readJson<T>(req: IncomingMessage, max = 4 * 1024 * 1024): Promise<T | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    // Un corpo senza limite è un modo di finire la memoria del daemon.
    if (size > max) throw new Error('corpo troppo grande')
    chunks.push(c as Buffer)
  }
  if (chunks.length === 0) return null
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T } catch { return null }
}

function closeServer(server: Server): Promise<void> {
  return new Promise(r => { server.closeAllConnections?.(); server.close(() => r()) })
}
