<script lang="ts">
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
  import GovProposalReadCard from './GovProposalReadCard.svelte';
  import {
    treasuryAuthorityExecute,
    type MutinyStatusDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import {
    gatePermissionlessSigner,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { isMutinyActive, isMutinyExecutable } from '../../../lib/governance/gov-proposal-lists';
  import { isTreasuryProposalActive } from '../../../lib/governance/treasury-proposal-ui';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';

  export let network: string;
  export let parentId: string;
  export let treasuryAuthority: string;
  export let mutinyModule: string;
  export let privilege: GovernancePrivilege;
  export let proposals: TreasuryProposalDto[] = [];
  export let proposalsLoading = false;
  export let proposalsError = '';
  export let mutinyStatus: MutinyStatusDto | null = null;
  export let mutinyLoading = false;
  export let onRefreshProposals: () => void = () => {};
  export let onExecuteMutiny: () => void = () => {};
  export let fundingHint = '';

  let acting = false;

  $: execGate = gatePermissionlessSigner(privilege);
  $: openCount = proposals.filter((p) => isTreasuryProposalActive(p.status)).length;
  $: mutinyActive = isMutinyActive(mutinyStatus);
  $: mutinyReady = isMutinyExecutable(mutinyStatus);

  async function runExecute(proposalId: string) {
    if (acting || !execGate.enabled) return;
    acting = true;
    try {
      await treasuryAuthorityExecute({
        network,
        parentId,
        treasuryAuthority,
        proposalId,
      });
      showToast('Execute submitted.');
      onRefreshProposals();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Execute failed.'));
    } finally {
      acting = false;
    }
  }
</script>

<div class="proposals-board">
  <div class="board-head">
    <h4 class="board-title">Proposals {#if openCount}({openCount} open){/if}</h4>
    <RefreshIconButton
      spinning={proposalsLoading}
      ariaLabel={proposalsLoading ? 'Refreshing proposals' : 'Refresh proposals'}
      on:click={onRefreshProposals}
    />
  </div>
  {#if fundingHint}
    <p class="muted funding-hint">{fundingHint}</p>
  {/if}

  {#if mutinyLoading && !mutinyStatus}
    <p class="muted">Loading mutiny status…</p>
  {:else if mutinyStatus}
    <div class="mutiny-strip" class:mutiny-strip-active={mutinyActive} class:mutiny-strip-ready={mutinyReady}>
      <span class="mutiny-label">Mutiny</span>
      {#if mutinyActive}
        <p class="mutiny-detail">
          Active #{mutinyStatus.activeMutinyId} toward <code>{mutinyStatus.proposedNewCaptain || '—'}</code>
          · yeas {mutinyStatus.yeas} / snapshot {mutinyStatus.snapshot}
        </p>
        {#if mutinyReady}
          <button
            type="button"
            class="execute-btn"
            disabled={acting || !execGate.enabled}
            title={execGate.enabled ? 'Execute mutiny' : execGate.reason}
            on:click={onExecuteMutiny}
          >
            Execute mutiny
          </button>
        {/if}
      {:else}
        <p class="mutiny-detail muted">No active mutiny · captain <code>{mutinyStatus.captain || '—'}</code></p>
      {/if}
    </div>
  {/if}

  {#if proposalsLoading && proposals.length === 0}
    <p class="muted">Loading proposals…</p>
  {:else if proposals.length === 0}
    <p class="muted">{proposalsError || 'No treasury proposals yet.'}</p>
  {:else}
    <ul class="proposal-list" role="list">
      {#each proposals as proposal (proposal.proposalId)}
        <GovProposalReadCard
          {proposal}
          showExecute
          executePending={acting}
          executeDisabledReason={execGate.enabled ? '' : execGate.reason}
          onExecute={() => runExecute(proposal.proposalId)}
        />
      {/each}
    </ul>
  {/if}
</div>

<style>
  .proposals-board {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .board-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .board-title {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    flex: 1;
  }
  .mutiny-strip {
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mutiny-strip-active {
    border-color: var(--accent);
  }
  .mutiny-strip-ready {
    border-color: color-mix(in srgb, #16a34a 55%, var(--border-subtle));
  }
  .mutiny-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-secondary);
  }
  .mutiny-detail {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
  }
  .proposal-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .funding-hint {
    margin: 0 0 4px;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    word-break: break-all;
  }
  .execute-btn {
    align-self: flex-start;
    font-size: 0.8125rem;
    padding: 6px 12px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    background: #16a34a;
    color: #fff;
  }
  .execute-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
