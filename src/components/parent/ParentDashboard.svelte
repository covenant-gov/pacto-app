<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { Squad } from '../../stores/app';
  import {
    ANNOUNCEMENTS_CHANNEL_NAME,
    SQUAD_DASHBOARD_CHANNEL_NAME,
    showMembersPanel,
    membershipVersionByGroupId,
    squadDashboardChannelMode,
    type SquadDashboardChannelMode,
  } from '../../stores/app';
import type { TreasurySafeEntry } from '../../lib/treasury/treasury-safes';
import { TREASURY_SAFE_UI_CAP, governanceTreasurySafeForParent, vaultTreasurySafesForParent } from '../../lib/treasury/treasury-safes';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';
  import type { ParentGovernanceDto, SquadInfraDto, TreasuryProposalDto, HatTreeNodeDto, SquadSponsorExtStatusDto } from '../../lib/governance/api';
  import {
    getSquadSponsorExtStatus,
    hasSponsorInfra,
    pactoGovInfraRow,
    pactoGovTreasuryEntryId,
    sponsorInfraRow,
    withLegacyProvider,
  } from '../../lib/governance/api';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';  import { buildCaptainMemberOptions } from '../../lib/governance/start-pacto-gov-deploy';
  import { parsePactoGovProviderPayload } from '../../lib/governance/pacto-gov-payload';
  import {
    protocolWearerCandidateAddresses,
    protocolWearerLabelByAddress,
  } from '../../lib/governance/hats-tree-annotations';
  import { hasSquadAdminInfra, resolveSquadAdminContext } from '../../lib/governance/squad-admin-payload';
  import { resolveSquadSponsorVariant } from '../../lib/governance/squad-sponsor-variant';
  import { DEFAULT_CHAIN_ID, parseSupportedChainId, type SupportedChainId } from '../../lib/wallet/chains';
  import {
    loadSquadNetworkOverride,
    resolveSquadNetwork,
    saveSquadNetworkOverride,
    squadNetworkTick,
  } from '../../lib/squad/squad-network';
  import { publishSquadNetworkUpdated } from '../../lib/squad/squad-network-share';
  import { currentUser } from '../../stores/auth';
  import friendsIcon from '../../icons/friends.svg';
  import ParentDashboardMembersPanel from './dashboard/ParentDashboardMembersPanel.svelte';
  import GovernanceDeployCoordinator from './dashboard/GovernanceDeployCoordinator.svelte';
  import {
    loadDashboardCrewTab,
    loadDashboardGovernanceTab,
    loadDashboardRolesTreeTab,
    loadDashboardStatusTab,
    loadDashboardTreasuryTab,
  } from '../../lib/dashboard/dashboard-tab-components';
  import { resolveDashboardStructureSummary } from '../../lib/dashboard/structure-summary';
  import { resolveDashboardPermissionsContext } from '../../lib/dashboard/permissions-panel';
  import {
    fetchHatsTree,
    fetchRolesTreeAnnotations,
    fetchSettingsChainMemberMaps,
    fetchSquadMemberEvmByNpub,
    fetchTreasuryProposals,
    isSupersededLoaderKey,
  } from '../../lib/dashboard/parent-dashboard-loaders';
  import {
    ensureMlsGroupMembers,
    membersByGroupId,
    membersLoadingByGroupId,
    refreshMlsGroupMembers,
  } from '../../stores/mls-group-members';
  import {
    getCachedHatsTree,
    getCachedTreasuryProposals,
    persistHatsTreeSnapshot,
    persistTreasuryProposalsSnapshot,
  } from '../../lib/dashboard/governance-snapshot-cache';
  import { persistSquadMemberEvmForParent } from '../../lib/dashboard/squad-member-evm-cache';
  import {
    getCachedSettingsChainSnapshot,
    persistSettingsChainSnapshot,
    settingsChainCacheKey,
  } from '../../lib/dashboard/settings-chain-cache';
  import { squadMemberEvmByParentId } from '../../stores/squads';

  type ParentDashboardView = SquadDashboardChannelMode;
  const DASHBOARD_VIEWS: ParentDashboardView[] = [
    'status',
    'governance',
    'treasury',
    'roles',
    'crew',
  ];

  $: dashboardView = $squadDashboardChannelMode;
  let visitedDashboardViews: Set<ParentDashboardView> = new Set();
  $: if (!visitedDashboardViews.has(dashboardView)) {
    visitedDashboardViews = new Set([...visitedDashboardViews, dashboardView]);
  }

  export let parent: Squad;
  export let treasurySafes: TreasurySafeEntry[] = [];
  export let governanceConfig: ParentGovernanceDto | null | undefined = undefined;
  export let squadInfraRows: SquadInfraDto[] | undefined = undefined;
  export let onSponsorDeployComplete:
    | ((params: {
        parentId: string;
        announcementsGroupId: string;
        chain: string;
        sponsorAddress: string;
        providerPayload: string;
        infraRowId: string;
      }) => Promise<void>)
    | undefined = undefined;
  export let onConfirmImportSafe:
    | ((params: {
        safeAddress: string;
        chain: string;
        label: string;
        entryId: string;
        txHash?: string;
      }) => Promise<void>)
    | undefined = undefined;
  export let onPactoGovDeployComplete:
    | ((params: {
        parentId: string;
        announcementsGroupId: string;
        chain: string;
        topHatId: string;
        providerPayload: string;
        safeAddress: string;
        txHash: string;
        infraRowId?: string;
      }) => Promise<void>)
    | undefined = undefined;
  export let onSquadAdminDeployComplete:
    | ((params: {
        parentId: string;
        announcementsGroupId: string;
        chain: string;
        squadAdminProxy: string;
        providerPayload: string;
        infraRowId: string;
      }) => Promise<void>)
    | undefined = undefined;

  let deployCoordinator: GovernanceDeployCoordinator | undefined;

  $: parentId = parent?.id;
  $: sponsorRow = sponsorInfraRow(squadInfraRows);
  $: sponsorVariant = resolveSquadSponsorVariant(sponsorRow);
  $: hasSponsor = hasSponsorInfra(squadInfraRows);
  $: displayedTreasurySafes = vaultTreasurySafesForParent(
    treasurySafes ?? [],
    parentId ?? '',
    pactoGovTreasuryEntryId,
  ).slice(0, TREASURY_SAFE_UI_CAP);

  $: pactoGovRow = pactoGovInfraRow(squadInfraRows);
  $: hasPactoGov = pactoGovRow != null;
  $: squadAdminCtx = resolveSquadAdminContext(squadInfraRows);
  $: hasSquadAdmin = hasSquadAdminInfra(squadInfraRows);
  $: pactoPayload = parsePactoGovProviderPayload(pactoGovRow?.providerPayload);
  $: knownWearerLabels = protocolWearerLabelByAddress(pactoPayload);
  $: pactoNetwork = parseSupportedChainId(
    pactoGovRow?.chain?.trim() || squadAdminCtx?.chain || DEFAULT_CHAIN_ID,
  );
  $: squadAdminNetwork = parseSupportedChainId(squadAdminCtx?.chain?.trim() || DEFAULT_CHAIN_ID);

  /** Chain of any already-deployed infra; seeds the squad network before an override is set. */
  $: infraSquadChain =
    pactoGovRow?.chain?.trim() || squadAdminCtx?.chain?.trim() || sponsorRow?.chain?.trim() || null;
  let squadNetworkOverride: SupportedChainId | null = null;
  $: {
    void $squadNetworkTick;
    squadNetworkOverride = loadSquadNetworkOverride($currentUser?.npub, parentId);
  }
  /** Established squad network (override → infra chain), or null until the first deploy picks one. */
  $: squadNetwork = resolveSquadNetwork({ override: squadNetworkOverride, infraChain: infraSquadChain });
  $: governanceTreasurySafe = governanceTreasurySafeForParent(
    treasurySafes ?? [],
    parentId ?? '',
    pactoGovTreasuryEntryId,
    {
      safeAddress: pactoPayload?.safe,
      chain: pactoGovRow?.chain ?? squadNetwork ?? undefined,
    },
  );

  function setSquadNetwork(chain: SupportedChainId): void {
    const npub = $currentUser?.npub;
    if (!npub || !parentId?.trim()) return;
    const gid = parentId.trim();
    saveSquadNetworkOverride(npub, gid, chain);
    void publishSquadNetworkUpdated(gid);
  }
  $: memberEvmOptionsForRoles = channelMembers
    .map((npub) => {
      const addr = squadMemberEvmByNpub[npub]?.trim();
      if (!addr) return null;
      const name = getProfileDisplayName($profiles[npub]) || npub.slice(0, 12);
      return { address: addr, label: name };
    })
    .filter((row): row is { address: string; label: string } => row != null);

  $: captainMemberOptions = buildCaptainMemberOptions(
    squadMemberEvmByNpub,
    $currentUser?.npub,
    (npub) => getProfileDisplayName($profiles[npub]),
  );

  $: structureSummary = resolveDashboardStructureSummary(
    squadInfraRows === undefined ? undefined : pactoGovRow,
  );

  $: permissionsGov = pactoGovRow != null ? withLegacyProvider(pactoGovRow) : governanceConfig;
  $: permissionsCtx = resolveDashboardPermissionsContext(permissionsGov);

  let treasuryProposals: TreasuryProposalDto[] = [];
  let treasuryProposalsLoading = false;
  let treasuryProposalsRefreshing = false;
  let treasuryProposalsError = '';
  let treasuryProposalsKey = '';

  let hatsTree: HatTreeNodeDto | null = null;
  let hatsTreeLoading = false;
  let hatsTreeRefreshing = false;
  let hatsTreeError = '';
  let hatsTreeKey = '';

  let roleLabelByHatId: Record<string, string> = {};
  let wearerAddressesByHatId: Record<string, string[]> = {};
  let executorRolesByAddress: Record<string, string> = {};
  let rolesTreeAnnotationsLoading = false;
  let rolesTreeAnnotationsRefreshing = false;
  let rolesTreeAnnotationsError = '';
  let rolesTreeAnnotationsKey = '';

  let memberHatByAddress: Record<string, string> = {};
  let memberRolesByAddress: Record<string, string> = {};
  let settingsChainLoading = false;
  let settingsChainRefreshing = false;
  let settingsChainError = '';
  let settingsChainKey = '';

  let sponsorExtStatus: SquadSponsorExtStatusDto | null = null;
  let sponsorExtLoading = false;
  let sponsorExtError = '';
  let sponsorExtKey = '';

  async function loadTreasuryProposals() {
    const ta = pactoPayload?.treasuryAuthority?.trim();
    const key = `${pactoNetwork}:${ta ?? ''}`;
    if (!ta || treasuryProposalsKey === key) return;
    treasuryProposalsKey = key;
    const npub = $currentUser?.npub;
    const cached = getCachedTreasuryProposals(npub, key);
    if (cached) {
      treasuryProposals = cached.proposals;
      treasuryProposalsLoading = false;
      treasuryProposalsRefreshing = true;
    } else {
      treasuryProposalsLoading = true;
      treasuryProposalsRefreshing = false;
    }
    treasuryProposalsError = '';
    const result = await fetchTreasuryProposals({ network: pactoNetwork, treasuryAuthority: ta });
    if (isSupersededLoaderKey(treasuryProposalsKey, key)) return;
    treasuryProposalsLoading = false;
    treasuryProposalsRefreshing = false;
    if (!result.error) {
      treasuryProposals = result.proposals;
      if (npub) persistTreasuryProposalsSnapshot(npub, key, result.proposals);
    } else if (cached) {
      treasuryProposalsError = result.error;
    } else {
      treasuryProposals = result.proposals;
      treasuryProposalsError = result.error;
    }
  }

  function wearersForRoleLabel(label: string): string[] {
    const hatId = Object.entries(roleLabelByHatId).find(([, l]) => l === label)?.[0];
    if (!hatId) return [];
    return wearerAddressesByHatId[hatId] ?? [];
  }

  $: captainWearers = wearersForRoleLabel('Captain');
  $: crewWearers = wearersForRoleLabel('Crew');
  $: myGovernanceAddress = (() => {
    const npub = $currentUser?.npub;
    if (!npub) return '';
    return squadMemberEvmByNpub[npub]?.trim() ?? '';
  })();

  function refreshTreasuryProposals() {
    treasuryProposalsKey = '';
    void loadTreasuryProposals();
  }

  async function loadHatsTree() {
    const topHat = pactoGovRow?.canonicalRef?.trim();
    const key = `${pactoNetwork}:${topHat ?? ''}`;
    if (!topHat || hatsTreeKey === key) return;
    hatsTreeKey = key;
    const npub = $currentUser?.npub;
    const cached = getCachedHatsTree(npub, key);
    if (cached) {
      hatsTree = cached.tree;
      hatsTreeLoading = false;
      hatsTreeRefreshing = true;
    } else {
      hatsTreeLoading = true;
      hatsTreeRefreshing = false;
    }
    hatsTreeError = '';
    const result = await fetchHatsTree({ network: pactoNetwork, topHatId: topHat });
    if (isSupersededLoaderKey(hatsTreeKey, key)) return;
    hatsTreeLoading = false;
    hatsTreeRefreshing = false;
    if (!result.error) {
      hatsTree = result.tree;
      if (npub) persistHatsTreeSnapshot(npub, key, result.tree);
    } else if (cached) {
      hatsTreeError = result.error;
    } else {
      hatsTree = result.tree;
      hatsTreeError = result.error;
    }
  }

  function refreshRolesTree() {
    hatsTreeKey = '';
    rolesTreeAnnotationsKey = '';
    void loadHatsTree();
    void loadRolesTreeAnnotations();
    void loadSquadMemberEvm();
  }

  async function loadRolesTreeAnnotations() {
    const topHat = pactoGovRow?.canonicalRef?.trim();
    const evmKey = Object.values(squadMemberEvmByNpub)
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join(',');
    const squadAdmin = squadAdminCtx?.proxy?.trim() ?? '';
    const protocolCandidates = protocolWearerCandidateAddresses(pactoPayload);
    const protocolKey = protocolCandidates
      .map((a) => a.toLowerCase())
      .sort()
      .join(',');
    const key = `${pactoNetwork}:${topHat ?? ''}:${evmKey}:${squadAdmin}:${protocolKey}`;
    if (!topHat || rolesTreeAnnotationsKey === key) return;
    rolesTreeAnnotationsKey = key;
    const hadData = Object.keys(roleLabelByHatId).length > 0;
    if (hadData) {
      rolesTreeAnnotationsLoading = false;
      rolesTreeAnnotationsRefreshing = true;
    } else {
      rolesTreeAnnotationsLoading = true;
      rolesTreeAnnotationsRefreshing = false;
    }
    rolesTreeAnnotationsError = '';
    const result = await fetchRolesTreeAnnotations({
      network: pactoNetwork,
      topHatId: topHat,
      squadMemberEvmByNpub,
      squadAdminProxy: squadAdminCtx?.proxy ?? null,
      squadAdminChain: squadAdminCtx?.chain ?? null,
      protocolWearerCandidates: protocolCandidates,
    });
    if (isSupersededLoaderKey(rolesTreeAnnotationsKey, key)) return;
    rolesTreeAnnotationsLoading = false;
    rolesTreeAnnotationsRefreshing = false;
    roleLabelByHatId = result.roleLabelByHatId;
    wearerAddressesByHatId = result.wearerAddressesByHatId;
    executorRolesByAddress = result.executorRolesByAddress;
    if (result.error) rolesTreeAnnotationsError = result.error;
  }

  async function loadSettingsChainContext() {
    const topHat = pactoGovRow?.canonicalRef?.trim() ?? null;
    const squadAdmin = squadAdminCtx?.proxy?.trim() ?? null;
    const cacheKey = settingsChainCacheKey({
      network: pactoNetwork,
      topHatId: topHat,
      squadAdminProxy: squadAdmin,
      squadMemberEvmByNpub,
    });
    if ((!topHat && !squadAdmin) || settingsChainKey === cacheKey) return;
    settingsChainKey = cacheKey;
    const npub = $currentUser?.npub;
    const cached =
      npub && parentId ? getCachedSettingsChainSnapshot(npub, parentId, cacheKey) : null;
    if (cached) {
      memberHatByAddress = cached.memberHatByAddress;
      memberRolesByAddress = cached.memberRolesByAddress;
      settingsChainLoading = false;
      settingsChainRefreshing = true;
    } else {
      settingsChainLoading = true;
      settingsChainRefreshing = false;
      memberHatByAddress = {};
      memberRolesByAddress = {};
    }
    settingsChainError = '';
    const result = await fetchSettingsChainMemberMaps({
      network: pactoNetwork,
      topHatId: topHat,
      squadAdminProxy: squadAdmin,
      squadAdminChain: squadAdminCtx?.chain ?? null,
      squadMemberEvmByNpub,
    });
    if (isSupersededLoaderKey(settingsChainKey, cacheKey)) return;
    settingsChainLoading = false;
    settingsChainRefreshing = false;
    if (!result.error) {
      memberHatByAddress = result.memberHatByAddress;
      memberRolesByAddress = result.memberRolesByAddress;
      if (npub && parentId) {
        persistSettingsChainSnapshot(npub, parentId, cacheKey, {
          memberHatByAddress: result.memberHatByAddress,
          memberRolesByAddress: result.memberRolesByAddress,
        });
      }
    } else if (cached) {
      settingsChainError = result.error;
    } else {
      memberHatByAddress = result.memberHatByAddress;
      memberRolesByAddress = result.memberRolesByAddress;
      settingsChainError = result.error;
    }
  }

  async function loadSponsorExtStatus() {
    if (!hasSponsor || !parentId) {
      sponsorExtStatus = null;
      sponsorExtError = '';
      sponsorExtKey = '';
      return;
    }
    // Hats-linked SquadSponsor has no Ext permit list API.
    if (sponsorVariant === 'hats') {
      sponsorExtStatus = null;
      sponsorExtError = '';
      sponsorExtKey = `hats:${parentId}`;
      sponsorExtLoading = false;
      return;
    }
    const network =
      sponsorRow?.chain?.trim() || squadNetwork || pactoNetwork || DEFAULT_CHAIN_ID;
    const memberAddresses = Object.values(squadMemberEvmByNpub)
      .map((a) => a.trim())
      .filter(Boolean)
      .sort();
    const key = `${network}:${parentId}:${sponsorRow?.canonicalRef ?? ''}:${memberAddresses.join(',')}`;
    if (sponsorExtKey === key) return;
    sponsorExtKey = key;
    sponsorExtLoading = true;
    sponsorExtError = '';
    try {
      sponsorExtStatus = await getSquadSponsorExtStatus({
        network,
        parentId,
        memberAddresses,
        sponsorAddress: sponsorRow?.canonicalRef ?? null,
      });
    } catch (e) {
      if (isSupersededLoaderKey(sponsorExtKey, key)) return;
      sponsorExtError = getInvokeErrorMessage(e, $t('governance.error.couldNotLoadSponsorEligibility'));
      if (!sponsorExtStatus) sponsorExtStatus = null;
    } finally {
      if (!isSupersededLoaderKey(sponsorExtKey, key)) sponsorExtLoading = false;
    }
  }

  function refreshSponsorExtStatus() {
    sponsorExtKey = '';
    void loadSponsorExtStatus();
  }

  $: if (dashboardView === 'governance' && pactoPayload?.treasuryAuthority) {
    void loadTreasuryProposals();
  }

  $: if (dashboardView === 'governance' && parentId) {
    void loadSquadMemberEvm();
  }

  $: if (dashboardView === 'governance' && pactoGovRow?.canonicalRef && parentId) {
    void loadRolesTreeAnnotations();
  }

  $: if (dashboardView === 'roles' && pactoGovRow?.canonicalRef) {
    void loadHatsTree();
  }

  $: if (dashboardView === 'roles' && pactoGovRow?.canonicalRef && parentId) {
    void squadMemberEvmByNpub;
    void loadRolesTreeAnnotations();
  }

  $: if (dashboardView === 'roles' && parentId) {
    void loadSquadMemberEvm();
  }

  $: if (
    (dashboardView === 'status' || dashboardView === 'crew') &&
    (pactoGovRow?.canonicalRef || squadAdminCtx?.proxy)
  ) {
    void loadSettingsChainContext();
  }

  $: if (
    (dashboardView === 'status' || dashboardView === 'crew') &&
    pactoGovRow?.canonicalRef &&
    parentId
  ) {
    void loadRolesTreeAnnotations();
  }

  $: announcementsGroupId =
    parent?.channels?.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId ??
    parent?.channels?.[0]?.groupId ??
    null;

  let prevMembersGroupIdForPanel: string | null = null;
  let prevMembersVersionByGroup: Record<string, number> = {};
  $: channelMembers = announcementsGroupId ? ($membersByGroupId[announcementsGroupId] ?? []) : [];
  $: loadingMembers =
    announcementsGroupId
      ? ($membersLoadingByGroupId[announcementsGroupId] ?? false) && channelMembers.length === 0
      : false;
  $: squadMemberEvmByNpub = parentId ? ($squadMemberEvmByParentId[parentId] ?? {}) : {};

  async function loadSquadMemberEvm() {
    if (!parentId) return;
    const loadParentId = parentId;
    const npub = $currentUser?.npub;
    const rows = await fetchSquadMemberEvmByNpub(loadParentId, announcementsGroupId, npub);
    if (parentId !== loadParentId) return;
    squadMemberEvmByParentId.update((m) => ({ ...m, [loadParentId]: rows }));
    if (npub) persistSquadMemberEvmForParent(npub, loadParentId, rows);
  }

  function selectDashboardView(id: ParentDashboardView) {
    squadDashboardChannelMode.set(id);
    if ((id === 'status' || id === 'crew') && announcementsGroupId) {
      void ensureMlsGroupMembers(announcementsGroupId);
    }
  }

  function prefetchDashboardTabIntent(id: ParentDashboardView) {
    if (id === 'governance') {
      if (pactoPayload?.treasuryAuthority) void loadTreasuryProposals();
      void loadSquadMemberEvm();
    } else if (id === 'roles' && pactoGovRow?.canonicalRef) {
      void loadHatsTree();
      void loadRolesTreeAnnotations();
      void loadSquadMemberEvm();
    }
  }

  $: if ((dashboardView === 'status' || dashboardView === 'crew') && parentId) {
    loadSquadMemberEvm();
  }

  $: if (dashboardView === 'crew' && hasSponsor && parentId) {
    void squadMemberEvmByNpub;
    void loadSponsorExtStatus();
  }

  function openDashboardMembersPanel() {
    showMembersPanel.set(true);
    prevMembersGroupIdForPanel = announcementsGroupId;
    if (announcementsGroupId) void ensureMlsGroupMembers(announcementsGroupId);
  }

  function toggleMembersPanel() {
    if ($showMembersPanel) {
      showMembersPanel.set(false);
    } else {
      openDashboardMembersPanel();
    }
  }

  $: if ($showMembersPanel && announcementsGroupId && prevMembersGroupIdForPanel !== announcementsGroupId) {
    prevMembersGroupIdForPanel = announcementsGroupId;
    void ensureMlsGroupMembers(announcementsGroupId);
  }
  $: if (!$showMembersPanel) prevMembersGroupIdForPanel = null;

  $: if ($showMembersPanel && announcementsGroupId) {
    const gid = announcementsGroupId;
    const version = $membershipVersionByGroupId[gid] ?? 0;
    const prev = prevMembersVersionByGroup[gid] ?? -1;
    if (version !== prev) {
      prevMembersVersionByGroup = { ...prevMembersVersionByGroup, [gid]: version };
      if (version > 0) void refreshMlsGroupMembers(gid);
    }
  }

  function prefetchDeployContext() {
    void loadSquadMemberEvm();
    if (announcementsGroupId) void ensureMlsGroupMembers(announcementsGroupId);
  }

  function openLaunchpad() {
    deployCoordinator?.openLaunchpad();
  }

  function openSetSafe() {
    deployCoordinator?.openSetSafe();
  }

  function openDeploySafe() {
    deployCoordinator?.openDeploySafe();
  }
