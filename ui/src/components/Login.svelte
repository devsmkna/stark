<script lang="ts">
  import Logo from './Logo.svelte'

  /** Il gate d'accesso a STARK: senza una sessione cloud valida non si entra.
   *  `server` dice se il server cloud è raggiungibile, per spiegare un login che
   *  non va («server giù» è diverso da «password sbagliata»). */
  let {
    server = 'ok',
    errore = '',
    lavorando = false,
    onLogin,
  }: {
    server: 'ok' | 'giu' | 'non-configurato'
    errore?: string
    lavorando?: boolean
    onLogin: (email: string, password: string) => void
  } = $props()

  let email = $state('')
  let password = $state('')

  function invia(): void {
    if (!email.trim() || !password || lavorando) return
    onLogin(email.trim(), password)
  }
</script>

<div class="lg-scrim" role="dialog" aria-modal="true" aria-label="Accedi a STARK">
  <div class="lg-card">
    <div class="lg-mark" aria-hidden="true"><Logo height={30} /></div>
    <h1>Accedi a STARK</h1>
    <p class="lg-sub">Il login cloud è obbligatorio per usare STARK.</p>

    {#if server === 'giu'}
      <p class="lg-warn">Il server cloud non è raggiungibile. Riprova più tardi.</p>
    {:else if server === 'non-configurato'}
      <p class="lg-warn">Server cloud non configurato: imposta <span class="lg-var">STARK_CLOUD_URL</span> sul daemon.</p>
    {/if}

    <form onsubmit={(e) => { e.preventDefault(); invia() }}>
      <label>
        <span>Email</span>
        <input
          type="email"
          autocomplete="username"
          placeholder="nome@dominio.it"
          bind:value={email}
          disabled={lavorando}
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          autocomplete="current-password"
          bind:value={password}
          disabled={lavorando}
        />
      </label>

      {#if errore}
        <p class="lg-err">{errore}</p>
      {/if}

      <button type="submit" class="lg-btn" disabled={lavorando || !email.trim() || !password}>
        {lavorando ? 'Accesso…' : 'Accedi'}
      </button>
    </form>
  </div>
</div>

<style>
  /*
   * Ogni classe qui dentro porta il prefisso `lg-`, e non è pedanteria: le classi
   * generiche di questa schermata — `.mark`, `.warn`, `.btn`, `.card` — esistono già
   * in `app.css` con **tutt'altro significato**, e questo componente le stava
   * ereditando in silenzio. Misurato nel browser (2 settembre 2026,
   * `tools/prova-login.mjs`), non dedotto dal CSS:
   *
   *   `.mark`  in app.css è l'**evidenziazione dei risultati di ricerca**, con un
   *            fondo rosso mattone al 26% — ed è il rettangolo colorato che compariva
   *            dietro il logo. Qui `.mark` era usata per il logo, e siccome il CSS
   *            locale non definiva la classe (solo l'svg dentro) niente si opponeva.
   *   `.warn`  è un **badge `display:flex`**. Un flex container fa di ogni pezzo di
   *            testo e del `<code>` un blocco a sé: la frase «Server cloud non
   *            configurato: imposta STARK_CLOUD_URL sul daemon» si spezzava in
   *            **sei righe**. Il CSS locale correggeva `margin`, `font-size` e
   *            `color`, cioè proprio le tre proprietà che non c'entravano.
   *
   * La lezione, che vale oltre questo file: uno stile scoped di Svelte protegge solo
   * le proprietà che **nomina**. Tutto il resto passa dal foglio globale, e un nome
   * di classe comune è un aggancio che nessuno vede finché non guarda lo schermo.
   */
  .lg-scrim {
    position: fixed; inset: 0; z-index: 12;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface); padding: 24px;
  }

  .lg-card {
    width: 100%; max-width: 360px;
    display: flex; flex-direction: column; gap: 12px;
    padding: 28px; border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: 0 10px 40px color-mix(in srgb, var(--shadow) 25%, transparent);
  }

  /* Il logo dentro la card, con l'aria attorno. La larghezza la detta l'altezza —
   * il tratto è largo quasi sette volte tanto (viewBox 1650×238), ed è la ragione per
   * cui a 44px sbordava di 36px dalla card: qui sta a 30, che dentro 360px meno i
   * padding ci sta con margine. `max-width` è la rete: se un domani il viewBox
   * cambiasse, il logo si rimpicciolisce invece di uscire dal riquadro. */
  .lg-mark { display: flex; margin-bottom: 4px; }
  .lg-mark :global(svg) {
    display: block; height: 30px; width: auto; max-width: 100%;
    color: var(--accent);
  }

  h1 { margin: 0; font-size: 20px; }
  .lg-sub { margin: 0; font-size: 13px; color: var(--muted); }

  form { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--muted); }
  input {
    padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--surface);
    color: var(--text); font-size: 14px;
  }
  input:focus { outline: none; border-color: var(--accent); }

  .lg-btn {
    padding: 10px; border-radius: 8px; border: none;
    background: var(--accent); color: var(--on-accent, #fff);
    font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .lg-btn:disabled { opacity: .5; cursor: default; }

  /* L'avviso è un riquadro, e lo dichiara per intero — `display` compreso, che era
   * la proprietà da cui arrivava il guaio. Colore di testo e fondo dalla stessa
   * famiglia, come gli altri avvisi dell'interfaccia. */
  .lg-warn, .lg-err {
    margin: 0; font-size: 12px; line-height: 1.5;
    display: block; padding: 8px 10px; border-radius: 8px;
  }
  .lg-warn {
    color: var(--wait, #d97706);
    background: color-mix(in srgb, var(--wait, #d97706) 12%, transparent);
  }
  .lg-err {
    color: var(--stop, #e5484d);
    background: color-mix(in srgb, var(--stop, #e5484d) 12%, transparent);
  }

  /* Il nome della variabile resta **dentro la frase**: mono per dire che si digita
   * così, ma senza il fondo e il padding che il `<code>` globale porta con sé — un
   * chip alto 24px in una riga da 18 spinge le parole a capo attorno a sé, ed è
   * l'altra metà di quelle sei righe. */
  .lg-var {
    font-family: var(--mono, ui-monospace, monospace);
    font-size: .92em;
    overflow-wrap: anywhere;
  }
</style>
