<script lang="ts">
  import { activeDmTab, dmList, pendingList, requestsList, activeDmId, type DmEntry } from '../stores/app';
  import userPlaceholder from '../icons/user-placeholder.svg';

  $: title = $activeDmTab === 'friends' ? 'Friends' : $activeDmTab === 'requests' ? 'Requests' : 'Pending';
  $: entries = $activeDmTab === 'friends' ? $dmList : $activeDmTab === 'requests' ? $requestsList : $pendingList;

  function displayName(entry: DmEntry): string {
    if (entry.name && entry.name.trim()) return entry.name.trim();
    return truncateNpub(entry.npub);
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

  <div class="dm-list-container">
    {#if entries.length > 0}
      <ul class="dm-list" role="list">
        {#each entries as entry (entry.npub)}
          <li>
            <button
              type="button"
              class="dm-row"
              class:active={$activeDmId === entry.npub}
              on:click={() => selectDm(entry.npub)}
              on:keydown={(e) => e.key === 'Enter' && selectDm(entry.npub)}
            >
              <span class="dm-avatar">
                {#if entry.avatar}
                  <img src={entry.avatar} alt="" class="dm-avatar-img" />
                {:else}
                  <img src={userPlaceholder} alt="" class="dm-avatar-placeholder" />
                {/if}
              </span>
              <span class="dm-name">{displayName(entry)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="empty-state">
        <p>{$activeDmTab === 'friends' ? 'No DMs yet' : $activeDmTab === 'requests' ? 'No requests' : 'No pending chats'}</p>
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
    background-color: #202020;
    display: flex;
    flex-direction: column;
    position: relative;
    flex-shrink: 0;
    border-left: 1px solid #313338;
  }

  .messenger-header {
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #313338;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .messenger-title {
    font-size: 1rem;
    font-weight: 600;
    color: #f2f3f5;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    color: #f2f3f5;
    font-size: 0.9375rem;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s;
    outline: none;
  }

  .dm-row:hover {
    background-color: #313338;
  }

  .dm-row:focus-visible {
    outline: 2px solid #5865f2;
    outline-offset: -2px;
  }

  .dm-row.active {
    background-color: #313338;
    color: #f2f3f5;
  }

  .dm-avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    background-color: #313338;
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

  .dm-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #949ba4;
    font-size: 0.875rem;
    padding: 16px;
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
    background-color: #5865f2;
  }
</style>
