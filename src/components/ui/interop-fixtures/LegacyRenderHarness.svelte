<svelte:options runes={false} />

<script lang="ts">
  /** Legacy-mode parent passing default slot content into a runes-mode child. */
  import RenderChild from './RenderChild.svelte';

  export let message: string;
</script>

<RenderChild>
  <p data-testid="render-content">{message}</p>
</RenderChild>
