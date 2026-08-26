// I servizi esterni per cui STARK sa aprire l'app dedicata invece del browser
// (F1, Notion, 25 agosto 2026). Sta in `core/` e non nella UI né nel daemon perché
// serve in **due** posti che devono dire la stessa cosa: `markdown.ts` decide se
// disegnare il bottone, `daemon/launch.ts` decide se onorarlo — la stessa
// disattenzione di `activity.ts` (due copie che divergono al primo caso limite).
//
// Perimetro volutamente stretto e non un'euristica sui domini: un servizio si
// aggiunge qui, un servizio alla volta, verificando che l'app lo consenta davvero —
// non indovinando dal nome del dominio.

export type ExternalService = { scheme: string; label: string }

const SERVICES: Record<string, ExternalService> = {
  'notion.so': { scheme: 'notion', label: 'Notion' },
  'www.notion.so': { scheme: 'notion', label: 'Notion' },
  'app.notion.com': { scheme: 'notion', label: 'Notion' },
}

/** Il servizio per questo hostname, se STARK lo conosce. Case-insensitive: un host
 *  arriva già così da `new URL()`, ma il mittente del testo non è detto lo sia. */
export function serviceFor(hostname: string): ExternalService | undefined {
  return SERVICES[hostname.toLowerCase()]
}

/**
 * L'URL nello schema dell'app, dallo stesso URL http(s). Verificato dal vivo (26
 * agosto 2026): per Notion basta scambiare lo schema, l'host e il percorso restano
 * identici — non è un'assunzione generica su come *ogni* servizio si comporterebbe,
 * è quello che si è visto aprire la pagina giusta due volte su due.
 */
export function appUrlFor(href: string, scheme: string): string {
  return href.replace(/^https?:/, `${scheme}:`)
}
