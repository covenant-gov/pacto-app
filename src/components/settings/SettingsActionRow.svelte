<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    children,
  }: {
    label: string;
    /** Trailing actions (buttons, MoreActionsMenu, etc.). */
    children?: Snippet;
  } = $props();
</script>

<div class="settings-action-row">
  <span class="settings-action-row-label">{label}</span>
  {#if children}
    <div class="settings-action-row-actions">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .settings-action-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  .settings-action-row-label {
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .settings-action-row-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
</style>
