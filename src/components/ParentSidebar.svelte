<script lang="ts">
  import Channel from './Channel.svelte';
  import ResizableSidebar from './ResizableSidebar.svelte';
  import ParentSettingUp from './ParentSettingUp.svelte';
  import chevronDownIcon from '../icons/chevron-down.svg';

  /** Channel shape for list items (name, groupId, order). Re-exported via type. */
  interface ParentChannel {
    name: string;
    groupId: string;
    order: number;
  }

  export let type: 'squad' | 'network' = 'squad';
  export let parentName = '';
  export let subheading: string | undefined = undefined;
  export let channels: ParentChannel[] = [];
  export let activeChannelId: string | null = null;
  export let activeView = 'hub';
  export let creating = false;
  export let createError = '';
  export let canRetryCreate = false;
  export let retryingCreate = false;
  export let emptyMessage = 'Select a parent';
  /** When false, show empty state instead of header/channels. */
  export let hasParent = false;
  /**
   * Error banners to show below the header. Each can have an optional dismiss handler.
   * If onDismissBanner is provided, a dismiss button is shown.
   */
  export let errorBanners: { id: string; text: string }[] = [];
  export let onDismissBanner: ((id: string) => void) | undefined = undefined;

  export let onSelectChannel: (groupId: string) => void = () => {};
  export let onCreateChannel: () => void = () => {};
  export let onRetryCreate: () => void = () => {};
  export let onInvite: () => void = () => {};
  /** Only used when type === 'squad'. */
  export let onExitSquad: (() => void) | undefined = undefined;
  /** Only used when type === 'network'. */
  export let onExitNetwork: (() => void) | undefined = undefined;

  let menuOpen = false;
  const createErrorId = 'parent-create-error';

  $: inviteLabel = type === 'squad' ? 'Invite to Squad' : 'Invite to Network';
  $: showExitSquad = type === 'squad' && typeof onExitSquad === 'function';
  $: showExitNetwork = type === 'network' && typeof onExitNetwork === 'function';
  $: showExit = showExitSquad || showExitNetwork;
  $: exitLabel = type === 'squad' ? 'Exit Squad' : 'Exit Network';
  $: onExit = type === 'squad' ? onExitSquad : onExitNetwork;
</script>

<svelte:window
  on:click={(e) => {
    const t = e.target as HTMLElement | null;
    if (menuOpen && t && !t.closest('.parent-header-actions')) menuOpen = false;
  }}
/>

<ResizableSidebar sidebarClass="parent-sidebar">
  {#if hasParent}
    <div class="parent-heading" role="region" aria-label="{type === 'squad' ? 'Squad' : 'Network'} {parentName}">
      <div class="parent-header-row">
        <h2 class="parent-name">{parentName}</h2>
        <div class="parent-header-actions">
          <button
            type="button"
            class="parent-menu-btn"
            title="{type === 'squad' ? 'Squad' : 'Network'} options"
            aria-label="{type === 'squad' ? 'Squad' : 'Network'} menu"
            on:click={() => (menuOpen = !menuOpen)}
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <img src={chevronDownIcon} alt="" class="parent-menu-chevron" />
          </button>
          {#if menuOpen}
            <div class="parent-menu-dropdown" role="menu">
              <button
                type="button"
                class="parent-menu-item"
                role="menuitem"
                on:click={() => {
                  menuOpen = false;
                  onInvite();
                }}
              >
                {inviteLabel}
              </button>
              {#if showExit && onExit}
                <button
                  type="button"
                  class="parent-menu-item parent-menu-item-exit"
                  role="menuitem"
                  on:click={() => {
                    menuOpen = false;
                    onExit();
                  }}
                >
                  {exitLabel}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      </div>
      {#if subheading}
        <p class="parent-subheading">{subheading}</p>
      {/if}
    </div>
    {#each errorBanners as banner (banner.id)}
      <div class="parent-error-banner" role="alert">
        {banner.text}
        {#if onDismissBanner}
          <button
            type="button"
            class="parent-error-dismiss"
            on:click={() => onDismissBanner(banner.id)}
            aria-label="Dismiss"
          >×</button>
        {/if}
      </div>
    {/each}
    <div class="parent-channels-container">
      {#if creating}
        <ParentSettingUp
          errorId={createErrorId}
          error={createError}
          canRetry={canRetryCreate}
          retrying={retryingCreate}
          onRetry={onRetryCreate}
        />
      {:else}
        <div class="parent-channel-list">
          {#each channels as channel (channel.groupId)}
            <div
              on:click={() => onSelectChannel(channel.groupId)}
              on:keydown={(e) => e.key === 'Enter' && onSelectChannel(channel.groupId)}
              role="button"
              tabindex="0"
            >
              <Channel
                name={channel.name}
                type="text"
                active={activeView === 'hub' && activeChannelId === channel.groupId}
              />
            </div>
          {/each}
        </div>
        {#if channels.length > 0}
          <button type="button" class="parent-create-channel-btn" on:click={onCreateChannel}>
            + Create channel
          </button>
        {/if}
      {/if}
    </div>
  {:else}
    <div class="parent-empty-state">
      <p>{emptyMessage}</p>
    </div>
  {/if}
</ResizableSidebar>

<style>
  :global(.parent-sidebar) {
    height: 100%;
    background-color: var(--bg-panel);
    display: flex;
    flex-direction: column;
    position: relative;
    flex-shrink: 0;
    border-left: 1px solid var(--border-subtle);
  }

  .parent-heading {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .parent-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .parent-name {
    flex: 1;
    min-width: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 4px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .parent-subheading {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .parent-header-actions {
    position: relative;
    flex-shrink: 0;
  }

  .parent-menu-btn {
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 1.125rem;
    line-height: 1;
    cursor: pointer;
  }

  .parent-menu-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .parent-menu-chevron {
    width: 18px;
    height: 18px;
    display: block;
    filter: var(--icon-dropdown-filter);
  }

  .parent-menu-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 160px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 50;
    padding: 4px 0;
  }

  .parent-menu-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
  }

  .parent-menu-item:hover {
    background: var(--bg-hover);
  }

  .parent-menu-item-exit {
    color: var(--danger);
  }

  .parent-menu-item-exit:hover {
    background: rgba(237, 66, 69, 0.15);
    color: var(--danger);
  }

  .parent-error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(242, 63, 66, 0.15);
    border: 1px solid rgba(242, 63, 66, 0.4);
    border-radius: 6px;
    margin: 8px 12px 0;
    color: var(--danger);
    font-size: 0.875rem;
  }

  .parent-error-dismiss {
    margin-left: auto;
    padding: 0 4px;
    background: none;
    border: none;
    color: inherit;
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0.8;
  }

  .parent-error-dismiss:hover {
    opacity: 1;
  }

  .parent-channels-container {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .parent-channel-list {
    display: flex;
    flex-direction: column;
  }

  .parent-channel-list > div {
    cursor: pointer;
    border-radius: 4px;
  }

  .parent-create-channel-btn {
    width: 100%;
    margin-top: 8px;
    padding: 8px 12px;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 0.875rem;
    cursor: pointer;
    text-align: left;
  }

  .parent-create-channel-btn:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
    border-color: var(--border);
  }

  .parent-empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }
</style>
