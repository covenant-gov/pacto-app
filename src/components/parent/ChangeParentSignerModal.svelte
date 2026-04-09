<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import Modal from '../ui/Modal.svelte';
  import { currentUser } from '../../stores/auth';
  import { showToast } from '../../stores/toast';
  import {
    listEvmAccounts,
    evmAccountSchemeLabel,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import {
    publishSquadMemberEvmShare,
    listSquadMemberEvmInvokeArgs,
  } from '../../lib/squad/squad-member-evm-share';

  export let open = false;
  export let parentKind: 'squad' | 'network' = 'squad';
  export let parentName: string;
  export let parentId: string;
  export let announcementsGroupId: string;
  export let onClose: () => void;

  const titleId = 'change-signer-title';
  const descId = 'change-signer-desc';

  let loading = true;
  let saving = false;
  let error = '';
  let accounts: EvmAccountRow[] = [];
  let rosterAddressForMe: string | null = null;
  let selectedAccountId: string | null = null;

  type EvmRow = { memberNpub: string; evmAddress: string; updatedAtMs: number };

  async function load(): Promise<void> {
    loading = true;
    error = '';
    try {
      accounts = (await listEvmAccounts()) ?? [];
      const me = $currentUser?.npub;
      if (me && parentId.trim()) {
        const q = listSquadMemberEvmInvokeArgs(parentId, announcementsGroupId);
        const rows = await invoke<EvmRow[]>('list_squad_member_evm', q);
        rosterAddressForMe = rows.find((r) => r.memberNpub === me)?.evmAddress ?? null;
      } else {
        rosterAddressForMe = null;
      }
      const match = accounts.find(
        (a) => rosterAddressForMe && a.address.toLowerCase() === rosterAddressForMe.toLowerCase()
      );
      const active = accounts.find((a) => a.isActive);
      const first = accounts[0];
      selectedAccountId = match?.id ?? active?.id ?? first?.id ?? null;
    } catch (e) {
      error = 'Could not load wallet accounts.';
      accounts = [];
      selectedAccountId = null;
    } finally {
      loading = false;
    }
  }

  $: if (open) {
    void load();
  }

  async function confirm(): Promise<void> {
    const acc = accounts.find((a) => a.id === selectedAccountId);
    const addr = acc?.address?.trim();
    if (!addr || !parentId.trim() || !announcementsGroupId.trim()) {
      error = 'Select an account with an address.';
      return;
    }
    saving = true;
    error = '';
    try {
      const ok = await publishSquadMemberEvmShare(announcementsGroupId.trim(), {
        evmAddress: addr,
      });
      if (!ok) {
        error = 'Could not update signer.';
        return;
      }
      showToast(
        'Signer address updated for this ' +
          (parentKind === 'squad' ? 'squad' : 'network') +
          '. Existing Safes on-chain are unchanged—update owners separately if needed.'
      );
      onClose();
    } catch (e) {
      error = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Could not update signer.';
    } finally {
      saving = false;
    }
  }
</script>

{#if open}
<Modal
  {titleId}
  descriptionId={descId}
  {onClose}
  dismissible={!saving}
  contentClass="change-signer-modal-panel"
>
  <h2 id={titleId}>Change signer</h2>
  <p id={descId} class="change-signer-desc">
    Choose which EVM address from your wallet is stored for <strong>{parentName}</strong> and shared on #announcements.
    Deploy Safe and other flows use this roster to suggest co-owners. <strong>Updating here does not modify an already
    deployed Safe</strong>—only the lookup for this group going forward.
  </p>

  {#if loading}
    <p class="muted">Loading accounts…</p>
  {:else if accounts.length === 0}
    <p class="change-signer-warn">Add an EVM account under Settings → Wallet, then try again.</p>
  {:else}
    {#if rosterAddressForMe}
      <p class="muted change-signer-current">
        Current roster address: <code class="change-signer-code">{rosterAddressForMe}</code>
      </p>
    {/if}
    <fieldset class="change-signer-fieldset">
      <legend class="visually-hidden">EVM account</legend>
      {#each accounts as acc (acc.id)}
        <label class="change-signer-option">
          <input type="radio" name="change-signer-acct" value={acc.id} bind:group={selectedAccountId} />
          <span class="change-signer-option-body">
            <span class="change-signer-label">{acc.label || evmAccountSchemeLabel(acc.scheme)}</span>
            <code class="change-signer-code">{acc.address}</code>
            {#if acc.isActive}<span class="muted change-signer-badge">Active signer</span>{/if}
            {#if acc.isDefaultShared}<span class="muted change-signer-badge">Default shared</span>{/if}
          </span>
        </label>
      {/each}
    </fieldset>
  {/if}

  {#if error}
    <p class="change-signer-error" role="alert">{error}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose} disabled={saving}>Cancel</button>
    <button
      type="button"
      class="btn-primary"
      disabled={saving || loading || accounts.length === 0 || !selectedAccountId}
      on:click={() => void confirm()}>{saving ? 'Saving…' : 'Update signer'}</button
    >
  </div>
</Modal>
{/if}

<style>
  .change-signer-desc {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0 0 16px 0;
    line-height: 1.45;
  }

  .change-signer-desc strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .change-signer-current {
    font-size: 0.8125rem;
    margin: 0 0 12px 0;
  }

  .change-signer-fieldset {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 8px;
    margin: 0 0 12px 0;
    max-height: 240px;
    overflow-y: auto;
  }

  .change-signer-option {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 6px;
    cursor: pointer;
    border-radius: 6px;
  }

  .change-signer-option:hover {
    background: var(--bg-hover);
  }

  .change-signer-option-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .change-signer-label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .change-signer-code {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    word-break: break-all;
    color: var(--text-secondary);
  }

  .change-signer-badge {
    font-size: 0.6875rem;
  }

  .change-signer-warn {
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin: 0 0 12px 0;
  }

  .change-signer-error {
    color: var(--danger, #e85d5d);
    font-size: 0.8125rem;
    margin: 8px 0 0 0;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }

  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover, var(--accent));
  }

  .btn-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  :global(.change-signer-modal-panel) {
    max-width: 480px;
  }
</style>
