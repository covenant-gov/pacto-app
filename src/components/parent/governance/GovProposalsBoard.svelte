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
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

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

  const tFn = get(t);

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
      showToast(tFn('governance.toast.submitted', { values: { label: tFn('governance.action.execute') } }));
      onRefreshProposals();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('governance.toast.failed', { values: { label: tFn('governance.action.execute') } })));
    } finally {
      acting = false;
    }
  }
</script>

<div class="proposals-board">
  <div class="board-head">
    <h4 class="board-title">{$t('governance.proposal.boardTitle')}{#if openCount} {$t('governance.proposal.openCount', { values: { count: openCount } })}{/if}</h4>
    <RefreshIconButton
      spinning={proposalsLoading}
      ariaLabel={proposalsLoading ? $t('governance.aria.refreshingProposals') : $t('governance.aria.refreshProposals')}
      on:click={onRefreshProposals}
    />
  </div>
  {#if fundingHint}
    <p class="muted funding-hint">{fundingHint}</p>
  {/if}

  {#if mutinyLoading && !mutinyStatus}
    <p class="muted">{$t('governance.status.loadingMutinyStatus')}</p>
  {:else if mutinyStatus}
    <div class="mutiny-strip" class:mutiny-strip-active={mutinyActive} class:mutiny-strip-ready={mutinyReady}>
      <span class="mutiny-label">{$t('governance.title.mutiny')}</span>
      {#if mutinyActive}
        <p class="mutiny-detail">
          {$t('governance.mutiny.activeToward', { values: { id: mutinyStatus.activeMutinyId, address: mutinyStatus.proposedNewCaptain, yeas: mutinyStatus.yeas, snapshot: mutinyStatus.snapshot } })}
        </p>
        {#if mutinyReady}
          <button
            type="button"
            class="execute-btn"
            disabled={acting || !execGate.enabled}
            title={execGate.enabled ? tFn('governance.action.executeMutiny') : $t(execGate.reason)}
            on:click={onExecuteMutiny}
          >
            {tFn('governance.action.executeMutiny')}
          </button>
        {/if}
      {:else}
        <p class="mutiny-detail muted">{$t('governance.mutiny.noActive', { values: { address: mutinyStatus.captain || '—' } })}</p>
      {/if}
    </div>
  {/if}

  {#if proposalsLoading && proposals.length === 0}
    <p class="muted">{$t('governance.status.loadingProposals')}</p>
  {:else if proposals.length === 0}
    <p class="muted">{proposalsError || $t('governance.empty.noTreasuryProposals')}</p>
  {:else}
    <ul class="proposal-list" role="list">
      {#each proposals as proposal (proposal.proposalId)}
        <GovProposalReadCard
          {proposal}
          showExecute
          executePending={acting}
          executeDisabledReason={execGate.enabled ? '' : $t(execGate.reason)}
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
