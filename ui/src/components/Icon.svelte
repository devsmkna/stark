<script lang="ts">
  let { name, class: c = '', style = '' }: { name: string; class?: string; style?: string } = $props()
</script>

<svg class="ic {c}" {style} aria-hidden="true"><use href="#{name}" /></svg>
