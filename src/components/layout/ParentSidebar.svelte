<script lang="ts">
  import Channel from '../channel/Channel.svelte';
  import ResizableSidebar from '../ui/ResizableSidebar.svelte';
  import ParentSettingUp from '../parent/ParentSettingUp.svelte';
  import SquadAvatar from '../squad/SquadAvatar.svelte';
  import { partitionHubSidebarChannels } from '../../lib/parent-navbar';
  import chevronDownIcon from '../../icons/chevron-down.svg';
  import { t } from 'svelte-i18n';
  import { unreadCountsByChat } from '../../stores/unread';

  /** Channel shape for list items (name, groupId, order). Re-exported via type. */
  interface ParentChannel {
    name: string;
    groupId: string;
    order: number;
  }

  interface Props {
    parentName?: string;
    parentIconUrl?: string;
    parentId?: string;
    subheading?: string;
    channels?: ParentChannel[];
    activeChannelId?: string | null;
    /** Disambiguates selection when multiple channels share the active MLS group id. */
    activeHubChannelName?: string | null;
    activeView?: string;
    creating?: boolean;
    createError?: string;
    canRetryCreate?: boolean;
    canDiscardCreate?: boolean;
    retryingCreate?: boolean;
    emptyMessage?: string;
    /** When false, show empty state instead of header/channels. */
    hasParent?: boolean;
    /**
     * Error banners to show below the header. Each can have an optional dismiss handler.
     * If onDismissBanner is provided, a dismiss button is shown.
     */
    errorBanners?: { id: string; text: string }[];
    onDismissBanner?: (id: string) => void;
    onSelectChannel?: (channel: ParentChannel) => void;
    onCreateChannel?: () => void;
    onRetryCreate?: () => void;
    onDiscardCreate?: () => void;
    onInvite?: () => void;
    onExitSquad?: () => void;
    /** Partner squad-pairs linked to the active hub. */
    partnerSquads?: { id: string; name: string }[];
    activePartnerSquadId?: string | null;
    onSelectPartnerSquad?: (id: string) => void;
    /** Show pair action on any hub with a pairable anchor squad. */
    showPairWithSquadAction?: boolean;
    onPairWithSquad?: () => void;
  }

  let {
    parentName = '',
    parentIconUrl = undefined,
    parentId = '',
    subheading = undefined,
    channels = [],
    activeChannelId = null,
    activeHubChannelName = null,
    activeView = 'hub',
    creating = false,
    createError = '',
    canRetryCreate = false,
    canDiscardCreate = false,
    retryingCreate = false,
    emptyMessage = '',
    hasParent = false,
    errorBanners = [],
    onDismissBanner,
    onSelectChannel = () => {},
    onCreateChannel = () => {},
    onRetryCreate = () => {},
    onDiscardCreate = () => {},
    onInvite = () => {},
    onExitSquad,
    partnerSquads = [],
    activePartnerSquadId = null,
    onSelectPartnerSquad = () => {},
    showPairWithSquadAction = false,
    onPairWithSquad,
  }: Props = $props();

  let menuOpen = $state(false);
  const createErrorId = 'parent-create-error';

  let groupIdDupCount = $derived(
    channels.reduce<Record<string, number>>((acc, c) => {
      acc[c.groupId] = (acc[c.groupId] ?? 0) + 1;
      return acc;
    }, {})
  );
  let firstNameByGroupId = $derived.by(() => {
    const m: Record<string, string> = {};
    for (const c of channels) {
      if (!(c.groupId in m)) m[c.groupId] = c.name;
    }
    return m;
  });

  let showPartnerSquads = $derived(partnerSquads.length > 0 || showPairWithSquadAction);
  let { defaultHubChannels, customChannels } = $derived(partitionHubSidebarChannels(channels));
  let hubAlertByChannelName = $derived.by(() => {
    const counts = $unreadCountsByChat;
    const out: Record<string, number> = {};
    for (const channel of [...defaultHubChannels, ...customChannels]) {
      out[channel.name] = counts[channel.groupId] ?? 0;
    }
    return out;
  });
  let showCustomChannelDivider = $derived(defaultHubChannels.length > 0 && customChannels.length > 0);
  let inviteLabel = $derived($t('nav.parentSidebar.invite'));
  let showExit = $derived(typeof onExitSquad === 'function');
  let exitLabel = $derived($t('nav.parentSidebar.exit'));
  let onExit = $derived(onExitSquad);
  let resolvedEmptyMessage = $derived(emptyMessage || $t('nav.parentSidebar.empty'));
