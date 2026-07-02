<script lang="ts">
  import { onDestroy } from 'svelte';
  import CommonsTopFilters from './CommonsTopFilters.svelte';
  import CommonsCategoryFocus from './CommonsCategoryFocus.svelte';
  import CommonsTagBrowser from './CommonsTagBrowser.svelte';
  import CommonsTagMenu from './CommonsTagMenu.svelte';
  import CommonsPersonalPanel from './CommonsPersonalPanel.svelte';
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
  import { COMMONS_TAG_GROUPS, findCommonsTagCategory } from '../../lib/commons/tag-catalog';
  import { activeTopNavTab } from '../../stores/navigation';
  import {
    commonsBroadcastModalClosedNonce,
    openCommonsBroadcastModal,
  } from '../../stores/commons-ui';
  import { profiles, loadProfile } from '../../stores/profiles';
  import { get } from 'svelte/store';

  let filterTags: string[] = [...DEFAULT_COMMONS_FEED_FILTERS.tags];
  let filterCategoryId: string | null = DEFAULT_COMMONS_FEED_FILTERS.categoryId;
  let focusedCategoryId: string | null = null;
  let browseMode: CommonsBrowseMode = 'categories';
  let subjectFilter: CommonsSubjectFilter = DEFAULT_COMMONS_FEED_FILTERS.subjectFilter;
  let audienceFilter: CommonsAudienceFilter = DEFAULT_COMMONS_FEED_FILTERS.audienceFilter;

  let personalNonce = 0;
  let lastModalClosedNonce = 0;
  let tagMenuOpen = false;

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let wasCommonsActive = false;

  $: feedFilters = { tags: filterTags, categoryId: filterCategoryId, subjectFilter, audienceFilter };
  $: filteredBroadcasts = prepareCommonsFeed($commonsBroadcasts, feedFilters);
  $: latestBroadcasts = prepareCommonsFeed($commonsBroadcasts, {
    tags: [],
    categoryId: null,
    subjectFilter,
    audienceFilter,
  });
  $: hasTagFilters =
    filterTags.length > 0 ||
    filterCategoryId != null ||
    focusedCategoryId != null;
  $: hasFilters =
    hasTagFilters ||
    subjectFilter !== 'both' ||
    audienceFilter !== 'any';
  $: showTileGrid =
    browseMode === 'categories' && !tagMenuOpen && focusedCategoryId == null && !hasTagFilters;
  $: categoryAllMode = focusedCategoryId != null && filterCategoryId != null && filterTags.length === 0;
  $: focusedCategoryTitle = focusedCategoryId
    ? (findCommonsTagCategory(focusedCategoryId)?.title ?? focusedCategoryId.toUpperCase())
    : null;

  $: if ($commonsBroadcastModalClosedNonce !== lastModalClosedNonce) {
    lastModalClosedNonce = $commonsBroadcastModalClosedNonce;
    personalNonce += 1;
    void loadFeed({ silent: true });
  }

  // Active broadcast counts per catalog tag for the grid "live" badges.
  $: countsByTag = (() => {
    const counts: Record<string, number> = {};
    const active = dedupeCommonsBroadcasts($commonsBroadcasts).filter((b) => isCommonsBroadcastActive(b));
    const known = new Set(COMMONS_TAG_GROUPS.map((g) => g.tag));
    for (const b of active) {
      for (const tag of b.tags) {
        if (known.has(tag)) counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return counts;
  })();

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

  $: {
    const commonsActive = $activeTopNavTab === 'commons';
    if (commonsActive && !wasCommonsActive) {
      void loadFeed({ silent: get(commonsBroadcasts).length > 0 });
      startPolling();
    } else if (!commonsActive && wasCommonsActive) {
      stopPolling();
    }
    wasCommonsActive = commonsActive;
  }

  onDestroy(() => {
    stopPolling();
  });
</script>

<section class="commons-area" aria-labelledby="commons-feed-heading">
  <div class="commons-scroll">
    <header class="commons-header">
      <div class="commons-header-row">
        <h1 id="commons-feed-heading" class="commons-title">Commons</h1>
        <RefreshIconButton
          disabled={$commonsFeedSyncing}
          spinning={$commonsFeedSyncing}
          ariaLabel={$commonsFeedSyncing ? 'Refreshing feed' : 'Refresh feed'}
          on:click={() => loadFeed()}
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
        <p class="commons-state muted" role="status">Loading broadcasts…</p>
      {:else if latestBroadcasts.length === 0}
        <p class="commons-state muted" role="status">No broadcasts match your filters.</p>
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
        <p class="commons-state muted" role="status">Loading broadcasts…</p>
      {:else if filteredBroadcasts.length === 0}
        <p class="commons-state muted" role="status">No broadcasts match your filters.</p>
        <p class="commons-state-hint muted">
          Try ALL-{focusedCategoryTitle} or pick fewer tags.
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
        <p class="commons-state muted" role="status">Loading broadcasts…</p>
      {:else if filteredBroadcasts.length === 0}
        <p class="commons-state muted" role="status">No broadcasts match your filters.</p>
        <p class="commons-state-hint muted">
          Try a narrower category, fewer tags, or broaden Squads / Users / Audience.
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
        activeCategoryId={null}
        {countsByTag}
        onSelectCategory={selectCategory}
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
