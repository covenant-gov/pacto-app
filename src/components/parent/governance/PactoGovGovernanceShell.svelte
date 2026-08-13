<script lang="ts">
  import { onMount } from 'svelte';
  import GovProposalsBoard from './GovProposalsBoard.svelte';
  import GovCrewActions from './GovCrewActions.svelte';
  import GovCaptainActions from './GovCaptainActions.svelte';
  import {
    getMutinyStatus,
    getQuartermasterStatus,
    mutinyExecute,
    mutinyHasVoted,
    getSquadCapabilities,
    type SquadCapabilitiesDto,
    type MutinyStatusDto,
    type QuartermasterPendingActionDto,
    type QuartermasterStatusDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import {
    fetchGovModuleReadCached,
    isGovModuleReadStale,
    mutinyReadCacheKey,
    peekGovModuleRead,
    quartermasterReadCacheKey,
  } from '../../../lib/governance/gov-module-read-cache';
  import {
    resolveGovernancePrivilege,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import {
    displayGovWriteFundingHint,
    govWriteSubmittedToast,
    resolveGovWriteFundingMode,
  } from '../../../lib/governance/gov-write-funding';
  import { govWriteErrorMessage } from '../../../lib/governance/gov-write-errors';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import { fetchQuartermasterPendingActions } from '../../../lib/dashboard/parent-dashboard-loaders';
  import { parseSupportedChainId } from '../../../lib/wallet/chains';
  import { fetchEvmBalance } from '../../../lib/wallet/signer-balance';
  import { showToast } from '../../../stores/toast';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  export let payload: PactoGovProviderPayloadV1;
  export let network: string;
  export let parentId: string;
  export let myAddress = '';
  export let captainWearers: string[] = [];
  export let crewWearers: string[] = [];
  export let memberEvmOptions: { address: string; label: string }[] = [];
  export let treasuryProposals: TreasuryProposalDto[] = [];
  export let treasuryProposalsLoading = false;
  export let treasuryProposalsError = '';
  export let onRefreshProposals: () => void = () => {};
  export let hasSponsor = false;

  type GovSubMode = 'proposals' | 'crew' | 'captain';
  type MutinySnapshot = { status: MutinyStatusDto; hasVoted: boolean };

  const tFn = get(t);

  let govSubMode: GovSubMode = 'proposals';
  let mutinyCaptain = '';
  let capabilities: SquadCapabilitiesDto | null = null;
  let capabilitiesLoadKey = '';

  let mutinyStatus: MutinyStatusDto | null = null;
  let mutinyHasVotedFlag = false;
  let mutinyLoading = false;
  let mutinyHydrateKey = '';

  let qmStatus: QuartermasterStatusDto | null = null;
  let qmHydrateKey = '';

  let qmPending: QuartermasterPendingActionDto[] = [];
  let qmPendingLoading = false;
  let qmPendingError = '';
  let qmPendingHydrateKey = '';

  let rosterBalanceRaw = '0';
  let rosterBalanceKnown = false;
  let fundingBalanceKey = '';

  $: captainList = (() => {
    const set = new Set(captainWearers.map((a) => a.trim().toLowerCase()).filter(Boolean));
    if (mutinyCaptain.trim()) set.add(mutinyCaptain.trim().toLowerCase());
    return [...set];
  })();

  $: privilege = resolveGovernancePrivilege({
    myAddress,
    safeAddress: payload.safe,
    captainWearers: captainList,
    crewWearers,
    capabilities,
  }) as GovernancePrivilege;

  $: {
    const addr = (privilege.myAddress || myAddress).trim();
    const key = `${network}|${addr}|${hasSponsor}`;
    if (key !== fundingBalanceKey) {
      fundingBalanceKey = key;
      if (addr) {
        void loadRosterFundingBalance(network, addr);
      } else {
        rosterBalanceKnown = false;
      }
    }
  }

  $: fundingMode = resolveGovWriteFundingMode({
    balanceRaw: rosterBalanceRaw,
    balanceKnown: rosterBalanceKnown,
    hasSponsorInfra: hasSponsor,
  });
  $: fundingHint = displayGovWriteFundingHint({
    balanceRaw: rosterBalanceRaw,
    balanceKnown: rosterBalanceKnown,
    hasSponsorInfra: hasSponsor,
  });

  $: {
    const pid = parentId.trim();
    const key = `${pid}|${network}`;
    if (pid && key !== capabilitiesLoadKey) {
      capabilitiesLoadKey = key;
      void loadCapabilities(pid);
    }
  }

  $: {
    const key = `${parentId}|${network}|${payload.mutinyModule ?? ''}|${privilege.myAddress}`;
    if (key !== mutinyHydrateKey && parentId.trim() && payload.mutinyModule?.trim()) {
      mutinyHydrateKey = key;
      void reloadMutiny(false);
    }
  }

  $: {
    const key = `${parentId}|${network}|${payload.quartermaster ?? ''}`;
    if (key !== qmHydrateKey && parentId.trim() && payload.quartermaster?.trim()) {
      qmHydrateKey = key;
      void reloadQm(false);
    }
  }

  $: {
    const key = `${parentId}|${network}|${payload.quartermaster ?? ''}|pending`;
    if (key !== qmPendingHydrateKey && parentId.trim() && payload.quartermaster?.trim()) {
      qmPendingHydrateKey = key;
      void reloadQmPending();
    }
  }

  async function loadCapabilities(pid: string) {
    const key = `${pid}|${network}`;
    try {
      const snap = await getSquadCapabilities(pid, network);
      if (key !== capabilitiesLoadKey) return;
      capabilities = snap;
    } catch {
      if (key !== capabilitiesLoadKey) return;
      capabilities = null;
    }
  }

  async function loadRosterFundingBalance(net: string, addr: string) {
    const chain = parseSupportedChainId(net);
    if (!chain) {
      rosterBalanceKnown = false;
      return;
    }
    const bal = await fetchEvmBalance(chain, addr, { timeoutMs: 12_000 });
    if (`${net}|${addr}|${hasSponsor}` !== fundingBalanceKey) return;
    if (bal.error) {
      rosterBalanceKnown = false;
      return;
    }
    rosterBalanceRaw = bal.balanceRaw;
    rosterBalanceKnown = true;
  }

  function applyMutinySnapshot(snap: MutinySnapshot) {
    mutinyStatus = snap.status;
    mutinyHasVotedFlag = snap.hasVoted;
    mutinyCaptain = snap.status.captain ?? '';
  }

  async function reloadMutiny(force = false) {
    const mutinyModule = payload.mutinyModule?.trim();
    if (!mutinyModule) return;
    const hydrateKey = `${parentId}|${network}|${mutinyModule}|${privilege.myAddress}`;
    const key = mutinyReadCacheKey(network, mutinyModule, privilege.myAddress);
    const peeked = peekGovModuleRead<MutinySnapshot>(key);
    if (peeked) applyMutinySnapshot(peeked);

    const needFetch = force || !peeked || isGovModuleReadStale(key);
    if (!needFetch) {
      mutinyLoading = false;
      return;
    }

    if (!peeked) mutinyLoading = true;
    try {
      const snap = await fetchGovModuleReadCached(
        key,
        parentId,
        async () => {
          const next = await getMutinyStatus({ network, mutinyModule, parentId });
          let voted = false;
          if (next.activeMutinyId !== '0' && privilege.myAddress) {
            voted = await mutinyHasVoted({
              network,
              mutinyModule,
              mutinyId: next.activeMutinyId,
              voter: privilege.myAddress,
              parentId,
            });
          }
          return { status: next, hasVoted: voted };
        },
        { force: force || !!peeked },
      );
      if (hydrateKey !== `${parentId}|${network}|${mutinyModule}|${privilege.myAddress}`) return;
      applyMutinySnapshot(snap);
    } catch {
      if (hydrateKey !== `${parentId}|${network}|${mutinyModule}|${privilege.myAddress}`) return;
      if (!peeked) {
        mutinyStatus = null;
        mutinyCaptain = '';
      }
    } finally {
      if (hydrateKey === `${parentId}|${network}|${mutinyModule}|${privilege.myAddress}`) {
        mutinyLoading = false;
      }
    }
  }

  async function reloadQm(force = false) {
    const quartermaster = payload.quartermaster?.trim();
    if (!quartermaster) return;
    const hydrateKey = `${parentId}|${network}|${quartermaster}`;
    const key = quartermasterReadCacheKey(network, quartermaster);
    const peeked = peekGovModuleRead<QuartermasterStatusDto>(key);
    if (peeked) qmStatus = peeked;

    const needFetch = force || !peeked || isGovModuleReadStale(key);
    if (!needFetch) {
      return;
    }

    try {
      const next = await fetchGovModuleReadCached(
        key,
        parentId,
        () => getQuartermasterStatus({ network, quartermaster, parentId }),
        { force: force || !!peeked },
      );
      if (hydrateKey !== `${parentId}|${network}|${quartermaster}`) return;
      qmStatus = next;
    } catch {
      if (hydrateKey !== `${parentId}|${network}|${quartermaster}`) return;
      if (!peeked) qmStatus = null;
    }
  }

  async function reloadQmPending() {
    const quartermaster = payload.quartermaster?.trim();
    if (!quartermaster) {
      qmPending = [];
      qmPendingError = '';
      return;
    }
    const hydrateKey = `${parentId}|${network}|${quartermaster}|pending`;
    qmPendingLoading = qmPending.length === 0;
    const result = await fetchQuartermasterPendingActions({ network, quartermaster, parentId });
    if (hydrateKey !== `${parentId}|${network}|${quartermaster}|pending`) return;
    qmPendingLoading = false;
    qmPending = result.pending;
    qmPendingError = result.error;
  }

  function refreshAllProposals() {
    onRefreshProposals();
    void reloadMutiny(true);
    void reloadQm(true);
    void reloadQmPending();
  }

  async function executeMutinyFromBoard() {
    const mutinyModule = payload.mutinyModule?.trim();
    if (!mutinyModule || !mutinyStatus) return;
    try {
      await mutinyExecute({
        network,
        parentId,
        mutinyModule,
        mutinyId: mutinyStatus.activeMutinyId,
      });
      showToast(govWriteSubmittedToast(tFn('governance.action.executeMutiny'), fundingMode));
      await reloadMutiny(true);
    } catch (e) {
      showToast(govWriteErrorMessage(e, tFn('governance.action.executeMutiny')));
    }
  }

  onMount(() => {
    const pid = parentId.trim();
    if (pid) {
      capabilitiesLoadKey = `${pid}|${network}`;
      void loadCapabilities(pid);
    }
  });

  function shortAddr(addr: string): string {
    const a = addr.trim();
    if (a.length < 14) return a || '—';
    return `${a.slice(0, 8)}…${a.slice(-6)}`;
  }

  const subModes: { id: GovSubMode; label: string }[] = [
    { id: 'proposals', label: tFn('governance.shell.tab.proposals') },
    { id: 'crew', label: tFn('governance.shell.tab.crew') },
    { id: 'captain', label: tFn('governance.shell.tab.captain') },
  ];
</script>

<div class="gov-shell">
  <div class="role-chip" role="status">
    {$t('governance.shell.you')} · <strong>{$t(privilege.roleLabel)}</strong>
    {#if privilege.myAddress}
      <code class="role-addr">{shortAddr(privilege.myAddress)}</code>
    {/if}
  </div>

  <div class="submode-tabs" role="tablist" aria-label={$t('governance.shell.subModesAria')}>
    {#each subModes as mode (mode.id)}
      <button
        type="button"
        role="tab"
        class="submode-tab"
        class:selected={govSubMode === mode.id}
        aria-selected={govSubMode === mode.id}
        on:click={() => (govSubMode = mode.id)}
      >
        {mode.label}
      </button>
    {/each}
  </div>

  <div class="submode-panel" role="tabpanel" tabindex="0" aria-label={subModes.find((m) => m.id === govSubMode)?.label ?? govSubMode}>
    {#if govSubMode === 'proposals'}
      <GovProposalsBoard
        {network}
        {parentId}
        treasuryAuthority={payload.treasuryAuthority ?? ''}
        quartermaster={payload.quartermaster ?? ''}
        {privilege}
        proposals={treasuryProposals}
        proposalsLoading={treasuryProposalsLoading}
        proposalsError={treasuryProposalsError}
        {mutinyStatus}
        {mutinyLoading}
        {qmPending}
        {qmPendingLoading}
        {qmPendingError}
        mutinyMode={!!qmStatus?.mutinyActive || !!(mutinyStatus && mutinyStatus.activeMutinyId !== '0' && !mutinyStatus.executed)}
        onRefreshProposals={refreshAllProposals}
        onExecuteMutiny={executeMutinyFromBoard}
        {fundingHint}
        {fundingMode}
      />
    {:else if govSubMode === 'crew'}
      <GovCrewActions
        {network}
        {parentId}
        treasuryAuthority={payload.treasuryAuthority ?? ''}
        mutinyModule={payload.mutinyModule ?? ''}
        {privilege}
        proposals={treasuryProposals}
        {mutinyStatus}
        mutinyHasVotedFlag={mutinyHasVotedFlag}
        onRefreshProposals={refreshAllProposals}
        onRefreshMutiny={() => reloadMutiny(true)}
        {fundingHint}
        {fundingMode}
      />
    {:else}
      <GovCaptainActions
        {network}
        {parentId}
        treasuryAuthority={payload.treasuryAuthority ?? ''}
        quartermaster={payload.quartermaster ?? ''}
        mutinyModule={payload.mutinyModule ?? ''}
        {privilege}
        proposals={treasuryProposals}
        {mutinyStatus}
        {qmStatus}
        {memberEvmOptions}
        {captainWearers}
        onRefreshProposals={refreshAllProposals}
        onRefreshMutiny={() => reloadMutiny(true)}
        onRefreshQm={() => {
          void reloadQm(true);
          void reloadQmPending();
        }}
        {fundingHint}
        {fundingMode}
      />
    {/if}
  </div>
</div>

<style>
  .gov-shell {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .role-chip {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
  .role-addr {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .submode-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .submode-tab {
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .submode-tab.selected {
    border-color: var(--brand);
    color: var(--text-primary);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--brand) 28%, transparent);
  }
  .submode-panel {
    min-width: 0;
  }
</style>
