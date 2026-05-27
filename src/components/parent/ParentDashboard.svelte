<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import type { Squad, Network } from '../../stores/app';
  import {
    ANNOUNCEMENTS_CHANNEL_NAME,
    DASHBOARD_CHANNEL_NAME,
    showMembersPanel,
    membershipVersionByGroupId,
    parentDashboardChannelMode,
    type ParentDashboardChannelMode,
  } from '../../stores/app';
  import { getMlsGroupMembers } from '../../lib/api/nostr';
  import type { TreasurySafeEntry } from '../../lib/treasury/treasury-safes';
  import { TREASURY_SAFE_UI_CAP } from '../../lib/treasury/treasury-safes';
  import { explorerAddressUrl, parseSupportedChainId, safeAppHomeUrl } from '../../lib/wallet/chains';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import { profiles } from '../../stores/profiles';
  import { safeStateByTreasuryId, refreshSafeStateForTreasuryEntry } from '../../stores/safe';
  import type { ParentGovernanceDto, SquadInfraDto, TreasuryProposalDto, HatTreeNodeDto } from '../../lib/governance/api';
  import {
    getHatsTree,
    getMemberHatWearers,
    getNavePirataDeployment,
    getSquadAdminExecutorRoles,
    hasSponsorInfra,
    listTreasuryProposals,
    pactoGovInfraRow,
    sponsorInfraRow,
    treasuryProposalHasVoted,
    withLegacyProvider,
  } from '../../lib/governance/api';
  import {
    formatSquadAdminExecutorRoles,
    hatChecksFromNaveDeployment,
    parsePactoGovProviderPayload,
  } from '../../lib/governance/pacto-gov-payload';
  import { hasSquadAdminInfra, resolveSquadAdminContext } from '../../lib/governance/squad-admin-payload';
  import { standaloneSafeInfraRows } from '../../lib/governance/standalone-safe-payload';
  import { isTreasuryProposalActive } from '../../lib/governance/treasury-proposal-ui';
  import { treasuryVaultHeading } from '../../lib/treasury/treasury-vault-labels';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { currentUser } from '../../stores/auth';
  import friendsIcon from '../../icons/friends.svg';
  import DeploySafeModal from './DeploySafeModal.svelte';
  import DeployNavePirataWizard from './governance/DeployNavePirataWizard.svelte';
  import DeploySquadSponsorModal from './governance/DeploySquadSponsorModal.svelte';
  import DeploySquadAdminModal from './governance/DeploySquadAdminModal.svelte';
  import LaunchpadModal from './governance/LaunchpadModal.svelte';
  import SquadSponsorTreasuryPanel from './governance/SquadSponsorTreasuryPanel.svelte';
  import HatsTreeDiagram from './governance/HatsTreeDiagram.svelte';
  import TreasuryProposalCard from './governance/TreasuryProposalCard.svelte';
  import SmartContractSecuritySection from './governance/SmartContractSecuritySection.svelte';
  import SquadRolesModal from './governance/SquadRolesModal.svelte';
  import { showToast } from '../../stores/toast';
  import { listSquadMemberEvmInvokeArgs } from '../../lib/squad/squad-member-evm-share';
  import { resolveDashboardStructureSummary } from '../../lib/dashboard/structure-summary';
  import { resolveDashboardPermissionsContext } from '../../lib/dashboard/permissions-panel';

  /** Sub-views under #dashboard: Governance, Roles Tree, Treasury, Settings. */
  type ParentDashboardView = ParentDashboardChannelMode;
  const DASHBOARD_VIEWS: { id: ParentDashboardView; label: string }[] = [
    { id: 'governance', label: 'Governance' },
    { id: 'roles_tree', label: 'Roles Tree' },
    { id: 'treasury', label: 'Treasury' },
    { id: 'settings', label: 'Settings' },
  ];

  $: dashboardView = $parentDashboardChannelMode;

  export let parent: Squad | Network;
  export let parentType: 'squad' | 'network' = 'squad';

  /** Linked Safes for this parent (from store + backend). */
  export let treasurySafes: TreasurySafeEntry[] = [];

  /** Governance row when loaded (`undefined` = not hydrated yet). */
  export let governanceConfig: ParentGovernanceDto | null | undefined = undefined;

  /** All infra rows for this parent (`undefined` = not hydrated yet). */
  export let squadInfraRows: SquadInfraDto[] | undefined = undefined;

  /** Persist, announce, and refresh store after sponsor deploy. */
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

  /** Persist, announce, and refresh store. */
  export let onConfirmImportSafe:
    | ((params: {
        safeAddress: string;
        chain: string;
        label: string;
        entryId: string;
        txHash?: string;
      }) => Promise<void>)
    | undefined = undefined;

  /** After successful Nave Pirata deploy: persist governance row, announce, refresh stores. */
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

  /** Persist, announce, and refresh store after standalone Squad Admin deploy. */
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
  let setSafeChain: 'sepolia' | 'mainnet' | 'optimism' = 'sepolia';
  let setSafeLabel = '';
  let setSafeError = '';
  let setSafeSaving = false;

  $: parentId = parent?.id;

  $: sponsorRow = sponsorInfraRow(squadInfraRows);
  $: hasSponsor = hasSponsorInfra(squadInfraRows);

  $: displayedTreasurySafes = [...(treasurySafes ?? [])].slice(0, TREASURY_SAFE_UI_CAP);
  $: treasuryStateKey = displayedTreasurySafes.map((e) => e.id).join('|');
  $: if ((dashboardView === 'treasury' || dashboardView === 'governance') && treasuryStateKey) {
    displayedTreasurySafes.forEach((e) => {
      refreshSafeStateForTreasuryEntry(e);
    });
  }

  $: pactoGovRow = pactoGovInfraRow(squadInfraRows);
  $: hasPactoGov = pactoGovRow != null;
  $: squadAdminCtx = resolveSquadAdminContext(squadInfraRows);
  $: hasSquadAdmin = hasSquadAdminInfra(squadInfraRows);
  $: vaultSafeCount = standaloneSafeInfraRows(squadInfraRows).length;
  $: pactoPayload = parsePactoGovProviderPayload(pactoGovRow?.providerPayload);
  $: pactoNetwork = (pactoGovRow?.chain?.trim() || squadAdminCtx?.chain || 'sepolia') as
    | 'sepolia'
    | 'mainnet'
    | 'optimism';
  $: squadAdminNetwork = (squadAdminCtx?.chain?.trim() || 'sepolia') as 'sepolia' | 'mainnet' | 'optimism';
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

  $: permissionsGov =
    pactoGovRow != null ? withLegacyProvider(pactoGovRow) : governanceConfig;
  $: permissionsCtx = resolveDashboardPermissionsContext(permissionsGov);

  let treasuryProposals: TreasuryProposalDto[] = [];
  let treasuryProposalsLoading = false;
  let treasuryProposalsError = '';
  let treasuryProposalsKey = '';
  let proposalHasVotedById: Record<string, boolean> = {};
  let proposalVotesLoading = false;
  let myVoterAddress = '';

  let hatsTree: HatTreeNodeDto | null = null;
  let hatsTreeLoading = false;
  let hatsTreeError = '';
  let hatsTreeKey = '';

  let memberHatByAddress: Record<string, string> = {};
  let memberRolesByAddress: Record<string, string> = {};
  let settingsChainLoading = false;
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
    const active = treasuryProposals.filter((p) => isTreasuryProposalActive(p.status));
    if (active.length === 0) {
      proposalHasVotedById = {};
      return;
    }
    proposalVotesLoading = true;
    try {
      const pairs = await Promise.all(
        active.map(async (p) => {
          const voted = await treasuryProposalHasVoted({
            network: pactoNetwork,
            treasuryAuthority: ta,
            proposalId: p.proposalId,
            voter,
          });
          return [p.proposalId, voted] as const;
        }),
      );
      const map: Record<string, boolean> = {};
      for (const [id, voted] of pairs) map[id] = voted;
      proposalHasVotedById = map;
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
    treasuryProposalsLoading = true;
    treasuryProposalsError = '';
    try {
      const rows = await listTreasuryProposals({ network: pactoNetwork, treasuryAuthority: ta });
      treasuryProposals = [...rows].sort((a, b) => Number(b.proposalId) - Number(a.proposalId));
      await loadTreasuryProposalVotes();
    } catch (e) {
      treasuryProposals = [];
      proposalHasVotedById = {};
      treasuryProposalsError = getInvokeErrorMessage(e, 'Could not load treasury proposals.');
    } finally {
      treasuryProposalsLoading = false;
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
    hatsTreeLoading = true;
    hatsTreeError = '';
    try {
      hatsTree = await getHatsTree({ network: pactoNetwork, topHatId: topHat });
    } catch (e) {
      hatsTree = null;
      hatsTreeError = getInvokeErrorMessage(e, 'Could not load Hats tree.');
    } finally {
      hatsTreeLoading = false;
    }
  }

  async function loadSettingsChainContext() {
    const topHat = pactoGovRow?.canonicalRef?.trim();
    const squadAdmin = squadAdminCtx?.proxy?.trim() ?? '';
    const key = `${pactoNetwork}:${topHat ?? ''}:${squadAdmin}:${Object.keys(squadMemberEvmByNpub).join(',')}`;
    if ((!topHat && !squadAdmin) || settingsChainKey === key) return;
    settingsChainKey = key;
    settingsChainLoading = true;
    settingsChainError = '';
    memberHatByAddress = {};
    memberRolesByAddress = {};
    try {
      const evmAddresses = Object.values(squadMemberEvmByNpub).filter(Boolean);
      if (evmAddresses.length === 0) return;

      if (topHat) {
        const deployment = await getNavePirataDeployment({ network: pactoNetwork, topHatId: topHat });
        const assignments = await getMemberHatWearers({
          network: pactoNetwork,
          memberAddresses: evmAddresses,
          hatChecks: hatChecksFromNaveDeployment(deployment),
        });
        const hatMap: Record<string, string> = {};
        for (const row of assignments) {
          if (row.hats.length > 0) {
            hatMap[row.address.toLowerCase()] = row.hats.map((h) => h.label).join(', ');
          }
        }
        memberHatByAddress = hatMap;
      }

      if (squadAdmin) {
        const roleNetwork = squadAdminCtx?.chain?.trim() || pactoNetwork;
        const roleRows = await Promise.all(
          evmAddresses.map(async (addr) => {
            const roles = await getSquadAdminExecutorRoles({
              network: roleNetwork,
              squadAdminProxy: squadAdmin,
              executorAddress: addr,
            });
            return {
              address: addr.toLowerCase(),
              label: formatSquadAdminExecutorRoles(roles),
            };
          }),
        );
        const roleMap: Record<string, string> = {};
        for (const row of roleRows) {
          if (row.label && row.label !== '—') {
            roleMap[row.address] = row.label;
          }
        }
        memberRolesByAddress = roleMap;
      }
    } catch (e) {
      settingsChainError = getInvokeErrorMessage(e, 'Could not load on-chain Hats or Roles for members.');
    } finally {
      settingsChainLoading = false;
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

  type SquadMemberEvmRow = { memberNpub: string; evmAddress: string; updatedAtMs: number };
  let squadMemberEvmByNpub: Record<string, string> = {};

  async function loadSquadMemberEvm() {
    const pid = parentId;
    if (!pid && !announcementsGroupId) return;
    try {
      const q = listSquadMemberEvmInvokeArgs(pid ?? '', announcementsGroupId);
      if (!q.parentId) return;
      const rows = await invoke<SquadMemberEvmRow[]>('list_squad_member_evm', q);
      const m: Record<string, string> = {};
      for (const r of rows) m[r.memberNpub] = r.evmAddress;
      squadMemberEvmByNpub = m;
    } catch {
      squadMemberEvmByNpub = {};
    }
  }

  async function loadDashboardMembers() {
    const groupId = announcementsGroupId;
    if (!groupId) return;
    loadingMembers = true;
    try {
      const result = await getMlsGroupMembers(groupId);
      channelMembers = (result.members ?? []) as string[];
    } catch {
      channelMembers = [];
    } finally {
      loadingMembers = false;
    }
  }

  function selectDashboardView(id: ParentDashboardView) {
    parentDashboardChannelMode.set(id);
    if (id === 'settings' && announcementsGroupId) loadDashboardMembers();
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

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
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
      setSafeChain = 'sepolia';
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

  function closeDeploySafeModal() {
    showDeploySafeModal = false;
  }

  function closeSetSafeModal() {
    showSetSafeModal = false;
    setSafeInput = '';
    setSafeLabel = '';
    setSafeError = '';
  }

  function openTreasuryExplorer(entry: TreasurySafeEntry) {
    const url = explorerAddressUrl(parseSupportedChainId(entry.chain), entry.safeAddress);
    if (url) openExternalUrl(url);
  }

  function openTreasurySafeApp(entry: TreasurySafeEntry) {
    const url = safeAppHomeUrl(parseSupportedChainId(entry.chain), entry.safeAddress);
    if (url) openExternalUrl(url);
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
      setSafeError = `At most ${TREASURY_SAFE_UI_CAP} Safes are shown per ${parentType}. Remove one from another client or use a fresh parent.`;
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
          >
            {v.label}
          </button>
        {/each}
      </div>
    </div>
    <div class="parent-dashboard-body">
      <div class="parent-dashboard">
  {#if parentType === 'network' && (parent as Network).memberSquads?.length}
    <div class="dashboard-header">
      <p class="dashboard-subtitle">
        {(parent as Network).memberSquads.map((s) => s.name).join(', ')}
      </p>
    </div>
  {/if}

  {#if dashboardView === 'governance'}
  {#if squadInfraRows !== undefined && !hasSponsor}
    <div class="sponsor-empty-banner" role="status">
      <p class="sponsor-empty-banner-text">
        Deploy squad sponsor first — it funds gas sponsorship and unlocks Pacto Gov and Safe deploy paths.
      </p>
      <button type="button" class="btn-primary" on:click={openLaunchpad}>Open Deploy</button>
    </div>
  {/if}
  <section class="dashboard-section dashboard-placeholder-section" aria-labelledby="governance-heading">
    <h3 id="governance-heading" class="section-heading">Governance</h3>
    {#if !pactoPayload?.treasuryAuthority}
      <p class="dashboard-placeholder-text dashboard-placeholder-lead">
        Treasury Authority proposals appear here after you deploy <strong>Pacto Gov</strong> from Deploy.
      </p>
      <button type="button" class="btn-primary governance-deploy-cta" on:click={openLaunchpad}>Deploy Pacto Gov</button>
    {:else}
      {#if treasuryProposalsLoading}
        <p class="dashboard-placeholder-text muted">Loading treasury proposals…</p>
      {:else if treasuryProposalsError}
        <p class="chain-read-error" role="alert">{treasuryProposalsError}</p>
      {:else if treasuryProposals.length === 0}
        <p class="dashboard-placeholder-text muted">No treasury proposals on-chain yet for this deployment.</p>
      {:else}
        <ul class="proposal-card-list" role="list">
          {#each treasuryProposals as proposal (proposal.proposalId)}
            <TreasuryProposalCard
              {proposal}
              voterAddress={myVoterAddress}
              hasVoted={proposalHasVotedById[proposal.proposalId]}
              votePending={proposalVotesLoading}
              onVoteYea={onTreasuryVoteClick}
              onVoteNay={onTreasuryVoteClick}
            />
          {/each}
        </ul>
      {/if}
    {/if}
  </section>
  {:else if dashboardView === 'roles_tree'}
  {#if squadInfraRows !== undefined && !hasSponsor}
    <div class="sponsor-empty-banner" role="status">
      <p class="sponsor-empty-banner-text">Deploy squad sponsor first using the Deploy button below.</p>
      <button type="button" class="btn-primary" on:click={openLaunchpad}>Open Deploy</button>
    </div>
  {/if}
  <section class="dashboard-section dashboard-placeholder-section" aria-labelledby="roles-tree-heading">
    <h3 id="roles-tree-heading" class="section-heading">Roles Tree</h3>
    {#if structureSummary === undefined}
      <p class="dashboard-placeholder-text muted">Loading roles tree context…</p>
    {:else if structureSummary === null}
      <p class="dashboard-placeholder-text dashboard-placeholder-lead">
        Hat tree and role structure show here once this {parentType} has a <strong>Pacto Gov</strong> deployment
        (Deploy). Safe-only setups do not publish a Hats tree id yet.
      </p>
      <button type="button" class="btn-secondary roles-tree-deploy-cta" on:click={openLaunchpad}>Open Deploy</button>
    {:else}
      <p class="structure-summary-lead dashboard-placeholder-text">
        Top hat for this {parentType} on <strong>{structureSummary.chainDisplayName}</strong> (chain id{' '}
        <code class="structure-mono">{structureSummary.chainIdNumeric}</code>).
      </p>
      <dl class="structure-dl">
        <dt>Tree / top hat id</dt>
        <dd><code class="structure-mono">{structureSummary.treeIdRaw}</code></dd>
      </dl>
      {#if structureSummary.hatsExplorerUrl}
        {@const hatsUrl = structureSummary.hatsExplorerUrl}
        <p class="structure-actions">
          <button type="button" class="btn-link treasury-explorer-link" on:click={() => openExternalUrl(hatsUrl)}>
            Open in Hats tree explorer
          </button>
        </p>
      {:else}
        <p class="dashboard-placeholder-text muted">Explorer link could not be built for this hat id format.</p>
      {/if}
      {#if hatsTreeLoading}
        <p class="dashboard-placeholder-text muted">Loading Hats tree from chain…</p>
      {:else if hatsTreeError}
        <p class="chain-read-error" role="alert">{hatsTreeError}</p>
      {:else if hatsTree}
        <p class="roles-table-caption">On-chain tree</p>
        <HatsTreeDiagram root={hatsTree} />
      {/if}
    {/if}
  </section>
  {:else if dashboardView === 'treasury'}
  <SquadSponsorTreasuryPanel
    parentId={parentId ?? ''}
    {sponsorRow}
    onOpenDeploy={openSponsorDeploy}
  />
  <section class="dashboard-section" aria-labelledby="safe-heading">
    <div class="treasury-section-head">
      <h3 id="safe-heading" class="section-heading">Vaults</h3>
      {#if (treasurySafes?.length ?? 0) < TREASURY_SAFE_UI_CAP}
        <div class="treasury-action-btns">
          <button type="button" class="btn-primary treasury-deploy-btn" on:click={openDeploySafe}>Deploy Safe</button>
          <button type="button" class="btn-secondary treasury-import-btn" on:click={openSetSafe}>Import Safe</button>
        </div>
      {/if}
    </div>
    {#if (treasurySafes?.length ?? 0) > TREASURY_SAFE_UI_CAP}
      <p class="treasury-cap-note muted">
        Showing {TREASURY_SAFE_UI_CAP} of {treasurySafes.length} linked Safes.
      </p>
    {/if}
    {#if displayedTreasurySafes.length === 0}
      <p class="no-safe">No Safe linked yet.</p>
    {:else}
      <ul class="treasury-safe-card-list" role="list">
        {#each displayedTreasurySafes as entry (entry.id)}
          {@const st = $safeStateByTreasuryId[entry.id]}
          {@const exUrl = explorerAddressUrl(parseSupportedChainId(entry.chain), entry.safeAddress)}
          {@const safeAppUrl = safeAppHomeUrl(parseSupportedChainId(entry.chain), entry.safeAddress)}
          <li class="treasury-safe-card">
            <h4 class="treasury-vault-title">{treasuryVaultHeading(entry, pactoPayload)}</h4>
            <div class="treasury-card-top">
              <span class="treasury-pill treasury-pill-chain">{entry.chain}</span>
              {#if entry.label}
                <span class="treasury-pill treasury-pill-label">{entry.label}</span>
              {/if}
            </div>
            <code class="treasury-card-address">{entry.safeAddress}</code>
            {#if exUrl || safeAppUrl}
              <div class="treasury-card-links">
                {#if exUrl}
                  <button
                    type="button"
                    class="btn-link treasury-explorer-link"
                    on:click={() => openTreasuryExplorer(entry)}
                  >
                    View on explorer
                  </button>
                {/if}
                {#if safeAppUrl}
                  <button
                    type="button"
                    class="btn-link treasury-explorer-link"
                    on:click={() => openTreasurySafeApp(entry)}
                  >
                    Open in Safe
                  </button>
                {/if}
              </div>
            {/if}
            {#if st?.state}
              <dl class="safe-state-dl treasury-card-dl">
                <dt>Balance</dt>
                <dd>{st.state.balanceFormatted} ETH</dd>
                <dt>Signatures</dt>
                <dd>{st.state.threshold} of {st.state.owners.length}</dd>
                <dt>Nonce</dt>
                <dd>{String(st.state.nonce)}</dd>
                <dt>Owners</dt>
                <dd>
                  <ul class="safe-owners-list">
                    {#each st.state.owners as owner}
                      <li><code class="safe-owner-address">{shortAddress(owner as string)}</code></li>
                    {/each}
                  </ul>
                </dd>
              </dl>
              {#if st.loading}
                <p class="safe-state-meta">Refreshing…</p>
              {:else if st.error}
                <p class="safe-state-error" role="alert">Last refresh failed: {st.error}</p>
              {/if}
            {:else if st?.loading}
              <p class="safe-state-meta">Loading Safe state…</p>
            {:else if st?.error}
              <p class="safe-state-error" role="alert">{st.error}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
  {:else if dashboardView === 'settings'}
  {#if squadInfraRows !== undefined && !hasSponsor}
    <div class="sponsor-empty-banner" role="status">
      <p class="sponsor-empty-banner-text">Deploy squad sponsor first using the Deploy button below.</p>
      <button type="button" class="btn-primary" on:click={openLaunchpad}>Open Deploy</button>
    </div>
  {/if}
  <section class="dashboard-section dashboard-placeholder-section" aria-labelledby="settings-heading">
    <h3 id="settings-heading" class="section-heading">Settings</h3>
    {#if permissionsCtx.phase === 'loading'}
      <p class="dashboard-placeholder-text muted">Loading permissions context…</p>
    {:else}
      <p class="dashboard-placeholder-text dashboard-placeholder-lead">{permissionsCtx.leadNote}</p>
      {#if permissionsCtx.pactoGovRevision}
        <p class="permissions-revision muted">
          pacto-gov revision <code class="permissions-revision-code">{permissionsCtx.pactoGovRevision}</code>
        </p>
      {/if}
      {#if permissionsCtx.catalogRows.length > 0}
        <div class="settings-actions-row">
          <p class="roles-table-caption">Role model</p>
          {#if squadAdminCtx}
            <button type="button" class="btn-secondary settings-roles-btn" on:click={() => (showSquadRolesModal = true)}>
              Manage squad roles
            </button>
          {/if}
        </div>
        <ul class="permissions-catalog-list" role="list">
          {#each permissionsCtx.catalogRows as row (row.id)}
            <li class="permissions-catalog-card">
              <h4 class="permissions-catalog-title">{row.title}</h4>
              <p class="permissions-catalog-summary">{row.summary}</p>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
    {#if settingsChainError}
      <p class="chain-read-error" role="alert">{settingsChainError}</p>
    {/if}
    {#if announcementsGroupId}
      {#if loadingMembers && channelMembers.length === 0}
        <p class="roles-loading">Loading members…</p>
      {:else if channelMembers.length > 0}
        <p class="roles-table-caption">Members (#announcements)</p>
        <ul class="roles-member-list" role="list">
          {#each channelMembers as memberNpub (memberNpub)}
            {@const npub = memberNpub as string}
            {@const rosterEvm = squadMemberEvmByNpub[npub]}
            {@const avatarSrc = getProfileAvatarSrc($profiles[npub])}
            <li class="roles-member-row">
              {#if avatarSrc}
                <img src={avatarSrc} alt="" class="roles-member-avatar" />
              {:else}
                <div class="roles-member-avatar roles-member-avatar-ph" aria-hidden="true"></div>
              {/if}
              <div class="roles-member-meta">
                <span class="roles-member-name"
                  >{getProfileDisplayName($profiles[npub]) ||
                    (npub.length > 20 ? npub.slice(0, 14) + '…' : npub)}</span
                >
                <code class="roles-member-npub">{npub.length > 28 ? npub.slice(0, 14) + '…' + npub.slice(-8) : npub}</code>
              </div>
              <div class="roles-member-cols">
                <span class="roles-col-label">EVM</span>
                <span class="roles-col-value" class:muted={!rosterEvm}
                  >{rosterEvm ? shortAddress(rosterEvm) : 'Not shared'}</span
                >
                <span class="roles-col-label">Hats</span>
                <span class="roles-col-value" class:muted={!rosterEvm || !memberHatByAddress[rosterEvm.toLowerCase()]}
                  >{settingsChainLoading
                    ? 'Loading…'
                    : rosterEvm
                      ? memberHatByAddress[rosterEvm.toLowerCase()] || '—'
                      : 'Not shared'}</span
                >
                <span class="roles-col-label">Roles</span>
                <span
                  class="roles-col-value"
                  class:muted={!rosterEvm || !memberRolesByAddress[rosterEvm.toLowerCase()]}
                  >{settingsChainLoading
                    ? 'Loading…'
                    : rosterEvm
                      ? memberRolesByAddress[rosterEvm.toLowerCase()] || '—'
                      : 'Not shared'}</span
                >
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="dashboard-placeholder-text muted">No members loaded yet. Open the members panel or switch to this tab again.</p>
      {/if}
    {:else}
      <p class="dashboard-placeholder-text muted">No announcements channel for this {parentType}.</p>
    {/if}
    <SmartContractSecuritySection
      parentId={parentId ?? ''}
      announcementsGroupId={announcementsGroupId ?? ''}
      canManage={permissionsCtx.phase === 'pacto_gov'}
    />
  </section>
  {/if}
      </div>
    </div>
    <div class="dashboard-deploy-bar">
      <button type="button" class="btn-primary dashboard-deploy-btn" on:click={openLaunchpad}>Deploy</button>
    </div>
  </div>
  {#if $showMembersPanel}
    <aside class="members-panel" aria-label="Channel members">
      <div class="members-panel-header">
        <h3 class="members-panel-title">Members</h3>
      </div>
      <div class="members-panel-list">
        {#if loadingMembers}
          <p class="members-panel-loading">Loading…</p>
        {:else}
          {#each channelMembers as member (member)}
            {@const npub = member as string}
            {@const avatarSrc = getProfileAvatarSrc($profiles[npub])}
            <div class="members-panel-member">
              {#if avatarSrc}
                <img src={avatarSrc} alt="" class="members-panel-avatar" />
              {:else}
                <div class="members-panel-avatar members-panel-avatar-placeholder" aria-hidden="true"></div>
              {/if}
              <span class="members-panel-name">{getProfileDisplayName($profiles[npub]) || npub.slice(0, 16) + '…'}</span>
            </div>
          {/each}
        {/if}
      </div>
    </aside>
  {/if}
</div>

{#if showDeploySafeModal && parentId}
  <DeploySafeModal
    parentId={parentId}
    announcementsGroupId={announcementsGroupId}
    {parentType}
    treasurySafeCount={treasurySafes?.length ?? 0}
    onClose={closeDeploySafeModal}
    onSuccess={async (params) => {
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
  />
{/if}

{#if showNaveWizard && parentId?.trim()}
  <DeployNavePirataWizard
    parentId={parentId.trim()}
    {parentType}
    onClose={() => {
      showNaveWizard = false;
    }}
    onComplete={async (out) => {
      await onPactoGovDeployComplete?.({
        parentId: parentId.trim(),
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
  />
{/if}

{#if showLaunchpad && parentId}
  <LaunchpadModal
    {parentType}
    {hasSponsor}
    {hasPactoGov}
    {hasSquadAdmin}
    {vaultSafeCount}
    hasAnnouncementsChannel={!!announcementsGroupId}
    onClose={() => {
      showLaunchpad = false;
    }}
    onDeploySponsor={openSponsorDeploy}
    onDeploySquadAdmin={openSquadAdminDeploy}
    onDeployPactoGov={openPactoGovDeploy}
    onDeploySafe={openDeploySafe}
    onImportSafe={openSetSafe}
  />
{/if}

{#if showSquadAdminDeploy && parentId?.trim()}
  <DeploySquadAdminModal
    parentId={parentId.trim()}
    {parentType}
    onClose={() => {
      showSquadAdminDeploy = false;
    }}
    onComplete={async (out) => {
      await onSquadAdminDeployComplete?.({
        parentId: parentId.trim(),
        announcementsGroupId: announcementsGroupId?.trim() ?? '',
        chain: out.chain,
        squadAdminProxy: out.squadAdminProxy,
        providerPayload: out.providerPayload,
        infraRowId: out.infraRowId,
      });
      showToast('Squad Admin deployed — open Settings to manage roles.');
      selectDashboardView('settings');
    }}
  />
{/if}

{#if showSponsorDeploy && parentId?.trim()}
  <DeploySquadSponsorModal
    parentId={parentId.trim()}
    {parentType}
    onClose={() => {
      showSponsorDeploy = false;
    }}
    onComplete={async (out) => {
      await onSponsorDeployComplete?.({
        parentId: parentId.trim(),
        announcementsGroupId: announcementsGroupId?.trim() ?? '',
        chain: out.chain,
        sponsorAddress: out.sponsorAddress,
        providerPayload: out.providerPayload,
        infraRowId: out.infraRowId,
      });
      showToast('Squad sponsor deployed and saved.');
    }}
  />
{/if}

{#if showSetSafeModal}
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="set-safe-title">
    <div class="modal-content">
      <h3 id="set-safe-title">Import Safe</h3>
      <p class="modal-desc">
        Add a Safe to this {parentType} treasury. Members see automated treasury notices in #inbox.
      </p>
      <label class="modal-field-label" for="import-safe-addr">Contract address</label>
      <input
        id="import-safe-addr"
        type="text"
        class="input-address"
        placeholder="0x..."
        bind:value={setSafeInput}
        aria-invalid={setSafeError ? 'true' : undefined}
        aria-describedby={setSafeError ? 'set-safe-error' : undefined}
      />
      <label class="modal-field-label" for="import-safe-chain">Network</label>
      <select id="import-safe-chain" class="input-select" bind:value={setSafeChain}>
        <option value="sepolia">Sepolia</option>
        <option value="mainnet">Ethereum</option>
        <option value="optimism">Optimism</option>
      </select>
      <label class="modal-field-label" for="import-safe-label">Label (optional)</label>
      <input
        id="import-safe-label"
        type="text"
        class="input-address"
        placeholder="e.g. Operations"
        bind:value={setSafeLabel}
      />
      {#if setSafeError}
        <p id="set-safe-error" class="input-error" role="alert">{setSafeError}</p>
      {/if}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" on:click={closeSetSafeModal} disabled={setSafeSaving}>Cancel</button>
        <button type="button" class="btn-primary" on:click={confirmSetSafe} disabled={setSafeSaving}
          >{setSafeSaving ? 'Saving…' : 'Add to treasury'}</button
        >
      </div>
    </div>
  </div>
{/if}

<SquadRolesModal
  open={showSquadRolesModal}
  onClose={() => (showSquadRolesModal = false)}
  squadAdminProxy={squadAdminCtx?.proxy ?? ''}
  network={squadAdminNetwork}
  memberEvmOptions={memberEvmOptionsForRoles}
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

  .sponsor-empty-banner {
    margin: 0 16px 16px;
    padding: 14px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-elevated);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
  }

  .sponsor-empty-banner-text {
    margin: 0;
    flex: 1;
    min-width: 200px;
    font-size: 0.875rem;
    color: var(--text-secondary);
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

  .dashboard-placeholder-section .section-heading {
    margin-bottom: 8px;
  }

  .dashboard-placeholder-text {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }

  .dashboard-placeholder-lead {
    margin-bottom: 16px;
  }

  .dashboard-placeholder-text.muted,
  .muted {
    color: var(--text-muted);
  }

  .proposal-card-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .proposal-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px;
    background: var(--bg-elevated);
  }

  .proposal-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .proposal-card-tool {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .proposal-card-chain {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .proposal-card-title {
    margin: 0 0 6px 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .proposal-card-ref {
    display: block;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    word-break: break-all;
    color: var(--text-secondary);
    margin: 0;
  }

  .proposal-card-actions {
    margin: 10px 0 0 0;
  }

  .structure-summary-lead {
    margin-top: 0;
  }

  .structure-dl {
    margin: 0 0 14px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    font-size: 0.875rem;
  }

  .structure-dl dt {
    margin: 0;
    color: var(--text-muted);
    font-weight: 500;
  }

  .structure-dl dd {
    margin: 0;
    word-break: break-all;
  }

  .structure-mono {
    font-size: 0.8125rem;
    color: var(--text-primary);
    font-family: ui-monospace, monospace;
  }

  .structure-actions {
    margin: 0 0 12px;
  }

  .structure-footnote {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .permissions-revision {
    margin: 0 0 14px;
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .permissions-revision-code {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .permissions-catalog-list {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .permissions-catalog-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px;
    background: var(--bg-elevated);
  }

  .permissions-catalog-title {
    margin: 0 0 6px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .permissions-catalog-summary {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .permissions-executor-placeholder {
    margin: 0 0 16px;
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .roles-loading {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0;
  }

  .roles-table-caption {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin: 0 0 8px 0;
  }

  .roles-member-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    overflow: hidden;
  }

  .roles-member-row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 12px;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 0.8125rem;
  }

  .roles-member-row:last-child {
    border-bottom: none;
  }

  .roles-member-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
  }

  .roles-member-avatar-ph {
    background: var(--border);
  }

  .roles-member-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .roles-member-name {
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .roles-member-npub {
    font-size: 0.7rem;
    color: var(--text-muted);
    word-break: break-all;
  }

  .roles-member-cols {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    align-items: baseline;
  }

  .roles-col-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .roles-col-value {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--text-secondary);
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

  .members-panel {
    width: 240px;
    min-width: 240px;
    background: var(--bg-elevated);
    border-left: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .members-panel-header {
    height: 48px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .members-panel-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .members-panel-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .members-panel-loading {
    margin: 0 16px;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .members-panel-member {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 16px;
    font-size: 0.9375rem;
    color: var(--text-secondary);
  }

  .members-panel-member:hover {
    background: var(--bg-hover);
  }

  .members-panel-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .members-panel-avatar-placeholder {
    background: var(--border);
  }

  .members-panel-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }
  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }
  .treasury-section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .treasury-vault-title {
    margin: 0 0 8px 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .governance-deploy-cta,
  .roles-tree-deploy-cta {
    margin-top: 8px;
  }

  .settings-actions-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .settings-roles-btn {
    font-size: 0.8125rem;
    padding: 6px 12px;
  }

  .treasury-section-head .section-heading {
    margin: 0;
  }
  .treasury-action-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .treasury-deploy-btn {
    flex-shrink: 0;
  }
  .treasury-import-btn {
    flex-shrink: 0;
  }
  .treasury-cap-note {
    font-size: 0.8125rem;
    margin: 0 0 12px 0;
  }
  .treasury-safe-card-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .treasury-safe-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px;
    background: var(--bg-elevated);
  }
  .treasury-card-top {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }
  .treasury-pill {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  .treasury-card-address {
    display: block;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    word-break: break-all;
    margin-bottom: 8px;
    color: var(--text-primary);
  }
  .treasury-card-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }

  .treasury-explorer-link {
    margin: 0;
  }
  .treasury-card-dl {
    margin-top: 8px;
  }
  .btn-link {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  .modal-field-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    margin: 12px 0 4px 0;
  }
  .input-select {
    width: 100%;
    padding: 10px 12px;
    font-size: 0.875rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    margin-bottom: 4px;
    box-sizing: border-box;
  }
  .no-safe {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
  }
  .safe-state-meta {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 12px 0 0 0;
  }
  .safe-state-error {
    font-size: 0.875rem;
    color: var(--danger, #e53e3e);
    margin: 12px 0 0 0;
  }
  .safe-state-dl {
    margin: 12px 0 0 0;
    font-size: 0.875rem;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 16px;
    align-items: baseline;
  }
  .safe-state-dl dt {
    color: var(--text-muted);
    font-weight: 500;
  }
  .safe-state-dl dd {
    margin: 0;
    color: var(--text-primary);
  }
  .safe-owners-list {
    margin: 0;
    padding-left: 1.25rem;
    list-style: disc;
  }
  .safe-owner-address {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
  }
  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }
  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal-content {
    background: var(--bg-panel);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    max-width: 90vw;
  }
  .modal-content h3 {
    margin: 0 0 8px 0;
    font-size: 1.25rem;
  }
  .modal-desc {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 0 0 8px 0;
  }
  .input-address {
    width: 100%;
    padding: 10px 12px;
    font-family: monospace;
    font-size: 0.875rem;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    margin-bottom: 8px;
    box-sizing: border-box;
  }
  .input-error {
    font-size: 0.8rem;
    color: var(--danger, #e53e3e);
    margin: 0 0 12px 0;
  }
  .modal-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
