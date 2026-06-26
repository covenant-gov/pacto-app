<script lang="ts">
  import { onMount } from 'svelte';

  export let title: string = "Enter PIN";
  export let onComplete: (pin: string) => void;
  export let isProcessing: boolean = false;
  export let error: string | null = null;
  export let onErrorClear: (() => void) | undefined = undefined;
  export let onBack: (() => void) | undefined = undefined;

  let digits: string[] = ['', '', '', '', '', ''];
  let inputs: HTMLInputElement[] = [];
  let isShaking = false;
  let lastClearedForError: string | null = null;

  function clearInputs() {
    digits = ['', '', '', '', '', ''];
    inputs.forEach(input => {
      if (input) input.value = '';
    });
    // Focus first input after clearing
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
    let value = target.value.replace(/[^0-9]/g, ''); // Only digits

    if (value.length > 1) {
      value = value.charAt(0); // Take first digit if multiple pasted
    }

    digits[index] = value;
    target.value = value;

    // Auto-advance to next input
    if (value && index < 5) {
      inputs[index + 1]?.focus();
    }

    // Check if all digits filled
    if (digits.every(d => d !== '') && !isProcessing) {
      const pin = digits.join('');
      // Reset the clear tracking so next error will trigger clear
      lastClearedForError = null;
      // Clear any previous error when submitting new PIN
      if (error && onErrorClear) {
        onErrorClear();
      }
      onComplete(pin);
    }
  }

  function handleKeydown(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace') {
      event.preventDefault();
      
      // Clear current and move to previous
      digits[index] = '';
      inputs[index].value = '';
      
      if (index > 0) {
        inputs[index - 1]?.focus();
      }
    } else if (event.key.length === 1 && !event.key.match(/^[0-9]$/)) {
      // Block non-numeric single characters
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
        inputs[i].value = digit;
      }
    });

    // Focus appropriate input
    if (cleaned.length < 6) {
      inputs[cleaned.length]?.focus();
    } else {
      inputs[5]?.blur();
      // Auto-submit if all filled
      if (digits.every(d => d !== '') && !isProcessing) {
        onComplete(digits.join(''));
      }
    }
  }

  onMount(() => {
    // Auto-focus first input
    inputs[0]?.focus();
  });

  // Watch for errors - clear inputs when error appears after PIN submission
  // Only clear once per error to avoid clearing while user is typing
  $: if (error && error !== lastClearedForError && digits.every(d => d !== '')) {
    lastClearedForError = error;
    clearInputs();
    triggerShake();
  }

  // Reset tracking when error is cleared
  $: if (!error) {
    lastClearedForError = null;
  }
</script>

<div class="pin-input-container">
  <h3 class="pin-title">{title}</h3>

  {#if error}
    <div class="pin-error">{error}</div>
  {/if}

  <div class="pin-inputs" class:shake={isShaking}>
    {#each digits as digit, i}
      <input
        bind:this={inputs[i]}
        type="password"
        inputmode="numeric"
        maxlength="1"
        value={digit}
        disabled={isProcessing}
        on:input={(e) => handleInput(i, e)}
        on:keydown={(e) => handleKeydown(i, e)}
        on:paste={handlePaste}
        class="pin-digit"
        aria-label={`PIN digit ${i + 1}`}
      />
    {/each}
  </div>

  {#if isProcessing}
    <div class="pin-processing">
      <div class="spinner"></div>
      <p>Processing...</p>
    </div>
  {/if}

  {#if onBack && error}
    <button
      class="btn-back"
      on:click={onBack}
      disabled={isProcessing}
    >
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
    color: var(--text-primary);
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    text-align: center;
  }

  .pin-error {
    color: var(--danger);
    font-size: 0.875rem;
    background: rgba(242, 63, 66, 0.1);
    padding: 8px 16px;
    border-radius: 8px;
    animation: shake 0.3s;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-10px); }
    75% { transform: translateX(10px); }
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
    background: var(--border-subtle);
    border: 2px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 600;
    text-align: center;
    outline: none;
    transition: all 0.2s;
  }

  .pin-digit:focus {
    border-color: var(--accent);
    background: var(--bg-hover);
    box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.2);
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
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .pin-processing p {
    margin: 0;
    font-size: 0.875rem;
  }

  .btn-back {
    padding: 12px 24px;
    background: transparent;
    color: var(--text-muted);
    border: 2px solid var(--border);
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .btn-back:hover:not(:disabled) {
    background: var(--border-subtle);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .btn-back:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

