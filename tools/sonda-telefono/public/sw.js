// Il Service Worker e' il pezzo che conta: e' cio' che riceve il push quando la pagina
// non esiste piu'. Se questo file non si registra, "ti chiama quando guardi altrove"
// sul telefono non e' implementabile, punto.
self.addEventListener('install', e => { self.skipWaiting() })
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('push', e => {
  const dati = (() => { try { return e.data ? e.data.json() : {} } catch { return {} } })()
  e.waitUntil((async () => {
    // Prova che il push e' ARRIVATO, anche se nessuno tocca la notifica.
    const inviatoA = dati.quando ?? 0
    try {
      await fetch('/api/log', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tipo: 'push-RICEVUTO-dal-telefono', ritardo_ms: inviatoA ? Date.now() - inviatoA : null }),
      })
    } catch {}
    // Il contenuto NON viaggia nel push: il SW lo chiederebbe al daemon. Qui simuliamo.
    await self.registration.showNotification('STARK ti aspetta', {
      body: 'Una chat ha bisogno di te', tag: 'stark-sonda', renotify: true,
    })
  })())
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(clients.openWindow('/?da=notifica'))
})
