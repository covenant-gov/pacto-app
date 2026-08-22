<script lang="ts">
  import GovCtaButton from './GovCtaButton.svelte';
  import GovProposeForm from './GovProposeForm.svelte';
  import CrewVoteModeSettings from './CrewVoteModeSettings.svelte';
  import GovCrewOffboardPanel from './GovCrewOffboardPanel.svelte';
  import {
    mutinyCastVote,
    mutinyExecute,
    mutinyExpire,
    mutinyStartToArbitraryContract,
    mutinyStartToArbitraryEoa,
    mutinyStartToCommittee,
    mutinyStartToCrewMember,
    mutinyStartToPauseCaptain,
    treasuryAuthorityCrewVote,
    treasuryAuthorityExecute,
    type MutinyStatusDto,
    type QuartermasterStatusDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import {
    crewVotableProposals,
    executableTreasuryProposals,
    isMutinyActive,
    isMutinyExpirable,
    proposalSelectLabel,
  } from '../../../lib/governance/gov-proposal-lists';
  import {
    gatePermissionlessSigner,
    gateRequiresCrew,
    type CtaGate,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import {
    fundedByFromWriteResult,
    govWriteSubmittedToast,
  } from '../../../lib/governance/gov-write-funding';
  import { showGovWriteErrorToast } from '../../../lib/governance/gov-write-errors';
  import { isCrewOffboardActive } from '../../../lib/governance/crew-offboard';
  import { shortEvmAddress } from '../../../lib/governance/hats-tree-annotations';
  import { showToast } from '../../../stores/toast';
  import { requireBackupVerified } from '../../../stores/backup-verification';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { scheduleDeadlineTimeout } from '../../../lib/utils/deadline-timeout';

  interface Props {
    network: string;
    parentId: string;
    treasuryAuthority: string;
    mutinyModule: string;
    quartermaster?: string;
    privilege: GovernancePrivilege;
    proposals?: TreasuryProposalDto[];
    mutinyStatus?: MutinyStatusDto | null;
    mutinyHasVotedFlag?: boolean;
    qmStatus?: QuartermasterStatusDto | null;
    memberEvmOptions?: { address: string; label: string }[];
    squadMemberOptions?: { address: string; label: string }[];
    offboardHasVoted?: boolean;
    onRefreshProposals?: () => void;
    onRefreshMutiny?: () => void;
    onRefreshQm?: () => void;
    fundingHint?: string;
    /** True while capability preflight is still loading; forces every gate closed. */
    capabilitiesPending?: boolean;
  }

  let {
    network,
    parentId,
    treasuryAuthority,
    mutinyModule,
    quartermaster = '',
    privilege,
    proposals = [],
    mutinyStatus = null,
    mutinyHasVotedFlag = false,
    qmStatus = null,
    memberEvmOptions = [],
    squadMemberOptions = [],
    offboardHasVoted = false,
    onRefreshProposals = () => {},
    onRefreshMutiny = () => {},
    onRefreshQm = () => {},
    fundingHint = '',
    capabilitiesPending = false,
  }: Props = $props();

  const tFn = get(t);
  const PENDING_GATE: CtaGate = { enabled: false, reason: 'governance.status.loading' };

  let acting = $state(false);
  let voteProposalId = $state('');
  let execProposalId = $state('');
  let startKind: 'crew' | 'committee' | 'eoa' | 'contract' | 'pause' = $state('crew');
  let proposed = $state('');
  let nowSec = $state(Math.floor(Date.now() / 1000));

  let crewGate = $derived(capabilitiesPending ? PENDING_GATE : gateRequiresCrew(privilege));
  let execGate = $derived(capabilitiesPending ? PENDING_GATE : gatePermissionlessSigner(privilege));
  let votable = $derived(crewVotableProposals(proposals));
  let executable = $derived(executableTreasuryProposals(proposals));
  let mutinyActive = $derived(isMutinyActive(mutinyStatus));
  let offboardActive = $derived(isCrewOffboardActive(qmStatus));
  let mutinyExpired = $derived(isMutinyExpirable(mutinyStatus, nowSec));
  let kindGate = $derived(
    offboardActive
      ? ({ enabled: false, reason: 'governance.gate.cannotStartMutinyWhileOffboard' } as const)
      : crewGate,
  );
  let startPickerOptions = $derived.by(() => {
    const src =
      startKind === 'crew' ? memberEvmOptions : startKind === 'eoa' ? squadMemberOptions : [];
    void src.length;
    return src.map((o) => ({ address: o.address, label: o.label }));
  });
  let startFormKey = $derived(
    `${mutinyStatus?.activeMutinyId ?? '0'}|${startKind}|${startPickerOptions.map((o) => o.address).join(',')}`,
  );
  let startGate = $derived.by((): CtaGate => {
    if (!kindGate.enabled) return kindGate;
    if (startKind === 'crew' && startPickerOptions.length === 0) {
      return { enabled: false, reason: 'governance.gate.noCrewHatForMutiny' };
    }
    if (startKind === 'eoa' && startPickerOptions.length === 0) {
      return { enabled: false, reason: 'governance.gate.noSquadMemberForMutiny' };
    }
    return kindGate;
  });
  let mutinyVoteGate = $derived(
    mutinyExpired
      ? ({ enabled: false, reason: 'governance.gate.mutinyExpired' } as const)
      : mutinyHasVotedFlag
        ? ({ enabled: false, reason: 'governance.gate.alreadyVoted' } as const)
        : crewGate,
  );
  let mutinyExecGate = $derived(
    mutinyExpired ? ({ enabled: false, reason: 'governance.gate.mutinyExpired' } as const) : execGate,
  );

  $effect(() => {
    nowSec = Math.floor(Date.now() / 1000);
    const deadline = mutinyStatus?.deadline ?? 0;
    if (deadline > nowSec) {
      return scheduleDeadlineTimeout(deadline, () => {
        nowSec = Math.floor(Date.now() / 1000);
      });
    }
    return undefined;
  });

  $effect(() => {
    if (votable.length && !votable.some((p) => p.proposalId === voteProposalId)) {
      voteProposalId = votable[0]?.proposalId ?? '';
    }
  });

  $effect(() => {
    if (executable.length && !executable.some((p) => p.proposalId === execProposalId)) {
      execProposalId = executable[0]?.proposalId ?? '';
    }
  });

  $effect(() => {
    const opts = startPickerOptions;
    if (opts.length === 0) {
      if (proposed) proposed = '';
      return;
    }
    const hit = opts.some(
      (o) => o.address.trim().toLowerCase() === proposed.trim().toLowerCase(),
    );
    if (!proposed.trim() || !hit) {
      proposed = opts[0].address;
    }
  });

  async function run(
    label: string,
    fn: () => Promise<unknown>,
    refresh: () => void | Promise<void>,
  ) {
    if (acting) return;
    acting = true;
    try {
      const result = await fn();
      showToast(govWriteSubmittedToast(label, fundedByFromWriteResult(result)));
      await Promise.resolve(refresh());
    } catch (e) {
      showGovWriteErrorToast(e, label);
    } finally {
      acting = false;
    }
  }

  function startMutiny() {
    if (startKind === 'pause') {
      void run(tFn('governance.action.startPauseCaptainMutiny'), () => mutinyStartToPauseCaptain({ network, parentId, mutinyModule }), onRefreshMutiny);
      return;
    }
    const fn =
      startKind === 'crew'
        ? mutinyStartToCrewMember
        : startKind === 'committee'
          ? mutinyStartToCommittee
          : startKind === 'eoa'
            ? mutinyStartToArbitraryEoa
            : mutinyStartToArbitraryContract;
    void run(tFn('governance.action.startMutiny'), () => fn({ network, parentId, mutinyModule, proposed }), onRefreshMutiny);
  }
</script>

<div class="crew-actions">
  {#if fundingHint}
    <p class="muted funding-hint">{fundingHint}</p>
  {/if}
  {#if treasuryAuthority}
    <section class="contract-box" aria-labelledby="crew-ta-heading">
      <h5 id="crew-ta-heading" class="contract-title">{$t('governance.title.treasuryAuthority')}</h5>

      <GovProposeForm
        {network}
        {parentId}
        {treasuryAuthority}
        {privilege}
        {fundingHint}
        {capabilitiesPending}
        onSubmitted={onRefreshProposals}
      />

      <CrewVoteModeSettings
        {network}
        {parentId}
        {treasuryAuthority}
        {privilege}
        {fundingHint}
        onSubmitted={onRefreshProposals}
      />

      <div class="section">
        <h6 class="section-label">{$t('governance.section.crewVote')}</h6>
        {#if votable.length === 0}
          <p class="muted">{$t('governance.empty.noProposalsInCrewVoting')}</p>
        {:else}
          <label class="field-label">
            {$t('governance.field.proposal')}
            <select bind:value={voteProposalId} disabled={acting}>
              {#each votable as p (p.proposalId)}
                <option value={p.proposalId}>{proposalSelectLabel(p)}</option>
              {/each}
            </select>
          </label>
          <div class="row">
            <GovCtaButton
              label={tFn('governance.action.voteYea')}
              variant="primary"
              gate={crewGate}
              {acting}
              onClick={() => {
                if (!requireBackupVerified()) return;
                void run(tFn('governance.action.crewYea'), () =>
                  treasuryAuthorityCrewVote({
                    network,
                    parentId,
                    treasuryAuthority,
                    proposalId: voteProposalId,
                    support: true,
                  }),
                  onRefreshProposals);
              }}
            />
            <GovCtaButton
              label={tFn('governance.action.voteNay')}
              gate={crewGate}
              {acting}
              onClick={() => {
                if (!requireBackupVerified()) return;
                void run(tFn('governance.action.crewNay'), () =>
                  treasuryAuthorityCrewVote({
                    network,
                    parentId,
                    treasuryAuthority,
                    proposalId: voteProposalId,
                    support: false,
                  }),
                  onRefreshProposals);
              }}
            />
          </div>
        {/if}
      </div>

      <div class="section">
        <h6 class="section-label">{$t('governance.section.executeProposal')}</h6>
        {#if executable.length === 0}
          <p class="muted">{$t('governance.empty.noProposalsReady')}</p>
        {:else}
          <label class="field-label">
            {$t('governance.field.proposal')}
            <select bind:value={execProposalId} disabled={acting}>
              {#each executable as p (p.proposalId)}
                <option value={p.proposalId}>{proposalSelectLabel(p)}</option>
              {/each}
            </select>
          </label>
            <GovCtaButton
              label={tFn('governance.action.execute')}
              variant="execute"
              gate={execGate}
              {acting}
              onClick={() => {
                if (!requireBackupVerified()) return;
                void run(tFn('governance.action.execute'), () =>
                  treasuryAuthorityExecute({
                    network,
                    parentId,
                    treasuryAuthority,
                    proposalId: execProposalId,
                  }),
                  onRefreshProposals);
              }}
            />
        {/if}
      </div>
    </section>
  {/if}

  {#if mutinyModule}
    <section class="contract-box" aria-labelledby="crew-mutiny-heading">
      <h5 id="crew-mutiny-heading" class="contract-title">{$t('governance.title.mutiny')}</h5>

      {#if mutinyActive && mutinyStatus}
        <div class="section">
          <h6 class="section-label">{$t('governance.section.activeMutiny')}</h6>
          <p class="muted">
            {$t('governance.mutiny.activeToward', { values: { id: mutinyStatus.activeMutinyId, address: mutinyStatus.proposedNewCaptain, yeas: mutinyStatus.yeas, snapshot: mutinyStatus.snapshot } })}
          </p>
          {#if mutinyStatus.fromCaptain}
            <p class="muted">
              {$t('governance.mutiny.fromCaptain', { values: { address: mutinyStatus.fromCaptain } })}
            </p>
          {/if}
          {#if mutinyStatus.deadline > 0}
            <p class="muted">
              {$t('governance.mutiny.deadline', { values: { when: new Date(mutinyStatus.deadline * 1000).toLocaleString() } })}
            </p>
          {/if}
          {#if mutinyExpired}
            <p class="muted">{$t('governance.mutiny.expired')}</p>
          {/if}
          <div class="row">
            <GovCtaButton
              label={mutinyHasVotedFlag ? tFn('governance.action.alreadyVoted') : tFn('governance.action.castMutinyVote')}
              variant="primary"
              gate={mutinyVoteGate}
              {acting}
              onClick={() =>
                void run(tFn('governance.action.mutinyVote'), () =>
                  mutinyCastVote({
                    network,
                    parentId,
                    mutinyModule,
                    mutinyId: mutinyStatus.activeMutinyId,
                  }),
                onRefreshMutiny)}
            />
            <GovCtaButton
              label={tFn('governance.action.executeMutiny')}
              variant="execute"
              gate={mutinyExecGate}
              {acting}
              onClick={() =>
                void run(tFn('governance.action.executeMutiny'), () =>
                  mutinyExecute({
                    network,
                    parentId,
                    mutinyModule,
                    mutinyId: mutinyStatus.activeMutinyId,
                  }),
                onRefreshMutiny)}
            />
            {#if mutinyExpired}
              <GovCtaButton
                label={tFn('governance.action.expireMutiny')}
                gate={execGate}
                {acting}
                onClick={() =>
                  void run(tFn('governance.action.expireMutiny'), () =>
                    mutinyExpire({
                      network,
                      parentId,
                      mutinyModule,
                      mutinyId: mutinyStatus.activeMutinyId,
                    }),
                  onRefreshMutiny)}
              />
            {/if}
          </div>
        </div>
      {:else}
        <div class="section">
          <h6 class="section-label">{$t('governance.section.startMutiny')}</h6>
          {#key startFormKey}
            <select
              bind:value={startKind}
              disabled={!kindGate.enabled || acting}
              aria-label={$t('governance.section.startMutiny')}
            >
              <option value="crew">{$t('governance.mutiny.startOption.crew')}</option>
              <option value="committee">{$t('governance.mutiny.startOption.committee')}</option>
              <option value="eoa">{$t('governance.mutiny.startOption.eoa')}</option>
              <option value="contract">{$t('governance.mutiny.startOption.contract')}</option>
              <option value="pause">{$t('governance.mutiny.startOption.pause')}</option>
            </select>
            {#if startKind === 'crew' || startKind === 'eoa'}
              {#if startPickerOptions.length > 0}
                <select
                  bind:value={proposed}
                  disabled={!kindGate.enabled || acting}
                  aria-label={$t('governance.field.proposedAddress')}
                >
                  {#each startPickerOptions as opt (opt.address)}
                    <option value={opt.address}>{opt.label} — {shortEvmAddress(opt.address)}</option>
                  {/each}
                </select>
              {:else}
                <p class="muted">
                  {$t(
                    startKind === 'crew'
                      ? 'governance.gate.noCrewHatForMutiny'
                      : 'governance.gate.noSquadMemberForMutiny',
                  )}
                </p>
              {/if}
            {:else if startKind !== 'pause'}
              <input
                bind:value={proposed}
                placeholder={$t('governance.field.proposedAddressPlaceholder')}
                disabled={!kindGate.enabled || acting}
              />
            {/if}
          {/key}
          <GovCtaButton label={tFn('governance.action.startMutiny')} variant="primary" gate={startGate} {acting} onClick={startMutiny} />
        </div>
      {/if}
    </section>
  {/if}

  {#if quartermaster}
    <GovCrewOffboardPanel
      {network}
      {parentId}
      {quartermaster}
      {privilege}
      {mutinyActive}
      {qmStatus}
      {memberEvmOptions}
      hasVoted={offboardHasVoted}
      {fundingHint}
      onRefresh={onRefreshQm}
    />
  {/if}
</div>

<style>
  .crew-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .contract-box {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
  }
  .contract-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .section-label {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .field-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .funding-hint {
    margin: 0 0 4px;
  }
  input,
  select {
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }
</style>
