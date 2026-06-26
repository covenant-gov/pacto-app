<script lang="ts">
  import { loadAndDecryptKey } from '../../lib/api/encryption';
  import { exportEvmAccountKeyPlaintext, exportRecoveryPhrase } from '../../lib/api/auth';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';
  import { evmAccountSchemeLabel, type EvmAccountRow } from '../../lib/wallet/evm-accounts';
  import { portal } from '../../lib/utils/portal';
  import { showToast } from '../../stores/toast';

  export let open = false;
  /** `evm` | `nostr` | `seed` (BIP-39 recovery phrase). */
  export let variant: 'evm' | 'nostr' | 'seed' = 'evm';
  export let account: EvmAccountRow | null = null;
  /** Shown in PIN step when `variant` is `nostr`. */
  export let npub = '';
  export let onClose: () => void = () => {};

  type Phase = 'pin' | 'key';

  let phase: Phase = 'pin';
  let pinDigits = ['', '', '', '', '', ''];
  let pinError = '';
  let busy = false;
  let privateKey = '';
  let revealed = false;
  let copied = false;
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
    phase = 'pin';
    pinDigits = ['', '', '', '', '', ''];
    pinError = '';
    busy = false;
    privateKey = '';
    revealed = false;
    copied = false;
  }

  function handleClose() {
    resetState();
    onClose();
  }

  async function handlePinSubmit() {
    if (busy) return;
    if (variant === 'evm' && !account) return;
    const pinValue = pinDigits.join('');
    if (pinValue.length !== 6) {
      pinError = 'PIN must be 6 digits';
      return;
    }

    busy = true;
    pinError = '';
    try {
      if (variant === 'nostr') {
        privateKey = await loadAndDecryptKey(pinValue);
      } else if (variant === 'seed') {
        await loadAndDecryptKey(pinValue);
        privateKey = await exportRecoveryPhrase();
      } else {
        await loadAndDecryptKey(pinValue);
        privateKey = await exportEvmAccountKeyPlaintext(account!.id);
      }
      revealed = false;
      copied = false;
      phase = 'key';
    } catch (e) {
      pinError = 'Incorrect PIN or export failed';
      console.error('Key export failed:', e);
      showToast(
        getInvokeErrorMessage(
          e,
          variant === 'nostr'
            ? 'Could not export nsec.'
            : variant === 'seed'
              ? 'Could not export seed phrase.'
              : 'Could not export private key.'
        )
      );
      pinDigits = ['', '', '', '', '', ''];
      setTimeout(() => pinInputs[0]?.focus(), 100);
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

  async function copyPrivateKey() {
    if (!privateKey) return;
    const ok = await copyTextToClipboard(privateKey);
    if (ok) {
      copied = true;
      showToast(
        variant === 'nostr'
          ? 'nsec copied'
          : variant === 'seed'
            ? 'Seed phrase copied'
            : 'Private key copied'
      );
      setTimeout(() => {
        copied = false;
      }, 2000);
    } else {
      showToast(
        variant === 'nostr'
          ? 'Could not copy nsec'
          : variant === 'seed'
            ? 'Could not copy seed phrase'
            : 'Could not copy private key'
      );
    }
  }
</script>

{#if open && (variant === 'nostr' || variant === 'seed' || account)}
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
      aria-labelledby="evm-export-modal-title"
      tabindex="0"
    >
      {#if phase === 'pin'}
        <h2 id="evm-export-modal-title">Enter PIN</h2>
        <p class="modal-subtitle">
          {#if variant === 'nostr'}
            Enter your PIN to export the nsec private key for
            <code class="modal-addr">{npub || 'this account'}</code>.
          {:else if variant === 'seed'}
            Enter your PIN to export the recovery seed phrase for this account.
          {:else}
            Enter your PIN to export the private key for
            <code class="modal-addr">{account?.address}</code>
            ({evmAccountSchemeLabel(account!.scheme)}).
          {/if}
        </p>

        {#if pinError}
          <div class="modal-error" role="alert">{pinError}</div>
        {/if}

        <div class="pin-boxes">
          {#each pinDigits as digit, i}
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
          <button type="button" class="btn-cancel" on:click={handleClose} disabled={busy}>Cancel</button>
          <button
            type="button"
            class="btn-confirm"
            on:click={handlePinSubmit}
            disabled={busy || pinDigits.some((d) => d === '')}
          >
            {busy ? 'Verifying…' : 'Continue'}
          </button>
        </div>
      {:else}
        <h2 id="evm-export-modal-title">
          {variant === 'nostr' ? 'Export nsec' : variant === 'seed' ? 'Export seed phrase' : 'Export private key'}
        </h2>
        <p class="modal-subtitle">
          {#if variant === 'nostr'}
            Nostr private key (nsec) for this account.
          {:else if variant === 'seed'}
            BIP-39 recovery phrase — use on another device to restore this account.
          {:else}
            {account?.label?.trim() || account?.address}
            {#if account?.hdIndex != null}
              · Derived #{account.hdIndex}
            {/if}
          {/if}
        </p>
        <p class="modal-warning">
          {#if variant === 'nostr'}
            Anyone with this nsec controls your Nostr identity and linked Pacto account. Store it offline and never share it.
          {:else if variant === 'seed'}
            Anyone with this seed phrase can restore your full account on another device. Write it down offline and never share it.
          {:else}
            Anyone with this key controls the account. Store it offline and never share it.
          {/if}
        </p>

        <div class="secret-value-shell">
          <div class="secret-value-main">
            {#if revealed}
              <span class="secret-plain" class:secret-plain-seed={variant === 'seed'}>{privateKey}</span>
            {:else}
              <span class="secret-mask" aria-hidden="true">•••••••••••••••••••••••••••••••••</span>
            {/if}
          </div>
          <div class="secret-toolbar">
            <button
              type="button"
              class="btn-reveal-secret"
              aria-pressed={revealed}
              aria-label={revealed
                ? variant === 'nostr'
                  ? 'Hide nsec'
                  : variant === 'seed'
                    ? 'Hide seed phrase'
                    : 'Hide private key'
                : variant === 'nostr'
                  ? 'Reveal nsec'
                  : variant === 'seed'
                    ? 'Reveal seed phrase'
                    : 'Reveal private key'}
              title={revealed ? 'Hide' : 'Reveal'}
              on:click={() => (revealed = !revealed)}
            >
              {#if revealed}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="reveal-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="reveal-icon" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              {/if}
            </button>
            <button
              type="button"
              class="btn-copy"
              aria-label={copied ? 'Copied' : 'Copy to clipboard'}
              title={copied ? 'Copied' : 'Copy'}
              on:click={copyPrivateKey}
            >
              <svg
                class="copy-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          </div>
        </div>

        <div class="modal-actions">
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
    max-width: 560px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .modal-content h2 {
    margin: 0 0 8px 0;
    font-size: 1.375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .modal-subtitle {
    margin: 0 0 20px 0;
    color: var(--text-muted);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .modal-addr {
    font-size: 0.8125rem;
    word-break: break-all;
  }

  .modal-warning {
    margin: 0 0 16px 0;
    padding: 12px 14px;
    border-radius: 8px;
    border-left: 3px solid var(--warning);
    background: rgba(250, 166, 26, 0.1);
    color: var(--warning);
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
  }

  .secret-value-shell {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 12px;
    justify-content: space-between;
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }

  .secret-value-main {
    flex: 1;
    min-width: 140px;
  }

  .secret-plain {
    color: var(--text-secondary);
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    word-break: break-all;
  }

  .secret-plain-seed {
    font-family: inherit;
    font-size: 0.9375rem;
    line-height: 1.55;
    word-break: normal;
  }

  .secret-mask {
    color: var(--text-muted);
    letter-spacing: 0.04em;
    user-select: none;
  }

  .secret-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .btn-reveal-secret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    cursor: pointer;
  }

  .btn-reveal-secret[aria-pressed='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }

  .reveal-icon {
    width: 1.15rem;
    height: 1.15rem;
  }

  .btn-copy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .btn-copy:hover {
    border-color: var(--accent);
  }

  .copy-icon {
    width: 1.15rem;
    height: 1.15rem;
  }
</style>
