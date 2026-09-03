// Le viste: una disposizione di pannelli che ha un nome e resta in elenco.
//
// Prima esisteva **un albero solo** — quello che stavi guardando. Aprire un'altra chat
// dalla barra laterale ci scriveva sopra (`replaceLeaf` sul pannello a fuoco), quindi
// affiancare due conversazioni era uno stato dello schermo, non una cosa: bastava un
// clic altrove per non ritrovarlo più. Da qui in avanti uno split **è** una cosa, con
// una riga sua in cima all'elenco, e la chat singola torna a essere una chat singola.
//
// Cosa sta qui e cosa no: qui c'è il registro — l'elenco, il nome, quale è attiva, e la
// scrittura nel `localStorage`. La **regola** che decide quando una vista nasce e quando
// muore sta nello Store (`#scriviAlbero`), perché dipende da `SPLIT_PICK`, che è roba
// dello Store: importarlo da qui vorrebbe dire un ciclo fra i due moduli per una
// costante.
//
// Nel browser e non sul daemon, come il tema e come il layout che c'era prima: «su
// questo schermo tengo queste due chat affiancate» è un fatto del dispositivo, non del
// progetto. Dentro finiscono solo id di chat e proporzioni, mai snapshot — quelli si
// rileggono dal daemon all'apertura.

import type { LayoutNode } from './layout.ts'

/** Una disposizione salvata. `focused` è quale pannello aveva il fuoco: rientrare in
 *  una vista e ritrovarsi a fuoco su un pannello a caso sarebbe rientrarci a metà. */
export type Vista = {
  /** Quello che finisce in `/view/<id>`. */
  id: string
  name: string
  tree: LayoutNode
  focused: string | null
}

/** Il caso «una chat sola»: non è una vista, non ha nome e non sta in elenco, ma va
 *  ricordato lo stesso — se no un ricaricamento fuori da ogni vista riparte vuoto. */
export type Singola = { tree: LayoutNode; focused: string | null }

type Salvato = { viste: Vista[]; active: string | null; single: Singola | null }

const CHIAVE = 'stark.views'
/** La chiave di prima. Si legge una volta sola, in migrazione, e poi si cancella: due
 *  chiavi che descrivono la stessa cosa sono due verità che possono divergere. */
const CHIAVE_VECCHIA = 'stark.layout'

export class Viste {
  lista = $state<Vista[]>([])
  /** Quale vista stai guardando. `null` = nessuna, cioè chat singola o niente. */
  active = $state<string | null>(null)
  single = $state<Singola | null>(null)

  get attiva(): Vista | undefined {
    return this.active ? this.lista.find(v => v.id === this.active) : undefined
  }

  /** L'albero da mostrare adesso: quello della vista attiva, o quello della singola. */
  get tree(): LayoutNode | null {
    return this.attiva?.tree ?? this.single?.tree ?? null
  }

  get focused(): string | null {
    return this.attiva?.focused ?? this.single?.focused ?? null
  }

  trova(id: string): Vista | undefined { return this.lista.find(v => v.id === id) }

  /**
   * Crea una vista e la rende attiva. Il nome arriva già fatto da chi chiama, perché
   * dipende dai titoli delle chat — che li conosce lo Store, non questo modulo.
   */
  crea(tree: LayoutNode, focused: string | null, name: string): Vista {
    const v: Vista = { id: nuovoId(), name, tree, focused }
    // In testa: l'ultima creata è quella che stai per usare, e cercarla in fondo a un
    // elenco che cresce sarebbe cercarla.
    this.lista = [v, ...this.lista]
    this.active = v.id
    this.salva()
    return v
  }

  /** Riscrive l'albero della vista attiva, o della singola se non ce n'è una. */
  scrivi(tree: LayoutNode | null, focused: string | null): void {
    const v = this.attiva
    if (v) {
      if (!tree) { this.elimina(v.id); return }
      this.lista = this.lista.map(x => (x.id === v.id ? { ...x, tree, focused } : x))
    } else {
      this.single = tree ? { tree, focused } : null
    }
    this.salva()
  }

