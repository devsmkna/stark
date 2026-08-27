import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'

// Il daemon serve `ui/dist` in produzione, quindi la UI e l'API stanno sulla stessa
// origine e non serve nessun CORS. In sviluppo Vite sta su un'altra porta (5173): il
// browser ci carica la pagina da lì, quindi manda `Origin: http://localhost:5173` a
// ogni richiesta — e il guard del daemon lo rifiuta, perché non è la sua origine vera.
//
// `changeOrigin` riscrive solo l'header `Host` verso il bersaglio: `Origin` passa
// intatto. Per le GET spesso non si nota (i browser lo omettono più spesso sulle
// richieste same-origin semplici), ma su una POST arriva sempre — scoperto dal vivo
// provando il Finder di sistema (26 agosto 2026): `{"error":"vietato"}` sul dev
// server, 200 sull'indirizzo del daemon. Il `configure` sotto riscrive anche `Origin`
// verso il bersaglio, prima che la richiesta lasci il proxy.
const DAEMON = process.env['STARK_DAEMON'] ?? 'http://127.0.0.1:4571'

export default defineConfig({
  root: 'ui',
  plugins: [svelte()],
  // `$core` invece di ../../../src/core: l'aliasing evita che la profondità di una
  // cartella diventi un dettaglio che compare in ogni import.
  resolve: { alias: { $core: resolve('src/core') } },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: DAEMON,
        changeOrigin: true,
        configure: proxy => {
          proxy.on('proxyReq', proxyReq => { proxyReq.setHeader('origin', DAEMON) })
        },
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
})
