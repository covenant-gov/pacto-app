<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { Squad } from '../../stores/app';
  import {
    ANNOUNCEMENTS_CHANNEL_NAME,
    MY_DASHBOARD_CHANNEL_NAME,
    squadMemberEvmByParentId,
  } from '../../stores/app';
  import {
    loadMyDashboardAlertsTab,
    loadMyDashboardStatusTab,
  } from '../../lib/dashboard/dashboard-tab-components';
  import { fetchSquadMemberEvmByNpub } from '../../lib/dashboard/parent-dashboard-loaders';
  import { persistSquadMemberEvmForParent } from '../../lib/dashboard/squad-member-evm-cache';
  import { currentUser } from '../../stores/auth';

  let { parent }: { parent: Squad } = $props();

  const parentId = $derived(parent?.id ?? '');
  const announcementsGroupId = $derived(
    parent?.channels?.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId ??
      parent?.channels?.[0]?.groupId ??
      null,
  );
  const squadMemberEvmByNpub = $derived(parentId ? ($squadMemberEvmByParentId[parentId] ?? {}) : {});

  async function loadSquadMemberEvm() {
    if (!parentId) return;
    const loadParentId = parentId;
    const npub = $currentUser?.npub;
    const rows = await fetchSquadMemberEvmByNpub(loadParentId, announcementsGroupId, npub);
    if (parentId !== loadParentId) return;
    squadMemberEvmByParentId.update((m) => ({ ...m, [loadParentId]: rows }));
    if (npub) persistSquadMemberEvmForParent(npub, loadParentId, rows);
  }

  $effect(() => {
    void parentId;
    void loadSquadMemberEvm();
  });
</script>

<div class="my-dashboard">
  <div class="dashboard-channel-header">
    <div class="dashboard-channel-info">
      <span class="dashboard-channel-icon">#</span>
      <h3 class="dashboard-channel-name">{MY_DASHBOARD_CHANNEL_NAME}</h3>
    </div>
  </div>
  <div class="my-dashboard-body">
    {#await loadMyDashboardStatusTab() then StatusTab}
      <StatusTab
        {announcementsGroupId}
        parentId={parentId ?? ''}
        {squadMemberEvmByNpub}
      >
        {#snippet afterChecklist()}
          {#await loadMyDashboardAlertsTab() then AlertsTab}
            <AlertsTab {parentId} {announcementsGroupId} />
          {:catch}
            <p class="tab-error" role="alert">{$t('governance.tabLoadError.alerts')}</p>
          {/await}
        {/snippet}
      </StatusTab>
    {:catch}
      <p class="tab-error" role="alert">{$t('governance.tabLoadError.statusShort')}</p>
    {/await}
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
