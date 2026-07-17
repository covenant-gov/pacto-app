<script lang="ts">
  import GovCtaButton from './GovCtaButton.svelte';
  import TreasuryProposalCard from './TreasuryProposalCard.svelte';
  import {
    treasuryAuthorityCaptainVote,
    treasuryAuthorityCrewVote,
    treasuryAuthorityExecute,
    treasuryAuthorityPropose,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import {
    gatePermissionlessSigner,
    gateRequiresCaptain,
    gateRequiresCaptainOrCrew,
    gateRequiresCrew,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { isTreasuryProposalActive } from '../../../lib/governance/treasury-proposal-ui';
  import { govWriteFundingFallbackHint } from '../../../lib/governance/gov-write-funding';
  import { showToast } from '../../../stores/toast';

  export let network: string;
  export let parentId: string;
  export let treasuryAuthority: string;
  export let privilege: GovernancePrivilege;
  export let proposals: TreasuryProposalDto[] = [];
  export let proposalsLoading = false;
  export let proposalsError = '';
  export let proposalHasVotedById: Record<string, boolean> = {};
  export let onRefresh: () => void = () => {};
  export let fundingHint = '';

  let acting = false;
  let proposeTo = '';
  let proposeValue = '0';
  let proposeData = '0x';
  let proposeOp = 'call';

  $: crewGate = gateRequiresCrew(privilege);
  $: captainGate = gateRequiresCaptain(privilege);
  $: proposeGate = gateRequiresCaptainOrCrew(privilege);
  $: execGate = gatePermissionlessSigner(privilege);
  $: openCount = proposals.filter((p) => isTreasuryProposalActive(p.status)).length;

  async function run(label: string, fn: () => Promise<unknown>) {
    if (acting) return;
    acting = true;
    try {
      await fn();
      showToast(`${label} submitted.`);
      onRefresh();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, `${label} failed.`));
    } finally {
      acting = false;
    }
  }

  function voteCrew(proposalId: string, support: boolean) {
    void run(support ? 'Crew yea' : 'Crew nay', () =>
      treasuryAuthorityCrewVote({
        network,
        parentId,
        treasuryAuthority,
        proposalId,
        support,
      }),
    );
  }

  function voteCaptain(proposalId: string, support: boolean) {
    void run(support ? 'Captain approve' : 'Captain veto', () =>
      treasuryAuthorityCaptainVote({
        network,
        parentId,
        treasuryAuthority,
        proposalId,
        support,
      }),
    );
  }
</script>

<div class="module-detail">
  <p class="module-lead muted">
    Crew vote + captain approval (or crew-only execute when the Safe wears the captain hat).
    {#if privilege.captainIsSafe}
      <strong> Safe currently holds the captain hat.</strong>
    {/if}
    {fundingHint.trim() || govWriteFundingFallbackHint()}
  </p>

  <div class="action-block">
    <h5 class="subhead">Propose</h5>
    <div class="form-grid">
      <label
        >To<input bind:value={proposeTo} placeholder="0x…" disabled={!proposeGate.enabled || acting} /></label
      >
      <label
        >Value (wei)<input bind:value={proposeValue} disabled={!proposeGate.enabled || acting} /></label
      >
      <label
        >Data<input bind:value={proposeData} placeholder="0x" disabled={!proposeGate.enabled || acting} /></label
      >
      <label
        >Op
        <select bind:value={proposeOp} disabled={!proposeGate.enabled || acting}>
          <option value="call">call</option>
          <option value="delegatecall">delegatecall</option>
        </select>
      </label>
    </div>
    <GovCtaButton
      label="Submit proposal"
      variant="primary"
      gate={proposeGate}
      {acting}
      onClick={() =>
        void run('Proposal', () =>
          treasuryAuthorityPropose({
            network,
            parentId,
            treasuryAuthority,
            to: proposeTo,
            valueWei: proposeValue,
            dataHex: proposeData,
            operation: proposeOp,
          }),
        )}
    />
  </div>

  <h5 class="subhead">Proposals {#if openCount}({openCount} open){/if}</h5>
  {#if proposalsLoading && proposals.length === 0}
    <p class="muted">Loading proposals…</p>
  {:else if proposals.length === 0}
    <p class="muted">{proposalsError || 'No treasury proposals yet.'}</p>
  {:else}
    <ul class="proposal-list" role="list">
      {#each proposals as proposal (proposal.proposalId)}
          <TreasuryProposalCard
          {proposal}
          voterAddress={privilege.myAddress}
          hasVoted={proposalHasVotedById[proposal.proposalId]}
          votePending={acting}
          voteDisabledReason={crewGate.enabled ? '' : crewGate.reason}
          onVoteYea={() => voteCrew(proposal.proposalId, true)}
          onVoteNay={() => voteCrew(proposal.proposalId, false)}
        />
        {#if isTreasuryProposalActive(proposal.status)}
          <div class="inline-actions">
            <GovCtaButton
              label="Captain approve"
              gate={captainGate}
              {acting}
              onClick={() => voteCaptain(proposal.proposalId, true)}
            />
            <GovCtaButton
              label="Captain veto"
              variant="danger"
              gate={captainGate}
              {acting}
              onClick={() => voteCaptain(proposal.proposalId, false)}
            />
            <GovCtaButton
              label="Execute"
              variant="primary"
              gate={execGate}
              {acting}
              onClick={() =>
                void run('Execute', () =>
                  treasuryAuthorityExecute({
                    network,
                    parentId,
                    treasuryAuthority,
                    proposalId: proposal.proposalId,
                  }),
                )}
            />
          </div>
        {/if}
      {/each}
    </ul>
  {/if}
</div>

<style>
  .module-detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .module-lead,
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .tiny {
    font-size: 0.6875rem;
  }
  .subhead {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
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
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .form-grid label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .form-grid input,
  .form-grid select {
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.8125rem;
  }
  .proposal-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .inline-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: -4px 0 8px;
  }
</style>
