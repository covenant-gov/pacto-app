<script lang="ts">
  /** Runes-mode parent passing default slot content into a legacy-mode child that still uses <slot />. */
  import LegacySlotChild from './LegacySlotChild.svelte';

  let { message }: { message: string } = $props();
</script>

<LegacySlotChild>
  <p data-testid="reverse-slot-content">{message}</p>
</LegacySlotChild>
