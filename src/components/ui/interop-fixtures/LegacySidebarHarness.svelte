<svelte:options runes={false} />

<script lang="ts">
  /** Legacy-mode parent passing default slot content into runes-mode ResizableSidebar. */
  import ResizableSidebar from '../ResizableSidebar.svelte';

  export let message: string;
</script>

<ResizableSidebar>
  <p data-testid="sidebar-content">{message}</p>
</ResizableSidebar>
