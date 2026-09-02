---
id: 17
title: 'Registrazione dalla UI: oggi un account nuovo si crea solo con curl'
status: backlog
priority: high
created: 2026-09-02T11:41:57.121182+02:00
updated: 2026-09-02T11:41:57.121182+02:00
class: standard
---

Emerso il 2 settembre 2026 provando a entrare: il login cloud e' obbligatorio (task #9) ma nella schermata non c'e' nessun modo di CREARE un account, quindi un utente nuovo davanti a STARK non ha nessuna strada — l'unica via e' un POST a mano al server. Le due utenze di oggi sono state create cosi'.

Il pezzo mancante e' solo la meta' verso l'utente: il server cloud ce l'ha gia' ed e' aperta — POST /api/register, 'registrazione libera' (cloud/src/auth.ts, registra()), verificata viva dall'esterno (400 'email e password obbligatorie' su corpo vuoto, 201 su credenziali valide). A mancare sono tre cose, tutte piccole:
  1. cloud.ts (daemon): una registraCloud(home, email, password) accanto a loginCloud, che dopo il 201 puo' fare direttamente il login e salvare il token — cosi' chi si registra entra, invece di doversi riautenticare.
  2. server.ts (daemon): POST /api/cloud/register, come le altre tre rotte cloud.
  3. Login.svelte + api.ts: un «Crea account» nella stessa card. Va deciso se e' un secondo bottone sotto «Accedi» o una linguetta che cambia il verbo del form (i campi sono gli stessi). Da guardare disegnato prima di scriverlo, come vuole la regola sulla UI.

Da decidere insieme, e non e' un dettaglio di implementazione: se la registrazione debba restare **libera** (chiunque raggiunga l'IP si fa un account) o passare da un invito. Oggi e' libera e il server e' su un IP pubblico senza TLS.

Legato al #9. Vedi anche la nota sul TLS nel commit 36f9c67: le credenziali viaggiano in chiaro.
