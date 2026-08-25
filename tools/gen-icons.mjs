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
  'i-bars': 'align-justify', 'i-plus': 'plus', 'i-check': 'check', 'i-down': 'chevron-down',
  'i-warn': 'triangle-alert', 'i-trash': 'trash-2', 'i-moon': 'moon', 'i-pencil': 'pencil',
  'i-shield': 'shield', 'i-palette': 'palette', 'i-monitor': 'monitor', 'i-search': 'search',
  'i-bell': 'bell', 'i-bell-off': 'bell-off', 'i-disk': 'hard-drive',
  'i-sliders': 'sliders-horizontal',
  'i-wifi-off': 'wifi-off', 'i-loader': 'loader-circle', 'i-x': 'x',
  'i-import': 'download', 'i-chat': 'message-circle', 'i-fwd': 'chevron-right',
}

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
</svg>
`)
console.log(`Sprite.svelte: ${Object.keys(ICONS).length} icone da Lucide ${version}`)