  rinomina(id: string, name: string): void {
    const pulito = name.trim()
    if (!pulito) return
    this.lista = this.lista.map(v => (v.id === id ? { ...v, name: pulito } : v))
    this.salva()
  }

  /** Toglie la vista. Se era quella attiva, `active` torna a `null`: chi chiama decide
   *  cosa mostrare al suo posto — questo modulo non apre e non chiude pannelli. */
  elimina(id: string): void {
    this.lista = this.lista.filter(v => v.id !== id)
    if (this.active === id) this.active = null
    this.salva()
  }

  /** Esce dalla vista attiva senza toccarla: resta in elenco, com'era. */
  esci(): void {
    if (this.active === null) return
    this.active = null
    this.salva()
  }

  /** Entra in una vista. Falso se quell'id non c'è — un indirizzo può nominarne una
   *  che su questo dispositivo non esiste, e chi chiama deve poterlo dire. */
  entra(id: string): boolean {
    if (!this.trova(id)) return false
    this.active = id
    this.single = null
    this.salva()
    return true
  }

  // ─── persistenza ──────────────────────────────────────────────────────────

  salva(): void {
    try {
      const dati: Salvato = { viste: $state.snapshot(this.lista) as Vista[], active: this.active, single: $state.snapshot(this.single) as Singola | null }
      if (dati.viste.length === 0 && !dati.single) localStorage.removeItem(CHIAVE)
      else localStorage.setItem(CHIAVE, JSON.stringify(dati))
    } catch { /* modalità privata: non sopravvive al ricaricamento, e va bene */ }
  }

  /**
   * Legge il salvataggio, migrando quello di prima se c'è.
   *
   * La migrazione decide dal **numero di foglie**, non da un flag: un albero salvato
   * con più di una foglia era già uno split, e diventa una vista; con una sola era una
   * chat aperta, e diventa `single`. Il nome della vista migrata lo passa chi chiama,
   * per la stessa ragione di `crea()` — qui i titoli non si conoscono.
   */
  carica(nomeMigrata: (tree: LayoutNode) => string, foglieVere: (tree: LayoutNode) => number): void {
    try {
      const raw = localStorage.getItem(CHIAVE)
      if (raw) {
        const d = JSON.parse(raw) as Salvato
        this.lista = Array.isArray(d.viste) ? d.viste.filter(sanaVista) : []
        this.active = typeof d.active === 'string' && this.trova(d.active) ? d.active : null
        this.single = d.single?.tree ? d.single : null
        return
      }
    } catch { /* JSON corrotto o `localStorage` assente: si riparte pulito */ }

    try {
      const raw = localStorage.getItem(CHIAVE_VECCHIA)
      if (!raw) return
      const vecchio = JSON.parse(raw) as { tree?: LayoutNode; focused?: string | null }
      if (vecchio?.tree) {
        if (foglieVere(vecchio.tree) > 1) {
          this.lista = [{ id: nuovoId(), name: nomeMigrata(vecchio.tree), tree: vecchio.tree, focused: vecchio.focused ?? null }]
          this.active = this.lista[0]!.id
        } else {
          this.single = { tree: vecchio.tree, focused: vecchio.focused ?? null }
        }
      }
      localStorage.removeItem(CHIAVE_VECCHIA)
      this.salva()
    } catch { /* idem */ }
  }
}

/** Una vista scritta a mano nel `localStorage` può contenere qualunque cosa: si tiene
 *  solo ciò che ha la forma giusta, invece di far esplodere l'avvio. */
function sanaVista(v: unknown): v is Vista {
  if (!v || typeof v !== 'object') return false
  const x = v as Partial<Vista>
  return typeof x.id === 'string' && typeof x.name === 'string' && !!x.tree && typeof x.tree === 'object'
}

/** `randomUUID` non c'è su un'origine non sicura (http su un hostname che non è
 *  `localhost` — cioè l'accesso dalla LAN, che STARK consente). Il ripiego non deve
 *  essere crittografico: serve solo che due viste create sullo stesso dispositivo non
 *  collidano. */
function nuovoId(): string {
  try { return crypto.randomUUID() } catch { /* origine non sicura */ }
  return `${Date.now().toString(16)}-${Math.floor(Math.random() * 0xffffffff).toString(16)}`
}
