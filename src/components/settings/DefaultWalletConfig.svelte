<script lang="ts">
  import { onMount } from 'svelte';
  import {
    listPreferredNetworkOptions,
    loadPreferredNetwork,
    savePreferredNetwork,
    getPreferredNetworkDisplayName,
    walletPreferredNetworkTick,
    type PreferredNetworkId,
  } from '../../lib/wallet/preferred-network';
  import {
    setActiveEvmAccount,
    setDefaultSharedEvmAccount,
    type EvmAccountRow,
  } from '../../lib/wallet/evm-accounts';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { portal } from '../../lib/utils/portal';
  import { settingsSectionCollapsed } from '../../lib/settings/settings-section-collapse';
  import { showToast } from '../../stores/toast';
  import EditIconButton from '../ui/EditIconButton.svelte';

  export let accountNpub: string;
  export let squadAccounts: EvmAccountRow[] = [];
  export let accountsLoading = false;
  export let onSaved: () => void | Promise<void> = () => {};

  let preferredNetwork: PreferredNetworkId = 'arbitrum';
  let editOpen = false;
  let saving = false;

  let editNetwork: PreferredNetworkId = 'arbitrum';
  let editSignerId = '';
  let editReceiverId = '';

  const networkOptions = listPreferredNetworkOptions();

  $: activeSigner = squadAccounts.find((a) => a.isActive) ?? null;
  $: activeReceiver = squadAccounts.find((a) => a.isDefaultShared) ?? null;
  $: signerAddress = activeSigner?.address?.trim() || null;
  $: receiverAddress = activeReceiver?.address?.trim() || signerAddress || null;
  $: preferredNetworkLabel = getPreferredNetworkDisplayName(preferredNetwork);

  $: accountNpub, $walletPreferredNetworkTick, syncPreferredNetwork();

  $: if (($settingsSectionCollapsed['settings-evm'] ?? true) && editOpen && !saving) {
    editOpen = false;
  }

  onMount(syncPreferredNetwork);

  function syncPreferredNetwork() {
    if (!accountNpub) return;
    preferredNetwork = loadPreferredNetwork(accountNpub);
  }

  function shortAddr(a: string | null): string {
    if (!a) return 'Not set';
    const t = a.trim();
    if (t.length < 18) return t;
    return `${t.slice(0, 10)}…${t.slice(-8)}`;
  }

  function openEdit() {
    editNetwork = preferredNetwork;
    editSignerId = activeSigner?.id ?? squadAccounts[0]?.id ?? '';
    editReceiverId = activeReceiver?.id ?? activeSigner?.id ?? squadAccounts[0]?.id ?? '';
    editOpen = true;
  }

  function closeEdit() {
    if (saving) return;
    editOpen = false;
  }

  async function saveEdit() {
    if (saving || !accountNpub) return;
    if (!editSignerId || !editReceiverId) {
      showToast('Choose a signer and receiver from your squad accounts.');
      return;
    }

    saving = true;
    let receiverChanged = false;
    try {
      if (editNetwork !== preferredNetwork) {
        savePreferredNetwork(accountNpub, editNetwork);
        preferredNetwork = editNetwork;
      }
      if (editSignerId !== activeSigner?.id) {
        await setActiveEvmAccount(editSignerId);
      }
      if (editReceiverId !== activeReceiver?.id) {
        await setDefaultSharedEvmAccount(editReceiverId);
        receiverChanged = true;
      }
      editOpen = false;
      await onSaved();
      showToast(
        receiverChanged
          ? 'Receiving address saved. Publishing profile metadata…'
          : 'Wallet config saved.',
      );
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Could not save wallet config.'));
    } finally {
      saving = false;
    }
  }

  function accountOptionLabel(acc: EvmAccountRow): string {
    const parts: string[] = [shortAddr(acc.address)];
    if (acc.label?.trim()) parts.push(acc.label.trim());
    if (acc.hdIndex != null) parts.push(`#${acc.hdIndex}`);
    return parts.join(' · ');
  }
</script>

