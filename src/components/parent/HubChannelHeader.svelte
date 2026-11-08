<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    channelName,
    actions,
  }: {
    channelName: string;
    actions?: Snippet;
  } = $props();
</script>

<div class="hub-channel-header">
  <div class="hub-channel-info">
    <span class="hub-channel-icon">#</span>
    <h3 class="hub-channel-name">{channelName}</h3>
  </div>
  {#if actions}
    <div class="hub-channel-actions">
      {@render actions()}
    </div>
  {/if}
</div>

<style>
  .hub-channel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    min-height: 48px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }
  .hub-channel-info {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hub-channel-icon {
    color: var(--text-muted);
    font-weight: 600;
  }
  .hub-channel-name {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .hub-channel-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
