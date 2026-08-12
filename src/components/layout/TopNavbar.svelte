<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
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
    MY_DASHBOARD_CHANNEL_ID,
    SQUAD_DASHBOARD_CHANNEL_ID,
    catchUpCount,
    type TopNavTab,
  } from '../../stores/app';
  import { resolveHubChannelNameForGroupSelection } from '../../lib/mls/virtual-channel-bucket';
  import { formatUnreadBadgeCount } from '../../lib/dm/dm-unread';

  const VIRTUAL_HUB_IDS = new Set([SQUAD_DASHBOARD_CHANNEL_ID, MY_DASHBOARD_CHANNEL_ID]);

  const tabs: TopNavTab[] = ['commons', 'dms', 'squads', 'catchup'];

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
        if (VIRTUAL_HUB_IDS.has(cid)) {
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
</script>

<div class="top-navbar" role="tablist" aria-label={$t('nav.topNavbar.mainViewAria')}>
  <span class="top-navbar-label" aria-hidden="true">{$t('nav.topNavbar.viewLabel')}</span>
  <div class="mode-switcher" role="group" aria-label={$t('nav.topNavbar.mainViewsAria')}>
    {#each tabs as tab (tab)}
      <button
        type="button"
        role="tab"
        class="mode-segment"
        class:active={$activeTopNavTab === tab}
        on:click={() => selectTab(tab)}
        aria-selected={$activeTopNavTab === tab}
        aria-label={tab === 'catchup' && $catchUpCount > 0
          ? `${$t(`nav.topNavbar.tabs.${tab}`)} (${$catchUpCount})`
          : $t(`nav.topNavbar.tabs.${tab}`)}
      >
        {$t(`nav.topNavbar.tabs.${tab}`)}
        {#if tab === 'catchup' && $catchUpCount > 0}
          <span class="mode-segment-badge">{formatUnreadBadgeCount($catchUpCount)}</span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .top-navbar {
    height: 48px;
    min-height: 48px;
    width: 100%;
    background-color: var(--bg-elevated);
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    flex-shrink: 0;
  }

  .top-navbar-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .mode-switcher {
    display: inline-flex;
    align-items: stretch;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 3px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .mode-segment {
    padding: 0 22px;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s;
    outline: none;
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
