<script lang="ts">
  import type { Squad } from '../../stores/app';
  import {
    ANNOUNCEMENTS_CHANNEL_NAME,
    MY_DASHBOARD_CHANNEL_NAME,
    myDashboardChannelMode,
    type MyDashboardChannelMode,
    squadMemberEvmByParentId,
  } from '../../stores/app';
  import {
    loadMyDashboardAlertsTab,
    loadMyDashboardStatusTab,
  } from '../../lib/dashboard/dashboard-tab-components';
  import { fetchSquadMemberEvmByNpub } from '../../lib/dashboard/parent-dashboard-loaders';
  import { persistSquadMemberEvmForParent } from '../../lib/dashboard/squad-member-evm-cache';
  import { currentUser } from '../../stores/auth';

  export let parent: Squad;

  const VIEWS: { id: MyDashboardChannelMode; label: string }[] = [
    { id: 'status', label: 'Status' },
    { id: 'alerts', label: 'Alerts' },
  ];

  $: dashboardView = $myDashboardChannelMode;
  $: parentId = parent?.id ?? '';
  $: announcementsGroupId =
    parent?.channels?.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId ??
    parent?.channels?.[0]?.groupId ??
    null;
  $: squadMemberEvmByNpub = parentId ? ($squadMemberEvmByParentId[parentId] ?? {}) : {};

  async function loadSquadMemberEvm() {
    if (!parentId) return;
    const loadParentId = parentId;
    const rows = await fetchSquadMemberEvmByNpub(loadParentId, announcementsGroupId);
    if (parentId !== loadParentId) return;
    squadMemberEvmByParentId.update((m) => ({ ...m, [loadParentId]: rows }));
    const npub = $currentUser?.npub;
    if (npub) persistSquadMemberEvmForParent(npub, loadParentId, rows);
  }

  $: if (parentId) void loadSquadMemberEvm();

  function selectView(id: MyDashboardChannelMode) {
    myDashboardChannelMode.set(id);
  }
</script>

<div class="my-dashboard">
  <div class="dashboard-channel-header">
    <div class="dashboard-channel-info">
      <span class="dashboard-channel-icon">#</span>
      <h3 class="dashboard-channel-name">{MY_DASHBOARD_CHANNEL_NAME}</h3>
    </div>
  </div>
  <div class="dashboard-view-nav" role="tablist" aria-label="My dashboard section">
    <span class="dashboard-view-nav-label" aria-hidden="true">Mode</span>
    <div class="dashboard-mode-switcher" role="group">
      {#each VIEWS as v (v.id)}
        <button
          type="button"
          role="tab"
          class="dashboard-mode-segment"
          class:active={dashboardView === v.id}
          aria-selected={dashboardView === v.id}
          on:click={() => selectView(v.id)}
        >
          {v.label}
        </button>
      {/each}
    </div>
  </div>
  <div class="my-dashboard-body">
    {#if dashboardView === 'status'}
      {#await loadMyDashboardStatusTab() then StatusTab}
        <StatusTab
          {announcementsGroupId}
          parentId={parentId ?? ''}
          {squadMemberEvmByNpub}
        />
      {:catch}
        <p class="tab-error" role="alert">Could not load Status.</p>
      {/await}
    {:else}
      {#await loadMyDashboardAlertsTab() then AlertsTab}
        <AlertsTab {parentId} {announcementsGroupId} />
      {:catch}
        <p class="tab-error" role="alert">Could not load Alerts.</p>
      {/await}
    {/if}
  </div>
</div>

<style>
  .my-dashboard {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .dashboard-channel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .dashboard-channel-info {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dashboard-channel-icon {
    color: var(--text-muted);
    font-weight: 600;
  }
  .dashboard-channel-name {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .dashboard-view-nav {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .dashboard-view-nav-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .dashboard-mode-switcher {
    display: inline-flex;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    overflow: hidden;
  }
  .dashboard-mode-segment {
    border: none;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    padding: 6px 12px;
    font-size: 0.8125rem;
    cursor: pointer;
    font-family: inherit;
  }
  .dashboard-mode-segment.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-weight: 600;
  }
  .my-dashboard-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px;
  }
  .tab-error {
    color: var(--danger, #c44);
  }
</style>
