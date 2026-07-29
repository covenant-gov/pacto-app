<script lang="ts">
  import { t } from 'svelte-i18n';
  import { squads } from '../../stores/squads';
  import { catchUpFilter, setCatchUpFilter, markAllCatchUpRead, catchUpEntries } from '../../stores/catch-up';
  import { showToast } from '../../stores/toast';

  let marking = $state(false);

  let mode = $derived($catchUpFilter.squadId ? 'squad' : ($catchUpFilter.kind ?? 'all'));

  function selectKind(kind: string | undefined) {
    setCatchUpFilter(kind ? { kind } : {});
  }

  function selectSquad(event: Event) {
    const squadId = (event.currentTarget as HTMLSelectElement).value;
    setCatchUpFilter(squadId ? { squadId } : {});
  }

  async function markAll() {
    if (marking || $catchUpEntries.length === 0) return;
    marking = true;
    try {
      await markAllCatchUpRead();
    } catch (e) {
      showToast(e instanceof Error ? e.message : $t('notifications.catchup.markAllError'));
    } finally {
      marking = false;
    }
  }
</script>

<div class="catch-up-filters">
  <div class="catch-up-filter-buttons" role="group" aria-label={$t('notifications.catchup.title')}>
    <button type="button" class="catch-up-filter-btn" class:active={mode === 'all'} onclick={() => selectKind(undefined)}>
      {$t('notifications.catchup.filterAll')}
    </button>
    <button
      type="button"
      class="catch-up-filter-btn"
      class:active={mode === 'action_prompt'}
      onclick={() => selectKind('action_prompt')}
    >
      {$t('notifications.catchup.filterNeedsAction')}
    </button>
    <button
      type="button"
      class="catch-up-filter-btn"
      class:active={mode === 'mention'}
      onclick={() => selectKind('mention')}
    >
      {$t('notifications.catchup.filterMentions')}
    </button>
  </div>
  <select
    class="catch-up-filter-squad"
    aria-label={$t('notifications.catchup.filterSquadAria')}
    value={$catchUpFilter.squadId ?? ''}
    onchange={selectSquad}
  >
    <option value="">{$t('notifications.catchup.filterSquadAll')}</option>
    {#each $squads as squad (squad.id)}
      <option value={squad.id}>{squad.name}</option>
    {/each}
  </select>
  <button
    type="button"
    class="catch-up-mark-all-btn"
    onclick={markAll}
    disabled={marking || $catchUpEntries.length === 0}
  >
    {$t('notifications.catchup.markAllRead')}
  </button>
</div>

<style>
  .catch-up-filters {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
    flex-wrap: wrap;
  }

  .catch-up-filter-buttons {
    display: inline-flex;
    gap: 4px;
  }

  .catch-up-filter-btn {
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-panel);
    color: var(--text-muted);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .catch-up-filter-btn:hover {
    color: var(--text-secondary);
  }

  .catch-up-filter-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .catch-up-filter-squad {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }

  .catch-up-mark-all-btn {
    margin-left: auto;
    padding: 5px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: none;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .catch-up-mark-all-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .catch-up-mark-all-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
