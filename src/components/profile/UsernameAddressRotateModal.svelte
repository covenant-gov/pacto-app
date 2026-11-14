<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { ZERO_ADDRESS } from '../../lib/wallet/assets';
  import { requireBackupVerified } from '../../stores/backup-verification';
  import { showToast } from '../../stores/toast';
  import {
    cancelUsernameAddressTransfer,
    claimUsernameAddressTransfer,
    hasPendingUsernameTransfer,
    initiateUsernameAddressTransfer,
    usernameState,
  } from '../../stores/username';
  import Modal from '../ui/Modal.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  let newAddress = $state('');

  const busy = $derived($usernameState.busy);
  const pending = $derived($hasPendingUsernameTransfer);
  const record = $derived($usernameState.record);
  const boundAddress = $derived(record?.evmAddress?.trim() || '');
  const pendingAddress = $derived.by(() => {
    const addr = record?.pendingAddress?.trim().toLowerCase();
    if (!addr || addr === ZERO_ADDRESS.toLowerCase()) return null;
    return record?.pendingAddress?.trim() ?? null;
  });

  const titleId = 'username-address-rotate-title';
  const descId = 'username-address-rotate-desc';

  function shortAddr(addr: string): string {
    const a = addr.trim();
    if (a.length < 12) return a;
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  function isValidEvmAddress(value: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
  }

  async function onInitiate() {
    if (!requireBackupVerified()) return;
    if (!isValidEvmAddress(newAddress)) {
      showToast(get(t)('profile.username.invalidAddress'), undefined, undefined, { error: true });
      return;
    }
    try {
      const result = await initiateUsernameAddressTransfer(newAddress);
      showToast(
        get(t)('profile.username.transferSuccess', { values: { path: result.path } }),
      );
      newAddress = '';
    } catch (e) {
      showToast(getInvokeErrorMessage(e), undefined, undefined, { error: true });
    }
  }

  async function onClaimTransfer() {
    if (!requireBackupVerified()) return;
    try {
      const result = await claimUsernameAddressTransfer();
      showToast(
        get(t)('profile.username.transferSuccess', { values: { path: result.path } }),
      );
    } catch (e) {
      showToast(getInvokeErrorMessage(e), undefined, undefined, { error: true });
    }
  }

  async function onCancelTransfer() {
    if (!requireBackupVerified()) return;
    try {
      const result = await cancelUsernameAddressTransfer();
      showToast(
        get(t)('profile.username.transferSuccess', { values: { path: result.path } }),
      );
    } catch (e) {
      showToast(getInvokeErrorMessage(e), undefined, undefined, { error: true });
    }
  }

  function handleClose() {
    if (busy) return;
    newAddress = '';
    onClose();
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={handleClose} dismissible={!busy}>
    <h2 id={titleId}>{$t('profile.username.rotateTitle')}</h2>
    <p id={descId} class="rotate-desc">{$t('profile.username.rotateDesc')}</p>

    {#if boundAddress}
      <p class="rotate-meta">
        {$t('profile.username.boundEvm')}:
        <code>{shortAddr(boundAddress)}</code>
      </p>
    {/if}

    {#if pending}
      <div class="rotate-pending" role="status">
        <p class="rotate-pending-title">{$t('profile.username.pendingTransfer')}</p>
        {#if pendingAddress}
          <p class="rotate-meta">
            {$t('profile.username.pendingTo', { values: { address: shortAddr(pendingAddress) } })}
          </p>
        {/if}
        <div class="rotate-actions">
          <button type="button" class="btn-primary" disabled={busy} onclick={() => void onClaimTransfer()}>
            {busy ? $t('profile.username.working') : $t('profile.username.claimTransfer')}
          </button>
          <button type="button" class="btn-secondary" disabled={busy} onclick={() => void onCancelTransfer()}>
            {$t('profile.username.cancelTransfer')}
          </button>
        </div>
      </div>
    {:else}
      <label class="rotate-field" for="username-rotate-new-evm">
        <span>{$t('profile.username.newAddressLabel')}</span>
        <input
          id="username-rotate-new-evm"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder={$t('profile.username.newAddressPlaceholder')}
          bind:value={newAddress}
          disabled={busy}
        />
      </label>
      <div class="rotate-actions">
        <button type="button" class="btn-primary" disabled={busy} onclick={() => void onInitiate()}>
          {busy ? $t('profile.username.working') : $t('profile.username.initiateTransfer')}
        </button>
        <button type="button" class="btn-secondary" disabled={busy} onclick={handleClose}>
          {$t('profile.cancel')}
        </button>
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .rotate-desc {
    margin: 0 0 16px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .rotate-meta {
    margin: 0 0 12px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .rotate-meta code {
    font-size: 0.8125rem;
  }

  .rotate-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .rotate-field input {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    padding: 8px 10px;
    font-size: 0.9375rem;
  }

  .rotate-field input:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }

  .rotate-pending {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .rotate-pending-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--warning);
  }

  .rotate-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .btn-primary,
  .btn-secondary {
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary {
    border: none;
    background: var(--brand);
    color: var(--on-brand);
  }

  .btn-primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn-secondary {
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
