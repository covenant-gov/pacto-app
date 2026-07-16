<script lang="ts">
  import GovCtaButton from './GovCtaButton.svelte';
  import GovProposeForm from './GovProposeForm.svelte';
  import GovBootstrapCrewModal from './GovBootstrapCrewModal.svelte';
  import {
    getQuartermasterPending,
    mutinyCaptainResign,
    mutinyExecute,
    quartermasterCancelAddCrew,
    quartermasterCancelRemoveCrew,
    quartermasterExecuteAddCrew,
    quartermasterExecuteRemoveCrew,
    quartermasterRequestAddCrew,
    quartermasterRequestRemoveCrew,
    treasuryAuthorityCaptainVote,
    treasuryAuthorityExecute,
    type MutinyStatusDto,
    type QuartermasterPendingDto,
    type QuartermasterStatusDto,
    type TreasuryProposalDto,
  } from '../../../lib/governance/api';
  import {
    captainVotableProposals,
    executableTreasuryProposals,
    isMutinyActive,
    proposalSelectLabel,
  } from '../../../lib/governance/gov-proposal-lists';
  import {
    gateBlockedByMutinyMode,
    gatePermissionlessSigner,
    gateRequiresCaptain,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';

  export let network: string;
  export let parentId: string;
  export let treasuryAuthority: string;
  export let quartermaster: string;
  export let mutinyModule: string;
  export let privilege: GovernancePrivilege;
  export let proposals: TreasuryProposalDto[] = [];
  export let mutinyStatus: MutinyStatusDto | null = null;
  export let qmStatus: QuartermasterStatusDto | null = null;
  export let memberEvmOptions: { address: string; label: string }[] = [];
  export let captainWearers: string[] = [];
  export let onRefreshProposals: () => void = () => {};
  export let onRefreshMutiny: () => void = () => {};
  export let onRefreshQm: () => void = () => {};

  let acting = false;
  let voteProposalId = '';
  let execProposalId = '';
  let resignTo = '';
  let qmAddress = '';
  let qmPending: QuartermasterPendingDto | null = null;
  let showBootstrapModal = false;

  $: captainGate = gateRequiresCaptain(privilege);
  $: qmGate = gateBlockedByMutinyMode(privilege, !!qmStatus?.mutinyActive);
  $: execGate = gatePermissionlessSigner(privilege);
  $: votable = captainVotableProposals(proposals);
  $: executable = executableTreasuryProposals(proposals);
  $: mutinyActive = isMutinyActive(mutinyStatus);
  $: bootstrapAvailable = qmStatus?.bootstrapAvailable === true;
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

  async function checkQmPending() {
    if (!quartermaster || !qmAddress.trim()) return;
    try {
      qmPending = await getQuartermasterPending({
        network,
        quartermaster,
        address: qmAddress.trim(),
      });
    } catch {
      qmPending = null;
    }
  }
</script>

<div class="captain-actions">
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
    <h5 class="subhead">Captain approve / veto</h5>
    {#if votable.length === 0}
      <p class="muted">No proposals awaiting captain decision.</p>
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
          label="Approve"
          variant="primary"
          contractHint="Treasury Authority"
          gate={captainGate}
          {acting}
          onClick={() =>
            void run('Captain approve', () =>
              treasuryAuthorityCaptainVote({
                network,
                parentId,
                treasuryAuthority,
                proposalId: voteProposalId,
                support: true,
              }),
            onRefreshProposals)}
        />
        <GovCtaButton
          label="Veto"
          variant="danger"
          contractHint="Treasury Authority"
          gate={captainGate}
          {acting}
          onClick={() =>
            void run('Captain veto', () =>
              treasuryAuthorityCaptainVote({
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

  {#if quartermaster}
    {#if bootstrapAvailable}
      <div class="action-block bootstrap-block">
        <h5 class="subhead">Bootstrap initial crew</h5>
        <p class="muted">
          Crew roster is still empty. Mint hats for members who have shared squad EVM addresses in one transaction.
        </p>
        <GovCtaButton
          label="Bootstrap crew…"
          variant="primary"
          contractHint="Quartermaster"
          gate={captainGate}
          {acting}
          onClick={() => (showBootstrapModal = true)}
        />
      </div>
    {/if}

    <div class="action-block">
      <h5 class="subhead">Quartermaster roster</h5>
      {#if qmStatus?.mutinyActive}
        <p class="muted"><strong>Mutiny mode on</strong> — captain roster actions blocked.</p>
      {:else if qmStatus}
        <p class="muted">Crew change delay {qmStatus.crewChangeDelaySecs}s</p>
      {/if}
      <label class="field-label">
        Target address
        <input bind:value={qmAddress} placeholder="0x…" disabled={acting} />
      </label>
      <button
        type="button"
        class="linkish"
        disabled={acting || !qmAddress.trim()}
        on:click={() => void checkQmPending()}
      >
        Check pending
      </button>
      {#if qmPending}
        <p class="muted tiny">
          Pending add at {qmPending.pendingAddAt || '0'} · pending remove at {qmPending.pendingRemoveAt || '0'}
        </p>
      {/if}
      <div class="row">
        <GovCtaButton
          label="Request add"
          variant="primary"
          contractHint="Quartermaster"
          gate={qmGate}
          {acting}
          onClick={() =>
            void run('Request add', () =>
              quartermasterRequestAddCrew({
                network,
                parentId,
                quartermaster,
                candidate: qmAddress,
              }),
            onRefreshQm)}
        />
        <GovCtaButton
          label="Cancel add"
          contractHint="Quartermaster"
          gate={qmGate}
          {acting}
          onClick={() =>
            void run('Cancel add', () =>
              quartermasterCancelAddCrew({
                network,
                parentId,
                quartermaster,
                candidate: qmAddress,
              }),
            onRefreshQm)}
        />
        <GovCtaButton
          label="Execute add"
          contractHint="Quartermaster"
          gate={execGate}
          {acting}
          onClick={() =>
            void run('Execute add', () =>
              quartermasterExecuteAddCrew({
                network,
                parentId,
                quartermaster,
                candidate: qmAddress,
              }),
            onRefreshQm)}
        />
      </div>
      <div class="row">
        <GovCtaButton
          label="Request remove"
          contractHint="Quartermaster"
          gate={qmGate}
          {acting}
          onClick={() =>
            void run('Request remove', () =>
              quartermasterRequestRemoveCrew({
                network,
                parentId,
                quartermaster,
                crew: qmAddress,
              }),
            onRefreshQm)}
        />
        <GovCtaButton
          label="Cancel remove"
          contractHint="Quartermaster"
          gate={qmGate}
          {acting}
          onClick={() =>
            void run('Cancel remove', () =>
              quartermasterCancelRemoveCrew({
                network,
                parentId,
                quartermaster,
                crew: qmAddress,
              }),
            onRefreshQm)}
        />
        <GovCtaButton
          label="Execute remove"
          contractHint="Quartermaster"
          gate={execGate}
          {acting}
          onClick={() =>
            void run('Execute remove', () =>
              quartermasterExecuteRemoveCrew({
                network,
                parentId,
                quartermaster,
                crew: qmAddress,
              }),
            onRefreshQm)}
        />
      </div>
    </div>
  {/if}

  {#if mutinyModule}
    <div class="action-block">
      <h5 class="subhead">Captain resign</h5>
      <input
        bind:value={resignTo}
        placeholder="New captain 0x…"
        disabled={!captainGate.enabled || acting || mutinyActive}
      />
      <GovCtaButton
        label="Resign captain"
        contractHint="Mutiny"
        gate={mutinyActive
          ? { enabled: false, reason: 'Cannot resign while a mutiny is active.' }
          : captainGate}
        {acting}
        onClick={() =>
          void run('Captain resign', () =>
            mutinyCaptainResign({ network, parentId, mutinyModule, newCaptain: resignTo }),
          onRefreshMutiny)}
      />
    </div>
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

  {#if mutinyModule && mutinyActive && mutinyStatus}
    <div class="action-block">
      <h5 class="subhead">Execute mutiny</h5>
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
  {/if}
</div>

<GovBootstrapCrewModal
  open={showBootstrapModal}
  onClose={() => (showBootstrapModal = false)}
  {network}
  {parentId}
  quartermaster={quartermaster}
  {privilege}
  memberOptions={memberEvmOptions}
  captainAddresses={captainWearers}
  onSubmitted={onRefreshQm}
/>

<style>
  .captain-actions {
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
  .tiny {
    font-size: 0.6875rem;
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
  .linkish {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .linkish:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
