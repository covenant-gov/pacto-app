<svelte:options runes={true} />

<script lang="ts">
  /** Runes-mode child still using the deprecated <slot /> element. */
</script>

<!-- svelte-ignore slot_element_deprecated -->
<div data-testid="slot-child"><slot /></div>
