<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
  import { showToast } from '../../stores/toast';
  import {
    commonsHiddenRevision,
    getHiddenCommonsBroadcasts,
    getHiddenCommonsCategoryIds,
    unhideCommonsBroadcast,
    unhideCommonsCategory,
  } from '../../lib/commons/commons-hidden';
  import { getLocalizedCommonsTagCategory } from '../../lib/commons/tag-catalog';

  const hiddenBroadcasts = $derived.by(() => {
    $commonsHiddenRevision;
    return getHiddenCommonsBroadcasts();
  });

  interface HiddenCategoryRow {
    id: string;
    title: string;
  }

  const hiddenCategories = $derived.by(() => {
    $commonsHiddenRevision;
    const rows: HiddenCategoryRow[] = [];
    for (const id of getHiddenCommonsCategoryIds()) {
      const category = getLocalizedCommonsTagCategory($t, id);
      if (category) rows.push({ id, title: category.title });
    }
    return rows;
  });

  function handleUnhideBroadcast(eventId: string, title: string) {
    unhideCommonsBroadcast(eventId);
    showToast($t('commons.hiddenSection.unhideToast', { values: { title } }));
  }

  function handleUnhideCategory(categoryId: string, title: string) {
    unhideCommonsCategory(categoryId);
    showToast($t('commons.hiddenSection.unhideToast', { values: { title } }));
  }
</script>

<SettingsCollapsibleSection sectionId="settings-commons" title={$t('settings.commonsSettingsTitle')}>
  <div class="hidden-commons-settings">
    <p class="hidden-commons-hint">{$t('commons.hiddenSection.description')}</p>

    <div class="hidden-commons-group">
      <h3 class="hidden-commons-subheading">{$t('commons.hiddenSection.categoriesTitle')}</h3>
      {#if hiddenCategories.length === 0}
        <p class="hidden-commons-empty">{$t('commons.hiddenSection.emptyCategories')}</p>
      {:else}
        <ul class="hidden-commons-list" role="list">
          {#each hiddenCategories as row (row.id)}
            <li class="hidden-commons-row">
              <span class="hidden-commons-title">{row.title}</span>
              <button
                type="button"
                class="hidden-commons-unhide"
                aria-label={$t('commons.hiddenSection.unhideAria', { values: { title: row.title } })}
                onclick={() => handleUnhideCategory(row.id, row.title)}
              >
                {$t('commons.hiddenSection.unhide')}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="hidden-commons-group">
      <h3 class="hidden-commons-subheading">{$t('commons.hiddenSection.broadcastsTitle')}</h3>
      {#if hiddenBroadcasts.length === 0}
        <p class="hidden-commons-empty">{$t('commons.hiddenSection.emptyBroadcasts')}</p>
      {:else}
        <ul class="hidden-commons-list" role="list">
          {#each hiddenBroadcasts as record (record.eventId)}
            <li class="hidden-commons-row">
              <span class="hidden-commons-broadcast">
                <span class="hidden-commons-title">{record.title}</span>
                <span class="hidden-commons-subtitle">{record.subtitle}</span>
              </span>
              <button
                type="button"
                class="hidden-commons-unhide"
                aria-label={$t('commons.hiddenSection.unhideAria', { values: { title: record.title } })}
                onclick={() => handleUnhideBroadcast(record.eventId, record.title)}
              >
                {$t('commons.hiddenSection.unhide')}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</SettingsCollapsibleSection>

<style>
  .hidden-commons-settings {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .hidden-commons-hint {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .hidden-commons-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .hidden-commons-subheading {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }

  .hidden-commons-empty {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .hidden-commons-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .hidden-commons-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  .hidden-commons-broadcast {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .hidden-commons-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hidden-commons-subtitle {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .hidden-commons-unhide {
    flex-shrink: 0;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .hidden-commons-unhide:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
</style>
