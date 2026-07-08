<script lang="ts">
  import { formatUnreadBadgeCount } from '../../lib/dm/dm-unread';

  export let name: string = "";
  export let active: boolean = false;
  export let type: 'text' | 'announcement' = 'text';
  /** Unread / action-needed count; hidden when 0 or channel is active. */
  export let alertCount = 0;

  $: alertLabel = formatUnreadBadgeCount(alertCount);
</script>

<button
  class="channel {active ? 'active' : ''}"
  aria-label={alertCount > 0 && !active ? `${name}, ${alertCount} notification${alertCount === 1 ? '' : 's'}` : name}
>
  <span class="icon">#</span>
  <span class="name">{name}</span>
  {#if alertLabel && !active}
    <span class="channel-alert-badge" aria-hidden="true">{alertLabel}</span>
  {/if}
</button>

<style>
  .channel {
    width: 100%;
    height: 36px;
    background: transparent;
    border: none;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    cursor: pointer;
    color: var(--text-muted);
    transition: background 0.15s, color 0.15s;
    margin: 2px 0;
    outline: none;
  }

  .channel:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .channel.active {
    background: var(--channel-active-bg, var(--border));
    color: var(--channel-active-fg, var(--text-primary));
  }

  .icon {
    font-size: 1.25rem;
    font-weight: 400;
    flex-shrink: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .channel-alert-badge {
    flex-shrink: 0;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    font-size: 0.6875rem;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
  }
</style>

