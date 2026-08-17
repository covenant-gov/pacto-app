<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Modal from '../../ui/Modal.svelte';
  import { quartermasterBootstrapCrew } from '../../../lib/governance/api';
  import {
    fundedByFromWriteResult,
    govWriteFundingFallbackHint,
    type GovWriteFundingMode,
  } from '../../../lib/governance/gov-write-funding';
  import { govWriteErrorMessage } from '../../../lib/governance/gov-write-errors';
  import { gateRequiresCaptain, type GovernancePrivilege } from '../../../lib/governance/governance-privilege';
  import { showToast } from '../../../stores/toast';

  export let open = false;
  export let onClose: () => void = () => {};
  export let network = 'sepolia';
  export let parentId = '';
  export let quartermaster = '';
  export let privilege: GovernancePrivilege;
  export let memberOptions: { address: string; label: string }[] = [];
  export let captainAddresses: string[] = [];
  export let onSubmitted: () => void = () => {};
  export let fundingHint = '';
  export let fundingMode: GovWriteFundingMode | null = null;

  const titleId = 'gov-bootstrap-crew-title';
  const descId = 'gov-bootstrap-crew-desc';

  const tFn = get(t);

  let selected = new Set<string>();
  let acting = false;
  let error = '';
  let wasOpen = false;

  $: gasLine = fundingHint.trim() || govWriteFundingFallbackHint();

  $: captainSet = new Set(
    [...captainAddresses, privilege?.myAddress ?? '']
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  );
  $: eligible = memberOptions.filter((m) => {
    const addr = m.address.trim().toLowerCase();
    return addr && !captainSet.has(addr);
  });
  $: captainGate = gateRequiresCaptain(privilege);
  $: allSelected = eligible.length > 0 && eligible.every((m) => selected.has(m.address.trim().toLowerCase()));

  $: if (open && !wasOpen) {
    wasOpen = true;
    selected = new Set(eligible.map((m) => m.address.trim().toLowerCase()));
    error = '';
  }
  $: if (!open) {
    wasOpen = false;
  }

  function toggle(addr: string) {
    const key = addr.trim().toLowerCase();
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
  }

  function toggleAll() {
    if (allSelected) {
      selected = new Set();
    } else {
      selected = new Set(eligible.map((m) => m.address.trim().toLowerCase()));
    }
  }

  async function submit() {
    if (acting || !captainGate.enabled) return;
    const candidates = eligible
      .map((m) => m.address.trim())
      .filter((addr) => selected.has(addr.toLowerCase()));
    if (candidates.length === 0) {
      error = tFn('governance.bootstrapCrew.error.noMember');
      return;
    }
    acting = true;
    error = '';
    try {
      const result = await quartermasterBootstrapCrew({
        network,
        parentId,
        quartermaster,
        candidates,
      });
      const count = candidates.length;
      const fundedBy = fundedByFromWriteResult(result);
      const toastKey =
        fundedBy === 'sponsored'
          ? 'governance.bootstrapCrew.toast.submittedSponsored'
          : fundedBy === 'self_funded'
            ? 'governance.bootstrapCrew.toast.submittedSelfFunded'
            : 'governance.bootstrapCrew.toast.submitted';
      showToast(tFn(toastKey, { values: { count } }));
      onSubmitted();
      onClose();
    } catch (e) {
      error = govWriteErrorMessage(e, tFn('governance.bootstrapCrew.toast.error'));
    } finally {
      acting = false;
    }
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={onClose} dismissible={!acting} contentClass="bootstrap-crew-modal">
    <h2 id={titleId} class="modal-title">{$t('governance.bootstrapCrew.title')}</h2>
    <p id={descId} class="modal-lead muted">
      {$t('governance.bootstrapCrew.description', { values: { gasLine } })}
    </p>

    {#if eligible.length === 0}
      <p class="muted">{$t('governance.bootstrapCrew.empty')}</p>
    {:else}
      <div class="select-row">
        <button type="button" class="btn-link" disabled={acting} on:click={toggleAll}>
          {allSelected ? $t('governance.common.clearSelection') : $t('governance.common.selectAll')}
        </button>
        <span class="muted tiny">{$t('governance.bootstrapCrew.selectCount', { values: { selected: selected.size, total: eligible.length } })}</span>
      </div>
      <ul class="member-list" role="list">
        {#each eligible as member (member.address)}
          {@const key = member.address.trim().toLowerCase()}
          <li class="member-row">
            <label class="member-label">
              <input
                type="checkbox"
                checked={selected.has(key)}
                disabled={acting}
                on:change={() => toggle(member.address)}
              />
              <span class="member-name">{member.label}</span>
              <code class="member-addr">{member.address}</code>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    {#if !captainGate.enabled}
      <p class="err">{$t(captainGate.reason)}</p>
    {/if}
    {#if error}
      <p class="err" role="alert">{error}</p>
    {/if}

    <div class="modal-actions">
      <button type="button" class="btn-secondary" disabled={acting} on:click={onClose}>{$t('governance.common.cancel')}</button>
      <button
        type="button"
        class="btn-primary"
        disabled={acting || !captainGate.enabled || selected.size === 0}
        on:click={submit}
      >
        {acting ? $t('governance.common.submitting') : $t('governance.bootstrapCrew.action')}
      </button>
    </div>
  </Modal>
{/if}

<style>
  :global(.bootstrap-crew-modal) {
    max-width: 32rem;
  }
  .modal-title {
    margin: 0 0 8px;
    font-size: 1.0625rem;
    font-weight: 600;
  }
  .modal-lead {
    margin: 0 0 12px;
    font-size: 0.8125rem;
    line-height: 1.45;
  }
  .select-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .member-list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 16rem;
    overflow: auto;
  }
  .member-row {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 8px 10px;
    background: var(--bg-elevated);
  }
  .member-label {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    align-items: center;
    cursor: pointer;
  }
  .member-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  .member-addr {
    grid-column: 2;
    font-size: 0.75rem;
    word-break: break-all;
    color: var(--text-muted);
  }
  .modal-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
  }
  .muted {
    color: var(--text-muted);
  }
  .tiny {
    font-size: 0.75rem;
  }
  .err {
    margin: 0 0 8px;
    font-size: 0.8125rem;
    color: var(--danger, #e53e3e);
  }
  .btn-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--brand);
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .btn-link:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .btn-primary,
  .btn-secondary {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .btn-primary {
    background: var(--brand);
    color: var(--on-brand);
    border: none;
  }
  .btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
