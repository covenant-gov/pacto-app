<script lang="ts">
  import {
    activeDmTab,
    dmList,
    pendingList,
    requestsList,
    pinnedList,
    activeDmId,
    allDmEntriesUnified,
    dmChatsByNpub,
    pinnedDmNpubs,
    dmSidebarCategoryForNpub,
    PACTO_APP_DM_THREAD_ID,
    PACTO_APP_DISPLAY_NAME,
    type DmEntry,
    type DmTab,
    type DmSidebarCategory,
  } from '../../stores/app';
  import { profiles } from '../../stores/profiles';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import userPlaceholder from '../../icons/user-placeholder.svg';

  $: title =
    $activeDmTab === 'friends'
      ? 'Friends'
      : $activeDmTab === 'requests'
        ? 'Requests'
        : $activeDmTab === 'pending'
          ? 'Pending'
          : $activeDmTab === 'search'
            ? 'Search'
            : 'Pinned';

  function displayName(entry: DmEntry): string {
    const profile = $profiles[entry.npub];
    if (profile) return getProfileDisplayName(profile);
    return entry.name?.trim() || truncateNpub(entry.npub);
  }

  /** Search tab: filter unified list by npub or display name (case-insensitive substring). */
  let dmSearchQuery = '';

  function matchesDmSearch(entry: DmEntry, rawQuery: string): boolean {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return true;
    if (entry.npub.toLowerCase().includes(q)) return true;
    return displayName(entry).toLowerCase().includes(q);
  }

  function tabSourceList(tab: DmTab): DmEntry[] {
    if (tab === 'friends') return $dmList as DmEntry[];
    if (tab === 'requests') return $requestsList as DmEntry[];
    if (tab === 'pending') return $pendingList as DmEntry[];
    if (tab === 'pinned') return $pinnedList as DmEntry[];
    return $allDmEntriesUnified as DmEntry[];
  }

  $: filteredEntries = (() => {
    const tab = $activeDmTab;
    const list = tabSourceList(tab);
    if (tab === 'search' && dmSearchQuery.trim() !== '') {
      return list.filter((e) => matchesDmSearch(e, dmSearchQuery));
    }
    return list;
  })();

  function categoryLabel(cat: DmSidebarCategory): string {
    switch (cat) {
      case 'pinned':
        return 'Pinned';
      case 'friends':
        return 'Friends';
      case 'requests':
        return 'Requests';
      case 'pending':
        return 'Pending';
    }
  }

  function truncateNpub(npub: string): string {
    if (npub.length <= 16) return npub;
    return npub.slice(0, 8) + '…' + npub.slice(-4);
  }

  function selectDm(npub: string) {
    $activeDmId = npub;
  }

  let width = 240;
  let isResizing = false;
  const minWidth = 180;
  const maxWidth = 400;

  function startResize() {
    isResizing = true;
  }

  function onMouseMove(event: MouseEvent) {
    if (!isResizing) return;
    const newWidth = event.clientX - 64;
    width = Math.max(minWidth, Math.min(maxWidth, newWidth));
  }

  function stopResize() {
    isResizing = false;
  }
</script>

<svelte:window
  on:mousemove={onMouseMove}
  on:mouseup={stopResize}
/>

