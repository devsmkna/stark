// Serve la UI compilata, con il perimetro di sicurezza addosso come tutto il resto.
//
// Il nodo da sciogliere: il guard chiede il token a ogni richiesta, ma il browser
// scarica gli script e i fogli di stile della pagina **senza** poter aggiungere
// intestazioni. Se non si facesse niente, la prima pagina passerebbe (il token è nel
// suo indirizzo) e subito dopo ogni sottorisorsa prenderebbe 403: schermo bianco.
//
// La soluzione è un cookie messo servendo la pagina, che il browser poi allega da solo.
// È esattamente il vettore CSRF da cui di solito ci si guarda, e qui è chiuso tre volte:
// `SameSite=Strict` fa sì che non parta nemmeno per richieste che nascono altrove, e
// restano in piedi i controlli su `Origin` e `Host`. `HttpOnly` perché nessuno script
// della pagina ha motivo di leggerlo.

import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, resolve, sep, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/dist')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  // Il tipo giusto conta davvero qui: servito come `application/octet-stream` il
  // manifest viene ignorato, e su iOS «Aggiungi alla schermata Home» è il passaggio
  // senza il quale le notifiche push non esistono proprio.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

export function uiIsBuilt(): boolean {
  return existsSync(join(UI_DIR, 'index.html'))
}

/** true se la richiesta è stata servita. */
/**
 * `token` è la credenziale **con cui questa richiesta è passata**, non quella della
 * macchina: da quando un telefono ne ha una sua e revocabile (`telefono.ts`), piantare
 * sempre quella globale vorrebbe dire consegnargli la chiave maestra al primo
 * caricamento — cioè annullare la revoca prima ancora di averla scritta.
 *
 * `durevole` allunga la vita del cookie per i telefoni. Ventiquattr'ore vanno bene per
 * una scheda sul computer, dove il token sta comunque nell'indirizzo e nel deposito
 * locale; su un telefono no — la **prima** richiesta è l'HTML nudo, che non ha
 * intestazioni né JavaScript, quindi vive solo del cookie: alla sua scadenza il
 * segnalibro tornerebbe a rispondere 403 e bisognerebbe rifare il codice dal computer.
 * A difendere non è la scadenza ma la revoca (decisione dell'utente, 28 agosto 2026):
 * togliere il dispositivo dall'elenco lo ferma subito, cookie o no.
 */
export function serveUi(
  req: IncomingMessage, res: ServerResponse, token: string, durevole = false,
): boolean {
  if ((req.method ?? 'GET') !== 'GET') return false
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (!uiIsBuilt()) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('La UI non è compilata. Esegui: npm run ui:build\n')
    return true
  }

  const file = resolveInside(url.pathname)
  // Una rotta sconosciuta ricade sulla pagina: è una app a pagina sola, e un
  // ricaricamento su /qualcosa deve riaprire l'app, non dare 404.
  const target = file ?? join(UI_DIR, 'index.html')
  const isPage = extname(target) === '.html'
  // Il service worker e il manifest **non** sono asset immutabili come i bundle con
  // l'impronta nel nome: il browser deve poterli ri-verificare, o una PWA salvata su
  // homescreen (iOS soprattutto) tiene la UI vecchia per sempre. `sw.js` immutable
  // non viene mai ricontrollato, quindi il nuovo service worker non si installa mai.
  const isRuntime = isPage || basename(target) === 'sw.js' || basename(target) === 'manifest.webmanifest'

  const headers: Record<string, string> = {
    'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
    // Gli asset hanno l'impronta nel nome, quindi si possono tenere per sempre.
    // La pagina no: cambia a ogni build e deve essere richiesta ogni volta. Stessa
    // regola per service worker e manifest: il primo deve poter cambiare codice senza
    // aspettare la scadenza della cache, il secondo senza aspettare che iOS se ne
    // accorga da solo.
    'cache-control': isRuntime ? 'no-store' : 'public, max-age=31536000, immutable',
    // Il primo caricamento porta il token in query string (`/?token=…`, ed è così che
    // funziona l'icona sulla schermata Home: iOS congela `start_url`). Senza questo,
    // un link cliccato da dentro STARK se lo porterebbe dietro nel `Referer` fino a un
    // sito qualunque. Su loopback era teorico; con un dominio pubblico non lo è più.
    'referrer-policy': 'no-referrer',
  }
  if (isPage) {
    // `Secure` mancava. Su `http://127.0.0.1` non serviva: il browser tratta il
    // loopback come contesto attendibile anche senza TLS (stessa ragione per cui
    // `Notification`/`AudioContext` ci funzionano senza HTTPS, misurato il 24 agosto).
    // Ma da telefono si passa da un proxy Tailscale che **è** HTTPS per davvero, e
    // Safari su una pagina sicura può scartare un cookie senza `Secure` invece di
    // tenerlo — candidato concreto al «vietato» dopo un refresh che si è visto dal
    // vivo il 26 agosto (domanda aperta §5 di "Continua da telefono": la credenziale
    // sul telefono non regge quanto dovrebbe). Aggiungerlo non toglie nulla al
    // loopback, che resta comunque un contesto attendibile.
    // 400 giorni è il tetto che i browser applicano comunque a un cookie persistente:
    // chiederne di più non lo allunga, lo accorcia a quello.
    const vita = durevole ? 400 * 86400 : 86400
    headers['set-cookie'] =
      `stark=${token}; Path=/; SameSite=Strict; HttpOnly; Secure; Max-Age=${vita}`
  }

  res.writeHead(200, headers)
  createReadStream(target).pipe(res)
  return true
}

/**
 * Traduce un percorso della richiesta in un file dentro `ui/dist`, o niente.
 * Il controllo finale sul prefisso non è ridondante rispetto a `normalize`: è ciò che
 * regge se domani qualcuno tocca questa funzione e reintroduce un `..` per sbaglio.
 */
function resolveInside(pathname: string): string | null {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const candidate = resolve(join(UI_DIR, clean))
  if (candidate !== UI_DIR && !candidate.startsWith(UI_DIR + sep)) return null
  if (!existsSync(candidate) || !statSync(candidate).isFile()) return null
  return candidate
}
