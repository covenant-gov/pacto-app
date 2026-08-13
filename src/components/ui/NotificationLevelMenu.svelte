<script lang="ts">
  import { t } from 'svelte-i18n';
  import { DEFAULT_NOTIFICATION_LEVEL, type NotificationLevel } from '../../lib/api/notifications';
  import { notificationLevels, setChatNotificationLevel } from '../../stores/notification-levels';
  import { showToast } from '../../stores/toast';

  let { chatId, onSelect = () => {} }: { chatId: string; onSelect?: () => void } = $props();

  let level = $derived($notificationLevels[chatId] ?? DEFAULT_NOTIFICATION_LEVEL);

  const OPTIONS: { value: NotificationLevel; labelKey: string }[] = [
    { value: 'all', labelKey: 'messaging.notificationLevel.all' },
    { value: 'mentions', labelKey: 'messaging.notificationLevel.mentions' },
    { value: 'nothing', labelKey: 'messaging.notificationLevel.nothing' },
  ];

  async function choose(value: NotificationLevel) {
    onSelect();
    if (value === level) return;
    try {
      const ok = await setChatNotificationLevel(chatId, value);
      if (!ok) showToast($t('messaging.notificationLevel.error'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : $t('messaging.notificationLevel.error'));
    }
  }
</script>

<div class="notification-level-menu" role="group" aria-label={$t('messaging.notificationLevel.title')}>
  <p class="notification-level-menu-label">{$t('messaging.notificationLevel.title')}</p>
  {#each OPTIONS as option (option.value)}
    <button
      type="button"
      class="notification-level-menu-item"
      class:notification-level-menu-item-active={level === option.value}
      role="menuitemradio"
      aria-checked={level === option.value}
      onclick={() => choose(option.value)}
    >
      <span>{$t(option.labelKey)}</span>
      {#if level === option.value}
        <span class="notification-level-menu-check" aria-hidden="true">&check;</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .notification-level-menu {
    padding: 4px 0;
    border-top: 1px solid var(--border-subtle);
    margin-top: 4px;
  }

  .notification-level-menu-label {
    margin: 4px 12px;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .notification-level-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
  }

  .notification-level-menu-item:hover {
    background: var(--bg-hover);
  }

  .notification-level-menu-item-active {
    color: var(--text-primary);
  }

  .notification-level-menu-check {
    color: var(--brand);
    font-weight: 700;
  }
</style>
