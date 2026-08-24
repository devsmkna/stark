import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'

// Il daemon serve `ui/dist` in produzione, quindi la UI e l'API stanno sulla stessa
// origine e non serve nessun CORS. In sviluppo Vite sta su un'altra porta, e il proxy
// rimette le due cose sulla stessa origine: senza, il guard rifiuterebbe l'`Origin`.
const DAEMON = process.env['STARK_DAEMON'] ?? 'http://127.0.0.1:4571'

export default defineConfig({
  root: 'ui',
  plugins: [svelte()],
  // `$core` invece di ../../../src/core: l'aliasing evita che la profondità di una
  // cartella diventi un dettaglio che compare in ogni import.
  resolve: { alias: { $core: resolve('src/core') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: DAEMON, changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
})
