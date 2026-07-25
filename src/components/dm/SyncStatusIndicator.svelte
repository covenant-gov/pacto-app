<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { SyncStatus } from '../../stores/dm';

  export let status: SyncStatus = 'idle';
  export let stalled: boolean = false;
</script>

<div class="sync-status" role="status" aria-live="polite" aria-label={`Sync status: ${stalled ? 'stalled' : status}`}>
  {#if stalled}
    <span class="sync-icon sync-icon-warning" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </span>
    <span class="sync-text sync-text-stalled">{$t('messaging.syncStatus.stalled')}</span>
  {:else if status === 'syncing'}
    <span class="sync-icon sync-icon-spinner" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
    </span>
    <span class="sync-text">{$t('messaging.syncStatus.syncing')}</span>
  {:else if status === 'finished'}
    <span class="sync-icon sync-icon-check" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </span>
    <span class="sync-text">{$t('messaging.syncStatus.synced')}</span>
  {:else}
    <span class="sync-icon sync-icon-idle" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="6"/>
      </svg>
    </span>
    <span class="sync-text">{$t('messaging.syncStatus.idle')}</span>
  {/if}
</div>

<style>
  .sync-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    user-select: none;
  }

  .sync-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sync-icon-spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .sync-text-stalled {
    color: var(--text-danger, #ef4444);
  }
</style>
