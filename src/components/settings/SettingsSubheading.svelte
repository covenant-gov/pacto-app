<script lang="ts">
  let {
    id = undefined,
    children,
  }: {
    id?: string;
    children: import('svelte').Snippet;
  } = $props();
</script>

<h3 {id} class="settings-subheading">{@render children()}</h3>

<style>
  .settings-subheading {
    margin: 0 0 10px 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }
</style>
