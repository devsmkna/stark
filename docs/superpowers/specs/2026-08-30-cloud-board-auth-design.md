# Cloud Board — autenticazione (e il modello che la contiene)

Spec di design, 30 agosto 2026.

Portare in cloud la board di STARK, sincronizzata fra più macchine e più persone. Il
primo step necessario è l'**autenticazione**: come un utente (o un collega) accede alla
board remota. Questa spec progetta l'autenticazione e il modello cloud che la contiene.

---

## 1. Il modello cloud

- **Multi-utente**: colleghi, non solo il proprietario.
- La board appartiene a un **progetto** (identificato dalla repo git / dalla cartella).
- **Condividere la board** = dare accesso alla board di quel progetto.
- Un collega la usa se ha **lo stesso progetto in locale** (chat aperta su quella cartella
  in STARK): ogni istanza locale sincronizza la propria board attraverso il backend.
- **Server centrale** sul **VPS proprio dell'utente**, dietro **Traefik** (come l'accesso
  fuori casa già esistente). Non P2P.
- **Login opzionale**: STARK funziona senza; la board cloud è la prima feature che lo
  richiede, ma l'autenticazione è **generale** — in futuro altre feature cloud la
  riuseranno.

## 2. Autenticazione — approccio scelto

**Token opaco + sessione server-side** (scelto su JWT per la revoca, che con la
condivisione multi-utente conta).

### Il server cloud (Node/TS, VPS + Traefik)

- `POST /api/register` — email + password → **hash** (argon2/bcrypt, mai in chiaro).
- `POST /api/login` — verifica → emette un **token opaco** (stringa casuale); la sessione
  sta lato server (persistita, es. JSONL o DB).
- `POST /api/logout` — revoca la sessione.
- Le sessioni persistono lato server, così un token rubato si può revocare.

### Il daemon locale

- Login **una volta** dalla UI di STARK → il daemon chiama `/api/login` → salva il token in
  `~/.stark/cloud-token` (0600, come il token locale).
- Usa quel token (`Authorization: Bearer`) per sincronizzare la board (task #4).
- **Flusso**: UI → daemon → server. Il browser non parla col server cloud direttamente:
  è il daemon che tiene la credenziale e sincronizza.

## 3. Registrazione e sicurezza della password

- **Registrazione libera** (`POST /api/register`).
- **Hash**: argon2 (o bcrypt) — mai in chiaro, mai reversibile, sale incluso.
- **Validazione**: email ben formata, password ≥ 8 caratteri.
- La password **non** viene mai inviata al daemon dopo il login: il daemon tiene solo il
  token di sessione.
- **Niente IP loggati**: l'auth registra solo ciò che serve (account, sessione), coerente
  con la telemetria non invadente (task #6).

## 4. Flusso di login nella UI

- **Dove**: una sezione nelle Impostazioni (es. "Cloud") + un piccolo stato nella barra di
  stato quando serve (es. la board cloud).
- **Login**: email+password una volta → il daemon chiama `/api/login` → salva il token →
  la UI mostra «connesso come <email>».
- **Logout**: bottone che revoca la sessione e toglie il token.
- **Stato**: il daemon espone se è loggato (e con quale email); la board cloud mostra
  «accedere per sincronizzare» se non è loggato, invece di un errore.

## 5. Errori e casi limite

- **Credenziali errate**: 401 con messaggio generico («email o password sbagliate»), senza
  dire quale delle due è sbagliata.
- **Email già registrata**: 409 alla registrazione.
- **Token scaduto/revocato**: il server risponde 401, il daemon lo rileva e la UI mostra
  «sessione scaduta — accedi di nuovo» (senza perdere il lavoro locale).
- **Server non raggiungibile**: la board cloud mostra «server offline»; la board locale
  continua a funzionare (offline-first).
- **Password**: mai in chiaro; token in `~/.stark/cloud-token` con 0600.
- **Concorrenza**: due login con le stesse credenziali → sessioni separate, ognuna
  revocabile.

## 6. Task collegati (board)

- **#3** Cloud: autenticazione (step necessario) — questa spec.
- **#4** Cloud: sincronizzazione della board — il passo dopo l'auth.
- **#5** Cloud: infrastruttura del backend — VPS + Traefik.
- **#6** Telemetria anonimizzata (usage, token, modelli usati) — bassa priorità, a
  prescindere dalla login.
