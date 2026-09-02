<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import CommonsTopFilters from './CommonsTopFilters.svelte';
  import CommonsCategoryFocus from './CommonsCategoryFocus.svelte';
  import CommonsTagBrowser from './CommonsTagBrowser.svelte';
  import CommonsTagMenu from './CommonsTagMenu.svelte';
  import CommonsPersonalPanel from './CommonsPersonalPanel.svelte';
  import CommonsEarlyAdopterCta from './CommonsEarlyAdopterCta.svelte';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';
  import CommonsBroadcastCard from './CommonsBroadcastCard.svelte';
  import type { CommonsBroadcastDto } from '../../lib/commons/types';
  import {
    COMMONS_FEED_REFRESH_MS,
    DEFAULT_COMMONS_FEED_FILTERS,
    dedupeCommonsBroadcasts,
    isCommonsBroadcastActive,
    prepareCommonsFeed,
    type CommonsAudienceFilter,
    type CommonsBrowseMode,
    type CommonsSubjectFilter,
  } from '../../lib/commons/commons-feed';
  import {
    commonsBroadcasts,
    commonsFeedError,
    commonsFeedSyncing,
    refreshCommonsBroadcasts,
  } from '../../lib/commons/commons-prefetch';
  import {
    COMMONS_TAG_GROUPS,
    COMMONS_TAG_TREE,
    filterVisibleCommonsCategories,
    getLocalizedCommonsTagCategory,
  } from '../../lib/commons/tag-catalog';
  import {
    commonsHiddenRevision,
    getHiddenCommonsBroadcastIds,
    getHiddenCommonsCategoryIds,
    hideCommonsCategory,
  } from '../../lib/commons/commons-hidden';
  import { showToast } from '../../stores/toast';
  import { activeTopNavTab } from '../../stores/navigation';
  import {
    commonsBroadcastModalClosedNonce,
    openCommonsBroadcastModal,
  } from '../../stores/commons-ui';
  import { profiles, loadProfile } from '../../stores/profiles';
  import { get } from 'svelte/store';

  let filterTags: string[] = $state([...DEFAULT_COMMONS_FEED_FILTERS.tags]);
  let filterCategoryId: string | null = $state(DEFAULT_COMMONS_FEED_FILTERS.categoryId);
  let focusedCategoryId: string | null = $state(null);
  let browseMode: CommonsBrowseMode = $state('categories');
  let subjectFilter: CommonsSubjectFilter = $state(DEFAULT_COMMONS_FEED_FILTERS.subjectFilter);
  let audienceFilter: CommonsAudienceFilter = $state(DEFAULT_COMMONS_FEED_FILTERS.audienceFilter);

  let personalNonce = $state(0);
  let lastModalClosedNonce = 0;
  let tagMenuOpen = $state(false);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let wasCommonsActive = false;

  const feedFilters = $derived({ tags: filterTags, categoryId: filterCategoryId, subjectFilter, audienceFilter });
  const hiddenBroadcastIds = $derived.by(() => {
    $commonsHiddenRevision;
    return getHiddenCommonsBroadcastIds();
  });
  const hiddenCategoryIds = $derived.by(() => {
    $commonsHiddenRevision;
    return new Set(getHiddenCommonsCategoryIds());
  });
  const visibleCategories = $derived(filterVisibleCommonsCategories(COMMONS_TAG_TREE, hiddenCategoryIds));
  const filteredBroadcasts = $derived(prepareCommonsFeed($commonsBroadcasts, feedFilters, hiddenBroadcastIds));
  const latestBroadcasts = $derived(
    prepareCommonsFeed(
      $commonsBroadcasts,
      { tags: [], categoryId: null, subjectFilter, audienceFilter },
      hiddenBroadcastIds
    )
  );
  const hasTagFilters = $derived(
    filterTags.length > 0 ||
    filterCategoryId != null ||
    focusedCategoryId != null
  );
  const hasFilters = $derived(
    hasTagFilters ||
    subjectFilter !== 'both' ||
    audienceFilter !== 'any'
  );
  const showTileGrid = $derived(
    browseMode === 'categories' && !tagMenuOpen && focusedCategoryId == null && !hasTagFilters
  );
  const categoryAllMode = $derived(focusedCategoryId != null && filterCategoryId != null && filterTags.length === 0);
  const focusedCategoryTitle = $derived.by(() => {
    const catId = focusedCategoryId;
    return catId ? (getLocalizedCommonsTagCategory($t, catId)?.title ?? catId.toUpperCase()) : null;
  });

  // Active broadcast counts per catalog tag for the grid "live" badges. Excludes hidden broadcasts.
  const countsByTag = $derived.by(() => {
    const counts: Record<string, number> = {};
    const active = dedupeCommonsBroadcasts($commonsBroadcasts).filter(
      (b) => isCommonsBroadcastActive(b) && !hiddenBroadcastIds.has(b.eventId)
    );
    const known = new Set(COMMONS_TAG_GROUPS.map((g) => g.tag));
    for (const b of active) {
      for (const tag of b.tags) {
        if (known.has(tag)) counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return counts;
  });

  function handleHideCategory(categoryId: string, title: string) {
    hideCommonsCategory(categoryId);
    showToast($t('commons.tagBrowser.hideToast', { values: { title } }));
  }

  async function loadFeed(options: { silent?: boolean } = {}) {
    const rows = await refreshCommonsBroadcasts(options);
    prefetchAuthorProfiles(rows);
  }

  /** Resolve PFPs for user broadcast authors that aren't cached yet. */
  function prefetchAuthorProfiles(list: CommonsBroadcastDto[]) {
    const cached = get(profiles);
    const pending = new Set<string>();
    for (const b of list) {
      if (b.subject === 'user' && b.authorNpub && !cached[b.authorNpub]) {
        pending.add(b.authorNpub);
      }
    }
    for (const npub of pending) {
      void loadProfile(npub).catch(() => {});
    }
  }

  /** Category tile: ANY of all tags in the category; opens focused drill-down. */
  function selectCategory(categoryId: string) {
    browseMode = 'categories';
    tagMenuOpen = false;
    focusedCategoryId = categoryId;
    filterCategoryId = categoryId;
    filterTags = [];
  }

  function clearCategoryFocus() {
    focusedCategoryId = null;
    filterCategoryId = null;
    filterTags = [];
  }

  /** Tag pick inside focused category drill-down (AND up to 3, same category only). */
  function toggleFocusedCategoryTag(tag: string) {
    if (!focusedCategoryId) return;

    if (filterCategoryId != null) {
      filterCategoryId = null;
      filterTags = [tag];
      return;
    }

    if (filterTags.includes(tag)) {
      filterTags = filterTags.filter((t) => t !== tag);
      if (filterTags.length === 0) {
        filterCategoryId = focusedCategoryId;
      }
      return;
    }

    if (filterTags.length >= 3) return;
    filterTags = [...filterTags, tag];
  }

  function removeFilterTag(tag: string) {
    filterTags = filterTags.filter((t) => t !== tag);
    if (filterTags.length === 0 && focusedCategoryId) {
      filterCategoryId = focusedCategoryId;
    }
  }

  /** Global tag menu: AND up to 3 tags; exits category focus. */
  function selectFocusedTag(tag: string) {
    browseMode = 'categories';
    focusedCategoryId = null;
    filterCategoryId = null;
    if (filterTags.includes(tag)) {
      filterTags = filterTags.filter((t) => t !== tag);
      return;
    }
    if (filterTags.length >= 3) return;
    filterTags = [...filterTags, tag];
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      void loadFeed({ silent: true });
    }, COMMONS_FEED_REFRESH_MS);
  }

  $effect(() => {
    if ($commonsBroadcastModalClosedNonce !== lastModalClosedNonce) {
      lastModalClosedNonce = $commonsBroadcastModalClosedNonce;
      personalNonce += 1;
      void loadFeed({ silent: true });
    }
  });

  $effect(() => {
    const commonsActive = $activeTopNavTab === 'commons';
    if (commonsActive && !wasCommonsActive) {
      void loadFeed({ silent: get(commonsBroadcasts).length > 0 });
      startPolling();
    } else if (!commonsActive && wasCommonsActive) {
      stopPolling();
    }
    wasCommonsActive = commonsActive;
  });

  onDestroy(() => {
    stopPolling();
  });
