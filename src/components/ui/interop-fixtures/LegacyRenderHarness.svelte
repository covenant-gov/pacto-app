<script lang="ts">
  /** R27 fixture: legacy-mode parent passing default slot content into a runes-mode child. */
  import RenderChild from './RenderChild.svelte';

  export let message: string;
</script>

<RenderChild>
  <p data-testid="render-content">{message}</p>
</RenderChild>
