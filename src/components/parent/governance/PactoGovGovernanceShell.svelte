<script lang="ts">
  import GovProposalsBoard from './GovProposalsBoard.svelte';
  import GovAllActions from './GovAllActions.svelte';
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
  import { runGovWriteInBackground } from '../../../lib/governance/gov-write-background';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import { fetchQuartermasterPendingActions } from '../../../lib/dashboard/parent-dashboard-loaders';
  import {
    listSquadGovReplica,
    parseGovReplicaSnapshot,
    pickReplicaRow,
    replicaStackForDashboard,
    upsertSquadGovReplica,
  } from '../../../lib/governance/gov-replica';
  import { isCrewOffboardActive } from '../../../lib/governance/crew-offboard';
  import { isMutinyActive } from '../../../lib/governance/gov-proposal-lists';
  import { govMemberOptions } from '../../../lib/governance/gov-member-options';
  import {
    ACL_SNAPSHOT_RETRY_MS,
    aclSnapshotLoadKey,
    aclSnapshotShouldRetry,
  } from '../../../lib/governance/acl-snapshot-key';
  import { shortEvmAddress } from '../../../lib/governance/hats-tree-annotations';
  import type { HatsTreeCommandContext } from '../../../lib/governance/hats-tree-role-actions';
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
    memberOptionsLoading?: boolean;
    memberEvmOptions?: { address: string; label: string }[];
    treasuryProposals?: TreasuryProposalDto[];
    treasuryProposalsLoading?: boolean;
    treasuryProposalsError?: string;
    onRefreshProposals?: () => void;
    warGameStack?: boolean;
    archiveView?: boolean;
    /** Viewed war-game round; empty on live nave. */
    warGameRound?: string;
    /** Proposals board (Status) vs All/Crew/Captain commands (Governance). */
    surface?: 'proposals' | 'commands';
    /** Live command snapshot for in-tree Hats CTAs. */
    treeCommands?: HatsTreeCommandContext | null;
  }

  let {
    payload,
    network,
    parentId,
    myAddress = '',
    captainWearers = [],
    crewWearers = [],
    memberOptionsLoading = false,
    memberEvmOptions = [],
    treasuryProposals = [],
    treasuryProposalsLoading = false,
    treasuryProposalsError = '',
    onRefreshProposals = () => {},
    warGameStack = false,
    archiveView = false,
    warGameRound = '',
    surface = 'commands',
    treeCommands = $bindable(null),
  }: Props = $props();

  type GovSubMode = 'all' | 'crew' | 'captain';
  type MutinySnapshot = { status: MutinyStatusDto; hasVoted: boolean };
  /** Capability-preflight state: `unresolved` must never render a gated action as available. */
  type CapabilitiesStatus = 'unresolved' | 'ready' | 'error';

  const tFn = get(t);

  let govSubMode: GovSubMode = $state('all');
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
  let replicaRound = $derived(warGameStack ? String(warGameRound || '').trim() : '');

  let processNonce = $derived($governanceProcessNonceByParentId[parentId.trim()] ?? 0);
  let rosterFrozen = $derived(isMutinyActive(mutinyStatus) || isCrewOffboardActive(qmStatus));
  let rosterFreezeReason = $derived(
    isMutinyActive(mutinyStatus)
      ? 'governance.gate.quartermasterLocked'
      : 'governance.gate.rosterFrozenOffboard',
  );
  let crewMemberOptions = $derived(
    govMemberOptions({
      roster: memberEvmOptions,
      crewWearers,
      preset: 'crewWearers',
    }),
  );

  $effect(() => {
    if (processNonce > 0 && processNonce !== lastSeenProcessNonce) {
      lastSeenProcessNonce = processNonce;
      onRefreshProposals();
      void reloadMutiny(false);
      void reloadQm(false);
      void reloadQmPending();
    }
  });

  let captainList = $derived.by(() => {
    const set = new Set(captainWearers.map((a) => a.trim().toLowerCase()).filter(Boolean));
    if (mutinyCaptain.trim()) set.add(mutinyCaptain.trim().toLowerCase());
    return [...set];
  });

  /** Destructive captain/crew CTAs stay closed until ACL preflight is ready (error is fail-closed). */
  let capabilitiesPending = $derived(
    capabilitiesStatus === 'unresolved' || capabilitiesStatus === 'error',
  );

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
      scheduleCapabilitiesRetry(pid, key);
    }
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
    if (!force) {
      try {
        const rows = await listSquadGovReplica(parentId);
        const replica = pickReplicaRow(rows, {
          stack: replicaStackForDashboard(warGameStack),
          kind: 'mutiny',
          round: replicaRound,
        });
        const snap = replica ? parseGovReplicaSnapshot(replica.snapshotJson) : null;
        if (snap?.mutiny) {
          mutinyStatus = snap.mutiny;
          mutinyCaptain = snap.mutiny.captain ?? '';
        }
      } catch {
        /* chain fill */
      }
    }
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
          if (parentId) {
            void upsertSquadGovReplica({
              parentId,
              stack: replicaStackForDashboard(warGameStack),
              kind: 'mutiny',
              snapshot: { mutiny: next },
              blockNumber: 0,
              round: replicaRound,
            });
          }
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
    try {
      const rows = await listSquadGovReplica(parentId);
      const replica = pickReplicaRow(rows, {
        stack: replicaStackForDashboard(warGameStack),
        kind: 'qm_pending',
        round: replicaRound,
      });
      const snap = replica ? parseGovReplicaSnapshot(replica.snapshotJson) : null;
      if (snap?.qmPending?.length) {
        if (hydrateKey !== `${parentId}|${network}|${quartermaster}|pending`) return;
        qmPending = snap.qmPending;
        qmPendingError = '';
      }
    } catch {
      /* chain fill */
    }
    const result = await fetchQuartermasterPendingActions({ network, quartermaster, parentId });
    if (hydrateKey !== `${parentId}|${network}|${quartermaster}|pending`) return;
    qmPendingLoading = false;
    qmPending = result.pending;
    qmPendingError = result.error;
    if (!result.error && result.pending.length > 0) {
      void upsertSquadGovReplica({
        parentId,
        stack: replicaStackForDashboard(warGameStack),
        kind: 'qm_pending',
        snapshot: { qmPending: result.pending },
        blockNumber: 0,
        round: replicaRound,
      });
    }
  }

  function refreshAllProposals() {
    onRefreshProposals();
    void reloadMutiny(true);
    void reloadQm(true);
    void reloadQmPending();
  }

  function executeMutinyFromBoard() {
    const mutinyModule = payload.mutinyModule?.trim();
    const status = mutinyStatus;
    if (!mutinyModule || !status) return;
    runGovWriteInBackground({
      label: tFn('governance.action.executeMutiny'),
      parentId,
      actionKey: `mutiny-exec:${status.activeMutinyId}`,
      job: () =>
        mutinyExecute({
          network,
          parentId,
          mutinyModule,
          mutinyId: status.activeMutinyId,
        }),
      onSettled: () => {
        clearGovModuleReadsForParent(parentId);
        void reloadMutiny(true);
      },
    });
  }

  function expireMutinyFromBoard() {
    const mutinyModule = payload.mutinyModule?.trim();
    const status = mutinyStatus;
    if (!mutinyModule || !status) return;
    runGovWriteInBackground({
      label: tFn('governance.action.expireMutiny'),
      parentId,
      actionKey: `mutiny-expire:${status.activeMutinyId}`,
      job: () =>
        mutinyExpire({
          network,
          parentId,
          mutinyModule,
          mutinyId: status.activeMutinyId,
        }),
      onSettled: () => {
        clearGovModuleReadsForParent(parentId);
        void reloadMutiny(true);
      },
    });
  }

  const subModes: { id: GovSubMode; label: string }[] = [
    { id: 'all', label: tFn('governance.shell.tab.all') },
    { id: 'crew', label: tFn('governance.shell.tab.crew') },
    { id: 'captain', label: tFn('governance.shell.tab.captain') },
  ];

  function refreshMutiny() {
    void reloadMutiny(true);
  }

  function refreshQm() {
    void reloadQm(true);
    void reloadQmPending();
  }

  $effect(() => {
    treeCommands = {
      privilege,
      capabilitiesPending,
      mutinyStatus,
      qmStatus,
      treasuryAuthority: payload.treasuryAuthority ?? '',
      mutinyModule: payload.mutinyModule ?? '',
      quartermaster: payload.quartermaster ?? '',
      network,
      parentId,
      memberEvmOptions,
      crewMemberOptions,
      memberOptionsLoading,
      captainWearers,
      crewWearers,
      warGameStack,
      refreshProposals: refreshAllProposals,
      refreshMutiny,
      refreshQm,
    };
  });
