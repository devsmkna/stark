# Scorciatoie da tastiera

Come funzionano le scorciatoie di STARK, dove vivono, e perché sono fatte così.

## Le azioni

Le azioni con una scorciatoia stanno in **`ui/src/lib/actions.ts`** — il registro
`AZIONI`. Ogni voce ha:

| campo | cosa |
|---|---|
| `id` | il nome dell'azione, che `esegui()` in `App.svelte` usa per fare la cosa |
| `label` | come si chiama nelle impostazioni |
| `hint` | cosa fa, detto a chi guarda le impostazioni e non il codice |
| `default` | la combinazione di partenza, in forma canonica |

Oggi:

| azione | default | cosa fa |
|---|---|---|
| `palette` | `mod+k` | apre la palette (salta a una chat per nome/progetto) |
| `board` | `mod+l` | apre o chiude la board del progetto |

La sezione **Shortcuts** nelle impostazioni itera su `AZIONI`: quindi una scorciatoia
nuova è una voce in quel registro e nient'altro — la schermata la disegna da sé.

## La forma canonica: `mod`

Su disco e nel registro si scrive **`mod+k`**, non `cmd+k` o `ctrl+k`. La ragione è che
le impostazioni stanno nel daemon (una macchina), ma la tastiera è del **dispositivo**
che guarda: un Mac e un PC che aprono lo stesso STARK devono premere tasti diversi per
la stessa cosa. `mod` vuol dire ⌘ su Mac e Ctrl altrove (`isMac()` in `shortcuts.ts`).

Il parsing, il confronto e la resa a schermo stanno in **`ui/src/lib/shortcuts.ts`**,
puro di proposito (niente Svelte/DOM) perché è lì che stanno i bug veri: `mod` che
cambia tasto, una combinazione scritta male, due azioni che si prendono la stessa.

## I tasti vietati

`escape` non si può assegnare (chiude menu, modali e la cattura stessa — toglierlo
sarebbe togliere l'unica via d'uscita che vale ovunque), e nemmeno i modificatori da
soli (`shift`, `control`, `alt`, `meta`, …), che sono metà di una scorciatoia, non una.

## Conflitti

Se due azioni condividono la stessa combinazione, STARK **lo dice** (Settings mostra
«Two actions share this shortcut») invece di rifiutare in silenzio: chi assegna una
combinazione già presa deve vedere con cosa ha sbattuto. Vince la prima nell'elenco.

## Quando scatta

Dentro una casella di testo una scorciatoia **senza `mod` non scatta**: una lettera
nuda è testo, e prendersela vorrebbe dire che scrivendo un prompt si aprono finestre
da sole. Con `mod` invece scatta eccome (⌘K deve funzionare proprio nella casella, dove
si sta il 90% del tempo).

## Tornare al default

Tornare al default vuol dire **togliere** la voce da `settings.json`, non scriverci
sopra il valore di partenza: se un domani il default cambia, chi non l'ha mai toccata
deve ricevere il default nuovo.
