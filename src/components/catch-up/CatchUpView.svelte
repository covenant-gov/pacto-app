<script lang="ts">
  import { t } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import { catchUpEntries, catchUpError, catchUpLoading, groupCatchUpEntriesBySquad, hydrateCatchUp } from '../../stores/catch-up';
  import { squads } from '../../stores/squads';
  import CatchUpFilters from './CatchUpFilters.svelte';
  import CatchUpEntry from './CatchUpEntry.svelte';

  onMount(() => {
    void hydrateCatchUp();
  });

  let groups = $derived(groupCatchUpEntriesBySquad($catchUpEntries, $squads));
</script>

<div class="catch-up-view">
  <div class="catch-up-header">
    <h2 class="catch-up-title">{$t('notifications.catchup.title')}</h2>
    <button
      type="button"
      class="catch-up-refresh"
      aria-label={$t('notifications.catchup.refreshAria')}
      title={$t('notifications.catchup.refreshAria')}
      onclick={() => hydrateCatchUp()}
    >
      ↻
    </button>
  </div>
  <CatchUpFilters />
  <div class="catch-up-body">
    {#if $catchUpLoading && $catchUpEntries.length === 0}
      <p class="catch-up-status" role="status">{$t('notifications.catchup.loading')}</p>
    {:else if $catchUpError}
      <p class="catch-up-status catch-up-status-error" role="alert">{$catchUpError}</p>
    {:else if $catchUpEntries.length === 0}
      <div class="catch-up-empty" role="status">
        <p class="catch-up-empty-title">{$t('notifications.catchup.emptyTitle')}</p>
        <p class="catch-up-empty-body">{$t('notifications.catchup.emptyBody')}</p>
      </div>
    {:else}
      {#each groups as group (group.key)}
        <div class="catch-up-group">
          <h3 class="catch-up-group-label">
            {group.label ?? $t('notifications.catchup.dmGroupLabel')}
          </h3>
          <ul class="catch-up-group-list">
            {#each group.entries as entry (entry.id)}
              <CatchUpEntry {entry} />
            {/each}
          </ul>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .catch-up-view {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background-color: var(--border-subtle);
  }

  .catch-up-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border-subtle);
  }

  .catch-up-title {
    margin: 0;
    font-size: 1.0625rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .catch-up-refresh {
    border: none;
    background: none;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
  }

  .catch-up-refresh:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .catch-up-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .catch-up-status {
    padding: 24px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .catch-up-status-error {
    color: var(--danger, #d64545);
  }

  .catch-up-empty {
    padding: 48px 24px;
    text-align: center;
  }

  .catch-up-empty-title {
    margin: 0 0 8px;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .catch-up-empty-body {
    margin: 0;
    max-width: 420px;
    margin-inline: auto;
    font-size: 0.8125rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .catch-up-group {
    background: var(--bg-elevated);
    margin-top: 8px;
  }

  .catch-up-group:first-child {
    margin-top: 0;
  }

  .catch-up-group-label {
    margin: 0;
    padding: 8px 12px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border-subtle);
  }

  .catch-up-group-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
