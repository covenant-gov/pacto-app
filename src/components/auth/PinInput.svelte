<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import './auth-step.css';

  let {
    title,
    onComplete,
    isProcessing = false,
    error = null,
    onErrorClear = undefined,
    onBack = undefined,
    pinDigitCount = 6,
  }: {
    title: string;
    onComplete: (pin: string) => void;
    isProcessing?: boolean;
    error?: string | null;
    onErrorClear?: (() => void) | undefined;
    onBack?: (() => void) | undefined;
    pinDigitCount?: number;
  } = $props();

  let digits: string[] = $state(Array(pinDigitCount).fill(''));
  let inputs: HTMLInputElement[] = $state([]);
  let isShaking = $state(false);
  let lastClearedForError: string | null = $state(null);

  function clearInputs() {
    digits = Array(pinDigitCount).fill('');
    inputs.forEach((input) => {
      if (input) input.value = '';
    });
    setTimeout(() => inputs[0]?.focus(), 100);
  }

  function triggerShake() {
    isShaking = true;
    setTimeout(() => {
      isShaking = false;
    }, 500);
  }

  function handleInput(index: number, event: Event) {
    const target = event.target as HTMLInputElement;
    let value = target.value.replace(/[^0-9]/g, '');

    if (value.length > 1) {
      value = value.charAt(0);
    }

    digits[index] = value;
    target.value = value;

    if (value && index < pinDigitCount - 1) {
      inputs[index + 1]?.focus();
    }

    if (digits.every((d) => d !== '') && !isProcessing) {
      lastClearedForError = null;
      if (error && onErrorClear) onErrorClear();
      onComplete(digits.join(''));
    }
  }

  function handleKeydown(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      digits[index] = '';
      inputs[index].value = '';
      if (index > 0) inputs[index - 1]?.focus();
    } else if (event.key.length === 1 && !event.key.match(/^[0-9]$/)) {
      event.preventDefault();
    }
  }

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    const pastedData = event.clipboardData?.getData('text') || '';
    const cleaned = pastedData.replace(/[^0-9]/g, '').slice(0, pinDigitCount);

    cleaned.split('').forEach((digit, i) => {
      if (i < pinDigitCount) {
        digits[i] = digit;
        inputs[i].value = digit;
      }
    });

    if (cleaned.length < pinDigitCount) {
      inputs[cleaned.length]?.focus();
    } else {
      inputs[pinDigitCount - 1]?.blur();
      if (digits.every((d) => d !== '') && !isProcessing) {
        onComplete(digits.join(''));
      }
    }
  }

  onMount(() => {
    inputs[0]?.focus();
  });

  $effect(() => {
    if (error && error !== lastClearedForError && digits.every((d) => d !== '')) {
      lastClearedForError = error;
      clearInputs();
      triggerShake();
    } else if (!error) {
      lastClearedForError = null;
    }
  });
</script>

<div class="pin-input-container auth-step-column">
  <h3 class="pin-title">{title}</h3>

  {#if error}
    <div class="pin-error" role="alert">{error}</div>
  {/if}

  <div class="pin-inputs" class:shake={isShaking}>
    {#each digits as digit, i (i)}
      <input
        bind:this={inputs[i]}
        type="password"
        inputmode="numeric"
        maxlength="1"
        value={digit}
        disabled={isProcessing}
        oninput={(e) => handleInput(i, e)}
        onkeydown={(e) => handleKeydown(i, e)}
        onpaste={handlePaste}
        class="pin-digit"
        aria-label={$t('auth.pinDigitAriaLabel', { values: { n: i + 1 } })}
      />
    {/each}
  </div>

  {#if isProcessing}
    <div class="pin-processing" role="status">
      <div class="spinner"></div>
      <p>{$t('auth.processing')}</p>
    </div>
  {/if}

  {#if onBack && error}
    <button type="button" class="btn-back" onclick={onBack} disabled={isProcessing}>
      {$t('auth.back')}
    </button>
  {/if}
</div>

<style>
  .pin-input-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }

  .pin-title {
    color: var(--text-primary);
    font-family: var(--font-mono-family, ui-monospace, monospace);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    margin: 0;
    text-align: center;
  }

  .pin-error {
    color: var(--danger);
    font-size: 0.875rem;
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    padding: 8px 16px;
    border-radius: 8px;
    animation: shake 0.3s;
  }

  @keyframes shake {
    0%,
    100% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(-10px);
    }
    75% {
      transform: translateX(10px);
    }
  }

  .pin-inputs {
    display: flex;
    gap: 10px;
  }

  .pin-inputs.shake {
    animation: shake 0.5s;
  }

  .pin-digit {
    width: 2.25rem;
    height: 2.5rem;
    background: color-mix(in srgb, var(--text-primary) 10%, var(--bg-panel));
    border: none;
    border-radius: 0.5rem;
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--text-primary) 62%, transparent);
    color: var(--text-primary);
    font-family: var(--font-mono-family, ui-monospace, monospace);
    font-size: 1.125rem;
    font-weight: 600;
    text-align: center;
    outline: none;
    transition:
      box-shadow 150ms ease,
      background-color 150ms ease;
    box-sizing: border-box;
  }

  .pin-digit:focus {
    box-shadow: inset 0 0 0 2px var(--brand);
    background: color-mix(in srgb, var(--text-primary) 10%, var(--bg-panel));
  }

  .pin-digit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pin-processing {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--text-muted);
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-subtle);
    border-top-color: var(--brand);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .pin-processing p {
    margin: 0;
    font-size: 0.875rem;
  }

  .btn-back {
    padding: 12px 24px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease;
    outline: none;
  }

  .btn-back:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--brand);
    color: var(--text-primary);
  }

  .btn-back:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .btn-back:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
