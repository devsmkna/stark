# Layout multi-pannello (split view)

## Perché

Oggi STARK tiene una sola chat aperta a fuoco: `Store.selected`/`snap`/`link`/`view` sono
campi singoli, e `App.svelte` mostra sempre e solo quella. L'utente vuole poter aprire più
chat affiancate nella stessa pagina, con pannelli ridimensionabili trascinati liberamente
(orizzontale o verticale), come un editor a piastrelle (VS Code).

## Cosa NON cambia

- L'indirizzo resta `/chat/<id>[/effects]` e continua a seguire **il pannello a fuoco**
  (l'ultimo su cui si è cliccato/scritto). Nessun formato nuovo di indirizzo.
- Sotto la soglia stretta (860px) il layout multi-pannello è **ignorato del tutto**: si vede
  solo il pannello a fuoco, esattamente come oggi (§8 di `ui-schermate.md`).
- Una chat aperta in due pannelli contemporaneamente **non è permessa**: trascinare una chat
  già aperta altrove sposta quel pannello (o lo porta a fuoco) invece di duplicarlo — evita
  due sottoscrizioni SSE sulla stessa sessione.
- Il daemon non cambia: N pannelli aperti vogliono dire N chiamate a `api.stream()`, lo
  stesso meccanismo per-sessione di oggi, chiamato più volte invece di modificato.

## Modello dati

### `Pane` (nuovo, `ui/src/lib/pane.svelte.ts`)

Estrae la logica già dentro `Store.select()`/`back()` in una classe riusabile per chat:

```ts
class Pane {
  readonly chatId: string
  snap = $state<SessionSnapshot | null>(null)
  link = $state<LinkStatus>('connecting')
  view = $state<'chat' | 'effects'>('chat')
  // apre lo snapshot iniziale + sottoscrive lo stream; chiude lo stream
  open(api: Api): Promise<void>
  close(): void
}
```

### `LayoutNode` (nuovo, `ui/src/lib/layout.ts`, funzioni pure — niente Svelte)

Albero ricorsivo:

```ts
type LayoutNode =
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; dir: 'row' | 'col'; children: LayoutNode[]; sizes: number[] }
```

Funzioni pure testabili senza DOM: `splitLeaf(tree, targetPaneId, dir, newPaneId)`,
`closeLeaf(tree, paneId)` (collassa lo split se resta un figlio solo), `resize(tree, path, sizes)`.

### `Store` (modifiche)

- `panes: Map<string, Pane>` sostituisce i campi piatti `snap`/`link`/`view` per la parte
  multi-pannello. `Store.selected` resta col significato di oggi — «la chat a fuoco» — ma è
  garantito corrispondere sempre a una foglia di `layout`.
- `layout: LayoutNode` — persistito su `localStorage['stark.layout']` come
  `{tree, focused}` (solo id di chat, mai snapshot).
- Nuovi metodi: `openPane(chatId)`, `closePane(chatId)`, `splitPane(targetPaneId, dir, newChatId)`,
  `resizePane(...)`, `focusPane(chatId)` (aggiorna `selected` + indirizzo, stessa `go()` di oggi).

## Interazione

- Righe della sidebar diventano `draggable`; `dragstart` porta l'id della chat.
- Ogni pannello ha zone di drop: **centro** → apre quella chat in quel pannello (sostituendo
  la foglia, spostando la chat se era aperta altrove); **bordo** (striscia ~25% su uno dei
  quattro lati) → split in quella direzione. Drop fuori da ogni pannello o su una striscia
  troppo stretta: nessun cambiamento, silenzioso (stesso principio del Finder nativo
  annullato — non è un errore).
- Divisori fra fratelli di uno stesso split sono trascinabili, aggiornano `sizes`.
- Chiusura: bottone `×` nell'header del pannello (distinto dal cestino della sidebar, che
  cancella la chat per sempre). Toglie la foglia, collassa il genitore se resta un figlio
  solo, ferma lo stream di quel `Pane`. L'ultimo pannello non si chiude mai da solo: sotto 1
  foglia si torna allo stato vuoto di oggi.

## Rendering

`Conversation.svelte` prende già `snap` come prop — non legge `store.snap` da sé. I punti da
rendere pannello-consapevoli:

- `store.row`/`store.live` (oggi derivati da `store.selected`) diventano locali dentro
  `Conversation`: `store.rows.find(r => r.id === snap.sessionId)` invece di `store.row`.
- I comandi lanciati da dentro un pannello (`sleep`, `setMode`, `rename`) passano
  `id={snap.sessionId}` esplicito — `Store.send()` accetta già un id opzionale, nessuna
  riscrittura della firma.

`Workspace.svelte` (nuovo) renderizza `store.layout` ricorsivamente: foglia → header (titolo,
`×`, switch chat/effetti) + `<Conversation>` o `<Effects>` sorgente da `store.panes.get(paneId)`;
split → flex `row`/`col` coi divisori. Ogni pannello ha il proprio switch conversazione/effetti
e la propria casella di scrittura — sono mini-conversazioni complete e indipendenti.

Sullo schermo stretto, `App.svelte` prende `snap`/`link` da `store.panes.get(store.selected)`
invece dei campi piatti di oggi: stesso template, `layout` ignorato.

## Persistenza

- `localStorage['stark.layout']` = `{tree, focused}`.
- All'avvio, dopo il primo elenco (stesso cancello `#partita` di `#apriDaIndirizzo`), si
  riconcilia: foglie con `chatId` non più in `rows` vengono tolte (`closeLeaf`), poi si apre
  un `Pane` + stream per ogni foglia superstite. Zero foglie superstiti → stato vuoto di oggi.
- Ogni split/chiusura/focus salva subito; il ridimensionamento salva solo al rilascio del
  divisore (`pointerup`), non a ogni frame del trascinamento.

## Testing

- `layout.ts` è puro: `splitLeaf`/`closeLeaf`/`resize` testabili senza Svelte né DOM, stesso
  stile dei test esistenti in `spike/`/`tools/` per logica pura.
- `Pane` testabile isolando `Api` (già iniettabile, `Store` lo fa oggi con `Api`).
- Verifica dal vivo (Playwright, come le rifiniture mobile già documentate in CLAUDE.md):
  split orizzontale e verticale, drag da sidebar, chiusura che collassa, ricaricamento che
  ricostruisce il layout, schermo stretto che lo ignora.

## Fuori scope (non in questo giro)

- Salvare il layout sul daemon (resta nel browser, come tema e font size — è del
  dispositivo, non del progetto).
- Animazioni di transizione durante split/chiusura.
- Un limite al numero di pannelli: nessuno imposto, ma non misurato oltre 4-5 sullo stesso
  schermo.
