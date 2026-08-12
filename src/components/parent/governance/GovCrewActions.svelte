<script lang="ts">
  import GovCtaButton from './GovCtaButton.svelte';
  import GovProposeForm from './GovProposeForm.svelte';
  import {
    mutinyCastVote,
    mutinyExecute,
    mutinyStartToArbitraryContract,
    mutinyStartToArbitraryEoa,
    mutinyStartToCommittee,
    mutinyStartToCrewMember,
    mutinyStartToPauseCaptain,
    treasuryAuthorityCrewVote,
    treasuryAuthorityExecute,
    type MutinyStatusDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import {
    crewVotableProposals,
    executableTreasuryProposals,
    isMutinyActive,
    proposalSelectLabel,
  } from '../../../lib/governance/gov-proposal-lists';
  import {
    gatePermissionlessSigner,
    gateRequiresCrew,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import {
    govWriteSubmittedToast,
    type GovWriteFundingMode,
  } from '../../../lib/governance/gov-write-funding';
  import { govWriteErrorMessage } from '../../../lib/governance/gov-write-errors';
  import { showToast } from '../../../stores/toast';
  import { requireBackupVerified } from '../../../stores/backup-verification';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  export let network: string;
  export let parentId: string;
  export let treasuryAuthority: string;
  export let mutinyModule: string;
  export let privilege: GovernancePrivilege;
  export let proposals: TreasuryProposalDto[] = [];
  export let mutinyStatus: MutinyStatusDto | null = null;
  export let mutinyHasVotedFlag = false;
  export let onRefreshProposals: () => void = () => {};
  export let onRefreshMutiny: () => void = () => {};
  export let fundingHint = '';
  export let fundingMode: GovWriteFundingMode | null = null;

  const tFn = get(t);

  let acting = false;
  let voteProposalId = '';
  let execProposalId = '';
  let startKind: 'crew' | 'committee' | 'eoa' | 'contract' | 'pause' = 'crew';
  let proposed = '';

  $: crewGate = gateRequiresCrew(privilege);
  $: execGate = gatePermissionlessSigner(privilege);
  $: votable = crewVotableProposals(proposals);
  $: executable = executableTreasuryProposals(proposals);
  $: mutinyActive = isMutinyActive(mutinyStatus);
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
      await fn();
      showToast(govWriteSubmittedToast(label, fundingMode));
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
        {fundingMode}
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
          <div class="row">
            <GovCtaButton
              label={mutinyHasVotedFlag ? tFn('governance.action.alreadyVoted') : tFn('governance.action.castMutinyVote')}
              variant="primary"
              gate={mutinyHasVotedFlag ? { enabled: false, reason: 'governance.gate.alreadyVoted' } : crewGate}
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
              gate={execGate}
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
          </div>
        </div>
      {:else}
        <div class="section">
          <h6 class="section-label">{$t('governance.section.startMutiny')}</h6>
          <select bind:value={startKind} disabled={!crewGate.enabled || acting}>
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
              disabled={!crewGate.enabled || acting}
            />
          {/if}
          <GovCtaButton label={tFn('governance.action.startMutiny')} variant="primary" gate={crewGate} {acting} onClick={startMutiny} />
        </div>
      {/if}
    </section>
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
