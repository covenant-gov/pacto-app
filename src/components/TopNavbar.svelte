<script lang="ts">
  import {
    activeTopNavTab,
    activeView,
    activeSquadId,
    activeChannelId,
    activeNetworkId,
    lastOpenedSquadId,
    lastOpenedChannelId,
    lastChannelBySquadId,
    lastOpenedNetworkId,
    lastOpenedNetworkChannelId,
    lastChannelByNetworkId,
    type TopNavTab,
  } from '../stores/app';

  const tabs: { id: TopNavTab; label: string }[] = [
    { id: 'dms', label: 'DMs' }, // 1-on-1 chat, non-governable
    { id: 'squads', label: 'Squads' }, // commune-level organizations (positioned below networks), governable
    { id: 'networks', label: 'Networks' }, // [regional] delegation-level coordinations (positioned above squads), governable
  ];

  const DEBUG = false; // [SquadChannel] set true to trace tab-switch persistence
  function selectTab(id: TopNavTab) {
    // Persist current squad/network channel before switching so it restores when returning
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
      }
      if ($activeTopNavTab === 'networks' && $activeNetworkId && cid && !cid.startsWith('creating-')) {
        const nid = $activeNetworkId;
        lastOpenedNetworkId.set(nid);
        lastOpenedNetworkChannelId.set(cid);
        lastChannelByNetworkId.update((m) => ({ ...m, [nid]: cid }));
      }
    }
    $activeTopNavTab = id;
    $activeView = 'hub'; // close Settings if open so the selected view is shown
  }
</script>

<div class="top-navbar" role="tablist" aria-label="Main view">
  <span class="top-navbar-label" aria-hidden="true">View</span>
  <div class="mode-switcher" role="group" aria-label="DMs, Squads, or Networks">
    {#each tabs as tab}
      <button
        type="button"
        role="tab"
        class="mode-segment"
        class:active={$activeTopNavTab === tab.id}
        on:click={() => selectTab(tab.id)}
        aria-selected={$activeTopNavTab === tab.id}
        aria-label={tab.label}
      >
        {tab.label}
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

  /* Segmented control: one pill containing three segments */
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
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .mode-segment.active {
    color: var(--text-primary);
    background: var(--bg-elevated);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
</style>
