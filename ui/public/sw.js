// Il Service Worker: l'unico pezzo di STARK che gira **senza la pagina**.
//
// È tutto qui il motivo per cui esiste. La notifica che STARK mostra da dentro la
// pagina (`new Notification(...)`) vale finché quella pagina è viva, e su un telefono
// non lo è quasi mai: a schermo spento, o con Safari in secondo piano, nella scheda non
// gira niente. Questo file invece viene svegliato dal sistema operativo quando arriva
// un push, anche se la scheda è chiusa da ore.
//
// Non fa cache e non intercetta le richieste, di proposito: STARK non deve funzionare
// offline — senza il daemon non c'è niente da mostrare — e una cache di mezzo sarebbe
// solo un posto in più in cui la UI può restare indietro rispetto al codice servito.

self.addEventListener('install', () => { self.skipWaiting() })

self.addEventListener('activate', e => e.waitUntil((async () => {
  await self.clients.claim()
  // Un service worker nuovo è arrivato: la UI è cambiata. Le pagine che questo SW
  // controlla — una PWA salvata sulla homescreen di iOS, per dirne una — resterebbero
  // sulla versione vecchia finché l'utente non le chiude e le riapre a mano. Si
  // ricaricano da sole, una volta sola, al momento del passaggio di controllo.
  const pagine = await self.clients.matchAll({ type: 'window', includeUncontrolled: false })
  for (const c of pagine) {
    try { await c.navigate(c.url) } catch { /* è già in navigazione o non navigabile */ }
  }
}))())

self.addEventListener('push', e => {
  const d = (() => { try { return e.data ? e.data.json() : {} } catch { return {} } })()
  e.waitUntil(self.registration.showNotification(d.title || 'STARK', {
    body: d.body || '',
    // `tag` è l'id della chat: due notifiche della stessa conversazione si
    // sostituiscono invece di impilarsi. Tornando al telefono dopo un'ora si trova
    // l'ultimo stato di ciascuna chat, non trenta righe da scorrere.
    tag: d.sessionId || 'stark',
    renotify: true,
    // Serve al clic qui sotto: la notifica è l'unica cosa che sa quale chat aprire.
    data: { sessionId: d.sessionId || '' },
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const id = e.notification.data && e.notification.data.sessionId
  const dove = id ? `/chat/${id}` : '/'
  e.waitUntil((async () => {
    // Se STARK è già aperto da qualche parte si porta lì quella finestra invece di
    // aprirne una seconda: due copie della stessa conversazione sono due posti in cui
    // scrivere, e si finisce per scrivere in quello sbagliato.
    const aperte = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of aperte) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus()
        if ('navigate' in c && id) { try { await c.navigate(dove) } catch { /* basta il focus */ } }
        return
      }
    }
    await self.clients.openWindow(dove)
  })())
})