</script>

<div class="gov-shell">
  <div class="role-chip" role="status">
    {$t('governance.shell.you')} · <strong>{$t(privilege.roleLabel)}</strong>
    {#if privilege.myAddress}
      <code class="role-addr">{shortEvmAddress(privilege.myAddress) || '—'}</code>
    {/if}
  </div>

  {#if surface === 'proposals'}
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
      mutinyModule={payload.mutinyModule ?? ''}
      mutinyMode={rosterFrozen}
      rosterFreezeReason={rosterFreezeReason}
      mutinyHasVoted={mutinyHasVotedFlag}
      {offboardHasVoted}
      onRefreshProposals={refreshAllProposals}
      onExecuteMutiny={executeMutinyFromBoard}
      onExpireMutiny={expireMutinyFromBoard}
      {capabilitiesPending}
    />
  {:else}
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
    {#if govSubMode === 'all'}
      <GovAllActions
        {network}
        {parentId}
        treasuryAuthority={payload.treasuryAuthority ?? ''}
        {privilege}
        {capabilitiesPending}
        onSubmitted={refreshAllProposals}
      />
    {:else if govSubMode === 'crew'}
      <GovCrewActions
        {network}
        {parentId}
        mutinyModule={payload.mutinyModule ?? ''}
        quartermaster={payload.quartermaster ?? ''}
        {privilege}
        {mutinyStatus}
        {qmStatus}
        memberEvmOptions={crewMemberOptions}
        squadMemberOptions={memberEvmOptions}
        {memberOptionsLoading}
        onRefreshMutiny={() => reloadMutiny(true)}
        onRefreshQm={() => {
          void reloadQm(true);
          void reloadQmPending();
        }}
        {capabilitiesPending}
      />
    {:else}
      <GovCaptainActions
        {network}
        {parentId}
        quartermaster={payload.quartermaster ?? ''}
        mutinyModule={payload.mutinyModule ?? ''}
        {privilege}
        {mutinyStatus}
        {qmStatus}
        {memberEvmOptions}
        {memberOptionsLoading}
        {captainWearers}
        {crewWearers}
        {warGameStack}
        onRefreshMutiny={() => reloadMutiny(true)}
        onRefreshQm={() => {
          void reloadQm(true);
          void reloadQmPending();
        }}
        {capabilitiesPending}
      />
    {/if}
  </div>
  {/if}
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
