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
  import { govWriteErrorMessage } from '../../../lib/governance/gov-write-errors';
  import { isCrewOffboardActive } from '../../../lib/governance/crew-offboard';
  import { showToast } from '../../../stores/toast';
  import { requireBackupVerified } from '../../../stores/backup-verification';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  export let network: string;
  export let parentId: string;
  export let treasuryAuthority: string;
  export let mutinyModule: string;
  export let quartermaster = '';
  export let privilege: GovernancePrivilege;
  export let proposals: TreasuryProposalDto[] = [];
  export let mutinyStatus: MutinyStatusDto | null = null;
  export let mutinyHasVotedFlag = false;
  export let qmStatus: QuartermasterStatusDto | null = null;
  export let memberEvmOptions: { address: string; label: string }[] = [];
  export let offboardHasVoted = false;
  export let onRefreshProposals: () => void = () => {};
  export let onRefreshMutiny: () => void = () => {};
  export let onRefreshQm: () => void = () => {};
  export let fundingHint = '';

  const tFn = get(t);

  let acting = false;
  let voteProposalId = '';
  let execProposalId = '';
  let startKind: 'crew' | 'committee' | 'eoa' | 'contract' | 'pause' = 'crew';
  let proposed = '';
  let nowSec = Math.floor(Date.now() / 1000);
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

  $: crewGate = gateRequiresCrew(privilege);
  $: execGate = gatePermissionlessSigner(privilege);
  $: votable = crewVotableProposals(proposals);
  $: executable = executableTreasuryProposals(proposals);
  $: mutinyActive = isMutinyActive(mutinyStatus);
  $: offboardActive = isCrewOffboardActive(qmStatus);
  $: {
    if (deadlineTimer != null) {
      clearTimeout(deadlineTimer);
      deadlineTimer = null;
    }
    nowSec = Math.floor(Date.now() / 1000);
    const deadline = mutinyStatus?.deadline ?? 0;
    if (deadline > nowSec) {
      deadlineTimer = setTimeout(() => {
        nowSec = Math.floor(Date.now() / 1000);
      }, Math.max(0, deadline * 1000 - Date.now()));
    }
  }
  $: mutinyExpired = isMutinyExpirable(mutinyStatus, nowSec);
  $: startGate = ((): CtaGate => {
    if (offboardActive) {
      return { enabled: false, reason: 'governance.gate.cannotStartMutinyWhileOffboard' };
    }
    return crewGate;
  })();
  $: mutinyVoteGate = ((): CtaGate => {
    if (mutinyExpired) return { enabled: false, reason: 'governance.gate.mutinyExpired' };
    if (mutinyHasVotedFlag) return { enabled: false, reason: 'governance.gate.alreadyVoted' };
    return crewGate;
  })();
  $: mutinyExecGate = ((): CtaGate => {
    if (mutinyExpired) return { enabled: false, reason: 'governance.gate.mutinyExpired' };
    return execGate;
  })();
  $: if (votable.length && !votable.some((p) => p.proposalId === voteProposalId)) {
    voteProposalId = votable[0]?.proposalId ?? '';
  }
  $: if (executable.length && !executable.some((p) => p.proposalId === execProposalId)) {
    execProposalId = executable[0]?.proposalId ?? '';
  }

  async function run(label: string, fn: () => Promise<unknown>, refresh: () => void) {
    if (acting) return;
    acting = true;
    try {
      const result = await fn();
      showToast(govWriteSubmittedToast(label, fundedByFromWriteResult(result)));
      refresh();
    } catch (e) {
      showToast(govWriteErrorMessage(e, label));
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
          <select bind:value={startKind} disabled={!startGate.enabled || acting}>
            <option value="crew">{$t('governance.mutiny.startOption.crew')}</option>
            <option value="committee">{$t('governance.mutiny.startOption.committee')}</option>
            <option value="eoa">{$t('governance.mutiny.startOption.eoa')}</option>
            <option value="contract">{$t('governance.mutiny.startOption.contract')}</option>
            <option value="pause">{$t('governance.mutiny.startOption.pause')}</option>
          </select>
          {#if startKind !== 'pause'}
            <input
              bind:value={proposed}
              placeholder={$t('governance.field.proposedAddressPlaceholder')}
              disabled={!startGate.enabled || acting}
            />
          {/if}
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
