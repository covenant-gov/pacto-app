<script lang="ts">
  import { exportSensitiveToClipboard } from '../../lib/api/auth';
  import { listEvmAccounts } from '../../lib/wallet/evm-accounts';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { portal } from '../../lib/utils/portal';
  import { showToast } from '../../stores/toast';

  export let open = false;
  export let onClose: () => void = () => {};

  type Phase = 'confirm' | 'pin' | 'loading' | 'success' | 'error';

  let phase: Phase = 'confirm';
  let pinDigits = ['', '', '', '', '', ''];
  let pinError = '';
  let busy = false;
  let exportError = '';
  let copiedLabels: string[] = [];
  let pinInputs: HTMLInputElement[] = [];

  let wasOpen = false;

  $: {
    if (open && !wasOpen && phase === 'pin') {
      setTimeout(() => pinInputs[0]?.focus(), 100);
    }
    if (!open && wasOpen) {
      resetState();
    }
    wasOpen = open;
  }

  function resetState() {
    phase = 'confirm';
    pinDigits = ['', '', '', '', '', ''];
    pinError = '';
    busy = false;
    exportError = '';
    copiedLabels = [];
  }

  function handleClose() {
    resetState();
    onClose();
  }

  function handleConfirmContinue() {
    phase = 'pin';
    setTimeout(() => pinInputs[0]?.focus(), 100);
  }

  function handleBackToConfirm() {
    pinDigits = ['', '', '', '', '', ''];
    pinError = '';
    phase = 'confirm';
  }

  async function exportAllSequentially(pinValue: string) {
    copiedLabels = [];

    await exportSensitiveToClipboard('nostr', undefined, pinValue);
    copiedLabels = [...copiedLabels, 'Nostr private key (nsec)'];

    await exportSensitiveToClipboard('seed', undefined, pinValue);
    copiedLabels = [...copiedLabels, 'Seed phrase'];

    const accounts = (await listEvmAccounts()) ?? [];
    for (const account of accounts) {
      await exportSensitiveToClipboard('evm', account.id, pinValue);
      copiedLabels = [
        ...copiedLabels,
        account.label?.trim() ? `${account.label.trim()} (${account.address})` : account.address,
      ];
    }
  }

  async function handlePinSubmit() {
    if (busy) return;
    const pinValue = pinDigits.join('');
    if (pinValue.length !== 6) {
      pinError = 'PIN must be 6 digits';
      return;
    }

    busy = true;
    pinError = '';
    exportError = '';
    phase = 'loading';
    try {
      await exportAllSequentially(pinValue);
      phase = 'success';
    } catch (e) {
      exportError = getInvokeErrorMessage(e, 'Could not export all secrets.');
      pinError = 'Incorrect PIN or export failed';
      phase = 'error';
      console.error('Export all failed:', e);
      showToast(exportError);
    } finally {
      busy = false;
    }
  }

  function handlePinInput(index: number, event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    if (value && !/^\d$/.test(value)) {
      input.value = pinDigits[index];
      return;
    }
    pinDigits[index] = value;
    pinError = '';
    if (value && index < 5) pinInputs[index + 1]?.focus();
    if (pinDigits.every((d) => d !== '')) void handlePinSubmit();
  }

  function handlePinKeydown(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace') {
      if (!pinDigits[index] && index > 0) {
        pinDigits[index - 1] = '';
        pinInputs[index - 1]?.focus();
      } else {
        pinDigits[index] = '';
      }
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' && index > 0) {
      pinInputs[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < 5) {
      pinInputs[index + 1]?.focus();
    } else if (event.key === 'Enter') {
      void handlePinSubmit();
    }
  }

  function handlePinPaste(event: ClipboardEvent) {
    event.preventDefault();
    const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').split('').slice(0, 6);
    digits.forEach((digit, i) => {
      if (i < 6) pinDigits[i] = digit;
    });
    const lastIndex = Math.min(digits.length - 1, 5);
    pinInputs[lastIndex]?.focus();
    if (digits.length === 6) void handlePinSubmit();
  }

  function summaryText(): string {
    if (copiedLabels.length === 0) return 'Nothing was copied.';
    return copiedLabels.join(', ');
  }
</script>

