<script lang="ts">
  // «Continua da telefono», in un riquadro solo.
  //
  // Il pannello non spiega cosa fare: **mostra cosa manca**. Ogni riga è una domanda a
  // cui la macchina sa già rispondere (`daemon/tailscale.ts`), quindi le spunte si
  // accendono da sé mentre fai i passi, senza chiudere e riaprire — ed è la ragione per
  // cui si rilegge ogni due secondi finché non è tutto verde: due dei cinque passi li
  // fai **altrove** (la console web di Tailscale, l'app sul telefono) e devi vederli
  // arrivare qui.
  //
  // Quando è tutto pronto la guida sparisce e resta una cosa sola: il codice. È lo
  // stato normale — la configurazione si fa una volta, il codice si chiede ogni volta
  // che colleghi un telefono nuovo.
  import Icon from './Icon.svelte'
  import type { StatoTelefono } from '../lib/api.ts'
  import type { Store } from '../lib/store.svelte.ts'

  let { store }: { store: Store } = $props()

  let stato = $state<StatoTelefono | null>(null)
  let codice = $state<{ codice: string; scade: number } | null>(null)
  let daFare = $state<string | null>(null)
  let loginUrl = $state<string | null>(null)
  let errore = $state<string | null>(null)
  let adesso = $state(Date.now())

  /**
   * Il testo di ogni passo. Sta qui e non nel daemon perché è **presentazione**: il
   * daemon manda un `id` e un fatto, la UI decide come si dice. Il `come` è la riga che
   * compare solo quando il passo non è fatto: a passo verde sarebbe rumore.
   */
  const PASSI: Record<string, { titolo: string; come: string; link?: [string, string] }> = {
    installato: {
      titolo: 'Tailscale on this machine',
      come: 'Not installed, or the daemon is not answering. On WSL it goes inside Linux, '
        + 'not on Windows: `curl -fsSL https://tailscale.com/install.sh | sh`.',
    },
    collegato: {
      titolo: 'This machine signed in',
      come: 'STARK can do this for you — it opens a Tailscale sign-in page.',
    },
    https: {
      titolo: 'HTTPS certificates enabled',
      come: 'This one is a switch in your Tailscale account, so STARK cannot flip it: '
        + 'open the admin console → DNS → enable MagicDNS, then HTTPS Certificates.',
      link: ['Open the admin console', 'https://login.tailscale.com/admin/dns'],
    },
    pubblicato: {
      titolo: 'STARK published on your tailnet',
      come: 'Tailscale terminates TLS and forwards to this machine. Nothing is exposed '
        + 'to the internet: only your own devices can reach it.',
    },
    telefono: {
      titolo: 'Tailscale on your phone',
      come: 'Install the app on the phone and sign in with the same account. It shows up '
        + 'here by itself once it does.',
      link: ['Get the app', 'https://tailscale.com/download'],
    },
  }

  async function leggi(): Promise<void> {
    try { stato = await store.api.phone() } catch { /* daemon giù: ci pensa `fatal` */ }
  }

  // Si rilegge finché non è tutto verde, poi si smette. Un orologio che continua a
  // battere su un pannello già a posto sarebbe il difetto già tolto dall'elenco il 26
  // agosto: calcolo che non cambia niente di ciò che si vede.
  $effect(() => {
    void leggi()
    const t = setInterval(() => {
      adesso = Date.now()
      if (!stato?.tailscale.pronto || codice) void leggi()
    }, 2000)
    return () => clearInterval(t)
  })

  const restano = $derived(codice ? Math.max(0, Math.round((codice.scade - adesso) / 1000)) : 0)
  // Il codice scaduto sparisce da solo: lasciarlo a schermo vorrebbe dire mostrare
  // qualcosa che non funziona più, e farlo scoprire al telefono.
  $effect(() => { if (codice && restano === 0) codice = null })

  async function chiedi(): Promise<void> {
    errore = null
    try { codice = await store.api.phoneCode() } catch { errore = 'Could not create a code' }
  }

  async function fai(azione: 'collega' | 'pubblica'): Promise<void> {
    daFare = azione; errore = null; loginUrl = null
    try {
      if (azione === 'collega') {
        const r = await store.api.tailscaleUp()
        if (r.url) loginUrl = r.url
        else if (!r.ok) errore = r.error ?? 'Could not sign in'
      } else {
        const r = await store.api.tailscalePublish()
        if (!r.ok) errore = r.error ?? 'Could not publish'
      }
    } finally { daFare = null; await leggi() }
  }

  const quando = (ts: number): string =>
    new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
</script>

