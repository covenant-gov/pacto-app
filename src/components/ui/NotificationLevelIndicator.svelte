<script lang="ts">
  import { t } from 'svelte-i18n';
  import { DEFAULT_NOTIFICATION_LEVEL } from '../../lib/api/notifications';
  import { notificationLevels } from '../../stores/notification-levels';

  let { chatId, onOpen }: { chatId: string; onOpen: () => void } = $props();

  let level = $derived($notificationLevels[chatId] ?? DEFAULT_NOTIFICATION_LEVEL);
</script>

{#if level !== DEFAULT_NOTIFICATION_LEVEL}
  <button
    type="button"
    class="notification-level-indicator"
    title={$t('messaging.notificationLevel.title')}
    aria-label={$t(
      level === 'nothing'
        ? 'messaging.notificationLevel.indicatorMutedAria'
        : 'messaging.notificationLevel.indicatorAllAria'
    )}
    onclick={onOpen}
  >
    {$t(level === 'nothing' ? 'messaging.notificationLevel.indicatorMuted' : 'messaging.notificationLevel.indicatorAll')}
  </button>
{/if}

<style>
  .notification-level-indicator {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-muted);
    font-size: 0.6875rem;
    font-weight: 600;
    line-height: 1.4;
    cursor: pointer;
    white-space: nowrap;
  }

  .notification-level-indicator:hover {
    color: var(--text-secondary);
    border-color: var(--text-muted);
  }
</style>
