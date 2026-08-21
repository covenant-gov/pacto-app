<svelte:options runes={false} />

<script lang="ts">
  /** Legacy-mode parent passing default slot content into a still-<slot /> runes child. */
  import SlotChild from './SlotChild.svelte';

  export let message: string;
</script>

<SlotChild>
  <p data-testid="slot-content">{message}</p>
</SlotChild>
