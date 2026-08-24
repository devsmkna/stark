<script lang="ts">
  let { name, style = '' }: { name: string; style?: string } = $props()
</script>

<svg class="ic" {style} aria-hidden="true"><use href="#{name}" /></svg>
