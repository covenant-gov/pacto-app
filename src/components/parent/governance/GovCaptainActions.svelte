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
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

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
  export let fundingHint = '';

  const tFn = get(t);

  let acting = false;
  let voteProposalId = '';
  let execProposalId = '';
  let resignTo = '';
  let qmAddress = '';
  let qmPending: QuartermasterPendingDto | null = null;
  let showBootstrapModal = false;

  function shortEvm(addr: string): string {
    const a = addr.trim();
    if (a.length < 12) return a;
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  $: if (memberEvmOptions.length > 0) {
    const hit = memberEvmOptions.some(
      (o) => o.address.trim().toLowerCase() === qmAddress.trim().toLowerCase(),
    );
    if (!qmAddress.trim() || !hit) {
      qmAddress = memberEvmOptions[0].address;
    }
  }

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
          ? tFn('governance.gate.cannotBootstrapMutiny')
          : tFn('governance.gate.bootstrapOnlyEmptyRoster'),
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
      showToast(tFn('governance.toast.submitted', { values: { label } }));
      refresh();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, tFn('governance.toast.failed', { values: { label } })));
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
  {#if fundingHint}
    <p class="muted funding-hint">{fundingHint}</p>
  {/if}
  {#if treasuryAuthority}
    <section class="contract-box" aria-labelledby="captain-ta-heading">
      <h5 id="captain-ta-heading" class="contract-title">{$t('governance.title.treasuryAuthority')}</h5>

      <GovProposeForm
        {network}
        {parentId}
        {treasuryAuthority}
        {privilege}
        onSubmitted={onRefreshProposals}
      />

      <div class="section">
        <h6 class="section-label">{$t('governance.section.approveVeto')}</h6>
        {#if votable.length === 0}
          <p class="muted">{$t('governance.empty.noProposalsAwaitingCaptain')}</p>
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
              label={tFn('governance.action.approve')}
              variant="primary"
              gate={captainGate}
              {acting}
              onClick={() =>
                void run(tFn('governance.action.captainApprove'), () =>
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
              label={tFn('governance.action.veto')}
              variant="danger"
              gate={captainGate}
              {acting}
              onClick={() =>
                void run(tFn('governance.action.captainVeto'), () =>
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
            onClick={() =>
              void run(tFn('governance.action.execute'), () =>
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
      <h5 id="captain-qm-heading" class="contract-title">{$t('governance.title.quartermaster')}</h5>

      <div class="section">
        <h6 class="section-label">{$t('governance.section.roster')}</h6>
        {#if qmStatus?.mutinyActive}
          <p class="muted"><strong>{$t('governance.info.mutinyModeOn')}</strong> — {$t('governance.info.mutinyModeBlocked')}</p>
        {:else if qmStatus}
          <p class="muted">{$t('governance.info.crewChangeDelay', { values: { delay: qmStatus.crewChangeDelaySecs } })}</p>
        {/if}
        <label class="field-label">
          {$t('governance.field.targetMember')}
          {#if memberEvmOptions.length > 0}
            <select bind:value={qmAddress} disabled={acting} aria-label={$t('governance.field.targetMemberAriaLabel')}>
              {#each memberEvmOptions as opt (opt.address)}
                <option value={opt.address}>{opt.label} — {shortEvm(opt.address)}</option>
              {/each}
            </select>
          {:else}
            <input bind:value={qmAddress} placeholder={$t('governance.field.targetMemberPlaceholder')} disabled={acting} />
          {/if}
        </label>
        <button
          type="button"
          class="linkish"
          disabled={acting || !qmAddress.trim()}
          on:click={() => void checkQmPending()}
        >
          {$t('governance.quartermaster.checkPending')}
        </button>
        {#if qmPending}
          <p class="muted tiny">
            {$t('governance.quartermaster.pendingAdd', { values: { at: qmPending.pendingAddAt || '0' } })} · {$t('governance.quartermaster.pendingRemove', { values: { at: qmPending.pendingRemoveAt || '0' } })}
          </p>
        {/if}
        <div class="row">
          <GovCtaButton
            label={tFn('governance.action.requestAdd')}
            gate={qmGate}
            {acting}
            onClick={() =>
              void run(tFn('governance.action.requestAdd'), () =>
                quartermasterRequestAddCrew({
                  network,
                  parentId,
                  quartermaster,
                  candidate: qmAddress,
                }),
              onRefreshQm)}
          />
          <GovCtaButton
            label={tFn('governance.action.cancelAdd')}
            gate={qmGate}
            {acting}
            onClick={() =>
              void run(tFn('governance.action.cancelAdd'), () =>
                quartermasterCancelAddCrew({
                  network,
                  parentId,
                  quartermaster,
                  candidate: qmAddress,
                }),
              onRefreshQm)}
          />
          <GovCtaButton
            label={tFn('governance.action.executeAdd')}
            gate={execGate}
            {acting}
            onClick={() =>
              void run(tFn('governance.action.executeAdd'), () =>
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
            label={tFn('governance.action.requestRemove')}
            gate={qmGate}
            {acting}
            onClick={() =>
              void run(tFn('governance.action.requestRemove'), () =>
                quartermasterRequestRemoveCrew({
                  network,
                  parentId,
                  quartermaster,
                  crew: qmAddress,
                }),
              onRefreshQm)}
          />
          <GovCtaButton
            label={tFn('governance.action.cancelRemove')}
            gate={qmGate}
            {acting}
            onClick={() =>
              void run(tFn('governance.action.cancelRemove'), () =>
                quartermasterCancelRemoveCrew({
                  network,
                  parentId,
                  quartermaster,
                  crew: qmAddress,
                }),
              onRefreshQm)}
          />
          <GovCtaButton
            label={tFn('governance.action.executeRemove')}
            gate={execGate}
            {acting}
            onClick={() =>
              void run(tFn('governance.action.executeRemove'), () =>
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
        <h6 class="section-label">{$t('governance.section.bootstrapInitialCrew')}</h6>
        <p class="muted">
          {$t('governance.info.bootstrapHint')}
        </p>
        <GovCtaButton
          label={tFn('governance.action.bootstrapCrew')}
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
      <h5 id="captain-mutiny-heading" class="contract-title">{$t('governance.title.mutiny')}</h5>

      <div class="section">
        <h6 class="section-label">{$t('governance.section.captainResign')}</h6>
        <input
          bind:value={resignTo}
          placeholder={$t('governance.field.newCaptainPlaceholder')}
          disabled={!captainGate.enabled || acting || mutinyActive}
        />
        <GovCtaButton
          label={tFn('governance.action.resignCaptain')}
          gate={mutinyActive
            ? { enabled: false, reason: tFn('governance.gate.cannotResignWhileMutiny') }
            : captainGate}
          {acting}
          onClick={() =>
            void run(tFn('governance.action.captainResign'), () =>
              mutinyCaptainResign({ network, parentId, mutinyModule, newCaptain: resignTo }),
            onRefreshMutiny)}
        />
      </div>

      <div class="section">
        <h6 class="section-label">{$t('governance.section.executeMutiny')}</h6>
        {#if mutinyActive && mutinyStatus}
          <p class="muted">
            {$t('governance.mutiny.activeToward', { values: { id: mutinyStatus.activeMutinyId, address: mutinyStatus.proposedNewCaptain, yeas: mutinyStatus.yeas, snapshot: mutinyStatus.snapshot } })}
          </p>
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
        {:else}
          <p class="muted">{$t('governance.empty.noActiveMutiny')}</p>
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
  {fundingHint}
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
  .funding-hint {
    margin: 0 0 4px;
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
