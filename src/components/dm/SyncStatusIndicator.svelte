<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { SyncStatus } from '../../stores/dm';
  import { deepRescan } from '../../lib/api/nostr';
  import { showToast } from '../../stores/toast';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { dmError } from '../../lib/utils/dm-debug';

  let { status = 'idle' }: { status?: SyncStatus } = $props();

  const LABEL_KEYS: Record<SyncStatus, string> = {
    idle: 'messaging.syncStatus.idle',
    syncing: 'messaging.syncStatus.syncing',
    finished: 'messaging.syncStatus.synced',
    behind: 'messaging.syncStatus.behind',
    stalled: 'messaging.syncStatus.stalled',
  };

  let label = $derived($t(LABEL_KEYS[status] ?? LABEL_KEYS.idle));
  let clickable = $derived(status === 'behind' || status === 'stalled');

  let open = $state(false);
  let scanning = $state(false);
  let rootEl: HTMLDivElement | undefined = $state();

  function togglePopover(): void {
    open = !open;
  }

  function closePopover(): void {
    open = false;
  }

  async function confirmDeepRescan(): Promise<void> {
    scanning = true;
    try {
      await deepRescan();
      closePopover();
    } catch (e) {
      dmError('deepRescan failed', e);
      showToast(
        getInvokeErrorMessage(e, $t('messaging.deepRescan.error')),
        undefined,
        undefined,
        { error: true }
      );
    } finally {
      scanning = false;
    }
  }

  function onDocumentClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && rootEl && !rootEl.contains(target)) closePopover();
  }

  function onDocumentKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') closePopover();
  }

  $effect(() => {
    if (!open) return;
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onDocumentKeydown, true);
    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onDocumentKeydown, true);
    };
  });

  $effect(() => {
    if (!clickable) open = false;
  });
</script>

<div class="sync-status-root" bind:this={rootEl}>
  <div
    class="sync-status"
    class:sync-status-hidden={status === 'idle'}
    data-state={status}
    role="status"
    aria-live="polite"
    title={label}
  >
    {#if clickable}
      <button
        type="button"
        class="sync-status-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onclick={togglePopover}
      >
        <span class="sync-dot" aria-hidden="true"></span>
      </button>
    {:else if status !== 'idle'}
      <span class="sync-dot" aria-hidden="true"></span>
    {/if}
    <span class="sync-label">{label}</span>
  </div>

  {#if open}
    <div class="sync-status-popover" role="dialog" aria-label={$t('messaging.deepRescan.title')}>
      <p class="sync-status-popover-title">{$t('messaging.deepRescan.title')}</p>
      <p class="sync-status-popover-text">{$t('messaging.deepRescan.warning')}</p>
      <div class="sync-status-popover-actions">
        <button
          type="button"
          class="sync-status-popover-cancel"
          disabled={scanning}
          onclick={closePopover}
        >
          {$t('messaging.deepRescan.cancel')}
        </button>
        <button
          type="button"
          class="sync-status-popover-confirm"
          disabled={scanning}
          onclick={confirmDeepRescan}
        >
          {scanning ? $t('messaging.deepRescan.scanning') : $t('messaging.deepRescan.confirm')}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .sync-status-root {
    position: relative;
    display: inline-flex;
    flex: none;
  }

  .sync-status {
    display: inline-flex;
    align-items: center;
    flex: none;
  }

  /* Idle is the steady state: keep the live region for assistive tech, drop it from layout. */
  .sync-status-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .sync-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .sync-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
  }

  .sync-status-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    margin: -4px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 50%;
  }

  .sync-status-trigger:hover .sync-dot,
  .sync-status-trigger:focus-visible .sync-dot {
    outline: 2px solid var(--border);
    outline-offset: 2px;
  }

  .sync-status[data-state='syncing'] .sync-dot {
    background: var(--warning);
    animation: sync-pulse 1.2s ease-in-out infinite;
  }

  .sync-status[data-state='finished'] .sync-dot {
    background: var(--success);
  }

  .sync-status[data-state='behind'] .sync-dot {
    background: var(--warning);
  }

  .sync-status[data-state='stalled'] .sync-dot {
    background: var(--danger);
  }

  @keyframes sync-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  @media (prefers-reduced-motion: reduce) {
    .sync-status[data-state='syncing'] .sync-dot {
      animation: none;
    }
  }

  .sync-status-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    width: 260px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }

  .sync-status-popover-title {
    margin: 0 0 6px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .sync-status-popover-text {
    margin: 0 0 12px;
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--text-secondary);
  }

  .sync-status-popover-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .sync-status-popover-cancel,
  .sync-status-popover-confirm {
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }

  .sync-status-popover-cancel {
    border: 1px solid var(--border);
    background: none;
    color: var(--text-secondary);
  }

  .sync-status-popover-cancel:hover {
    background: var(--bg-hover);
  }

  .sync-status-popover-confirm {
    border: none;
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .sync-status-popover-confirm:disabled,
  .sync-status-popover-cancel:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