<div class="scrim" role="presentation" onclick={() => { store.dialog = null }}></div>
<div class="dlg" style="width:460px">
  <div class="dlgh">
    <Icon name="i-phone" style="color:var(--accent)" />
    <span class="dt">Use STARK from your phone</span>
    <button class="x" aria-label="Close" onclick={() => { store.dialog = null }}>
      <Icon name="i-x" />
    </button>
  </div>

  <div class="dlgb" style="gap:0">
    {#if !stato}
      <div class="mid" style="padding:24px">Checking…</div>
    {:else if stato.tailscale.pronto}
      <!-- Tutto collegato: il pannello dice una cosa sola. -->
      <p class="lead">
        Open <b>{stato.tailscale.url}</b> on your phone and type this code.
      </p>
      {#if codice}
        <div class="code">{codice.codice}</div>
        <div class="sub">Expires in {Math.floor(restano / 60)}:{String(restano % 60).padStart(2, '0')} · one use</div>
      {:else}
        <button class="btn pri wide" onclick={() => void chiedi()}>Show me a code</button>
        <div class="sub">
          Good for 5 minutes and a single phone. You only do this once per device — after
          that the phone stays connected until you disconnect it here.
        </div>
      {/if}
    {:else}
      <p class="lead">
        A few things have to be true before a phone can reach STARK. It checks them
        live, so the ticks turn on by themselves as you go — no need to close this.
      </p>
      <div class="passi">
        {#each stato.tailscale.passi as p (p.id)}
          {@const t = PASSI[p.id]}
          <div class="passo" class:ok={p.fatto}>
            <span class="mk">{#if p.fatto}<Icon name="i-check" />{/if}</span>
            <div class="body">
              <div class="t">{t?.titolo ?? p.id}</div>
              {#if p.fatto && p.dettaglio}
                <div class="d">{p.dettaglio}</div>
              {:else if !p.fatto}
                <div class="d">{t?.come}</div>
                <div class="fai">
                  {#if p.azione}
                    <button class="btn" disabled={daFare !== null}
                      onclick={() => void fai(p.azione!)}>
                      {daFare === p.azione ? 'Working…'
                        : p.azione === 'collega' ? 'Sign this machine in' : 'Publish STARK'}
                    </button>
                  {/if}
                  {#if t?.link}
                    <a class="btn" href={t.link[1]} target="_blank" rel="noreferrer">{t.link[0]}</a>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
      {#if loginUrl}
        <!-- L'indirizzo che `tailscale up` stamperebbe in un terminale. Non si apre da
             soli: aprire una finestra addosso a chi non l'ha chiesta è la regola che ci
             è già costata un giro con Esplora Risorse (vedi CLAUDE.md, F3). -->
        <div class="hint">
          <Icon name="i-open" />
          <span>Finish signing in: <a href={loginUrl} target="_blank" rel="noreferrer">{loginUrl}</a></span>
        </div>
      {/if}
    {/if}

    {#if errore}<div class="hint bad"><Icon name="i-warn" /><span>{errore}</span></div>{/if}

    {#if stato && stato.devices.length > 0}
      <div class="sez">Connected phones</div>
      {#each stato.devices as d (d.id)}
        <div class="dev">
          <div>
            <div class="t">{d.nome}</div>
            <div class="d">connected {quando(d.da)}</div>
          </div>
          <!-- La revoca è la difesa che abbiamo scelto al posto della scadenza: se non
               fosse a un clic da qui, non lo sarebbe. -->
          <button class="btn" onclick={() => { void store.api.phoneRevoke(d.id).then(leggi) }}>
            Disconnect
          </button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .lead { margin: 0 0 12px; font-size: 11.5px; line-height: 1.5; color: var(--ink-2); }
  .sub { margin-top: 7px; font-size: 10px; line-height: 1.45; color: var(--muted); }

  /* Il codice è la cosa da leggere da due metri, sopra una tastiera di telefono:
     monospace e spaziato, perché è fatto per essere ribattuto carattere per carattere. */
  .code {
    margin: 6px 0 0; padding: 14px; border-radius: 11px;
    border: 1px solid var(--line-2); background: var(--surface-2);
    font-family: var(--mono); font-size: 27px; font-weight: 600;
    letter-spacing: .22em; text-align: center; text-indent: .22em; color: var(--ink);
  }
  .wide { width: 100%; }

  .passi { display: flex; flex-direction: column; gap: 2px; }
  .passo { display: flex; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
  .passo:first-child { border-top: 0; }
  /* Il pallino è **vuoto** finché il passo non è fatto, non rosso: non è un guasto, è
     una cosa che non hai ancora fatto. */
  .mk {
    flex: none; width: 15px; height: 15px; margin-top: 1px; border-radius: 50%;
    border: 1.5px solid var(--line-2); display: flex; align-items: center;
    justify-content: center; color: #fff;
  }
  .passo.ok .mk { background: var(--done); border-color: var(--done); }
  .mk :global(svg.ic) { width: 10px; height: 10px; stroke-width: 3; }
  .passo .t { font-size: 11.5px; font-weight: 600; }
  .passo.ok .t { color: var(--ink-2); font-weight: 500; }
  .passo .d { font-size: 10px; line-height: 1.45; color: var(--muted); margin-top: 2px; }
  .fai { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
  .fai a { text-decoration: none; display: inline-flex; align-items: center; }

  .hint {
    display: flex; align-items: flex-start; gap: 7px; margin-top: 10px;
    font-size: 10.5px; line-height: 1.45; color: var(--ink-2);
  }
  .hint :global(svg.ic) { width: 13px; height: 13px; flex: none; margin-top: 1px; }
  .hint.bad { color: var(--stop); }
  .hint a { color: var(--accent); word-break: break-all; }

  .sez {
    margin: 16px 0 2px; padding-top: 12px; border-top: 1px solid var(--line);
    font-size: 9.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase;
    color: var(--muted);
  }
  .dev { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
  .dev > div:first-child { flex: 1; min-width: 0; }
  .dev .t { font-size: 11.5px; font-weight: 600; }
  .dev .d { font-size: 10px; color: var(--muted); }
</style>
