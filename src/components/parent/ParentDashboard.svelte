<script lang="ts">
  import type { Squad } from '../../stores/app';
  import {
    ANNOUNCEMENTS_CHANNEL_NAME,
    DASHBOARD_CHANNEL_NAME,
    showMembersPanel,
    membershipVersionByGroupId,
    parentDashboardChannelMode,
    type ParentDashboardChannelMode,
  } from '../../stores/app';
  import type { TreasurySafeEntry } from '../../lib/treasury/treasury-safes';
  import { TREASURY_SAFE_UI_CAP } from '../../lib/treasury/treasury-safes';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';
  import type { ParentGovernanceDto, SquadInfraDto, TreasuryProposalDto, HatTreeNodeDto } from '../../lib/governance/api';
  import {
    hasSponsorInfra,
    pactoGovInfraRow,
    sponsorInfraRow,
    withLegacyProvider,
  } from '../../lib/governance/api';
  import { parsePactoGovProviderPayload } from '../../lib/governance/pacto-gov-payload';
  import { hasSquadAdminInfra, resolveSquadAdminContext } from '../../lib/governance/squad-admin-payload';
  import { standaloneSafeInfraRows } from '../../lib/governance/standalone-safe-payload';
  import { DEFAULT_CHAIN_ID, parseSupportedChainId, type SupportedChainId } from '../../lib/wallet/chains';
  import { currentUser } from '../../stores/auth';
  import friendsIcon from '../../icons/friends.svg';
  import ParentDashboardMembersPanel from './dashboard/ParentDashboardMembersPanel.svelte';
  import ParentDashboardModals from './dashboard/ParentDashboardModals.svelte';
  import {
    loadDashboardGovernanceTab,
    loadDashboardRolesTreeTab,
    loadDashboardSettingsTab,
    loadDashboardTreasuryTab,
  } from '../../lib/dashboard/dashboard-tab-components';
  import { showToast } from '../../stores/toast';
  import { resolveDashboardStructureSummary } from '../../lib/dashboard/structure-summary';
  import { resolveDashboardPermissionsContext } from '../../lib/dashboard/permissions-panel';
  import {
    fetchDashboardChannelMembers,
    fetchHatsTree,
    fetchSettingsChainMemberMaps,
    fetchSquadMemberEvmByNpub,
    fetchTreasuryProposalVoteMap,
    fetchTreasuryProposals,
  } from '../../lib/dashboard/parent-dashboard-loaders';
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

  type ParentDashboardView = ParentDashboardChannelMode;
  const DASHBOARD_VIEWS: { id: ParentDashboardView; label: string }[] = [
    { id: 'governance', label: 'Governance' },
    { id: 'roles_tree', label: 'Roles Tree' },
    { id: 'treasury', label: 'Treasury' },
    { id: 'settings', label: 'Settings' },
  ];

  $: dashboardView = $parentDashboardChannelMode;

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

  let showSetSafeModal = false;
  let showDeploySafeModal = false;
  let showNaveWizard = false;
  let showLaunchpad = false;
  let showSponsorDeploy = false;
  let showSquadAdminDeploy = false;
  let showSquadRolesModal = false;

  let setSafeInput = '';
  let setSafeChain: SupportedChainId = DEFAULT_CHAIN_ID;
  let setSafeLabel = '';
  let setSafeError = '';
  let setSafeSaving = false;

  $: parentId = parent?.id;
  $: sponsorRow = sponsorInfraRow(squadInfraRows);
  $: hasSponsor = hasSponsorInfra(squadInfraRows);
  $: displayedTreasurySafes = [...(treasurySafes ?? [])].slice(0, TREASURY_SAFE_UI_CAP);

  $: pactoGovRow = pactoGovInfraRow(squadInfraRows);
  $: hasPactoGov = pactoGovRow != null;
  $: squadAdminCtx = resolveSquadAdminContext(squadInfraRows);
  $: hasSquadAdmin = hasSquadAdminInfra(squadInfraRows);
  $: vaultSafeCount = standaloneSafeInfraRows(squadInfraRows).length;
  $: pactoPayload = parsePactoGovProviderPayload(pactoGovRow?.providerPayload);
  $: pactoNetwork = parseSupportedChainId(
    pactoGovRow?.chain?.trim() || squadAdminCtx?.chain || DEFAULT_CHAIN_ID,
  );
  $: squadAdminNetwork = parseSupportedChainId(squadAdminCtx?.chain?.trim() || DEFAULT_CHAIN_ID);
  $: memberEvmOptionsForRoles = channelMembers
    .map((npub) => {
      const addr = squadMemberEvmByNpub[npub]?.trim();
      if (!addr) return null;
      const name = getProfileDisplayName($profiles[npub]) || npub.slice(0, 12);
      return { address: addr, label: name };
    })
    .filter((row): row is { address: string; label: string } => row != null);

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
  let proposalHasVotedById: Record<string, boolean> = {};
  let proposalVotesLoading = false;
  let myVoterAddress = '';

  let hatsTree: HatTreeNodeDto | null = null;
  let hatsTreeLoading = false;
  let hatsTreeRefreshing = false;
  let hatsTreeError = '';
  let hatsTreeKey = '';

  let memberHatByAddress: Record<string, string> = {};
  let memberRolesByAddress: Record<string, string> = {};
  let settingsChainLoading = false;
  let settingsChainRefreshing = false;
  let settingsChainError = '';
  let settingsChainKey = '';

  async function loadTreasuryProposalVotes() {
    const ta = pactoPayload?.treasuryAuthority?.trim();
    if (!ta || treasuryProposals.length === 0) {
      proposalHasVotedById = {};
      myVoterAddress = '';
      return;
    }
    const me = $currentUser?.npub;
    const voter = me ? squadMemberEvmByNpub[me]?.trim() : '';
    myVoterAddress = voter;
    if (!voter) {
      proposalHasVotedById = {};
      return;
    }
    proposalVotesLoading = true;
    try {
      proposalHasVotedById = await fetchTreasuryProposalVoteMap({
        network: pactoNetwork,
        treasuryAuthority: ta,
        proposals: treasuryProposals,
        voterAddress: voter,
      });
    } catch {
      proposalHasVotedById = {};
    } finally {
      proposalVotesLoading = false;
    }
  }

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
    treasuryProposalsLoading = false;
    treasuryProposalsRefreshing = false;
    if (!result.error) {
      treasuryProposals = result.proposals;
      if (npub) persistTreasuryProposalsSnapshot(npub, key, result.proposals);
      await loadTreasuryProposalVotes();
    } else if (cached) {
      treasuryProposalsError = result.error;
    } else {
      treasuryProposals = result.proposals;
      treasuryProposalsError = result.error;
      proposalHasVotedById = {};
    }
  }

  function onTreasuryVoteClick() {
    showToast(
      'On-chain vote signing is not wired yet — your vote status is loaded from Treasury Authority.',
    );
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

  $: if (dashboardView === 'governance' && pactoPayload?.treasuryAuthority) {
    void loadTreasuryProposals();
  }

  $: if (dashboardView === 'governance' && parentId) {
    void loadSquadMemberEvm();
  }

  $: if (dashboardView === 'roles_tree' && pactoGovRow?.canonicalRef) {
    void loadHatsTree();
  }

  $: if (dashboardView === 'settings' && (pactoGovRow?.canonicalRef || squadAdminCtx?.proxy)) {
    void loadSettingsChainContext();
  }

  $: announcementsGroupId =
    parent?.channels?.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME)?.groupId ??
    parent?.channels?.[0]?.groupId ??
    null;

  let channelMembers: string[] = [];
  let loadingMembers = false;
  let prevMembersGroupIdForPanel: string | null = null;
  $: squadMemberEvmByNpub = parentId ? ($squadMemberEvmByParentId[parentId] ?? {}) : {};

  async function loadSquadMemberEvm() {
    if (!parentId) return;
    const rows = await fetchSquadMemberEvmByNpub(parentId, announcementsGroupId);
    squadMemberEvmByParentId.update((m) => ({ ...m, [parentId]: rows }));
    const npub = $currentUser?.npub;
    if (npub) persistSquadMemberEvmForParent(npub, parentId, rows);
  }

  async function loadDashboardMembers() {
    if (!announcementsGroupId) return;
    loadingMembers = true;
    channelMembers = await fetchDashboardChannelMembers(announcementsGroupId);
    loadingMembers = false;
  }

  function selectDashboardView(id: ParentDashboardView) {
    parentDashboardChannelMode.set(id);
    if (id === 'settings' && announcementsGroupId) loadDashboardMembers();
  }

  function prefetchDashboardTabIntent(id: ParentDashboardView) {
    if (id === 'governance') {
      if (pactoPayload?.treasuryAuthority) void loadTreasuryProposals();
      void loadSquadMemberEvm();
    } else if (id === 'roles_tree' && pactoGovRow?.canonicalRef) {
      void loadHatsTree();
    }
  }

  $: if (dashboardView === 'settings' && parentId) {
    loadSquadMemberEvm();
  }

  function openDashboardMembersPanel() {
    showMembersPanel.set(true);
    prevMembersGroupIdForPanel = announcementsGroupId;
    channelMembers = [];
    loadDashboardMembers();
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
    loadDashboardMembers();
  }
  $: if (!$showMembersPanel) prevMembersGroupIdForPanel = null;

  $: if ($showMembersPanel && announcementsGroupId) {
    const gid = announcementsGroupId;
    const version = $membershipVersionByGroupId[gid] ?? 0;
    if (version > 0) {
      loadDashboardMembers();
    }
  }

  function openLaunchpad() {
    showLaunchpad = true;
  }

  function requireSponsorForInfra(action: () => void) {
    if (!hasSponsor) {
      showToast('Deploy squad sponsor first.');
      showLaunchpad = true;
      return;
    }
    action();
  }

  function openSetSafe() {
    requireSponsorForInfra(() => {
      showSetSafeModal = true;
      setSafeInput = '';
      setSafeChain = DEFAULT_CHAIN_ID;
      setSafeLabel = '';
      setSafeError = '';
    });
  }

  function openDeploySafe() {
    requireSponsorForInfra(() => {
      showDeploySafeModal = true;
    });
  }

  function openPactoGovDeploy() {
    requireSponsorForInfra(() => {
      if (pactoGovRow) {
        selectDashboardView('governance');
        return;
      }
      if (parentId?.trim()) showNaveWizard = true;
    });
  }

  function openSponsorDeploy() {
    if (parentId?.trim()) showSponsorDeploy = true;
  }

  function openSquadAdminDeploy() {
    requireSponsorForInfra(() => {
      if (hasSquadAdmin) {
        selectDashboardView('settings');
        showSquadRolesModal = true;
        return;
      }
      if (parentId?.trim()) showSquadAdminDeploy = true;
    });
  }

  function closeSetSafeModal() {
    showSetSafeModal = false;
    setSafeInput = '';
    setSafeLabel = '';
    setSafeError = '';
  }

  async function confirmSetSafe() {
    const addr = setSafeInput.trim();
    if (!addr) {
      setSafeError = 'Enter a Safe address';
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setSafeError = 'Invalid address (expected 0x + 40 hex chars)';
      return;
    }
    if (!onConfirmImportSafe) {
      setSafeError = 'Import Safe is not available';
      return;
    }
    if ((treasurySafes?.length ?? 0) >= TREASURY_SAFE_UI_CAP) {
      setSafeError = `At most ${TREASURY_SAFE_UI_CAP} Safes are shown per squad. Remove one from another client or use a fresh parent.`;
      return;
    }
    setSafeSaving = true;
    setSafeError = '';
    try {
      const entryId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `te-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await onConfirmImportSafe({
        safeAddress: addr,
        chain: setSafeChain,
        label: setSafeLabel.trim(),
        entryId,
      });
      closeSetSafeModal();
      selectDashboardView('treasury');
      showToast('Safe imported and added to treasury.');
    } catch (e) {
      setSafeError = (e as Error)?.message ?? 'Failed to import Safe';
    } finally {
      setSafeSaving = false;
    }
  }
</script>

<div class="parent-dashboard-layout">
  <div class="parent-dashboard-main">
    <div class="dashboard-channel-header">
      <div class="dashboard-channel-info">
        <span class="dashboard-channel-icon">#</span>
        <h3 class="dashboard-channel-name">{DASHBOARD_CHANNEL_NAME}</h3>
      </div>
      <div class="dashboard-header-actions">
        <button
          type="button"
          class="channel-members-btn"
          title="Members"
          on:click={toggleMembersPanel}
          aria-label={$showMembersPanel ? 'Close channel members' : 'View channel members'}
          aria-expanded={$showMembersPanel}
        >
          <img src={friendsIcon} alt="" class="channel-members-btn-icon" />
        </button>
      </div>
    </div>
    <div class="dashboard-view-nav" role="tablist" aria-label="Dashboard section">
      <span class="dashboard-view-nav-label" aria-hidden="true">Mode</span>
      <div class="dashboard-mode-switcher" role="group">
        {#each DASHBOARD_VIEWS as v}
          <button
            type="button"
            role="tab"
            class="dashboard-mode-segment"
            class:active={dashboardView === v.id}
            aria-selected={dashboardView === v.id}
            on:click={() => selectDashboardView(v.id)}
            on:mouseenter={() => prefetchDashboardTabIntent(v.id)}
            on:focus={() => prefetchDashboardTabIntent(v.id)}
          >
            {v.label}
          </button>
        {/each}
      </div>
    </div>
    <div class="parent-dashboard-body">
      <div class="parent-dashboard">
        {#if parent.kind === 'squad-pair' && parent.pairedSquads?.length}
          <div class="dashboard-header">
            <p class="dashboard-subtitle">
              {parent.pairedSquads.map((s) => s.name).join(', ')}
            </p>
          </div>
        {/if}

        {#if dashboardView === 'governance'}
          {#await loadDashboardGovernanceTab() then GovernanceTab}
            <GovernanceTab
              {squadInfraRows}
              {hasSponsor}
              {pactoPayload}
              {treasuryProposals}
              {treasuryProposalsLoading}
              treasuryProposalsRefreshing={treasuryProposalsRefreshing}
              {treasuryProposalsError}
              {myVoterAddress}
              {proposalHasVotedById}
              {proposalVotesLoading}
              onTreasuryVoteClick={onTreasuryVoteClick}
              onOpenLaunchpad={openLaunchpad}
            />
          {:catch}
            <p class="dashboard-tab-load-error" role="alert">Could not load Governance tab.</p>
          {/await}
        {:else if dashboardView === 'roles_tree'}
          {#await loadDashboardRolesTreeTab() then RolesTreeTab}
            <RolesTreeTab
              {squadInfraRows}
              {hasSponsor}
              {structureSummary}
              {hatsTree}
              {hatsTreeLoading}
              hatsTreeRefreshing={hatsTreeRefreshing}
              {hatsTreeError}
              onOpenLaunchpad={openLaunchpad}
            />
          {:catch}
            <p class="dashboard-tab-load-error" role="alert">Could not load Roles Tree tab.</p>
          {/await}
        {:else if dashboardView === 'treasury'}
          {#await loadDashboardTreasuryTab() then TreasuryTab}
            <TreasuryTab
              parentId={parentId ?? ''}
              {sponsorRow}
              {treasurySafes}
              {displayedTreasurySafes}
              {pactoPayload}
              onOpenSponsorDeploy={openSponsorDeploy}
              onOpenDeploySafe={openDeploySafe}
              onOpenImportSafe={openSetSafe}
            />
          {:catch}
            <p class="dashboard-tab-load-error" role="alert">Could not load Treasury tab.</p>
          {/await}
        {:else if dashboardView === 'settings'}
          {#await loadDashboardSettingsTab() then SettingsTab}
            <SettingsTab
              {squadInfraRows}
              {hasSponsor}
              {permissionsCtx}
              {squadAdminCtx}
            {settingsChainError}
            {settingsChainLoading}
            settingsChainRefreshing={settingsChainRefreshing}
            {announcementsGroupId}
              parentId={parentId ?? ''}
              {channelMembers}
              {loadingMembers}
              {squadMemberEvmByNpub}
              {memberHatByAddress}
              {memberRolesByAddress}
              onOpenLaunchpad={openLaunchpad}
              onOpenSquadRolesModal={() => (showSquadRolesModal = true)}
              onRosterBindingChanged={() => void loadSquadMemberEvm()}
            />
          {:catch}
            <p class="dashboard-tab-load-error" role="alert">Could not load Settings tab.</p>
          {/await}
        {/if}
      </div>
    </div>
    <div class="dashboard-deploy-bar">
      <button type="button" class="btn-primary dashboard-deploy-btn" on:click={openLaunchpad}>Deploy</button>
    </div>
  </div>
  <ParentDashboardMembersPanel
    open={$showMembersPanel}
    {channelMembers}
    {loadingMembers}
  />
</div>

<ParentDashboardModals
  parentId={parentId ?? ''}
  {announcementsGroupId}
  treasurySafeCount={treasurySafes?.length ?? 0}
  {hasSponsor}
  {hasPactoGov}
  {hasSquadAdmin}
  {vaultSafeCount}
  squadAdminProxy={squadAdminCtx?.proxy ?? ''}
  squadAdminNetwork={squadAdminNetwork}
  memberEvmOptions={memberEvmOptionsForRoles}
  bind:showDeploySafeModal
  bind:showNaveWizard
  bind:showLaunchpad
  bind:showSponsorDeploy
  bind:showSquadAdminDeploy
  bind:showSquadRolesModal
  bind:showSetSafeModal
  bind:setSafeInput
  bind:setSafeChain
  bind:setSafeLabel
  bind:setSafeError
  bind:setSafeSaving
  onCloseDeploySafe={() => (showDeploySafeModal = false)}
  onCloseNaveWizard={() => (showNaveWizard = false)}
  onCloseLaunchpad={() => (showLaunchpad = false)}
  onCloseSponsorDeploy={() => (showSponsorDeploy = false)}
  onCloseSquadAdminDeploy={() => (showSquadAdminDeploy = false)}
  onCloseSquadRolesModal={() => (showSquadRolesModal = false)}
  onCloseSetSafe={closeSetSafeModal}
  onConfirmSetSafe={confirmSetSafe}
  onDeploySponsor={openSponsorDeploy}
  onDeploySquadAdmin={openSquadAdminDeploy}
  onDeployPactoGov={openPactoGovDeploy}
  onDeploySafe={openDeploySafe}
  onImportSafe={openSetSafe}
  onDeploySafeSuccess={async (params) => {
    if (!onConfirmImportSafe) {
      throw new Error('Treasury save is not available in this context.');
    }
    await onConfirmImportSafe({
      safeAddress: params.safeAddress,
      chain: params.chain,
      label: params.label.trim() || 'Deployed multisig',
      entryId: params.entryId,
      txHash: params.txHash,
    });
    showToast('Safe deployed and added to treasury.');
    selectDashboardView('treasury');
  }}
  onNaveComplete={async (out) => {
    await onPactoGovDeployComplete?.({
      parentId: parentId!.trim(),
      announcementsGroupId: announcementsGroupId?.trim() ?? '',
      chain: out.chain,
      topHatId: out.topHatId,
      providerPayload: out.providerPayload,
      safeAddress: out.safeAddress,
      txHash: out.txHash,
    });
    showNaveWizard = false;
    selectDashboardView('governance');
    showToast('Pacto Gov deployed — Governance and Roles Tree tabs are live.');
  }}
  onSquadAdminComplete={async (out) => {
    await onSquadAdminDeployComplete?.({
      parentId: parentId!.trim(),
      announcementsGroupId: announcementsGroupId?.trim() ?? '',
      chain: out.chain,
      squadAdminProxy: out.squadAdminProxy,
      providerPayload: out.providerPayload,
      infraRowId: out.infraRowId,
    });
    showToast('Squad Admin deployed — open Settings to manage roles.');
    selectDashboardView('settings');
  }}
  onSponsorComplete={async (out) => {
    await onSponsorDeployComplete?.({
      parentId: parentId!.trim(),
      announcementsGroupId: announcementsGroupId?.trim() ?? '',
      chain: out.chain,
      sponsorAddress: out.sponsorAddress,
      providerPayload: out.providerPayload,
      infraRowId: out.infraRowId,
    });
    showToast('Squad sponsor deployed and saved.');
  }}
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
    overflow-y: auto;
    min-height: 0;
  }

  .dashboard-deploy-bar {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    padding: 12px 16px;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
  }

  .dashboard-deploy-btn {
    min-width: 120px;
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
</style>
