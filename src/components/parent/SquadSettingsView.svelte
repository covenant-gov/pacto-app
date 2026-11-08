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
  import { currentUser } from '../../stores/auth-session';
  import { profiles } from '../../stores/profiles';
  import {
    SETTINGS_CHANNEL_MODES,
    settingsChannelMode,
    type SettingsChannelMode,
  } from '../../stores/navigation';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import HubChannelHeader from './HubChannelHeader.svelte';
  import HubModeSwitcher from './HubModeSwitcher.svelte';
  import {
    loadDashboardSettingsAccessTab,
    loadDashboardSettingsNetworkTab,
    loadDashboardSettingsUsTab,
    loadMyDashboardAlertsTab,
    loadMyDashboardStatusTab,
  } from '../../lib/dashboard/dashboard-tab-components';
  import { fetchSquadMemberEvmByNpub } from '../../lib/dashboard/parent-dashboard-loaders';
  import { persistSquadMemberEvmForParent } from '../../lib/dashboard/squad-member-evm-cache';
  import { ensureMlsGroupMembers, membersByGroupId } from '../../stores/mls-group-members';
  import {
    resolveSettingsPrivilegesAdmin,
    resolveSquadAdminContext,
    settingsPrivilegesRevision,
  } from '../../lib/governance/squad-admin-payload';
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
  const privilegesAdmin = $derived(resolveSettingsPrivilegesAdmin(infraRows));
  const pactoGovRevision = $derived(settingsPrivilegesRevision(infraRows, privilegesAdmin));
  const channelMembers = $derived(announcementsGroupId ? ($membersByGroupId[announcementsGroupId] ?? []) : []);
  const squadMemberEvmByNpub = $derived(parentId ? ($squadMemberEvmByParentId[parentId] ?? {}) : {});
  const memberEvmOptions = $derived(
    channelMembers
      .map((npub) => {
        const addr = squadMemberEvmByNpub[npub]?.trim();
        if (!addr) return null;
        const name = getProfileDisplayName($profiles[npub]) || npub.slice(0, 12);
        return { address: addr, label: name };
      })
      .filter((row): row is { address: string; label: string } => row != null),
  );
  const settingsMode = $derived($settingsChannelMode);

  let visitedSettingsModes = $state(new Set<SettingsChannelMode>([$settingsChannelMode]));
  $effect(() => {
    const mode = settingsMode;
    if (visitedSettingsModes.has(mode)) return;
    visitedSettingsModes = new Set([...visitedSettingsModes, mode]);
  });

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

  function selectSettingsMode(mode: SettingsChannelMode) {
    settingsChannelMode.set(mode);
  }

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
  <HubChannelHeader channelName={SETTINGS_CHANNEL_NAME} />
  <HubModeSwitcher
    modes={SETTINGS_CHANNEL_MODES}
    active={settingsMode}
    ariaLabel={$t('governance.settingsChannelMode.section')}
    labelFor={(mode) => $t(`governance.settingsChannelMode.${mode}`)}
    onSelect={(mode) => selectSettingsMode(mode as SettingsChannelMode)}
  />
  <div class="squad-settings-body">
    {#if visitedSettingsModes.has('you')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={settingsMode === 'you'}
        hidden={settingsMode !== 'you'}
      >
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
    {/if}
    {#if visitedSettingsModes.has('us')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={settingsMode === 'us'}
        hidden={settingsMode !== 'us'}
      >
        {#await loadDashboardSettingsUsTab() then UsTab}
          <UsTab squad={parent} {announcementsGroupId} />
        {:catch}
          <p class="tab-error" role="alert">{$t('governance.tabLoadError.us')}</p>
        {/await}
      </div>
    {/if}
    {#if visitedSettingsModes.has('access')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={settingsMode === 'access'}
        hidden={settingsMode !== 'access'}
      >
        {#await loadDashboardSettingsAccessTab() then AccessTab}
          <AccessTab
            squad={parent}
            {squadAdminCtx}
            {announcementsGroupId}
            parentId={parentId ?? ''}
            {channelMembers}
            {squadMemberEvmByNpub}
            {privilegesAdmin}
            {pactoGovRevision}
            {memberEvmOptions}
          />
        {:catch}
          <p class="tab-error" role="alert">{$t('governance.tabLoadError.access')}</p>
        {/await}
      </div>
    {/if}
    {#if visitedSettingsModes.has('network')}
      <div
        class="dashboard-tab-pane"
        class:dashboard-tab-pane-active={settingsMode === 'network'}
        hidden={settingsMode !== 'network'}
      >
        {#await loadDashboardSettingsNetworkTab() then NetworkTab}
          <NetworkTab
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
          <p class="tab-error" role="alert">{$t('governance.tabLoadError.network')}</p>
        {/await}
      </div>
    {/if}
  </div>
</div>

<style>
  .squad-settings {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .squad-settings-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 16px;
  }
  .dashboard-tab-pane[hidden] {
    display: none !important;
  }
  .tab-error {
    color: var(--danger, #c44);
  }
</style>
