<script lang="ts">
  import GovCtaButton from './GovCtaButton.svelte';
  import {
    getQuartermasterPending,
    getQuartermasterStatus,
    quartermasterCancelAddCrew,
    quartermasterCancelRemoveCrew,
    quartermasterExecuteAddCrew,
    quartermasterExecuteRemoveCrew,
    quartermasterRequestAddCrew,
    quartermasterRequestRemoveCrew,
    type QuartermasterPendingDto,
    type QuartermasterStatusDto,
  } from '../../../lib/governance/api';
  import {
    fetchGovModuleReadCached,
    isGovModuleReadStale,
    peekGovModuleRead,
    quartermasterReadCacheKey,
  } from '../../../lib/governance/gov-module-read-cache';
  import {
    gateBlockedByMutinyMode,
    gatePermissionlessSigner,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { showToast } from '../../../stores/toast';

  export let network: string;
  export let parentId: string;
  export let quartermaster: string;
  export let privilege: GovernancePrivilege;
  export let onMutinyMode: (active: boolean) => void = () => {};

  let status: QuartermasterStatusDto | null = null;
  let pending: QuartermasterPendingDto | null = null;
  let loading = false;
  let refreshing = false;
  let acting = false;
  let error = '';
  let address = '';
  let lastHydrateKey = '';

  $: captainGate = gateBlockedByMutinyMode(privilege, !!status?.mutinyActive);
  $: execGate = gatePermissionlessSigner(privilege);

  function applyStatus(next: QuartermasterStatusDto) {
    status = next;
    onMutinyMode(next.mutinyActive);
  }

  function cacheKey(): string {
    return quartermasterReadCacheKey(network, quartermaster);
  }

  async function reload(force = false) {
    const key = cacheKey();
    const peeked = peekGovModuleRead<QuartermasterStatusDto>(key);
    if (peeked) applyStatus(peeked);

    const needFetch = force || !peeked || isGovModuleReadStale(key);
    if (!needFetch) {
      loading = false;
      refreshing = false;
      if (address.trim()) {
        try {
          pending = await getQuartermasterPending({
            network,
            quartermaster,
            address: address.trim(),
          });
        } catch {
          pending = null;
        }
      }
      return;
    }

    if (!peeked) loading = true;
    else refreshing = true;
    error = '';
    try {
      const next = await fetchGovModuleReadCached(
        key,
        parentId,
        () => getQuartermasterStatus({ network, quartermaster }),
        { force: force || !!peeked },
      );
      applyStatus(next);
      if (address.trim()) {
        pending = await getQuartermasterPending({
          network,
          quartermaster,
          address: address.trim(),
        });
      } else {
        pending = null;
      }
    } catch (e) {
      error = getInvokeErrorMessage(e, 'Could not load quartermaster.');
      if (!peeked) {
        status = null;
        onMutinyMode(false);
      }
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  $: {
    const key = `${parentId}|${network}|${quartermaster}`;
    if (key !== lastHydrateKey && parentId.trim() && quartermaster.trim()) {
      lastHydrateKey = key;
      void reload(false);
    }
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    if (acting) return;
    acting = true;
    try {
      await fn();
      showToast(`${label} submitted.`);
      await reload(true);
    } catch (e) {
      showToast(getInvokeErrorMessage(e, `${label} failed.`));
    } finally {
      acting = false;
    }
  }
</script>

<div class="module-detail">
  {#if loading && !status}
    <p class="muted">Loading quartermaster…</p>
  {:else if error && !status}
    <p class="err">{error}</p>
  {:else if status}
    <p class="muted">
      Crew change delay {status.crewChangeDelaySecs}s
      {#if status.mutinyActive}
        · <strong>Mutiny mode on</strong> (captain roster actions blocked)
      {/if}
      {#if refreshing}
        · Updating…
      {/if}
    </p>

    <div class="action-block">
      <h5 class="subhead">Target address</h5>
      <input bind:value={address} placeholder="0x…" disabled={acting} />
      <button type="button" class="linkish" disabled={acting || !address.trim()} on:click={() => void reload(true)}>
        Check pending
      </button>
      {#if pending}
        <p class="muted tiny">
          Pending add at {pending.pendingAddAt || '0'} · pending remove at {pending.pendingRemoveAt || '0'}
        </p>
      {/if}
    </div>

    <div class="action-block">
      <h5 class="subhead">Add crew</h5>
      <div class="row">
        <GovCtaButton
          label="Request add"
          variant="primary"
          gate={captainGate}
          {acting}
          onClick={() =>
            void run('Request add', () =>
              quartermasterRequestAddCrew({
                network,
                parentId,
                quartermaster,
                candidate: address,
              }),
            )}
        />
        <GovCtaButton
          label="Cancel add"
          gate={captainGate}
          {acting}
          onClick={() =>
            void run('Cancel add', () =>
              quartermasterCancelAddCrew({
                network,
                parentId,
                quartermaster,
                candidate: address,
              }),
            )}
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
                candidate: address,
              }),
            )}
        />
      </div>
    </div>

    <div class="action-block">
      <h5 class="subhead">Remove crew</h5>
      <div class="row">
        <GovCtaButton
          label="Request remove"
          variant="primary"
          gate={captainGate}
          {acting}
          onClick={() =>
            void run('Request remove', () =>
              quartermasterRequestRemoveCrew({
                network,
                parentId,
                quartermaster,
                crew: address,
              }),
            )}
        />
        <GovCtaButton
          label="Cancel remove"
          gate={captainGate}
          {acting}
          onClick={() =>
            void run('Cancel remove', () =>
              quartermasterCancelRemoveCrew({
                network,
                parentId,
                quartermaster,
                crew: address,
              }),
            )}
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
                crew: address,
              }),
            )}
        />
      </div>
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
  .tiny {
    font-size: 0.6875rem;
  }
  .err {
    color: var(--danger, #e53e3e);
    font-size: 0.8125rem;
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
  input {
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
