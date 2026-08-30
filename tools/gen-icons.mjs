// Genera lo sprite delle icone da `lucide-static`, che è il pacchetto ufficiale.
// Non si disegnano icone a mano: si rigenera questo file.
//   node tools/gen-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DIR = resolve('node_modules/lucide-static/icons')
const ICONS = {
  'i-term': 'terminal', 'i-brick': 'brick-wall', 'i-brain': 'brain', 'i-doc': 'file-text',
  'i-globe': 'globe', 'i-plug': 'plug', 'i-block': 'ban', 'i-ask': 'circle-question-mark',
  'i-mail': 'mail', 'i-cut': 'scissors', 'i-bolt': 'zap', 'i-branch': 'git-branch',
  'i-folder': 'folder', 'i-gear': 'settings', 'i-back': 'chevron-left', 'i-stop': 'circle-stop',
  'i-bars': 'align-justify', 'i-chart': 'chart-column', 'i-plus': 'plus',
  'i-check': 'check', 'i-down': 'chevron-down', 'i-clip': 'paperclip', 'i-send': 'arrow-up',
  'i-warn': 'triangle-alert', 'i-trash': 'trash-2', 'i-moon': 'moon', 'i-pencil': 'pencil',
  'i-shield': 'shield', 'i-palette': 'palette', 'i-monitor': 'monitor', 'i-search': 'search',
  'i-bell': 'bell', 'i-bell-off': 'bell-off', 'i-disk': 'hard-drive',
  'i-sliders': 'sliders-horizontal',
  'i-wifi-off': 'wifi-off', 'i-loader': 'loader-circle', 'i-x': 'x',
  'i-import': 'download', 'i-chat': 'message-circle', 'i-fwd': 'chevron-right',
  'i-copy': 'copy',
  'i-reveal': 'folder-open',
  'i-open': 'external-link',
  'i-dollar': 'dollar-sign',
  'i-span': 'unfold-horizontal',
  'i-panel': 'panel-left',
}

/**
 * Le due che Lucide non ha, disegnate a mano — con la ragione accanto, perché senza
 * questa mappa rigenerare lo sprite le cancellerebbe. È già successo: erano state
 * aggiunte direttamente nel file generato, che l'intestazione dice di non toccare.
 */
const CUSTOM = {
  'i-circle': {
    nota: `Un task ancora da fare: un cerchio vuoto. \`i-check\` è quello spuntato, e
       serviva il suo contrario — senza, un task «todo» resterebbe senza segno e le
       righe non si allineerebbero con le altre.`,
    inner: '<circle cx="12" cy="12" r="8" />',
  },
  'i-dot': {
    nota: "Quello in corso. `i-bolt` c'era ma vuol dire un'altra cosa (la modalità auto).",
    inner: '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" fill="currentColor" />',
  },
  'i-phone': {
    nota: `Il telefono (notifiche, Phone.svelte). \`smartphone\` di Lucide esiste ma è
       un'altra forma: questo è il rettangolo stretto con la barra sotto.`,
    inner: '<rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" />',
  },
  'i-file': {
    nota: "L'allegato che non è un'immagine: al posto dell'anteprima che non c'è (FileBlock).",
    inner: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />',
  },
  'i-more': {
    nota: "I tre punti dell'overflow «…» della barra laterale: variante piena di `ellipsis`, che in Lucide è vuota.",
    inner: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />',
  },
}

const custom = Object.entries(CUSTOM).map(([id, { nota, inner }]) =>
  `  <!-- ${nota} -->\n  <symbol id="${id}" viewBox="0 0 24 24">${inner}</symbol>`).join('\n')

const symbols = Object.entries(ICONS).map(([id, name]) => {
  const src = readFileSync(resolve(DIR, `${name}.svg`), 'utf8')
  const inner = /<svg\b[^>]*>([\s\S]*?)<\/svg>/.exec(src)[1].replace(/\s+/g, ' ').trim()
  return `  <symbol id="${id}" viewBox="0 0 24 24">${inner}</symbol>`
}).join('\n')

const version = JSON.parse(readFileSync('node_modules/lucide-static/package.json', 'utf8')).version
writeFileSync('ui/src/components/Sprite.svelte', `<!-- GENERATO da tools/gen-icons.mjs — Lucide ${version}, licenza ISC. Non modificare a mano. -->
<script lang="ts"></${''}script>

<svg style="display:none" aria-hidden="true">
${symbols}
${custom}
</svg>
`)
console.log(`Sprite.svelte: ${Object.keys(ICONS).length} icone da Lucide ${version}, piu' ${Object.keys(CUSTOM).length} disegnate a mano`)