{#if open}
  <div use:portal>
  <div
    class="modal-overlay"
    on:click={handleClose}
    on:keydown={(e) => e.key === 'Escape' && handleClose()}
    role="presentation"
  >
    <div
      class="modal-content"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && handleClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-all-title"
      tabindex="0"
    >
      {#if phase === 'confirm'}
        <h2 id="export-all-title">Export all secrets</h2>
        <p class="modal-subtitle">
          Export the Nostr private key, recovery seed phrase, and every EVM private key on this device for backup or migration.
        </p>
        <p class="modal-warning">
          Anyone with these secrets can control your account. Store them offline and never share them.
        </p>
        <p class="modal-warning clipboard-warning">
          Clipboard managers, OS clipboard history, and cross-device clipboard sync may still capture the secrets. Each secret is copied separately and the clipboard is cleared 90 seconds after the last one.
        </p>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={handleClose}>Cancel</button>
          <button type="button" class="btn-confirm" on:click={handleConfirmContinue}>Continue</button>
        </div>
      {:else if phase === 'pin'}
        <h2 id="export-all-title">Enter PIN</h2>
        <p class="modal-subtitle">Enter your PIN to export all account secrets for backup or migration.</p>

        {#if pinError}
          <div class="modal-error" role="alert">{pinError}</div>
        {/if}

        <div class="pin-boxes">
          {#each pinDigits as digit, i (i)}
            <input
              bind:this={pinInputs[i]}
              type="password"
              inputmode="numeric"
              maxlength="1"
              class="pin-box"
              value={digit}
              disabled={busy}
              aria-label="PIN digit {i + 1}"
              on:input={(e) => handlePinInput(i, e)}
              on:keydown={(e) => handlePinKeydown(i, e)}
              on:paste={handlePinPaste}
            />
          {/each}
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={handleBackToConfirm}>Back</button>
          <button
            type="button"
            class="btn-confirm"
            on:click={handlePinSubmit}
            disabled={busy || pinDigits.some((d) => d === '')}
          >
            {busy ? 'Verifying…' : 'Continue'}
          </button>
        </div>
      {:else if phase === 'loading'}
        <h2 id="export-all-title">Exporting secrets</h2>
        <p class="modal-subtitle">Copying secrets to the clipboard one at a time…</p>
        <div class="modal-loading" aria-busy="true" aria-live="polite">
          <span class="loading-spinner" aria-hidden="true"></span>
        </div>
      {:else if phase === 'success'}
        <h2 id="export-all-title">Copied to clipboard</h2>
        <p class="modal-subtitle">The following secrets were copied to your system clipboard:</p>
        <p class="modal-success">{summaryText()}</p>
        <p class="modal-success">
          The clipboard will be cleared 90 seconds after the last secret was copied. Paste each one into a secure destination now.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn-close" on:click={handleClose}>Close</button>
        </div>
      {:else if phase === 'error'}
        <h2 id="export-all-title">Export failed</h2>
        <p class="modal-subtitle">Could not copy all secrets to the clipboard.</p>
        {#if exportError}
          <div class="modal-error" role="alert">{exportError}</div>
        {/if}
        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={handleBackToConfirm}>Try again</button>
          <button type="button" class="btn-close" on:click={handleClose}>Close</button>
        </div>
      {/if}
    </div>
  </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    backdrop-filter: blur(4px);
  }

  .modal-content {
    background: var(--bg-elevated);
    border-radius: 12px;
    padding: 28px;
    max-width: 640px;
    width: 90%;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .modal-content h2 {
    margin: 0 0 8px;
    font-size: 1.375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .modal-subtitle {
    margin: 0 0 20px;
    color: var(--text-muted);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .modal-warning {
    margin: 0 0 12px 0;
    padding: 12px 14px;
    border-radius: 8px;
    border-left: 3px solid var(--warning);
    background: rgba(250, 166, 26, 0.1);
    color: var(--warning);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .clipboard-warning {
    border-left-color: var(--danger);
    background: rgba(242, 63, 66, 0.08);
  }

  .modal-success {
    margin: 0 0 12px 0;
    padding: 12px 14px;
    border-radius: 8px;
    border-left: 3px solid var(--success);
    background: rgba(35, 197, 94, 0.1);
    color: var(--success);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .modal-error {
    margin: 0 0 16px 0;
    padding: 12px 14px;
    border-radius: 8px;
    background: rgba(242, 63, 66, 0.1);
    color: var(--danger);
    font-size: 0.875rem;
  }

  .modal-loading {
    display: flex;
    justify-content: center;
    padding: 24px 0;
  }

  .loading-spinner {
    display: inline-block;
    width: 28px;
    height: 28px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .pin-boxes {
    display: flex;
    gap: 10px;
    justify-content: center;
    margin-bottom: 20px;
  }

  .pin-box {
    width: 52px;
    height: 60px;
    padding: 0;
    border: 2px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 1.5rem;
    text-align: center;
    outline: none;
  }

  .pin-box:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.2);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 24px;
  }

  .btn-cancel,
  .btn-close,
  .btn-confirm {
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .btn-cancel,
  .btn-close {
    background: var(--bg-panel);
    color: var(--text-primary);
    border-color: var(--border);
  }

  .btn-confirm {
    background: var(--accent);
    color: white;
  }

  .btn-confirm:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