</script>

<svelte:window
  onclick={(e) => {
    const t = e.target as HTMLElement | null;
    if (menuOpen && t && !t.closest('.parent-header-actions')) menuOpen = false;
  }}
/>

<ResizableSidebar sidebarClass="parent-sidebar">
  {#if hasParent}
    <div class="parent-heading" role="region" aria-label={$t('nav.parentSidebar.squadHeading', { values: { squadName: parentName } })}>
      <div class="parent-header-row">
        <SquadAvatar src={parentIconUrl} name={parentName} seed={parentId || parentName} size={32} />
        <h2 class="parent-name">{parentName}</h2>
        <div class="parent-header-actions">
          <button
            type="button"
            class="parent-menu-btn"
            title={$t('nav.parentSidebar.squadOptionsTitle')}
            aria-label={$t('nav.parentSidebar.squadMenuAria')}
            onclick={() => (menuOpen = !menuOpen)}
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
                onclick={() => {
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
                  onclick={() => {
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
            onclick={() => onDismissBanner(banner.id)}
            aria-label={$t('nav.parentSidebar.dismissAria')}
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
          canDiscard={canDiscardCreate}
          onDiscard={onDiscardCreate}
        />
      {:else}
        <div class="parent-channel-list">
          {#each defaultHubChannels as channel (`${channel.groupId}:${channel.name}:${channel.order}`)}
            <div
              onclick={() => onSelectChannel(channel)}
              onkeydown={(e) => e.key === 'Enter' && onSelectChannel(channel)}
              role="button"
              tabindex="0"
            >
              <Channel
                name={channel.name}
                alertCount={hubAlertByChannelName[channel.name] ?? 0}
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
              onclick={() => onSelectChannel(channel)}
              onkeydown={(e) => e.key === 'Enter' && onSelectChannel(channel)}
              role="button"
              tabindex="0"
            >
              <Channel
                name={channel.name}
                alertCount={hubAlertByChannelName[channel.name] ?? 0}
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
          <button type="button" class="parent-create-channel-btn" onclick={onCreateChannel}>
            {$t('nav.parentSidebar.createChannel')}
          </button>
        {/if}
        {#if showPartnerSquads}
          <div class="partner-squads-section" role="navigation" aria-label={$t('nav.parentSidebar.partnerSquadsAria')}>
            <p class="partner-squads-heading">{$t('nav.parentSidebar.partnerSquads')}</p>
            {#if partnerSquads.length > 0}
            <div class="partner-squad-list">
              {#each partnerSquads as partner (partner.id)}
                <button
                  type="button"
                  class="partner-squad-item"
                  class:active={activePartnerSquadId === partner.id && activeView === 'hub'}
                  onclick={() => onSelectPartnerSquad(partner.id)}
                >
                  {partner.name}
                </button>
              {/each}
            </div>
            {/if}
          </div>
        {/if}
        {#if showPairWithSquadAction && typeof onPairWithSquad === 'function' && !creating}
          <button type="button" class="parent-pair-squad-btn" onclick={onPairWithSquad}>
            {$t('nav.parentSidebar.pairWithSquad')}
          </button>
        {/if}
      {/if}
    </div>
  {:else}
    <div class="parent-empty-state">
      <p>{resolvedEmptyMessage}</p>
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
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .parent-subheading {
    margin: 4px 0 0 0;
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

  .parent-menu-item:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

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
