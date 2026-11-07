<script lang="ts">
  import { t } from 'svelte-i18n';
  import { eventTimeFormat } from '../../stores/event-time-format';
</script>

<label class="event-time-format">
  <span>{$t('events.timeFormat.label')}</span>
  <select bind:value={$eventTimeFormat}>
    <option value="system">{$t('events.timeFormat.system')}</option>
    <option value="12h">{$t('events.timeFormat.12h')}</option>
    <option value="24h">{$t('events.timeFormat.24h')}</option>
  </select>
</label>

<style>
  .event-time-format {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: 13px;
    color: var(--text-secondary);
  }

  select {
    max-width: 100%;
    min-height: 32px;
    padding: 6px 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-panel);
    color: var(--text-primary);
    font: inherit;
  }

  select:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }
</style>
