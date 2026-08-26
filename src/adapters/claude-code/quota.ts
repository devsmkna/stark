// Da «quanto ne hai consumata» del piano al vocabolario canonico di STARK.
//
// Sta in un file suo, e puro, per la stessa ragione di `translate.ts`: questa
// traduzione si verifica su una cattura vera senza aprire nessuna sessione, quindi
// senza spendere niente. La cattura è quella del 26 agosto 2026, ed è in
// `offline-check.ts`.
//
// Il dato arriva dal metodo `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`
// dell'SDK — sì, si chiama davvero così, ed è l'SDK stesso a dire che la forma può
// cambiare. Vale comunque la regola del progetto: se una cosa ufficiale c'è, si usa
// quella. Il prezzo dell'instabilità si paga qui e solo qui: se un giorno la forma
// cambia, questa funzione restituisce un elenco vuoto e il pannellino dice che non lo
// sa, invece di mostrare numeri inventati. Nessun'altra parte di STARK se ne accorge.

import type { QuotaWindow } from '../../core/events.ts'

type Raw = Record<string, unknown>

/**
 * Le finestre, in ordine di lettura: prima la sessione, poi la settimana, poi le
 * settimane ristrette a un modello.
 *
 * Cosa **non** si fa qui: inventare. Una finestra che il piano manda a `null` non
 * diventa uno zero, diventa un campo assente; e le chiavi che non conosciamo non si
 * indovinano — il piano ne manda anche in codice (`nimbus_quill`, `tangelo`), che non
 * significano niente per chi guarda e resterebbero righe senza nome.
 */
export function quotaWindows(usage: unknown): QuotaWindow[] {
  const u = usage as Raw | null | undefined
  if (!u || u['rate_limits_available'] === false) return []
  const rl = u['rate_limits'] as Raw | null | undefined
  if (!rl) return []

  const out: QuotaWindow[] = []
  const session = window_(rl['five_hour'], 'session')
  if (session) out.push(session)
  const weekly = window_(rl['seven_day'], 'weekly')
  if (weekly) out.push(weekly)

  // Le settimane per modello arrivano da due parti: due chiavi fisse storiche e un
  // array che il server riempie da solo. Si leggono tutte e due e si tiene un nome
  // solo — `model_scoped` è quello che porta l'etichetta scritta dal server, quindi
  // in caso di doppione vince l'ultimo che passa di qui... e infatti passa dopo.
  const perModello = new Map<string, QuotaWindow>()
  const fisse: [string, string][] = [['seven_day_opus', 'Opus'], ['seven_day_sonnet', 'Sonnet']]
  for (const [chiave, nome] of fisse) {
    const w = window_(rl[chiave], 'weekly', nome)
    if (w) perModello.set(nome.toLowerCase(), w)
  }
  const scoped = rl['model_scoped']
  if (Array.isArray(scoped)) {
    for (const m of scoped) {
      const nome = String((m as Raw)?.['display_name'] ?? '').trim()
      if (!nome) continue
      const w = window_(m, 'weekly', nome)
      if (w) perModello.set(nome.toLowerCase(), w)
    }
  }
  out.push(...perModello.values())
  return out
}

function window_(raw: unknown, kind: QuotaWindow['kind'], scope?: string): QuotaWindow | null {
  const r = raw as Raw | null | undefined
  if (!r || typeof r !== 'object') return null
  const used = num(r['utilization'] ?? r['percent'])
  const resetsAt = ms(r['resets_at'])
  // Una finestra che non dice né quanto è piena né quando si riapre non è una riga:
  // è una riga vuota. Meglio non mostrarla che mostrarla con due trattini.
  if (used === undefined && resetsAt === undefined) return null
  return {
    kind,
    ...(scope !== undefined ? { scope } : {}),
    ...(used !== undefined ? { used } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** ISO 8601 → epoch ms. Il piano lo manda come stringa; il modello canonico usa i ms
 *  ovunque, e convertire qui è ciò che evita due convenzioni nella stessa UI. */
function ms(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v
  if (typeof v !== 'string' || !v) return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : undefined
}
