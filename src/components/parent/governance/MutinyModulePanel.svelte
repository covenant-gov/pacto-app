<script lang="ts">
  import { onMount } from 'svelte';
  import GovCtaButton from './GovCtaButton.svelte';
  import {
    getMutinyStatus,
    mutinyCaptainResign,
    mutinyCastVote,
    mutinyExecute,
    mutinyHasVoted,
    mutinyStartToArbitraryContract,
    mutinyStartToArbitraryEoa,
    mutinyStartToCommittee,
    mutinyStartToCrewMember,
    mutinyStartToPauseCaptain,
    type MutinyStatusDto,
  } from '../../../lib/governance/api';
  import {
    gatePermissionlessSigner,
    gateRequiresCaptain,
    gateRequiresCrew,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';

  export let network: string;
  export let parentId: string;
  export let mutinyModule: string;
  export let privilege: GovernancePrivilege;
  export let onStatus: (info: { active: boolean; captain: string }) => void = () => {};

  let status: MutinyStatusDto | null = null;
  let hasVoted = false;
  let loading = true;
  let acting = false;
  let error = '';
  let startKind: 'crew' | 'committee' | 'eoa' | 'contract' | 'pause' = 'crew';
  let proposed = '';
  let resignTo = '';

  $: crewGate = gateRequiresCrew(privilege);
  $: captainGate = gateRequiresCaptain(privilege);
  $: execGate = gatePermissionlessSigner(privilege);
  $: mutinyActive = !!(status && status.activeMutinyId !== '0' && !status.executed);

  async function reload() {
    loading = true;
    error = '';
    try {
      status = await getMutinyStatus({ network, mutinyModule });
      onStatus({
        active: status.activeMutinyId !== '0' && !status.executed,
        captain: status.captain ?? '',
      });
      if (status.activeMutinyId !== '0' && privilege.myAddress) {
        hasVoted = await mutinyHasVoted({
          network,
          mutinyModule,
          mutinyId: status.activeMutinyId,
          voter: privilege.myAddress,
        });
      } else {
        hasVoted = false;
      }
    } catch (e) {
      error = getInvokeErrorMessage(e, 'Could not load mutiny status.');
      status = null;
      onStatus({ active: false, captain: '' });
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void reload();
  });

  async function run(label: string, fn: () => Promise<unknown>) {
    if (acting) return;
    acting = true;
    try {
      await fn();
      showToast(`${label} submitted.`);
      await reload();
    } catch (e) {
      showToast(getInvokeErrorMessage(e, `${label} failed.`));
    } finally {
      acting = false;
    }
  }

  function startMutiny() {
    if (startKind === 'pause') {
      void run('Start pause-captain mutiny', () =>
        mutinyStartToPauseCaptain({ network, parentId, mutinyModule }),
      );
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
    void run('Start mutiny', () => fn({ network, parentId, mutinyModule, proposed }));
  }
</script>

<div class="module-detail">
  {#if loading}
    <p class="muted">Loading mutiny…</p>
  {:else if error}
    <p class="err">{error}</p>
  {:else if status}
    <p class="muted">
      Captain tracked as <code>{status.captain || '—'}</code>
      · Active id {status.activeMutinyId}
    </p>
    {#if mutinyActive}
      <div class="status-box">
        <p>
          Mutiny toward <code>{status.proposedNewCaptain}</code> · yeas {status.yeas} / snapshot
          {status.snapshot}
        </p>
        <div class="row">
          <GovCtaButton
            label={hasVoted ? 'Already voted' : 'Cast mutiny vote'}
            variant="primary"
            gate={hasVoted ? { enabled: false, reason: 'You already voted in this mutiny.' } : crewGate}
            {acting}
            onClick={() =>
              void run('Mutiny vote', () =>
                mutinyCastVote({
                  network,
                  parentId,
                  mutinyModule,
                  mutinyId: status!.activeMutinyId,
                }),
              )}
          />
          <GovCtaButton
            label="Execute mutiny"
            gate={execGate}
            {acting}
            onClick={() =>
              void run('Execute mutiny', () =>
                mutinyExecute({
                  network,
                  parentId,
                  mutinyModule,
                  mutinyId: status!.activeMutinyId,
                }),
              )}
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
        <GovCtaButton label="Start mutiny" variant="primary" gate={crewGate} {acting} onClick={startMutiny} />
      </div>
    {/if}

    <div class="action-block">
      <h5 class="subhead">Captain resign</h5>
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
          )}
      />
    </div>
  {/if}
</div>

<style>
  .module-detail {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .muted {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .err {
    color: var(--danger, #e53e3e);
    font-size: 0.8125rem;
  }
  .status-box,
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