<div class="messenger-navbar" style="width: {width}px;">
  <div class="messenger-header">
    <h2 class="messenger-title">{title}</h2>
  </div>

  {#if $activeDmTab === 'search'}
    <div class="messenger-search-wrap">
      <label class="messenger-search-label" for="messenger-dm-search">Search</label>
      <input
        id="messenger-dm-search"
        type="search"
        class="messenger-search-input"
        placeholder="Name or npub (all lists)…"
        bind:value={dmSearchQuery}
        autocomplete="off"
        spellcheck="false"
        aria-label="Search direct messages by name or npub"
      />
    </div>
  {/if}

  <div class="dm-list-container">
    {#if $activeDmTab === 'pinned'}
      <ul class="dm-list dm-list-pacto-app" role="list">
        <li>
          <button
            type="button"
            class="dm-row dm-row-pacto-app"
            class:active={$activeDmId === PACTO_APP_DM_THREAD_ID}
            on:click={() => selectDm(PACTO_APP_DM_THREAD_ID)}
            on:keydown={(ev) => ev.key === 'Enter' && selectDm(PACTO_APP_DM_THREAD_ID)}
          >
            <span class="dm-avatar dm-avatar-pacto-app">
              <span class="dm-avatar-pacto-app-letter" aria-hidden="true">P</span>
            </span>
            <span class="dm-name-block">
              <span class="dm-name">{PACTO_APP_DISPLAY_NAME}</span>
            </span>
          </button>
        </li>
      </ul>
    {/if}
    {#if filteredEntries.length > 0}
      <ul class="dm-list" role="list">
        {#each filteredEntries as raw ((raw as DmEntry).npub)}
          {@const row = raw as DmEntry}
          {@const avatarSrc = getProfileAvatarSrc($profiles[row.npub])}
          {@const cat =
            $activeDmTab === 'search'
              ? dmSidebarCategoryForNpub(row.npub, $dmChatsByNpub, $pinnedDmNpubs)
              : null}
          <li>
            <button
              type="button"
              class="dm-row"
              class:active={$activeDmId === row.npub}
              on:click={() => selectDm(row.npub)}
              on:keydown={(ev) => ev.key === 'Enter' && selectDm(row.npub)}
            >
              <span class="dm-avatar">
                {#if avatarSrc}
                  <img src={avatarSrc} alt="" class="dm-avatar-img" />
                {:else}
                  <img src={userPlaceholder} alt="" class="dm-avatar-placeholder" />
                {/if}
              </span>
              <span class="dm-name-block">
                <span class="dm-name">{displayName(row)}</span>
                {#if cat}
                  <span class="dm-category">{categoryLabel(cat)}</span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if $activeDmTab !== 'pinned'}
      <div class="empty-state">
        <p>
          {$activeDmTab === 'search' && dmSearchQuery.trim() !== ''
            ? 'No matches'
            : $activeDmTab === 'search'
              ? 'No DMs yet'
              : $activeDmTab === 'friends'
                ? 'No DMs yet'
                : $activeDmTab === 'requests'
                  ? 'No requests'
                  : $activeDmTab === 'pending'
                    ? 'No pending chats'
                    : 'No pinned DMs'}
        </p>
      </div>
    {/if}
  </div>

  <button
    class="resize-handle"
    on:mousedown={startResize}
    aria-label="Resize sidebar"
    type="button"
  ></button>
</div>

<style>
  .messenger-navbar {
    height: 100%;
    background-color: var(--bg-panel);
    display: flex;
    flex-direction: column;
    position: relative;
    flex-shrink: 0;
    border-left: 1px solid var(--border-subtle);
  }

  .messenger-header {
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border-subtle);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .messenger-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .messenger-search-wrap {
    padding: 8px 12px 10px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .messenger-search-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .messenger-search-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    font-size: 0.875rem;
    font-family: inherit;
    color: var(--text-primary);
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    outline: none;
  }

  .messenger-search-input::placeholder {
    color: var(--text-muted);
  }

  .messenger-search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .dm-list-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .dm-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .dm-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    margin: 0 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.9375rem;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s;
    outline: none;
  }

  .dm-row:hover {
    background-color: var(--border-subtle);
  }

  .dm-row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .dm-row.active {
    background-color: var(--border-subtle);
    color: var(--text-primary);
  }

  .dm-avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    background-color: var(--border-subtle);
  }

  .dm-avatar-img,
  .dm-avatar-placeholder {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .dm-avatar-placeholder {
    opacity: 0.7;
  }

  .dm-name-block {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .dm-name {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dm-category {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.875rem;
    padding: 16px;
  }

  .dm-list-pacto-app {
    margin-bottom: 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .dm-avatar-pacto-app {
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dm-avatar-pacto-app-letter {
    color: var(--accent-contrast, #fff);
    font-weight: 700;
    font-size: 0.875rem;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
    background-color: transparent;
    transition: background-color 0.15s;
    border: none;
    padding: 0;
    outline: none;
  }

  .resize-handle:hover,
  .resize-handle:focus {
    background-color: var(--accent);
  }
</style>