</script>

<div class="parent-dashboard-layout">
  <div class="parent-dashboard-main">
    <div class="dashboard-channel-header">
      <div class="dashboard-channel-info">
        <span class="dashboard-channel-icon">#</span>
        <h3 class="dashboard-channel-name">{SQUAD_DASHBOARD_CHANNEL_NAME}</h3>
      </div>
      <div class="dashboard-header-actions">
        <button
          type="button"
          class="channel-members-btn"
          title={$t('governance.members.title')}
          on:click={toggleMembersPanel}
          aria-label={$showMembersPanel ? $t('governance.members.close') : $t('governance.members.view')}
          aria-expanded={$showMembersPanel}
        >
          <img src={friendsIcon} alt="" class="channel-members-btn-icon" />
        </button>
      </div>
    </div>
    <div class="dashboard-view-nav" role="tablist" aria-label={$t('governance.dashboardSection')}>
      <span class="dashboard-view-nav-label" aria-hidden="true">{$t('governance.mode')}</span>
      <div class="dashboard-mode-switcher" role="group">
        {#each DASHBOARD_VIEWS as v (v)}
          <button
            type="button"
            role="tab"
            class="dashboard-mode-segment"
            class:active={dashboardView === v}
            aria-selected={dashboardView === v}
            on:click={() => selectDashboardView(v)}
            on:mouseenter={() => prefetchDashboardTabIntent(v)}
            on:focus={() => prefetchDashboardTabIntent(v)}
          >
            {$t(`governance.dashboardView.${v}`)}
          </button>
        {/each}
      </div>
    </div>
    <div class="parent-dashboard-body">
      <div class="parent-dashboard" class:parent-dashboard-wide={dashboardView === 'roles' || dashboardView === 'governance'}>
        {#if parent.kind === 'squad-pair' && parent.pairedSquads?.length}
          <div class="dashboard-header">
            <p class="dashboard-subtitle">
              {parent.pairedSquads.map((s) => s.name).join(', ')}
            </p>
          </div>
        {/if}

        {#if visitedDashboardViews.has('status')}
          <div class="dashboard-tab-pane" class:dashboard-tab-pane-active={dashboardView === 'status'} hidden={dashboardView !== 'status'}>
          {#await loadDashboardStatusTab() then StatusTab}
            <StatusTab
              squad={parent}
              {permissionsCtx}
              {squadAdminCtx}
              {announcementsGroupId}
              parentId={parentId ?? ''}
              {channelMembers}
              {squadMemberEvmByNpub}
              {memberRolesByAddress}
              {squadNetwork}
              squadNetworkFromInfra={infraSquadChain != null}
              onSetSquadNetwork={setSquadNetwork}
              hasGovernance={hasPactoGov}
              {hasSquadAdmin}
              {captainWearers}
              {crewWearers}
              onOpenDeploy={openLaunchpad}
              onOpenCrewBootstrap={() => selectDashboardView('governance')}
            />
          {:catch}
            <p class="dashboard-tab-load-error" role="alert">{$t('governance.tabLoadError.status')}</p>
          {/await}
          </div>
        {/if}
        {#if visitedDashboardViews.has('governance')}
          <div class="dashboard-tab-pane" class:dashboard-tab-pane-active={dashboardView === 'governance'} hidden={dashboardView !== 'governance'}>
          {#await loadDashboardGovernanceTab() then GovernanceTab}
            <GovernanceTab
              {squadInfraRows}
              {pactoPayload}
              pactoGovTopHatId={pactoGovRow?.canonicalRef ?? ''}
              pactoGovChain={pactoGovRow?.chain}
              parentId={parentId ?? ''}
              myAddress={myGovernanceAddress}
              {captainWearers}
              {crewWearers}
              memberEvmOptions={memberEvmOptionsForRoles}
              {treasuryProposals}
              {treasuryProposalsLoading}
              treasuryProposalsRefreshing={treasuryProposalsRefreshing}
              {treasuryProposalsError}
              onRefreshProposals={refreshTreasuryProposals}
              onOpenLaunchpad={openLaunchpad}
              {hasSponsor}
            />
          {:catch}
            <p class="dashboard-tab-load-error" role="alert">{$t('governance.tabLoadError.governance')}</p>
          {/await}
          </div>
        {/if}
        {#if visitedDashboardViews.has('roles')}
          <div class="dashboard-tab-pane" class:dashboard-tab-pane-active={dashboardView === 'roles'} hidden={dashboardView !== 'roles'}>
          {#await loadDashboardRolesTreeTab() then RolesTreeTab}
            <RolesTreeTab
              {squadInfraRows}
              {structureSummary}
              {hatsTree}
              {hatsTreeLoading}
              hatsTreeRefreshing={hatsTreeRefreshing}
              {hatsTreeError}
              {roleLabelByHatId}
              {wearerAddressesByHatId}
              {executorRolesByAddress}
              {squadMemberEvmByNpub}
              {knownWearerLabels}
              rolesTreeAnnotationsLoading={rolesTreeAnnotationsLoading}
              rolesTreeAnnotationsRefreshing={rolesTreeAnnotationsRefreshing}
              {rolesTreeAnnotationsError}
              onRefreshRolesTree={refreshRolesTree}
              onOpenLaunchpad={openLaunchpad}
            />
          {:catch}
            <p class="dashboard-tab-load-error" role="alert">{$t('governance.tabLoadError.roles')}</p>
          {/await}
          </div>
        {/if}
        {#if visitedDashboardViews.has('treasury')}
          <div class="dashboard-tab-pane" class:dashboard-tab-pane-active={dashboardView === 'treasury'} hidden={dashboardView !== 'treasury'}>
          {#await loadDashboardTreasuryTab() then TreasuryTab}
            <TreasuryTab
              parentId={parentId ?? ''}
              network={pactoGovRow?.chain ?? squadNetwork ?? 'sepolia'}
              {sponsorRow}
              {treasurySafes}
              {displayedTreasurySafes}
              {governanceTreasurySafe}
              {pactoPayload}
              {announcementsGroupId}
              myAddress={myGovernanceAddress}
              {captainWearers}
              {crewWearers}
              onOpenSponsorDeploy={openLaunchpad}
              onOpenDeploySafe={openDeploySafe}
              onOpenImportSafe={openSetSafe}
            />
          {:catch}
            <p class="dashboard-tab-load-error" role="alert">{$t('governance.tabLoadError.treasury')}</p>
          {/await}
          </div>
        {/if}
        {#if visitedDashboardViews.has('crew')}
          <div class="dashboard-tab-pane" class:dashboard-tab-pane-active={dashboardView === 'crew'} hidden={dashboardView !== 'crew'}>
          {#await loadDashboardCrewTab() then CrewTab}
            <CrewTab
              squad={parent}
              {announcementsGroupId}
              {channelMembers}
              {loadingMembers}
              {settingsChainError}
              {settingsChainLoading}
              settingsChainRefreshing={settingsChainRefreshing}
              {squadMemberEvmByNpub}
              {memberHatByAddress}
              {memberRolesByAddress}
              showManagePrivileges={!!squadAdminCtx}
              pactoGovRevision={permissionsCtx.pactoGovRevision ?? ''}
              onOpenSquadRolesModal={() => deployCoordinator?.openSquadRolesModal()}
              {sponsorExtStatus}
              {sponsorExtLoading}
              {sponsorExtError}
              sponsorNetwork={sponsorRow?.chain?.trim() || squadNetwork || pactoNetwork || DEFAULT_CHAIN_ID}
              parentId={parentId ?? ''}
              onRefreshSponsorExt={refreshSponsorExtStatus}
              hasSponsor={hasSponsor}
              sponsorHatsMode={sponsorVariant === 'hats'}
              {captainWearers}
              {crewWearers}
            />
          {:catch}
            <p class="dashboard-tab-load-error" role="alert">{$t('governance.tabLoadError.crew')}</p>
          {/await}
          </div>
        {/if}
      </div>
    </div>
  </div>
  <ParentDashboardMembersPanel
    open={$showMembersPanel}
    {channelMembers}
    {loadingMembers}
  />
</div>

<GovernanceDeployCoordinator
  bind:this={deployCoordinator}
  parentId={parentId ?? ''}
  {announcementsGroupId}
  treasurySafeCount={treasurySafes?.length ?? 0}
  {hasSponsor}
  {hasPactoGov}
  {hasSquadAdmin}
  squadAdminProxy={squadAdminCtx?.proxy ?? ''}
  {squadAdminNetwork}
  {squadNetwork}
  sponsorAddress={sponsorRow?.canonicalRef ?? ''}
  pactoGovAddress={pactoPayload?.safe?.trim() ||
    pactoPayload?.squadAdminProxy?.trim() ||
    pactoGovRow?.canonicalRef?.trim() ||
    ''}
  pactoGovTopHatId={pactoGovRow?.canonicalRef ?? ''}
  quartermaster={pactoPayload?.quartermaster ?? ''}
  {captainMemberOptions}
  memberEvmOptions={memberEvmOptionsForRoles}
  {onConfirmImportSafe}
  {onPactoGovDeployComplete}
  {onSponsorDeployComplete}
  {onSquadAdminDeployComplete}
  onNavigate={selectDashboardView}
  onPrefetchDeployContext={prefetchDeployContext}
/>

<style>
  .parent-dashboard-layout {
    flex: 1;
    display: flex;
    flex-direction: row;
    background: var(--bg-panel);
    height: 100%;
    min-width: 0;
    border-left: 1px solid var(--border-subtle);
  }

  .parent-dashboard-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .parent-dashboard-body {
    flex: 1;
    overflow: auto;
    min-height: 0;
    min-width: 0;
  }

  .dashboard-view-nav {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 48px;
    min-height: 48px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    flex-shrink: 0;
  }

  .dashboard-view-nav-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .dashboard-mode-switcher {
    display: inline-flex;
    align-items: stretch;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 3px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .dashboard-mode-segment {
    padding: 0 14px;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s, background-color 0.15s;
  }

  .dashboard-mode-segment:hover:not(.active) {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .dashboard-mode-segment:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .dashboard-mode-segment.active {
    color: var(--text-primary);
    background: var(--bg-elevated);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .dashboard-channel-header {
    height: 48px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    flex-shrink: 0;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
  }

  .dashboard-channel-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dashboard-channel-icon {
    color: var(--text-muted);
    font-size: 1.25rem;
    font-weight: 600;
  }

  .dashboard-channel-name {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .dashboard-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .channel-members-btn {
    padding: 6px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .channel-members-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .channel-members-btn-icon {
    width: 20px;
    height: 20px;
    display: block;
    filter: var(--icon-dropdown-filter);
  }

  .parent-dashboard {
    padding: 24px;
    max-width: 560px;
  }

  /* Roles org-chart and Governance module grid need the full mode width. */
  .parent-dashboard-wide {
    max-width: none;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }

  .dashboard-header {
    margin-bottom: 16px;
  }

  .dashboard-subtitle {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
  }

  .btn-primary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }

  .dashboard-tab-load-error {
    margin: 16px;
    font-size: 0.875rem;
    color: var(--danger, #e53e3e);
  }

  .dashboard-tab-pane[hidden] {
    display: none !important;
  }
</style>
