<script lang="ts">
  // Il confronto fra prima e dopo.
  //
  // Qui non si calcola nessuna differenza: `core/diff.ts` entra con gli `Hunk` del
  // vocabolario canonico ed esce con righe già pronte da disegnare. È lo stesso codice
  // che gira nel motore, quindi ciò che si vede non può divergere da ciò che il journal
  // dice sia successo.
  //
  // Due forme, e la seconda non è un ripiego: su schermo stretto l'affiancato non ci
  // sta, e lì non si rimpicciolisce — si cambia (docs/ui-schermate.md §4).
  import { sideBySide, unified, type Side, type Span } from '$core/diff.ts'
  import type { Hunk } from '$core/events.ts'

  let { hunks, narrow = false }: { hunks: Hunk[]; narrow?: boolean } = $props()

  // Le due forme si costruiscono in due variabili distinte e non in una sola: hanno
  // gli stessi nomi di riga (`context`, `removed`, `added`) con dentro campi diversi,
  // quindi in un'unione sola non ci sarebbe modo di sapere quale delle due si ha in
  // mano. Se ne costruisce una alla volta, e non si paga niente per l'altra.
  const rows = $derived(narrow ? [] : sideBySide(hunks))
  const urows = $derived(narrow ? unified(hunks) : [])
  const empty = $derived(rows.length === 0 && urows.length === 0)

  const gap = (r: { oldFrom: number; oldTo: number }): string =>
    r.oldTo >= r.oldFrom ? `⋯ lines ${r.oldFrom}–${r.oldTo} not shown` : '⋯'

  /** La riga spezzata in tre: prima, la parte cambiata, dopo. */
  function parts(s: Side, span: Span | undefined): [string, string, string] {
    if (!span) return [s.text, '', '']
    return [s.text.slice(0, span.start), s.text.slice(span.start, span.end), s.text.slice(span.end)]
  }
</script>

<div class="diff">
  {#if narrow}
    <div class="ugrid">
      {#each urows as r, i (i)}
        {#if r.kind === 'gap'}
          <div class="gap">{gap(r)}</div>
        {:else if r.kind === 'context'}
          <div class="dn">{r.newNo}</div><div>{r.text}</div>
        {:else if r.kind === 'removed'}
          <div class="dn">{r.oldNo}</div><div class="dold">{r.text}</div>
        {:else}
          <div class="dn">{r.newNo}</div><div class="dnew">{r.text}</div>
        {/if}
      {/each}
      {#if empty}<div class="gap">nothing changed</div>{/if}
    </div>
  {:else}
    <div class="dgrid">
      {#each rows as r, i (i)}
        {#if r.kind === 'gap'}
          <div class="gap">{gap(r)}</div>
        {:else if r.kind === 'context'}
          <div class="dn">{r.left.no}</div><div>{r.left.text}</div>
          <div class="dn">{r.right.no}</div><div>{r.right.text}</div>
        {:else if r.kind === 'removed'}
          <div class="dn">{r.left.no}</div><div class="dold">{r.left.text}</div>
          <div class="dn"></div><div class="void"></div>
        {:else if r.kind === 'added'}
          <div class="dn"></div><div class="void"></div>
          <div class="dn">{r.right.no}</div><div class="dnew">{r.right.text}</div>
        {:else}
          <!-- la riga vecchia e la sua sostituta alla stessa altezza, con marcata
               solo la porzione che è davvero cambiata -->
          {@const l = parts(r.left, r.leftSpan)}
          {@const n = parts(r.right, r.rightSpan)}
          <div class="dn">{r.left.no}</div>
          <div class="dold">{l[0]}{#if l[1]}<span class="mark">{l[1]}</span>{/if}{l[2]}</div>
          <div class="dn">{r.right.no}</div>
          <div class="dnew">{n[0]}{#if n[1]}<span class="markn">{n[1]}</span>{/if}{n[2]}</div>
        {/if}
      {/each}
      {#if empty}<div class="gap">nothing changed</div>{/if}
    </div>
  {/if}
</div>

<style>
  /* Le celle vuote di fronte a una riga tolta o aggiunta: sono un buco vero nel
     file, e lasciarle bianche le farebbe leggere come una riga di contesto. */
  .void { background: var(--surface-2); }
</style>
