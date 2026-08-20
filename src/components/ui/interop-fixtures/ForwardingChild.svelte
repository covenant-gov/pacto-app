<svelte:options runes={true} />

<script lang="ts">
  /**
   * R27 fixture: runes-mode child forwarding a DOM click via the bare on:click directive.
   * Only valid because this fixture has no onclick=... attributes anywhere in its template --
   * mixing bare on: forwarding with the new on*= syntax in the same component is a compile error.
   */
</script>

<!-- svelte-ignore event_directive_deprecated -->
<button type="button" data-testid="forwarding-child" aria-label="forward" on:click></button>