</script>

<section class="commons-area" aria-labelledby="commons-feed-heading">
  <div class="commons-scroll">
    <header class="commons-header">
      <div class="commons-header-row">
        <h1 id="commons-feed-heading" class="commons-title">{$t('commons.view.title')}</h1>
        <RefreshIconButton
          disabled={$commonsFeedSyncing}
          spinning={$commonsFeedSyncing}
          ariaLabel={$commonsFeedSyncing ? $t('commons.view.refreshSyncing') : $t('commons.view.refresh')}
          onclick={() => loadFeed()}
        />
      </div>
    </header>

    <CommonsPersonalPanel
      refreshKey={personalNonce}
      onBroadcast={openCommonsBroadcastModal}
      onChanged={() => {
        personalNonce += 1;
        void loadFeed({ silent: true });
      }}
    />

    <CommonsEarlyAdopterCta />

    <CommonsTopFilters
      bind:tags={filterTags}
      bind:categoryId={filterCategoryId}
      bind:subjectFilter
      bind:audienceFilter
      bind:tagMenuOpen
      bind:focusedCategoryId
      bind:browseMode
      onRemoveTag={removeFilterTag}
      onClearCategory={clearCategoryFocus}
    />

    {#if $commonsFeedError}
      <p class="commons-state commons-state-error" role="alert">{$commonsFeedError}</p>
    {/if}

    {#if tagMenuOpen}
      <CommonsTagMenu
        activeTags={filterTags}
        {countsByTag}
        onToggleTag={selectFocusedTag}
      />
    {:else if browseMode === 'latest'}
      {#if $commonsFeedSyncing && $commonsBroadcasts.length === 0}
        <p class="commons-state muted" role="status">{$t('commons.view.loading')}</p>
      {:else if latestBroadcasts.length === 0}
        <p class="commons-state muted" role="status">{$t('commons.view.noMatches')}</p>
      {:else}
        <ul class="commons-results" role="feed" aria-busy={$commonsFeedSyncing}>
          {#each latestBroadcasts as broadcast (broadcast.eventId)}
            <li>
              <CommonsBroadcastCard {broadcast} />
            </li>
          {/each}
        </ul>
      {/if}
    {:else if focusedCategoryId}
      <CommonsCategoryFocus
        categoryId={focusedCategoryId}
        {categoryAllMode}
        activeTags={filterTags}
        {countsByTag}
        onToggleTag={toggleFocusedCategoryTag}
        onClearFocus={clearCategoryFocus}
      />

      {#if $commonsFeedSyncing && $commonsBroadcasts.length === 0}
        <p class="commons-state muted" role="status">{$t('commons.view.loading')}</p>
      {:else if filteredBroadcasts.length === 0}
        <p class="commons-state muted" role="status">{$t('commons.view.noMatches')}</p>
        <p class="commons-state-hint muted">
          {$t('commons.view.categoryHint', { values: { categoryTitle: focusedCategoryTitle } })}
        </p>
      {:else}
        <ul class="commons-results" role="feed" aria-busy={$commonsFeedSyncing}>
          {#each filteredBroadcasts as broadcast (broadcast.eventId)}
            <li>
              <CommonsBroadcastCard {broadcast} />
            </li>
          {/each}
        </ul>
      {/if}
    {:else if hasFilters}
      {#if $commonsFeedSyncing && $commonsBroadcasts.length === 0}
        <p class="commons-state muted" role="status">{$t('commons.view.loading')}</p>
      {:else if filteredBroadcasts.length === 0}
        <p class="commons-state muted" role="status">{$t('commons.view.noMatches')}</p>
        <p class="commons-state-hint muted">
          {$t('commons.view.narrowHint')}
        </p>
      {:else}
        <ul class="commons-results" role="feed" aria-busy={$commonsFeedSyncing}>
          {#each filteredBroadcasts as broadcast (broadcast.eventId)}
            <li>
              <CommonsBroadcastCard {broadcast} />
            </li>
          {/each}
        </ul>
      {/if}
    {:else if showTileGrid}
      <CommonsTagBrowser
        categories={visibleCategories}
        activeCategoryId={null}
        {countsByTag}
        onSelectCategory={selectCategory}
        onHideCategory={handleHideCategory}
      />
    {/if}
  </div>
</section>

<style>
  .commons-area {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-base, var(--bg-primary));
  }

  .commons-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px 32px 40px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .commons-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .commons-title {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
  }

  .commons-results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 4px;
  }

  .commons-state {
    margin: 24px 0 0;
    font-size: 0.9375rem;
    text-align: center;
  }

  .commons-state-error {
    color: var(--danger, #e55);
  }

  .commons-state-hint {
    margin: 4px 0 0;
    font-size: 0.8125rem;
    text-align: center;
  }

  .muted {
    color: var(--text-muted);
  }
</style>
