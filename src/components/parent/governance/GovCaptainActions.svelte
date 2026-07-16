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
    type CtaGate,
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
  $: bootstrapGate = ((): CtaGate => {
    if (!bootstrapAvailable) {
      return {
        enabled: false,
        reason: qmStatus?.mutinyActive
          ? 'Cannot bootstrap while mutiny mode is on.'
          : 'Bootstrap only runs while the crew roster is empty.',
      };
    }
    return captainGate;
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
    <section class="contract-box" aria-labelledby="captain-ta-heading">
      <h5 id="captain-ta-heading" class="contract-title">Treasury Authority</h5>

      <GovProposeForm
        {network}
        {parentId}
        {treasuryAuthority}
        {privilege}
        onSubmitted={onRefreshProposals}
      />

      <div class="section">
        <h6 class="section-label">Approve / veto</h6>
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

      <div class="section">
        <h6 class="section-label">Execute proposal</h6>
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
    </section>
  {/if}

  {#if quartermaster}
    <section class="contract-box" aria-labelledby="captain-qm-heading">
      <h5 id="captain-qm-heading" class="contract-title">Quartermaster</h5>

      <div class="section">
        <h6 class="section-label">Roster</h6>
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

      <div class="section">
        <h6 class="section-label">Bootstrap initial crew</h6>
        <p class="muted">
          Mint crew hats in one transaction while the roster is still empty. Members need a shared squad EVM address.
        </p>
        <GovCtaButton
          label="Bootstrap crew…"
          variant="primary"
          gate={bootstrapGate}
          {acting}
          onClick={() => (showBootstrapModal = true)}
        />
      </div>
    </section>
  {/if}

  {#if mutinyModule}
    <section class="contract-box" aria-labelledby="captain-mutiny-heading">
      <h5 id="captain-mutiny-heading" class="contract-title">Mutiny</h5>

      <div class="section">
        <h6 class="section-label">Captain resign</h6>
        <input
          bind:value={resignTo}
          placeholder="New captain 0x…"
          disabled={!captainGate.enabled || acting || mutinyActive}
        />
        <GovCtaButton
          label="Resign captain"
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

      <div class="section">
        <h6 class="section-label">Execute mutiny</h6>
        {#if mutinyActive && mutinyStatus}
          <p class="muted">
            Active #{mutinyStatus.activeMutinyId} toward <code>{mutinyStatus.proposedNewCaptain}</code>
          </p>
          <GovCtaButton
            label="Execute mutiny"
            variant="execute"
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
        {:else}
          <p class="muted">No active mutiny to execute.</p>
        {/if}
      </div>
    </section>
  {/if}
</div>

<GovBootstrapCrewModal
  open={showBootstrapModal}
  onClose={() => (showBootstrapModal = false)}
  {network}
  {parentId}
  {quartermaster}
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
  code {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    word-break: break-all;
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
