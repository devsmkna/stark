<script lang="ts">
  import Sprite from './components/Sprite.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Conversation from './components/Conversation.svelte'
  import { Store } from './lib/store.svelte.ts'

  const store = new Store()

  $effect(() => {
    void store.start()
    return () => store.dispose()
  })
</script>

<Sprite />

<div class="shell">
  {#if !store.hasToken}
    <div class="mid">
      <div>
        <p><b>No token.</b></p>
        <p>Open the address <code>npm run stark</code> prints when it starts. It carries the
        token once; STARK moves it into a cookie and clears it from the address bar.</p>
      </div>
    </div>
  {:else}
    <Sidebar rows={store.rows} selected={store.selected} onpick={id => void store.select(id)} />

    {#if store.fatal}
      <div class="mid">The daemon is not answering: {store.fatal}</div>
    {:else if store.snap}
      <Conversation snap={store.snap} link={store.link} />
    {:else if store.selected}
      <div class="mid">Opening…</div>
    {:else if store.loaded && store.rows.length === 0}
      <div class="mid">
        <div>
          <p><b>No chats yet.</b></p>
          <p>Starting a chat from here is not wired yet — this slice only reads.
          Use <code>npm run slice</code> to create a real one, then reload.</p>
        </div>
      </div>
    {:else}
      <div class="mid">Pick a chat on the left.</div>
    {/if}
  {/if}
</div>

<style>
  .mid p { margin: 0 0 8px; max-width: 46ch; }
</style>
