<script lang="ts">
  import Channel from '../channel/Channel.svelte';
  import ResizableSidebar from '../ui/ResizableSidebar.svelte';
  import ParentSettingUp from '../parent/ParentSettingUp.svelte';
  import { partitionHubSidebarChannels } from '../../lib/parent-navbar';
  import chevronDownIcon from '../../icons/chevron-down.svg';

  /** Channel shape for list items (name, groupId, order). Re-exported via type. */
  interface ParentChannel {
    name: string;
    groupId: string;
    order: number;
  }

  export let parentName = '';
  export let subheading: string | undefined = undefined;
  export let channels: ParentChannel[] = [];
  export let activeChannelId: string | null = null;
  /** Disambiguates selection when multiple channels share the active MLS group id. */
  export let activeHubChannelName: string | null = null;
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

  export let onSelectChannel: (channel: ParentChannel) => void = () => {};
  export let onCreateChannel: () => void = () => {};
  export let onRetryCreate: () => void = () => {};
  export let onInvite: () => void = () => {};
  export let showBroadcastSquad = false;
  export let broadcastSquadDisabled = false;
  export let broadcastSquadDisabledTitle = '';
  export let onBroadcastSquad: (() => void) | undefined = undefined;
  export let onExitSquad: (() => void) | undefined = undefined;

  /** Partner squad-pairs linked to the active hub. */
  export let partnerSquads: { id: string; name: string }[] = [];
  export let activePartnerSquadId: string | null = null;
  export let onSelectPartnerSquad: (id: string) => void = () => {};

  /** Show pair action on any hub with a pairable anchor squad. */
  export let showPairWithSquadAction = false;
  export let onPairWithSquad: (() => void) | undefined = undefined;

  let menuOpen = false;
  const createErrorId = 'parent-create-error';

  $: groupIdDupCount = channels.reduce<Record<string, number>>((acc, c) => {
    acc[c.groupId] = (acc[c.groupId] ?? 0) + 1;
    return acc;
  }, {});
  $: firstNameByGroupId = (() => {
    const m: Record<string, string> = {};
    for (const c of channels) {
      if (!(c.groupId in m)) m[c.groupId] = c.name;
    }
    return m;
  })();

  $: showPartnerSquads = partnerSquads.length > 0 || showPairWithSquadAction;
  $: ({ defaultHubChannels, customChannels } = partitionHubSidebarChannels(channels));
  $: showCustomChannelDivider = defaultHubChannels.length > 0 && customChannels.length > 0;
  $: inviteLabel = 'Invite to Squad';
  $: showBroadcastSquadItem = showBroadcastSquad || broadcastSquadDisabled;
  $: showExit = typeof onExitSquad === 'function';
  $: exitLabel = 'Exit Squad';
  $: onExit = onExitSquad;
</script>

<svelte:window
  on:click={(e) => {
    const t = e.target as HTMLElement | null;
    if (menuOpen && t && !t.closest('.parent-header-actions')) menuOpen = false;
  }}
/>

<ResizableSidebar sidebarClass="parent-sidebar">
  {#if hasParent}
    <div class="parent-heading" role="region" aria-label="Squad {parentName}">
      <div class="parent-header-row">
        <h2 class="parent-name">{parentName}</h2>
        <div class="parent-header-actions">
          <button
            type="button"
            class="parent-menu-btn"
            title="Squad options"
            aria-label="Squad menu"
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
              {#if showBroadcastSquadItem}
                <button
                  type="button"
                  class="parent-menu-item"
                  class:parent-menu-item-disabled={broadcastSquadDisabled}
                  role="menuitem"
                  disabled={broadcastSquadDisabled}
                  title={broadcastSquadDisabled ? broadcastSquadDisabledTitle : undefined}
                  on:click={() => {
                    if (broadcastSquadDisabled || !onBroadcastSquad) return;
                    menuOpen = false;
                    onBroadcastSquad();
                  }}
                >
                  Broadcast Squad
                </button>
              {/if}
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
          {#each defaultHubChannels as channel (`${channel.groupId}:${channel.name}:${channel.order}`)}
            <div
              on:click={() => onSelectChannel(channel)}
              on:keydown={(e) => e.key === 'Enter' && onSelectChannel(channel)}
              role="button"
              tabindex="0"
            >
              <Channel
                name={channel.name}
                type="text"
                active={activeView === 'hub' &&
                  activeChannelId === channel.groupId &&
                  (groupIdDupCount[channel.groupId] <= 1 ||
                    activeHubChannelName === channel.name ||
                    (activeHubChannelName == null &&
                      firstNameByGroupId[channel.groupId] === channel.name))}
              />
            </div>
          {/each}
          {#if showCustomChannelDivider}
            <hr class="parent-channel-divider" aria-hidden="true" />
          {/if}
          {#each customChannels as channel (`${channel.groupId}:${channel.name}:${channel.order}`)}
            <div
              on:click={() => onSelectChannel(channel)}
              on:keydown={(e) => e.key === 'Enter' && onSelectChannel(channel)}
              role="button"
              tabindex="0"
            >
              <Channel
                name={channel.name}
                type="text"
                active={activeView === 'hub' &&
                  activeChannelId === channel.groupId &&
                  (groupIdDupCount[channel.groupId] <= 1 ||
                    activeHubChannelName === channel.name ||
                    (activeHubChannelName == null &&
                      firstNameByGroupId[channel.groupId] === channel.name))}
              />
            </div>
          {/each}
        </div>
        {#if channels.length > 0}
          <button type="button" class="parent-create-channel-btn" on:click={onCreateChannel}>
            + Create channel
          </button>
        {/if}
        {#if showPartnerSquads}
          <div class="partner-squads-section" role="navigation" aria-label="Partner Squads">
            <p class="partner-squads-heading">Partner Squads</p>
            {#if partnerSquads.length > 0}
            <div class="partner-squad-list">
              {#each partnerSquads as partner (partner.id)}
                <button
                  type="button"
                  class="partner-squad-item"
                  class:active={activePartnerSquadId === partner.id && activeView === 'hub'}
                  on:click={() => onSelectPartnerSquad(partner.id)}
                >
                  {partner.name}
                </button>
              {/each}
            </div>
            {/if}
          </div>
        {/if}
        {#if showPairWithSquadAction && typeof onPairWithSquad === 'function' && !creating}
          <button type="button" class="parent-pair-squad-btn" on:click={onPairWithSquad}>
            + Pair with squad…
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

  .parent-menu-item-disabled,
  .parent-menu-item:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .parent-menu-item-disabled:hover,
  .parent-menu-item:disabled:hover {
    background: none;
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

  .parent-channel-divider {
    margin: 6px 4px 8px;
    border: none;
    border-top: 1px solid var(--border-subtle);
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

  .partner-squads-section {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle);
  }

  .partner-squads-heading {
    margin: 0 0 8px 4px;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .partner-squad-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .partner-squad-item {
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.875rem;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .partner-squad-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .partner-squad-item.active {
    background: var(--bg-hover);
    color: var(--text-primary);
    font-weight: 500;
  }

  .parent-pair-squad-btn {
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

  .parent-pair-squad-btn:hover {
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
