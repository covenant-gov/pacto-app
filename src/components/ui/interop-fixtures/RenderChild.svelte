<script lang="ts">
  /** R27 fixture: runes-mode child rendering default content via {@render children()}. */
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div data-testid="render-child">{@render children()}</div>
