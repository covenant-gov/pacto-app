<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { exportSensitiveToClipboard } from '../../lib/api/auth';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { evmAccountSchemeLabel, type EvmAccountRow } from '../../lib/wallet/evm-accounts';
  import { portal } from '../../lib/utils/portal';
  import { showToast } from '../../stores/toast';
  import { appConfig } from '../../stores/app-config';

  export let open = false;
  /** `evm` | `nostr` | `seed` (BIP-39 recovery phrase). */
  export let variant: 'evm' | 'nostr' | 'seed' = 'evm';
  export let account: EvmAccountRow | null = null;
  /** Shown when `variant` is `nostr`. */
  export let npub = '';
  export let onClose: () => void = () => {};

  const tFn = get(t);

  type Phase = 'confirm' | 'pin' | 'loading' | 'success' | 'error';

  let phase: Phase = 'confirm';
  let pinDigits = Array(6).fill('');
  let pinError = '';
  let busy = false;
  let exportError = '';
  let pinInputs: HTMLInputElement[] = [];

  let wasOpen = false;

  $: pinDigitCount = $appConfig.pinDigitCount;
  $: if (pinDigits.length !== pinDigitCount) pinDigits = Array(pinDigitCount).fill('');

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
    pinDigits = Array(pinDigitCount).fill('');
    pinError = '';
    busy = false;
    exportError = '';
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
    pinDigits = Array(pinDigitCount).fill('');
    pinError = '';
    phase = 'confirm';
  }

  async function handlePinSubmit() {
    if (busy) return;
    if (variant === 'evm' && !account) return;
    const pinValue = pinDigits.join('');
    if (pinValue.length !== pinDigitCount) {
      pinError = tFn('auth.pinMustBeSixDigits', { values: { count: pinDigitCount } });
      return;
    }

    busy = true;
    pinError = '';
    exportError = '';
    phase = 'loading';
    try {
      await exportSensitiveToClipboard(
        variant,
        variant === 'evm' ? account!.id : undefined,
        pinValue
      );
      phase = 'success';
    } catch (e) {
      exportError = getInvokeErrorMessage(
        e,
        variant === 'nostr'
          ? tFn('export.error.couldNotExportNsec')
          : variant === 'seed'
            ? tFn('export.error.couldNotExportSeedPhrase')
            : tFn('export.error.couldNotExportPrivateKey')
      );
      pinError = tFn('auth.incorrectPinOrExportFailed');
      phase = 'error';
      console.error('Key export failed:', e);
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
    if (value && index < pinDigitCount - 1) pinInputs[index + 1]?.focus();
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
    } else if (event.key === 'ArrowRight' && index < pinDigitCount - 1) {
      pinInputs[index + 1]?.focus();
    } else if (event.key === 'Enter') {
      void handlePinSubmit();
    }
  }

  function handlePinPaste(event: ClipboardEvent) {
    event.preventDefault();
    const digits = (event.clipboardData?.getData('text') || '')
      .replace(/\D/g, '')
      .split('')
      .slice(0, pinDigitCount);
    digits.forEach((digit, i) => {
      if (i < pinDigitCount) pinDigits[i] = digit;
    });
    const lastIndex = Math.min(digits.length - 1, pinDigitCount - 1);
    pinInputs[lastIndex]?.focus();
    if (digits.length === pinDigitCount) void handlePinSubmit();
  }

  function confirmTitle(): string {
    return variant === 'nostr'
      ? tFn('export.modal.title.nsec')
      : variant === 'seed'
        ? tFn('export.modal.title.seed')
        : tFn('export.modal.title.privateKey');
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
      {#if phase === 'confirm'}
        <h2 id="evm-export-modal-title">{confirmTitle()}</h2>
        <p class="modal-subtitle">
          {#if variant === 'nostr'}
            {$t('export.modal.subtitle.nsec')}
          {:else if variant === 'seed'}
            {$t('export.modal.subtitle.seed')}
          {:else}
            {account?.label?.trim() || account?.address}
            {#if account?.hdIndex != null}
              {$t('export.modal.subtitle.derived', { values: { hdIndex: account.hdIndex } })}
            {/if}
          {/if}
        </p>
        <p class="modal-warning">
          {#if variant === 'nostr'}
            {$t('export.modal.warning.nsec')}
          {:else if variant === 'seed'}
            {$t('export.modal.warning.seed')}
          {:else}
            {$t('export.modal.warning.privateKey')}
          {/if}
        </p>
        <p class="modal-warning clipboard-warning">{$t('export.modal.warning.clipboard')}</p>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={handleClose}>{$t('settings.cancel')}</button>
          <button type="button" class="btn-confirm" on:click={handleConfirmContinue}>{$t('auth.continue')}</button>
        </div>
      {:else if phase === 'pin'}
        <h2 id="evm-export-modal-title">{$t('auth.pinEnterTitle')}</h2>
        <p class="modal-subtitle">
          {#if variant === 'nostr'}
            {$t('export.modal.pinSubtitle.nsec', { values: { account: npub || tFn('export.modal.fallback.thisAccount') } })}
          {:else if variant === 'seed'}
            {$t('export.modal.pinSubtitle.seed')}
          {:else}
            {$t('export.modal.pinSubtitle.evm', { values: { address: account?.address, scheme: tFn(evmAccountSchemeLabel(account!.scheme)) } })}
          {/if}
        </p>

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
              aria-label={$t('auth.pinDigitAriaLabel', { values: { n: i + 1 } })}
              on:input={(e) => handlePinInput(i, e)}
              on:keydown={(e) => handlePinKeydown(i, e)}
              on:paste={handlePinPaste}
            />
          {/each}
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={handleBackToConfirm} disabled={busy}>{$t('export.modal.back')}</button>
          <button
            type="button"
            class="btn-confirm"
            on:click={handlePinSubmit}
            disabled={busy || pinDigits.some((d) => d === '')}
          >
            {busy ? $t('commons.verifying') : $t('auth.continue')}
          </button>
        </div>
      {:else if phase === 'loading'}
        <h2 id="evm-export-modal-title">{confirmTitle()}</h2>
        <p class="modal-subtitle">{$t('export.modal.loading.copying')}</p>
        <div class="modal-loading" aria-busy="true" aria-live="polite">
          <span class="loading-spinner" aria-hidden="true"></span>
        </div>
      {:else if phase === 'success'}
        <h2 id="evm-export-modal-title">{$t('export.modal.success.title')}</h2>
        <p class="modal-subtitle">{$t('export.modal.success.subtitle')}</p>
        <p class="modal-success">{$t('export.modal.success.clearedIn90')}</p>
        <div class="modal-actions">
          <button type="button" class="btn-close" on:click={handleClose}>{$t('commons.close')}</button>
        </div>
      {:else if phase === 'error'}
        <h2 id="evm-export-modal-title">{$t('export.modal.error.title')}</h2>
        <p class="modal-subtitle">{$t('export.modal.error.subtitle')}</p>
        {#if exportError}
          <div class="modal-error" role="alert">{exportError}</div>
        {/if}
        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={handleBackToConfirm}>{$t('export.modal.tryAgain')}</button>
          <button type="button" class="btn-close" on:click={handleClose}>{$t('commons.close')}</button>
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
    margin: 0 0 16px 0;
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
    border-top-color: var(--brand);
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
    border-color: var(--brand);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 20%, transparent);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
</style>
