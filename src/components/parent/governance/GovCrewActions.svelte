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
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';

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
      showToast(`${label} submitted.`);
      refresh();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, `${label} failed.`));
    } finally {
      acting = false;
    }
  }

  function startMutiny() {
    if (startKind === 'pause') {
      void run('Start pause-captain mutiny', () => mutinyStartToPauseCaptain({ network, parentId, mutinyModule }), onRefreshMutiny);
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
    void run('Start mutiny', () => fn({ network, parentId, mutinyModule, proposed }), onRefreshMutiny);
  }
</script>

<div class="crew-actions">
  {#if treasuryAuthority}
    <GovProposeForm
      {network}
      {parentId}
      {treasuryAuthority}
      {privilege}
      onSubmitted={onRefreshProposals}
    />
  {/if}

  <div class="action-block">
    <h5 class="subhead">Crew vote</h5>
    {#if votable.length === 0}
      <p class="muted">No proposals in crew voting phase.</p>
    {:else}
      <label class="field-label">
        Proposal
        <select bind:value={voteProposalId} disabled={acting}>
          {#each votable as p (p.proposalId)}
            <option value={p.proposalId}>{proposalSelectLabel(p)}</option>
          {/each}
        </select>
      </label>
      <div class="row">
        <GovCtaButton
          label="Vote yea"
          variant="primary"
          contractHint="Treasury Authority"
          gate={crewGate}
          {acting}
          onClick={() =>
            void run('Crew yea', () =>
              treasuryAuthorityCrewVote({
                network,
                parentId,
                treasuryAuthority,
                proposalId: voteProposalId,
                support: true,
              }),
            onRefreshProposals)}
        />
        <GovCtaButton
          label="Vote nay"
          contractHint="Treasury Authority"
          gate={crewGate}
          {acting}
          onClick={() =>
            void run('Crew nay', () =>
              treasuryAuthorityCrewVote({
                network,
                parentId,
                treasuryAuthority,
                proposalId: voteProposalId,
                support: false,
              }),
            onRefreshProposals)}
        />
      </div>
    {/if}
  </div>

  {#if mutinyModule}
    {#if mutinyActive && mutinyStatus}
      <div class="action-block">
        <h5 class="subhead">Active mutiny</h5>
        <p class="muted">
          Toward <code>{mutinyStatus.proposedNewCaptain}</code> · yeas {mutinyStatus.yeas} / snapshot
          {mutinyStatus.snapshot}
        </p>
        <div class="row">
          <GovCtaButton
            label={mutinyHasVotedFlag ? 'Already voted' : 'Cast mutiny vote'}
            variant="primary"
            contractHint="Mutiny"
            gate={mutinyHasVotedFlag ? { enabled: false, reason: 'You already voted in this mutiny.' } : crewGate}
            {acting}
            onClick={() =>
              void run('Mutiny vote', () =>
                mutinyCastVote({
                  network,
                  parentId,
                  mutinyModule,
                  mutinyId: mutinyStatus.activeMutinyId,
                }),
              onRefreshMutiny)}
          />
          <GovCtaButton
            label="Execute mutiny"
            variant="execute"
            contractHint="Mutiny"
            gate={execGate}
            {acting}
            onClick={() =>
              void run('Execute mutiny', () =>
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
      <div class="action-block">
        <h5 class="subhead">Start mutiny</h5>
        <select bind:value={startKind} disabled={!crewGate.enabled || acting}>
          <option value="crew">To crew member</option>
          <option value="committee">To committee (Safe-style)</option>
          <option value="eoa">To arbitrary EOA</option>
          <option value="contract">To arbitrary contract</option>
          <option value="pause">Pause captain (hat → Safe)</option>
        </select>
        {#if startKind !== 'pause'}
          <input
            bind:value={proposed}
            placeholder="Proposed address 0x…"
            disabled={!crewGate.enabled || acting}
          />
        {/if}
        <GovCtaButton
          label="Start mutiny"
          variant="primary"
          contractHint="Mutiny"
          gate={crewGate}
          {acting}
          onClick={startMutiny}
        />
      </div>
    {/if}
  {/if}

  <div class="action-block">
    <h5 class="subhead">Execute treasury proposal</h5>
    {#if executable.length === 0}
      <p class="muted">No proposals ready to execute.</p>
    {:else}
      <label class="field-label">
        Proposal
        <select bind:value={execProposalId} disabled={acting}>
          {#each executable as p (p.proposalId)}
            <option value={p.proposalId}>{proposalSelectLabel(p)}</option>
          {/each}
        </select>
      </label>
      <GovCtaButton
        label="Execute"
        variant="execute"
        contractHint="Treasury Authority"
        gate={execGate}
        {acting}
        onClick={() =>
          void run('Execute', () =>
            treasuryAuthorityExecute({
              network,
              parentId,
              treasuryAuthority,
              proposalId: execProposalId,
            }),
          onRefreshProposals)}
      />
    {/if}
  </div>
</div>

<style>
  .crew-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .action-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
  }
  .subhead {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
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
  input,
  select {
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    word-break: break-all;
  }
</style>