<section class="dwc" aria-labelledby="wallet-default-evm-heading">
  <h2 id="wallet-default-evm-heading" class="dwc-title">Default EVM account</h2>

  <p class="dwc-hint">
    Preferred network, default signing address, and published receiving address for DMs, profile, and squad operations.
  </p>

  <div class="dwc-summary">
    <dl class="dwc-summary-list">
      <div class="dwc-summary-row">
        <dt>Preferred network</dt>
        <dd>{preferredNetworkLabel}</dd>
      </div>
      <div class="dwc-summary-row">
        <dt>Signer</dt>
        <dd><code>{shortAddr(signerAddress)}</code></dd>
      </div>
      <div class="dwc-summary-row">
        <dt>Receiver</dt>
        <dd><code>{shortAddr(receiverAddress)}</code></dd>
      </div>
    </dl>
    <EditIconButton
      disabled={accountsLoading || squadAccounts.length === 0}
      ariaLabel="Edit default EVM account"
      title="Edit default EVM account"
      className="dwc-summary-edit"
      on:click={openEdit}
    />
  </div>

  {#if squadAccounts.length === 0 && !accountsLoading}
    <p class="dwc-hint dwc-hint-tight">Add a squad EVM account below before editing defaults.</p>
  {/if}
</section>

{#if editOpen}
  <div use:portal>
  <div class="dwc-modal-backdrop" role="presentation" on:click={closeEdit}></div>
  <div class="dwc-modal" role="dialog" aria-labelledby="wallet-default-evm-edit-title" aria-modal="true">
    <h2 id="wallet-default-evm-edit-title" class="dwc-title">Edit default EVM account</h2>
    <p class="dwc-hint">Only derived squad accounts can be signer or receiver.</p>

    <label class="dwc-label" for="wallet-default-network">Preferred network</label>
    <select
      id="wallet-default-network"
      class="dwc-input"
      bind:value={editNetwork}
      disabled={saving}
    >
      {#each networkOptions as opt (opt.id)}
        <option value={opt.id}>{opt.label}</option>
      {/each}
    </select>

    <label class="dwc-label" for="wallet-default-signer">Signer</label>
    <select
      id="wallet-default-signer"
      class="dwc-input"
      bind:value={editSignerId}
      disabled={saving || squadAccounts.length === 0}
    >
      {#each squadAccounts as acc (acc.id)}
        <option value={acc.id}>{accountOptionLabel(acc)}</option>
      {/each}
    </select>

    <label class="dwc-label" for="wallet-default-receiver">Receiver</label>
    <select
      id="wallet-default-receiver"
      class="dwc-input"
      bind:value={editReceiverId}
      disabled={saving || squadAccounts.length === 0}
    >
      {#each squadAccounts as acc (acc.id)}
        <option value={acc.id}>{accountOptionLabel(acc)}</option>
      {/each}
    </select>

    <div class="dwc-modal-actions">
      <button type="button" class="dwc-btn dwc-btn-secondary" disabled={saving} on:click={closeEdit}>
        Cancel
      </button>
      <button type="button" class="dwc-btn" disabled={saving} on:click={saveEdit}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </div>
  </div>
{/if}

<style>
  .dwc {
    margin-bottom: 8px;
  }

  .dwc-title {
    margin: 0 0 8px;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .dwc-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .dwc-hint-tight {
    margin-top: 12px;
  }

  .dwc-summary {
    margin: 16px 0 0 0;
    padding: 16px 18px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-elevated);
    display: grid;
    grid-template-columns: minmax(120px, 34%) 1fr auto;
    column-gap: 12px;
    row-gap: 12px;
    align-items: center;
  }

  .dwc-summary-list {
    margin: 0;
    display: contents;
  }

  .dwc-summary-row {
    display: contents;
  }

  :global(.dwc-summary-edit) {
    grid-column: 3;
    grid-row: 1 / span 3;
    align-self: start;
    justify-self: end;
    width: 2rem;
    height: 2rem;
    border-color: var(--border);
    background: var(--bg-hover);
    color: var(--text-primary);
    transition: border-color 0.2s;
  }

  :global(.dwc-summary-edit:hover:not(:disabled)) {
    border-color: var(--accent);
  }

  :global(.dwc-summary-edit:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .dwc-summary-row dt {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .dwc-summary-row dd {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-primary);
    word-break: break-all;
  }

  .dwc-summary-row dd code {
    font-family: ui-monospace, 'Courier New', monospace;
    font-size: 0.875rem;
  }

  .dwc-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 0.875rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    outline: none;
  }

  .dwc-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .dwc-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .dwc-btn-secondary {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .dwc-btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dwc-label {
    display: block;
    margin: 16px 0 6px 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .dwc-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-family: inherit;
    outline: none;
  }

  .dwc-input:focus {
    border-color: var(--accent);
  }

  .dwc-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 10000;
  }

  .dwc-modal {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 10001;
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    padding: 22px 22px 18px;
    border-radius: 12px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  }

  .dwc-modal-actions {
    display: flex;
    gap: 12px;
    margin-top: 24px;
  }

  .dwc-modal-actions .dwc-btn {
    flex: 1;
    padding-top: 10px;
    padding-bottom: 10px;
  }
</style>
