// Mette questa copia del repo sull'ultima release. Serve all'installer.
//
//   node src/cli/release.ts checkout [radice]    mettiti sull'ultima release
//   node src/cli/release.ts riallinea [radice]   disfa cio' che `npm install` ha sporcato
//
// Perché un file a parte invece di un verbo di `stark.ts`: l'installer lo chiama
// **prima** di `npm install`, su una cartella appena clonata dove `node_modules` non
// esiste ancora. `stark.ts` importa il daemon, che importa l'SDK: là non partirebbe.
// La catena che si attraversa da qui — `daemon/aggiornamenti.ts`, `core/release.ts`,
// `core/platform.ts` — non importa **niente** fuori da `node:`, ed è una proprietà da
// non rompere: si romperebbe solo sulla macchina di chi installa per la prima volta,
// cioè dove non la vedremmo mai.
//
// Perché non riusare `stark update`: sono due domande diverse. `update` chiede «sono
// indietro rispetto all'ultima release?» e non fa niente se la risposta è no. Questo
// chiede «mettimi **sull'**ultima release», e lo fa comunque — perché un clone appena
// fatto sta sulla punta di `main`, che porta la stessa `version` dell'ultima release
// ma non è quel commit. Senza questo, si installerebbe codice non rilasciato con
// l'aria di essere una release.

import {
  controlla, passaAllaRelease, riallinea, ultimaReleaseRemota,
} from '../daemon/aggiornamenti.ts'
import { esegui } from '../core/platform.ts'

const comando = process.argv[2]
const radice = process.argv[3] ?? process.cwd()

// Va chiamata **dopo** `npm install`, e solo lì: `npm install` riscrive
// `package-lock.json` e `yarn.lock` a ogni esecuzione, quindi senza questo passo
// l'installer lascerebbe l'albero sporco e il `checkout` della volta dopo si
// rifiuterebbe per modifiche locali che non sono di nessuno. Il perché sia sicuro sta
// scritto su `riallinea()`.
if (comando === 'riallinea') {
  await riallinea(radice)
  process.exit(0)
}

if (comando !== 'checkout') {
  console.error('usa: node src/cli/release.ts checkout|riallinea [radice]')
  process.exit(2)
}

const ultima = await ultimaReleaseRemota(radice).catch((e: Error) => {
  console.error(`Non sono riuscito a chiedere le release al remoto: ${e.message}`)
  process.exit(1)
})

if (!ultima) {
  // Nessun tag di release: si resta su `main`, e lo si **dice**. È la condizione di un
  // progetto che non ha ancora rilasciato niente, non un guasto — ma chi installa deve
  // sapere che sta prendendo la punta dello sviluppo invece di una versione.
  console.error('Nessuna release pubblicata: resto sul ramo di sviluppo.')
  await esegui('git', ['-C', radice, 'fetch', '--quiet', 'origin'], { timeout: 120_000 })
    .catch(() => { /* offline: si tiene quello che c'è, l'ha già detto il clone */ })
  await esegui('git', ['-C', radice, 'merge', '--ff-only', '--quiet', '@{u}'], { timeout: 60_000 })
    .catch(() => { /* niente upstream, o modifiche locali: non si sovrascrive niente */ })
  process.exit(0)
}

const prima = await controlla(radice)
try {
  await passaAllaRelease(radice, ultima.tag)
} catch (e) {
  console.error(`Non sono riuscito a mettermi su ${ultima.tag}: ${(e as Error).message}`)
  process.exit(1)
}
console.log(prima.installata === ultima.versione
  ? `Release ${ultima.versione} (${ultima.tag}).`
  : `Release ${ultima.versione} (${ultima.tag}), da ${prima.installata}.`)
