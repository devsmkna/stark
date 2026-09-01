<script lang="ts">
  import Logo from './Logo.svelte'

  /** Testo opzionale sotto il logo: chi osserva deve capire cosa sta aspettando
   *  («Opening…», «Starting…»), ma il segno è il logo, non la frase. */
  let { message = '' }: { message?: string } = $props()
</script>

<div class="splash" role="status" aria-label={message || 'Loading STARK'}>
  <div class="mark" aria-hidden="true"><Logo height={50} /></div>
  {#if message}
    <div class="msg">{message}</div>
  {/if}
</div>

<style>
  /* Schermata piena dietro cui l'apertura di una chat (o il primo elenco) va avanti
     senza un contatore finto: il logo che respira dice «c'è un ritardo, non è rotto».
     `z-index` sopra scrim/dialoghi (8/9) e menu (6): mentre si apre non deve esserci
     niente fra il segno e chi aspetta. */
  .splash {
    position: fixed; inset: 0; z-index: 12;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 16px; background: var(--surface);
  }

  /* Il "glow": il logo è un vettore in `currentColor`, quindi il bagliore lo disegna
     un `drop-shadow` sul contorno — stessa immagine, di giorno e di notte, con
     l'accento del tema. Neon, non nuvola: raggi corti e concentrici che restano
     attaccati ai tratti — con blur da 30-48px le ombre delle cinque lettere si
     fondevano in un rettangolo pieno dietro la parola (screenshot Chromium, e
     segnalato dall'utente, 1º settembre 2026). Il respiro muove solo il filtro:
     le lettere restano accese. */
  .mark { animation: respiro 2s ease-in-out infinite; }
  .mark :global(svg) { display: block; height: clamp(34px, 8vw, 50px); width: auto; }

  @keyframes respiro {
    0%, 100% {
      filter: drop-shadow(0 0 2px color-mix(in srgb, var(--accent) 55%, transparent))
              drop-shadow(0 0 7px color-mix(in srgb, var(--accent) 32%, transparent));
    }
    50% {
      filter: drop-shadow(0 0 3px color-mix(in srgb, var(--accent) 85%, transparent))
              drop-shadow(0 0 10px color-mix(in srgb, var(--accent) 50%, transparent))
              drop-shadow(0 0 26px color-mix(in srgb, var(--accent) 25%, transparent));
    }
  }

  .msg { font-size: 11px; color: var(--muted); letter-spacing: .06em; }
</style>