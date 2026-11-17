<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import Bell from '@lucide/svelte/icons/bell';
  import {
    activeTopNavTab,
    activeView,
    activeSquadId,
    activeChannelId,
    activeHubChannelName,
    squads,
    lastOpenedSquadId,
    lastOpenedChannelId,
    lastChannelBySquadId,
    lastHubChannelNameBySquadId,
    isVirtualHubChannelId,
    catchUpCount,
    openAccountProfile,
    type TopNavTab,
  } from '../../stores/app';
  import { resolveHubChannelNameForGroupSelection } from '../../lib/mls/virtual-channel-bucket';
  import { formatUnreadBadgeCount } from '../../lib/dm/dm-unread';
  import TorStatusIndicator from './TorStatusIndicator.svelte';

  const tabs: TopNavTab[] = ['squads', 'dms', 'commons'];

  const DEBUG = false;
  function selectTab(id: TopNavTab) {
    if (id !== $activeTopNavTab) {
      const cid = $activeChannelId;
      if (DEBUG) console.log('[SquadChannel] selectTab', { from: $activeTopNavTab, to: id, activeSquadId: $activeSquadId, activeChannelId: cid?.slice(0, 20) });
      if ($activeTopNavTab === 'squads' && $activeSquadId && cid && !cid.startsWith('creating-')) {
        const sid = $activeSquadId;
        lastOpenedSquadId.set(sid);
        lastOpenedChannelId.set(cid);
        lastChannelBySquadId.update((m) => {
          const next = { ...m, [sid]: cid };
          if (DEBUG) console.log('[SquadChannel] TopNavbar persist squad', { sid: sid.slice(0, 12), cid: cid.slice(0, 20), mapKeys: Object.keys(next) });
          return next;
        });
        const squad = get(squads).find((s) => s.id === sid);
        if (isVirtualHubChannelId(cid)) {
          lastHubChannelNameBySquadId.update((m) => {
            const next = { ...m };
            delete next[sid];
            return next;
          });
        } else {
          const hub =
            resolveHubChannelNameForGroupSelection(squad?.channels ?? [], cid, get(activeHubChannelName)) ?? '';
          if (hub) lastHubChannelNameBySquadId.update((m) => ({ ...m, [sid]: hub }));
        }
      }
    }
    $activeTopNavTab = id;
    $activeView = 'hub';
  }

  const catchUpLabel = $derived(
    $catchUpCount > 0
      ? `${$t('nav.topNavbar.tabs.catchup')} (${$catchUpCount})`
      : $t('nav.topNavbar.tabs.catchup'),
  );
</script>

<div class="top-navbar">
  <div class="top-navbar-tabs" role="tablist" aria-label={$t('nav.topNavbar.mainViewAria')}>
    <div class="mode-switcher">
      {#each tabs as tab (tab)}
        <button
          type="button"
          role="tab"
          class="mode-segment"
          class:active={$activeTopNavTab === tab}
          onclick={() => selectTab(tab)}
          aria-selected={$activeTopNavTab === tab}
          aria-label={$t(`nav.topNavbar.tabs.${tab}`)}
        >
          {$t(`nav.topNavbar.tabs.${tab}`)}
        </button>
      {/each}
    </div>
    <div class="catch-up-control">
      <button
        type="button"
        role="tab"
        class="mode-segment mode-segment-icon"
        class:active={$activeTopNavTab === 'catchup'}
        onclick={() => selectTab('catchup')}
        aria-selected={$activeTopNavTab === 'catchup'}
        aria-label={catchUpLabel}
        title={$t('nav.topNavbar.tabs.catchup')}
      >
        <span class="catch-up-icon" aria-hidden="true">
          <Bell />
        </span>
        {#if $catchUpCount > 0}
          <span class="mode-segment-badge">{formatUnreadBadgeCount($catchUpCount)}</span>
        {/if}
      </button>
    </div>
  </div>
  <div class="profile-control">
    <button
      type="button"
      class="mode-segment mode-segment-icon"
      class:active={$activeView === 'profile'}
      onclick={openAccountProfile}
      aria-pressed={$activeView === 'profile'}
      aria-label={$t('nav.navbar.profile')}
      title={$t('nav.navbar.profile')}
    >
      <!-- Inlined user-circle so the stroke follows the button color. -->
      <svg class="profile-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5.3163 19.4384C5.92462 18.0052 7.34492 17 9 17H15C16.6551 17 18.0754 18.0052 18.6837 19.4384M16 9.5C16 11.7091 14.2091 13.5 12 13.5C9.79086 13.5 8 11.7091 8 9.5C8 7.29086 9.79086 5.5 12 5.5C14.2091 5.5 16 7.29086 16 9.5ZM22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </div>
  <TorStatusIndicator />
</div>

<style>
  .top-navbar {
    height: 48px;
    min-height: 48px;
    width: 100%;
    box-sizing: border-box;
    background-color: var(--bg-elevated);
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    flex-shrink: 0;
  }

  .top-navbar-tabs {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    gap: 12px;
  }

  .mode-switcher,
  .catch-up-control,
  .profile-control {
    display: inline-flex;
    align-items: stretch;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 3px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .catch-up-control {
    margin-left: auto;
  }

  .mode-segment {
    padding: 0 22px;
    min-height: 1.5rem;
    font-size: 0.9375rem;
    font-weight: 500;
    line-height: 1.5rem;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s;
    outline: none;
  }

  .mode-segment-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 12px;
  }

  .catch-up-icon {
    display: inline-flex;
    width: 1.125rem;
    height: 1.125rem;
    flex-shrink: 0;
  }

  .catch-up-icon :global(svg) {
    width: 100%;
    height: 100%;
  }

  .profile-icon {
    width: 1.125rem;
    height: 1.125rem;
    flex-shrink: 0;
  }

  .mode-segment-icon .mode-segment-badge {
    margin-left: 0;
  }

  .mode-segment:hover:not(.active) {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .mode-segment:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .mode-segment.active {
    color: var(--text-primary);
    background: var(--bg-elevated);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .mode-segment-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    margin-left: 6px;
    border-radius: 9px;
    background: var(--brand);
    color: var(--on-brand);
    font-size: 0.6875rem;
    font-weight: 600;
    vertical-align: middle;
  }
</style>
