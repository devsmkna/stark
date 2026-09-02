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

<div class="login" role="dialog" aria-modal="true" aria-label="Accedi a STARK">
  <div class="card">
    <div class="mark" aria-hidden="true"><Logo height={44} /></div>
    <h1>Accedi a STARK</h1>
    <p class="sub">Il login cloud è obbligatorio per usare STARK.</p>

    {#if server === 'giu'}
      <p class="warn">Il server cloud non è raggiungibile. Riprova più tardi.</p>
    {:else if server === 'non-configurato'}
      <p class="warn">Server cloud non configurato: imposta <code>STARK_CLOUD_URL</code> sul daemon.</p>
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
        <p class="err">{errore}</p>
      {/if}

      <button type="submit" class="btn" disabled={lavorando || !email.trim() || !password}>
        {lavorando ? 'Accesso…' : 'Accedi'}
      </button>
    </form>
  </div>
</div>

<style>
  .login {
    position: fixed; inset: 0; z-index: 12;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface); padding: 24px;
  }

  .card {
    width: 100%; max-width: 360px;
    display: flex; flex-direction: column; gap: 12px;
    padding: 28px; border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: 0 10px 40px color-mix(in srgb, var(--shadow) 25%, transparent);
  }

  .mark :global(svg) { display: block; height: 44px; width: auto; color: var(--accent); }

  h1 { margin: 0; font-size: 20px; }
  .sub { margin: 0; font-size: 13px; color: var(--muted); }

  form { display: flex; flex-direction: column; gap: 12px; margin-top: 8px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--muted); }
  input {
    padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--surface);
    color: var(--text); font-size: 14px;
  }
  input:focus { outline: none; border-color: var(--accent); }

  .btn {
    padding: 10px; border-radius: 8px; border: none;
    background: var(--accent); color: var(--on-accent, #fff);
    font-size: 14px; font-weight: 600; cursor: pointer;
  }
  .btn:disabled { opacity: .5; cursor: default; }

  .err, .warn { margin: 0; font-size: 12px; }
  .err { color: var(--danger, #e5484d); }
  .warn { color: var(--warning, #d97706); }
  code { font-size: 11px; }
</style>
