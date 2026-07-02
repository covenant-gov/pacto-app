<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    title?: string;
    onComplete: (pin: string) => void;
    isProcessing?: boolean;
    error?: string | null;
    onErrorClear?: () => void;
    onBack?: () => void;
  }

  let {
    title = 'Enter PIN',
    onComplete,
    isProcessing = false,
    error = null,
    onErrorClear,
    onBack,
  }: Props = $props();

  let digits = $state(['', '', '', '', '', '']);
  let inputs: (HTMLInputElement | undefined)[] = $state([]);
  let isShaking = $state(false);
  let lastClearedForError = $state<string | null>(null);

  function clearInputs() {
    digits = ['', '', '', '', '', ''];
    for (const input of inputs) {
      if (input) input.value = '';
    }
    setTimeout(() => inputs[0]?.focus(), 100);
  }

  function triggerShake() {
    isShaking = true;
    setTimeout(() => {
      isShaking = false;
    }, 500);
  }

  function trySubmit() {
    if (!digits.every((d) => d !== '') || isProcessing) return;
    lastClearedForError = null;
    if (error && onErrorClear) onErrorClear();
    onComplete(digits.join(''));
  }

  function handleInput(index: number, event: Event) {
    const target = event.target as HTMLInputElement;
    let value = target.value.replace(/[^0-9]/g, '');

    if (value.length > 1) {
      value = value.charAt(0);
    }

    digits[index] = value;
    target.value = value;

    if (value && index < 5) {
      inputs[index + 1]?.focus();
    }

    trySubmit();
  }

  function handleKeydown(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      digits[index] = '';
      if (inputs[index]) inputs[index]!.value = '';
      if (index > 0) inputs[index - 1]?.focus();
    } else if (event.key.length === 1 && !event.key.match(/^[0-9]$/)) {
      event.preventDefault();
    }
  }

  function handlePaste(event: ClipboardEvent) {
    event.preventDefault();
    const pastedData = event.clipboardData?.getData('text') || '';
    const cleaned = pastedData.replace(/[^0-9]/g, '').slice(0, 6);

    cleaned.split('').forEach((digit, i) => {
      if (i < 6) {
        digits[i] = digit;
        if (inputs[i]) inputs[i]!.value = digit;
      }
    });

    if (cleaned.length < 6) {
      inputs[cleaned.length]?.focus();
    } else {
      inputs[5]?.blur();
      trySubmit();
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
    }
  });

  $effect(() => {
    if (!error) lastClearedForError = null;
  });
</script>

<div class="pin-input-container">
  <h3 class="pin-title">{title}</h3>

  {#if error}
    <div class="pin-error" role="alert">{error}</div>
  {/if}

  <div class="pin-inputs" class:shake={isShaking}>
    {#each digits as digit, i (i)}
      <input
        bind:this={
          () => inputs[i],
          (el) => {
            inputs[i] = el;
          }
        }
        type="password"
        inputmode="numeric"
        maxlength="1"
        value={digit}
        disabled={isProcessing}
        oninput={(e) => handleInput(i, e)}
        onkeydown={(e) => handleKeydown(i, e)}
        onpaste={handlePaste}
        class="pin-digit"
        aria-label={`PIN digit ${i + 1}`}
      />
    {/each}
  </div>

  {#if isProcessing}
    <div class="pin-processing" role="status">
      <div class="spinner"></div>
      <p>Processing...</p>
    </div>
  {/if}

  {#if onBack && error}
    <button type="button" class="btn-back" onclick={onBack} disabled={isProcessing}>
      Back
    </button>
  {/if}
</div>

<style>
  .pin-input-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 32px;
  }

  .pin-title {
    color: var(--text-primary, #f2f5f9);
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    text-align: center;
  }

  .pin-error {
    color: var(--danger, #f472b6);
    font-size: 0.875rem;
    background: rgba(242, 63, 66, 0.1);
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
    gap: 12px;
  }

  .pin-inputs.shake {
    animation: shake 0.5s;
  }

  .pin-digit {
    width: 48px;
    height: 56px;
    background: var(--border-subtle, #343c4c);
    border: 2px solid var(--border, #455061);
    border-radius: 8px;
    color: var(--text-primary, #f2f5f9);
    font-size: 1.5rem;
    font-weight: 600;
    text-align: center;
    outline: none;
    transition: all 0.2s;
    box-sizing: border-box;
  }

  .pin-digit:focus {
    border-color: var(--accent, #22d3ee);
    background: var(--bg-hover, #363e4f);
    box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.2);
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
    color: var(--text-muted, #8b96a8);
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-subtle, #343c4c);
    border-top-color: var(--accent, #22d3ee);
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
    background: transparent;
    color: var(--text-muted, #8b96a8);
    border: 2px solid var(--border, #455061);
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .btn-back:hover:not(:disabled) {
    background: var(--border-subtle, #343c4c);
    border-color: var(--accent, #22d3ee);
    color: var(--text-primary, #f2f5f9);
  }

  .btn-back:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
