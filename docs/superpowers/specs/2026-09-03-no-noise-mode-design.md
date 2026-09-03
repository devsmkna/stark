# No-noise mode (modalità compatta)

## Problema

Con tante finestre di STARK aperte insieme, header, barra in basso e righe della
sidebar occupano più spazio di quanto serva. Serve una modalità che li rimpicciolisca
tutti, attivabile al volo con una scorciatoia, per chi tiene più finestre aperte.

## Meccanismo di stato

Stessa forma del tema (`ui/src/lib/theme.svelte.ts`), per la stessa ragione: è una
proprietà del **dispositivo**, non del progetto o della chat.

Nuovo file `ui/src/lib/density.svelte.ts`:

```ts
export class Densifier {
  compact = $state<boolean>(false)   // localStorage['stark.density'], 'compact' | assente
  toggle(): void
  set(v: boolean): void
  #apply(): void   // data-density="compact" su document.documentElement, o lo toglie
}
```

Istanziato in `Store` come `store.density`, accanto a `store.theme`.

## Attivazione

- Nuova voce in `AZIONI` (`ui/src/lib/actions.ts`): id `density`, label "Toggle
  no-noise mode", hint "Shrink the header, status bar and sidebar rows.", default
  `mod+shift+m`.
- In `App.svelte`, `esegui()` chiama `store.density.toggle()` per l'id `density`.
- Voce corrispondente nel pannello Settings dove già vivono `board`/`sidebar`
  (stessa lista, stesso meccanismo di riassegnazione già esistente per le
  scorciatoie).

## Cosa cambia in modalità compatta

Tutto via CSS, selettore `:global(html[data-density="compact"]) ...` dentro gli
`<style>` scoped già esistenti di ogni componente. Nessuno stato nuovo da passare ai
componenti: la classe/attributo sta sulla radice, i componenti guardano la CSS, non
JS.

- **Header conversazione** (`.bar` in `Conversation.svelte`): padding e font ridotti.
  Il testo "N file · M comandi" sparisce, resta solo l'icona — stessa condizione già
  usata sotto gli 860px di larghezza (`store.narrow`), estesa a `store.density.compact`.
  Il bottone "copy debug info" si nasconde.
- **Barra composer/status in basso** (`Dock.svelte`): padding e font ridotti. Nel
  badge del modello corrente (`.pk-meta`) spariscono prezzo (`$`) e finestra di
  contesto; resta solo il nome del modello.
- **Sidebar** (`Sidebar.svelte`): righe più basse, meno padding verticale. Nessun
  testo sparisce qui, solo densità.

Non tocca: contenuto della conversazione (turni, testo, tool), pannello agente,
board, impostazioni.

## Persistenza

`localStorage`, chiave `stark.density`, valori `'compact'` o assente (default: non
compatto). Letto alla costruzione di `Densifier`, come `Themer`.

## Fuori scope

- Nessuna densità intermedia: solo acceso/spento.
- Non tocca la soglia di `store.narrow` (860px) né la logica mobile: sono
  indipendenti, e uno schermo stretto può essere sia compatto sia largo di testo
  (`textSize`).
- Nessuna opzione per scegliere *quali* pezzi restringere: è un interruttore solo.
