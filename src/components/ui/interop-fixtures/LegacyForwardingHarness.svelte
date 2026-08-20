<svelte:options runes={false} />

<script lang="ts">
  /** Legacy-mode parent listening on a runes-mode child's forwarded on:click. */
  import ForwardingChild from './ForwardingChild.svelte';

  export let onForwardedClick: () => void;
</script>

<ForwardingChild on:click={onForwardedClick} />
