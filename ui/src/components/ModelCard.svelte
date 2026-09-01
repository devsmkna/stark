<script lang="ts">
  /**
   * La scheda del modello: avatar, nome, provider, costo e contesto.
   *
   * Nasce come markup dello header del picker (`ModelPicker`), dove la scheda dice
   * quale modello è in uso; la stessa scheda è il contenuto degli hover sul chip del
   * modello in Helper e AgentPanel. Il box lo dettano gli stili qui, **uno** per
   * tutti, con i font fissati: chi ospita ha un font d'ambiente suo (il body 12px,
   * una barra 10px), e la scheda deve sembrare la stessa ovunque.
   *
   * Qui c'è **solo la scheda**. Il contenitore e la posizione restano di chi la
   * ospita. Le derivate di presentazione (provider, tipi di input, formati) stanno
   * in `lib/lobe.ts` e `lib/view.ts`, che è dove le condivide anche il picker.
   */
  import Icon from './Icon.svelte'
  import { getLobeIconUrl, providerLabelFor, inputTypesOf } from '../lib/lobe.ts'
  import { fmtTok, fmtCosto } from '../lib/view.ts'
  import type { AgentModels } from '../lib/api'

  let { agent, model }: { agent: AgentModels; model: AgentModels['models'][number] } = $props()

  /** Il costo del modello come bandiera: vero quando i due canali sono a zero (la
   *  firma free riconosciuta dappertutto nel picker), falso quando costa o quando
   *  il modello non lo dichiara. La stat distingue i tre casi. */
  const costoFree = $derived.by(() => {
    const c = model?.cost
    return !!c && c.input === 0 && c.output === 0
  })

  const providerMostrato = $derived(model ? providerLabelFor(model as { providerName?: string; id: string; resolved?: string }) : '')
  const inputTypes = $derived(inputTypesOf(model as { accepts?: string[] } | undefined))
  const ic0 = $derived(getLobeIconUrl((model as any).resolved ?? model.id))
</script>

<div class="card">
  <div class="avatar">
    {#if ic0}<img class="micon" src={ic0} alt="" width="15" height="15" loading="lazy"
      onerror={(e)=>{const t=e.currentTarget as HTMLImageElement;t.style.display='none'}} />
    {:else}<Icon name="i-brain" />{/if}
  </div>
  <div class="info">
    <div class="title-row">
      <div class="title">{model.label ?? model.id}</div>
      {#if inputTypes}
        <span class="input-types" title={`accepts: ${[inputTypes.text ? 'text' : null, inputTypes.image ? 'image' : null, inputTypes.video ? 'video' : null, inputTypes.audio ? 'audio' : null, inputTypes.docs ? 'documents' : null].filter(Boolean).join(', ')}`}>
          {#if inputTypes.text}<Icon name="i-type" class="on" />{/if}
          {#if inputTypes.image}<Icon name="i-image" class="on" />{/if}
          {#if inputTypes.video}<Icon name="i-video" class="on" />{/if}
          {#if inputTypes.audio}<Icon name="i-audio" class="on" />{/if}
          {#if inputTypes.docs}<Icon name="i-doc" class="on" />{/if}
        </span>
      {/if}
    </div>
    <div class="provider">{agent.label}{#if providerMostrato}<span class="sep">·</span>{providerMostrato}{/if}</div>
    <div class="stats">
      <span class="stat" class:free={costoFree}><span class="dollar">$</span>
        {#if costoFree}
          <b>free</b>
        {:else if model.cost}
          <span class="per-m">/M</span><b>{fmtCosto(model.cost.input)} / {fmtCosto(model.cost.output)}</b>
        {:else}
          <b>—</b>
        {/if}
      </span>
      <span class="stat" title="context window"><span class="k">context</span><b>{fmtTok(model.contextWindow)}</b></span>
    </div>
  </div>
</div>

<style>
  /* Il font d'ambiente NON deve decidere la misura della scheda: chi la ospita ha il
      suo (il body 12px, una barra 10px) e lo stesso box ovunque è la ragione per cui
      questo componente esiste. Fissarlo qui vale per tutti. */
  .card{font-size:12px;display:flex;align-items:flex-start;gap:10px;padding:12px}
  .avatar{width:30px;height:30px;border-radius:8px;border:1px solid var(--line-2);
    display:flex;align-items:center;justify-content:center;flex:none}
  .card img.micon{flex:none;filter:var(--icon-f)}
  .avatar svg.ic{flex:none;width:15px;height:15px}
  .info{flex:1;min-width:0}
  .title{font-weight:700;color:var(--ink);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .title-row{display:flex;align-items:center;gap:8px}
  .title-row .title{flex:1;min-width:0}
  .title-row .input-types{margin-left:auto;flex:none}
  .provider{color:var(--muted);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .provider .sep{color:var(--line-2);margin:0 5px}
  .stats{display:flex;gap:12px;margin-top:9px;flex-wrap:wrap}
  .stat{display:flex;align-items:center;gap:4px;color:var(--muted)}
  .stat .k, .stat .per-m{font-size:8px;font-weight:600;letter-spacing:-0.02em;text-transform:uppercase;color:var(--muted);opacity:.75;font-stretch:condensed;flex-shrink:0}
  .stat .dollar{font-family:var(--mono);font-weight:700;color:var(--muted);width:8px;text-align:center;flex-shrink:0}
  .stat b{color:var(--ink);font-weight:600;margin-left:1px}
  .stat.free b{color:var(--accent)}
  .input-types{display:inline-flex;align-items:center;gap:3px;margin-left:1px}
  .input-types svg.ic{height:12px}
  :global(.input-types svg.ic){width:11px;height:11px}
  :global(.input-types svg.ic.on){color:var(--ink);opacity:1}
</style>
