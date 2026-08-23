<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import type { Squad } from '../../stores/app';
  import {
    ANNOUNCEMENTS_CHANNEL_NAME,
    SETTINGS_CHANNEL_NAME,
    squadInfraByParentId,
    squadMemberEvmByParentId,
  } from '../../stores/app';
  import { currentUser } from '../../stores/auth';
  import { loadDashboardSettingsTab } from '../../lib/dashboard/dashboard-tab-components';
  import { fetchSquadMemberEvmByNpub } from '../../lib/dashboard/parent-dashboard-loaders';
  import { persistSquadMemberEvmForParent } from '../../lib/dashboard/squad-member-evm-cache';
  import { ensureMlsGroupMembers, membersByGroupId } from '../../stores/mls-group-members';
  import { resolveSquadAdminContext } from '../../lib/governance/squad-admin-payload';
  import { pactoGovInfraRow, pactoGovWargameInfraRow, sponsorInfraRow } from '../../lib/governance/api';
  import {
    loadSquadNetworkPair,
    resolvePracticeSquadNetwork,
    resolvePrimarySquadNetwork,
    saveSquadNetworkSlot,
    squadNetworkTick,
    type SquadNetworkSlot,
  } from '../../lib/squad/squad-network';
  import { publishSquadNetworkUpdated } from '../../lib/squad/squad-network-share';
  import {
    clearSquadRpcPrimary,
    effectiveSquadRpcConfig,
    setSquadRpcBackup,
    setSquadRpcPrimary,
    squadRpcTick,
    type SquadRpcConfig,
  } from '../../lib/squad/squad-rpc';
  import { publishSquadRpcUpdated } from '../../lib/squad/squad-rpc-share';

  let { parent }: { parent: Squad } = $props();

  const parentId = $derived(parent?.id ?? '');
  const announcementsGroupId = $derived(
    parent?.channels?.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId ??
      parent?.channels?.[0]?.groupId ??
      null,
  );
  const infraRows = $derived($squadInfraByParentId[parentId] ?? []);
  const squadAdminCtx = $derived(resolveSquadAdminContext(infraRows));
  const channelMembers = $derived(announcementsGroupId ? ($membersByGroupId[announcementsGroupId] ?? []) : []);
  const squadMemberEvmByNpub = $derived(parentId ? ($squadMemberEvmByParentId[parentId] ?? {}) : {});

  const productionInfraChain = $derived(
    pactoGovInfraRow(infraRows)?.chain?.trim() ||
      squadAdminCtx?.chain?.trim() ||
      sponsorInfraRow(infraRows)?.chain?.trim() ||
      null,
  );
  const practiceInfraChain = $derived(pactoGovWargameInfraRow(infraRows)?.chain?.trim() || null);

  const storedPair = $derived.by(() => {
    void $squadNetworkTick;
    return loadSquadNetworkPair($currentUser?.npub, parentId);
  });
  const primaryNetwork = $derived(
    resolvePrimarySquadNetwork({ override: storedPair?.primary, infraChain: productionInfraChain }),
  );
  const practiceNetwork = $derived(
    resolvePracticeSquadNetwork({ override: storedPair?.practice, infraChain: practiceInfraChain }),
  );

  let squadRpcConfig: SquadRpcConfig | null = $state(null);
  $effect(() => {
    void $squadRpcTick;
    squadRpcConfig = effectiveSquadRpcConfig($currentUser?.npub, parentId, primaryNetwork);
  });

  $effect(() => {
    if (announcementsGroupId) void ensureMlsGroupMembers(announcementsGroupId);
  });

  $effect(() => {
    const pid = parentId;
    const gid = announcementsGroupId;
    if (!pid) return;
    const npub = $currentUser?.npub;
    void fetchSquadMemberEvmByNpub(pid, gid, npub).then((rows) => {
      if (parentId !== pid) return;
      squadMemberEvmByParentId.update((m) => ({ ...m, [pid]: rows }));
      if (npub) persistSquadMemberEvmForParent(npub, pid, rows);
    });
  });

  function setSlot(slot: SquadNetworkSlot, chain: typeof primaryNetwork) {
    const npub = $currentUser?.npub;
    if (!npub || !parentId.trim()) return;
    saveSquadNetworkSlot(npub, parentId.trim(), slot, chain);
    void publishSquadNetworkUpdated(parentId.trim());
  }

  async function handleSetSquadRpcPrimary(url: string): Promise<string | void> {
    const tFn = get(t);
    const npub = $currentUser?.npub;
    if (!npub || !parentId.trim()) return tFn('squad.rpc.error.selectNetworkFirst');
    const res = setSquadRpcPrimary(npub, parentId.trim(), primaryNetwork, url);
    if (!res.ok) return tFn(res.error);
    const published = await publishSquadRpcUpdated(parentId.trim());
    if (!published) return tFn('squad.rpc.error.publishFailed');
  }

  async function handleSetSquadRpcBackup(url: string): Promise<string | void> {
    const tFn = get(t);
    const npub = $currentUser?.npub;
    if (!npub || !parentId.trim()) return tFn('squad.rpc.error.selectNetworkFirst');
    const res = setSquadRpcBackup(npub, parentId.trim(), primaryNetwork, url);
    if (!res.ok) return tFn(res.error);
    const published = await publishSquadRpcUpdated(parentId.trim());
    if (!published) return tFn('squad.rpc.error.publishFailed');
  }

  async function handleClearSquadRpcPrimary(): Promise<void> {
    const npub = $currentUser?.npub;
    if (!npub || !parentId.trim()) return;
    clearSquadRpcPrimary(npub, parentId.trim(), primaryNetwork);
    await publishSquadRpcUpdated(parentId.trim());
  }
</script>

<div class="squad-settings">
  <div class="dashboard-channel-header">
    <div class="dashboard-channel-info">
      <span class="dashboard-channel-icon">#</span>
      <h3 class="dashboard-channel-name">{SETTINGS_CHANNEL_NAME}</h3>
    </div>
  </div>
  <div class="squad-settings-body">
    {#await loadDashboardSettingsTab() then SettingsTab}
      <SettingsTab
        squad={parent}
        {squadAdminCtx}
        {announcementsGroupId}
        parentId={parentId ?? ''}
        {channelMembers}
        {squadMemberEvmByNpub}
        {primaryNetwork}
        {practiceNetwork}
        onSetPrimaryNetwork={(chain) => setSlot('primary', chain)}
        onSetPracticeNetwork={(chain) => setSlot('practice', chain)}
        {squadRpcConfig}
        onSetSquadRpcPrimary={handleSetSquadRpcPrimary}
        onSetSquadRpcBackup={handleSetSquadRpcBackup}
        onClearSquadRpcPrimary={handleClearSquadRpcPrimary}
      />
    {:catch}
      <p class="tab-error" role="alert">{$t('governance.tabLoadError.settings')}</p>
    {/await}
  </div>
</div>

<style>
  .squad-settings {
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
  .squad-settings-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px;
  }
  .tab-error {
    color: var(--danger, #c44);
  }
</style>
