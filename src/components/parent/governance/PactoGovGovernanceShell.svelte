<script lang="ts">
  import GovProposalsBoard from './GovProposalsBoard.svelte';
  import GovCrewActions from './GovCrewActions.svelte';
  import GovCaptainActions from './GovCaptainActions.svelte';
  import {
    getMutinyStatus,
    getQuartermasterStatus,
    mutinyExecute,
    mutinyExpire,
    mutinyHasVoted,
    crewOffboardHasVoted,
    getSquadCapabilities,
    type SquadCapabilitiesDto,
    type MutinyStatusDto,
    type QuartermasterPendingActionDto,
    type QuartermasterStatusDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import { warGameArchiveCapabilities } from '../../../lib/governance/hub-sponsor';
  import {
    clearGovModuleReadsForParent,
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
    fundedByFromWriteResult,
    govWriteSubmittedToast,
  } from '../../../lib/governance/gov-write-funding';
  import { showGovWriteErrorToast } from '../../../lib/governance/gov-write-errors';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import { fetchQuartermasterPendingActions } from '../../../lib/dashboard/parent-dashboard-loaders';
  import { isCrewOffboardActive } from '../../../lib/governance/crew-offboard';
  import { isMutinyActive } from '../../../lib/governance/gov-proposal-lists';
  import { parseSupportedChainId } from '../../../lib/wallet/chains';
  import { fetchEvmBalance } from '../../../lib/wallet/signer-balance';
  import { labeledWearerOptions } from '../../../lib/governance/war-game-captain';
  import {
    ACL_SNAPSHOT_RETRY_MS,
    aclSnapshotLoadKey,
    aclSnapshotShouldRetry,
  } from '../../../lib/governance/acl-snapshot-key';
  import { showToast } from '../../../stores/toast';
  import { governanceProcessNonceByParentId } from '../../../stores/navigation';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  interface Props {
    payload: PactoGovProviderPayloadV1;
    network: string;
    parentId: string;
    myAddress?: string;
    captainWearers?: string[];
    crewWearers?: string[];
    memberEvmOptions?: { address: string; label: string }[];
    treasuryProposals?: TreasuryProposalDto[];
    treasuryProposalsLoading?: boolean;
    treasuryProposalsError?: string;
    onRefreshProposals?: () => void;
    hasSponsor?: boolean;
    warGameStack?: boolean;
    archiveView?: boolean;
  }

  let {
    payload,
    network,
    parentId,
    myAddress = '',
    captainWearers = [],
    crewWearers = [],
    memberEvmOptions = [],
    treasuryProposals = [],
    treasuryProposalsLoading = false,
    treasuryProposalsError = '',
    onRefreshProposals = () => {},
    hasSponsor = false,
    warGameStack = false,
    archiveView = false,
  }: Props = $props();

  type GovSubMode = 'proposals' | 'crew' | 'captain';
  type MutinySnapshot = { status: MutinyStatusDto; hasVoted: boolean };
  /** Capability-preflight state: `unresolved` must never render a gated action as available. */
  type CapabilitiesStatus = 'unresolved' | 'ready' | 'error';

  const tFn = get(t);

  let govSubMode: GovSubMode = $state('proposals');
  let mutinyCaptain = $state('');
  let capabilities: SquadCapabilitiesDto | null = $state(null);
  let capabilitiesStatus: CapabilitiesStatus = $state('unresolved');
  let capabilitiesLoadKey = $state('');
  let capabilitiesRetryKey = $state('');
  let capabilitiesRetryTimer: ReturnType<typeof setTimeout> | null = null;

  let mutinyStatus: MutinyStatusDto | null = $state(null);
  let mutinyHasVotedFlag = $state(false);
  let mutinyLoading = $state(false);
  let mutinyHydrateKey = $state('');

  let qmStatus: QuartermasterStatusDto | null = $state(null);
  let qmHydrateKey = $state('');
  let offboardHasVoted = $state(false);

  let qmPending: QuartermasterPendingActionDto[] = $state([]);
  let qmPendingLoading = $state(false);
  let qmPendingError = $state('');
  let qmPendingHydrateKey = $state('');
  let lastSeenProcessNonce = $state(0);

  let rosterBalanceRaw = $state('0');
  let rosterBalanceKnown = $state(false);
  let fundingBalanceKey = $state('');

  let processNonce = $derived($governanceProcessNonceByParentId[parentId.trim()] ?? 0);
  let rosterFrozen = $derived(isMutinyActive(mutinyStatus) || isCrewOffboardActive(qmStatus));
  let rosterFreezeReason = $derived(
    isMutinyActive(mutinyStatus)
      ? 'governance.gate.quartermasterLocked'
      : 'governance.gate.rosterFrozenOffboard',
  );
  let crewMemberOptions = $derived(labeledWearerOptions(crewWearers, memberEvmOptions));

  $effect(() => {
    if (processNonce > 0 && processNonce !== lastSeenProcessNonce) {
      lastSeenProcessNonce = processNonce;
      refreshAllProposals();
    }
  });

  let captainList = $derived.by(() => {
    const set = new Set(captainWearers.map((a) => a.trim().toLowerCase()).filter(Boolean));
    if (mutinyCaptain.trim()) set.add(mutinyCaptain.trim().toLowerCase());
    return [...set];
  });

  /** Destructive captain/crew CTAs must stay closed until the ACL preflight resolves. */
  let capabilitiesPending = $derived(capabilitiesStatus === 'unresolved');

  let privilege = $derived(
    resolveGovernancePrivilege({
      myAddress,
      safeAddress: payload.safe,
      captainWearers: captainList,
      crewWearers,
      capabilities,
    }) as GovernancePrivilege,
  );

  $effect(() => {
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
  });

  let fundingHint = $derived(
    displayGovWriteFundingHint({
      balanceRaw: rosterBalanceRaw,
      balanceKnown: rosterBalanceKnown,
      hasSponsorInfra: hasSponsor,
    }),
  );

  $effect(() => {
    const pid = parentId.trim();
    const key = aclSnapshotLoadKey({
      parentId: pid,
      network,
      warGameStack,
      processNonce,
      archiveView,
      myAddress,
      captainWearers,
      crewWearers,
    });
    if (!pid || key === capabilitiesLoadKey) return;
    capabilitiesLoadKey = key;
    capabilitiesRetryKey = '';
    if (capabilitiesRetryTimer) {
      clearTimeout(capabilitiesRetryTimer);
      capabilitiesRetryTimer = null;
    }
    if (archiveView) {
      capabilities = warGameArchiveCapabilities(pid);
      capabilitiesStatus = 'ready';
      return;
    }
    capabilitiesStatus = 'unresolved';
    void loadCapabilities(pid, key);
  });

  $effect(() => {
    return () => {
      if (capabilitiesRetryTimer) {
        clearTimeout(capabilitiesRetryTimer);
        capabilitiesRetryTimer = null;
      }
    };
  });

  $effect(() => {
    const key = `${parentId}|${network}|${payload.mutinyModule ?? ''}|${privilege.myAddress}`;
    if (key !== mutinyHydrateKey && parentId.trim() && payload.mutinyModule?.trim()) {
      mutinyHydrateKey = key;
      void reloadMutiny(false);
    }
  });

  $effect(() => {
    const key = `${parentId}|${network}|${payload.quartermaster ?? ''}|${privilege.myAddress}`;
    if (key !== qmHydrateKey && parentId.trim() && payload.quartermaster?.trim()) {
      qmHydrateKey = key;
      void reloadQm(false);
    }
  });

  $effect(() => {
    const key = `${parentId}|${network}|${payload.quartermaster ?? ''}|pending`;
    if (key !== qmPendingHydrateKey && parentId.trim() && payload.quartermaster?.trim()) {
      qmPendingHydrateKey = key;
      void reloadQmPending();
    }
  });

  function scheduleCapabilitiesRetry(pid: string, key: string) {
    if (capabilitiesRetryKey === key) return;
    capabilitiesRetryKey = key;
    if (capabilitiesRetryTimer) clearTimeout(capabilitiesRetryTimer);
    capabilitiesRetryTimer = setTimeout(() => {
      capabilitiesRetryTimer = null;
      if (key !== capabilitiesLoadKey) return;
      capabilitiesStatus = 'unresolved';
      void loadCapabilities(pid, key);
    }, ACL_SNAPSHOT_RETRY_MS);
  }

  async function loadCapabilities(pid: string, key: string) {
    try {
      const snap = await getSquadCapabilities(pid, network, { wargame: warGameStack });
      if (key !== capabilitiesLoadKey) return;
      capabilities = snap;
      capabilitiesStatus = 'ready';
      if (
        aclSnapshotShouldRetry({
          snapshot: snap,
          myAddress,
          captainWearers,
          crewWearers,
        })
      ) {
        scheduleCapabilitiesRetry(pid, key);
      }
    } catch {
      if (key !== capabilitiesLoadKey) return;
      capabilities = null;
      capabilitiesStatus = 'error';
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
    if (peeked && !force) applyMutinySnapshot(peeked);

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
    const hydrateKey = `${parentId}|${network}|${quartermaster}|${privilege.myAddress}`;
    const key = quartermasterReadCacheKey(network, quartermaster);
    const peeked = peekGovModuleRead<QuartermasterStatusDto>(key);
    if (peeked) qmStatus = peeked;

    const needFetch = force || !peeked || isGovModuleReadStale(key);
    if (!needFetch) {
      if (peeked && isCrewOffboardActive(peeked) && privilege.myAddress) {
        void loadOffboardVote(quartermaster, peeked, privilege.myAddress);
      }
      return;
    }

    try {
      const next = await fetchGovModuleReadCached(
        key,
        parentId,
        () => getQuartermasterStatus({ network, quartermaster, parentId }),
        { force: force || !!peeked },
      );
      if (hydrateKey !== `${parentId}|${network}|${quartermaster}|${privilege.myAddress}`) return;
      qmStatus = next;
      if (isCrewOffboardActive(next) && privilege.myAddress) {
        await loadOffboardVote(quartermaster, next, privilege.myAddress);
      } else {
        offboardHasVoted = false;
      }
    } catch {
      if (hydrateKey !== `${parentId}|${network}|${quartermaster}|${privilege.myAddress}`) return;
      if (!peeked) qmStatus = null;
    }
  }

  async function loadOffboardVote(
    quartermaster: string,
    status: QuartermasterStatusDto,
    voter: string,
  ) {
    const id = status.activeCrewOffboardId?.trim();
    if (!id || id === '0') {
      offboardHasVoted = false;
      return;
    }
    try {
      offboardHasVoted = await crewOffboardHasVoted({
        network,
        quartermaster,
        offboardId: id,
        voter,
        parentId,
      });
    } catch {
      offboardHasVoted = false;
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
      const result = await mutinyExecute({
        network,
        parentId,
        mutinyModule,
        mutinyId: mutinyStatus.activeMutinyId,
      });
      showToast(govWriteSubmittedToast(tFn('governance.action.executeMutiny'), fundedByFromWriteResult(result)));
      await reloadMutiny(true);
    } catch (e) {
      showGovWriteErrorToast(e, tFn('governance.action.executeMutiny'));
      clearGovModuleReadsForParent(parentId);
      await reloadMutiny(true);
    }
  }

  async function expireMutinyFromBoard() {
    const mutinyModule = payload.mutinyModule?.trim();
    if (!mutinyModule || !mutinyStatus) return;
    try {
      const result = await mutinyExpire({
        network,
        parentId,
        mutinyModule,
        mutinyId: mutinyStatus.activeMutinyId,
      });
      showToast(govWriteSubmittedToast(tFn('governance.action.expireMutiny'), fundedByFromWriteResult(result)));
      await reloadMutiny(true);
    } catch (e) {
      showGovWriteErrorToast(e, tFn('governance.action.expireMutiny'));
      clearGovModuleReadsForParent(parentId);
      await reloadMutiny(true);
    }
  }

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
        onclick={() => (govSubMode = mode.id)}
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
        {qmStatus}
        {qmPending}
        {qmPendingLoading}
        {qmPendingError}
        mutinyMode={rosterFrozen}
        rosterFreezeReason={rosterFreezeReason}
        onRefreshProposals={refreshAllProposals}
        onExecuteMutiny={executeMutinyFromBoard}
        onExpireMutiny={expireMutinyFromBoard}
        {fundingHint}
        {capabilitiesPending}
      />
    {:else if govSubMode === 'crew'}
      <GovCrewActions
        {network}
        {parentId}
        treasuryAuthority={payload.treasuryAuthority ?? ''}
        mutinyModule={payload.mutinyModule ?? ''}
        quartermaster={payload.quartermaster ?? ''}
        {privilege}
        proposals={treasuryProposals}
        {mutinyStatus}
        mutinyHasVotedFlag={mutinyHasVotedFlag}
        {qmStatus}
        memberEvmOptions={crewMemberOptions}
        squadMemberOptions={memberEvmOptions}
        {offboardHasVoted}
        onRefreshProposals={refreshAllProposals}
        onRefreshMutiny={() => reloadMutiny(true)}
        onRefreshQm={() => {
          void reloadQm(true);
          void reloadQmPending();
        }}
        {fundingHint}
        {capabilitiesPending}
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
        {crewWearers}
        {warGameStack}
        onRefreshProposals={refreshAllProposals}
        onRefreshMutiny={() => reloadMutiny(true)}
        onRefreshQm={() => {
          void reloadQm(true);
          void reloadQmPending();
        }}
        {fundingHint}
        {capabilitiesPending}
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
