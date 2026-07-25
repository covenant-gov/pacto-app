<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { SyncStatus } from '../../stores/dm';

  export let status: SyncStatus = 'idle';
  export let stalled: boolean = false;

  const LABEL_KEYS: Record<string, string> = {
    idle: 'messaging.syncStatus.idle',
    syncing: 'messaging.syncStatus.syncing',
    finished: 'messaging.syncStatus.synced',
    stalled: 'messaging.syncStatus.stalled',
  };

  $: state = stalled ? 'stalled' : status;
  $: label = $t(LABEL_KEYS[state] ?? LABEL_KEYS.idle);
</script>

<span
  class="sync-status"
  class:sync-status-hidden={state === 'idle'}
  data-state={state}
  role="status"
  aria-live="polite"
  title={label}
>
  {#if state !== 'idle'}
    <span class="sync-dot" aria-hidden="true"></span>
  {/if}
  <span class="sync-label">{label}</span>
</span>

<style>
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

  .sync-status[data-state='syncing'] .sync-dot {
    background: var(--warning);
    animation: sync-pulse 1.2s ease-in-out infinite;
  }

  .sync-status[data-state='finished'] .sync-dot {
    background: var(--success);
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
</style>
