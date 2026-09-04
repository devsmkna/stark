# Rinominare i progetti (contenitori)

## Problema

Un "progetto" in STARK è oggi il nome della cartella di lavoro (`cwd`), mostrato
dappertutto tramite `project(cwd)` (`ui/src/lib/view.ts`), che ne prende l'ultimo
segmento del percorso. Non c'è modo di dargli un nome diverso: chi ha cartelle chiamate
`api`, `web`, `worker-2` per tre repository diversi li vede etichettati così ovunque
nella UI, indipendentemente da cosa contengono davvero.

## Cosa cambia, cosa no

- **Cambia**: il testo mostrato per un progetto, ovunque compaia.
- **Non cambia**: l'identità di un progetto resta la cartella. Raggruppamento in
  sidebar, ordine alfabetico dei colori (`colours()` in `view.ts`), stato
  aperto/chiuso di un gruppo (`store.collapse`), ordine scelto dall'utente
  (`store.order`) — tutto continua a essere calcolato sul nome **grezzo** della
  cartella (`project(cwd)`), esattamente come oggi. Rinominare non deve spostare un
  gruppo, non deve fargli cambiare colore, non deve alterare lo stato aperto/chiuso.

## Dati

`settings.projects[cwd]` (già esistente, `{ colour?, muted?, profile? }`) guadagna un
campo:

```ts
projects: Record<string, { colour?: number; muted?: boolean; profile?: string; name?: string }>
```

Stessa persistenza di colore/silenzio/profilo: sta nel daemon (`settings.json`), non
nel browser — è un fatto del progetto, non del dispositivo (vedi CLAUDE.md, sezione
impostazioni). `name` assente o stringa vuota vuol dire "usa il nome della cartella".

## Lettura del nome

Nuova funzione pura in `ui/src/lib/view.ts`, accanto a `project()`:

```ts
export function projectName(
  cwd: string | undefined,
  overrides: Record<string, { name?: string }> | undefined,
): string {
  const custom = cwd ? overrides?.[cwd]?.name?.trim() : undefined
  return custom || project(cwd)
}
```

`project(cwd)` resta invariata e **non sparisce**: continua a essere la funzione da
usare ovunque serva l'identità grezza (chiavi di raggruppamento, `colours()`,
`store.collapse`, `store.order`, il lookup nella palette dei colori). `projectName()`
è per il testo mostrato all'utente, e basta.

## Dove cambia il testo mostrato

Ogni chiamata a `project(cwd)` fatta per **mostrare** un nome (non per identità/colore)
diventa `projectName(cwd, store.settings?.projects)`:

- `Sidebar.svelte:558` — intestazione del gruppo (`section.proj` resta l'identità per
  drag&drop/collapse/ordine; il testo mostrato legge `projectName` dalla `cwd` della
  prima riga del gruppo, `section.rows[0]?.cwd`)
- `Palette.svelte` (⌘K) — riga del risultato
- `Conversation.svelte` — titolo di fallback e colore (colore resta raw, titolo mostrato usa `projectName`)
- `Dock.svelte` — le tre etichette "cartella" nel composer
- `NewChat.svelte` — elenco cartelle recenti e riga di continuazione (il colore del
  pallino resta raw, l'etichetta accanto usa `projectName`)
- `SplitPick.svelte` — sottotitolo della riga
- `Board.svelte` — opzioni del selettore progetto
- `Todo.svelte` — etichetta del progetto corrente e delle sezioni
- `Settings.svelte` — riga di "Projects" (`o-t`), righe di "Stay quiet for", elenco
  "Journal"/"Import"
- `store.svelte.ts:588` — titolo delle notifiche di chiamata

Non cambia: `view.ts` internamente (`colours()`), `Sidebar.svelte` per le chiavi di
`perProgetto`/`needsCounts`/`tree`/`store.collapse`/`store.order`, i lookup nella
`palette` dei colori ovunque compaiano (`palette.get(project(...))`).

## Come si rinomina

In Settings → Projects, doppio click sul nome (`o-t`) — stesso gesto già usato per
rinominare una chat (`Conversation.svelte`, doppio click sul titolo). Il testo diventa
un campo scrivibile; Invio o perdere il focus salva (`store.setProject(cwd, { name })`,
trimmato; stringa vuota salva `name: undefined`, che azzera l'override e la riga torna
a mostrare il nome della cartella); Escape annulla senza salvare.

## Limite noto (esistente, non introdotto da questa modifica)

Due cartelle diverse con lo stesso nome finale (es. `~/lavoro/api` e
`~/altro/api`) sono già oggi fuse in un solo gruppo di sidebar, perché
l'identità è la stringa del nome e non il percorso intero. Rinominare una delle due
in quel caso ha effetto indefinito su quale entry di `settings.projects` "vince"
visivamente nel gruppo — non è un problema che questa modifica introduce, ed è fuori
scope risolverlo qui (richiederebbe cambiare l'identità dei gruppi da nome a percorso,
un refactor più ampio che tocca `store.collapse`, `store.order` e `colours()`).

## Fuori scope

- Nessuna validazione di unicità sul nome scelto: è un'etichetta, non un identificatore.
- Nessun limite di lunghezza esplicito oltre al trim degli spazi.
- Non tocca il meccanismo di colore, silenzio o profilo per progetto.
