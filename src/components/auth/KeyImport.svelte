<script lang="ts">
  export let onImport: (privateKey: string) => void;
  export let onBack: () => void;
  export let isValidating: boolean = false;
  export let error: string | null = null;

  let privateKey = '';
  let localError: string | null = null;

  $: displayError = localError || error;

  function handleSubmit() {
    const trimmed = privateKey.trim();
    localError = null;
    
    if (!trimmed) {
      localError = 'Please enter your private key or recovery phrase';
      return;
    }
    
    // Check if it's a mnemonic (12 or 24 words)
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    const isMnemonic = words.length === 12 || words.length === 24;
    
    if (isMnemonic) {
      if (words.length !== 12 && words.length !== 24) {
        localError = `Invalid mnemonic: expected 12 or 24 words, got ${words.length}`;
        return;
      }
      onImport(trimmed);
    } else {
      if (!trimmed.startsWith('nsec1')) {
        localError = 'Please enter either an nsec key (starting with "nsec1") or a 12/24-word recovery phrase';
        return;
      }
      if (trimmed.length !== 63) {
        localError = `Invalid nsec key length. Expected 63 characters, got ${trimmed.length}`;
        return;
      }
      onImport(trimmed);
    }
  }

  function handlePaste(event: ClipboardEvent) {
    // Let default paste behavior work, then trim
    setTimeout(() => {
      privateKey = privateKey.trim();
    }, 0);
  }

  // Clear errors when user starts typing
  $: if (privateKey) {
    localError = null;
    if (error) {
      error = null;
    }
  }
</script>

<div class="key-import-container">
  <div class="key-import-content">
    <div class="import-header">
      <h2>Import Your Keys</h2>
      <p class="import-subtitle">
        Enter your nsec key or 12-word recovery phrase
      </p>
    </div>

    {#if displayError}
      <div class="import-error">{displayError}</div>
    {/if}

    <div class="import-form">
      <textarea
        bind:value={privateKey}
        on:paste={handlePaste}
        placeholder="nsec1... or 12-word recovery phrase"
        disabled={isValidating}
        class="key-textarea"
        rows="4"
      ></textarea>

      <div class="import-actions">
        <button
          class="btn-secondary"
          on:click={onBack}
          disabled={isValidating}
        >
          Back
        </button>
        <button
          class="btn-primary"
          on:click={handleSubmit}
          disabled={isValidating || !privateKey.trim()}
        >
          {isValidating ? 'Validating...' : 'Continue'}
        </button>
      </div>
    </div>

    <div class="import-notice">
      <p>⚠️ Your private key will be encrypted with a PIN and stored securely on this device.</p>
    </div>
  </div>
</div>

<style>
  .key-import-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100vh;
    background: var(--bg-page);
  }

  .key-import-content {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 480px;
    width: 100%;
    padding: 32px;
  }

  .import-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .import-header h2 {
    color: var(--text-primary);
    font-size: 1.75rem;
    font-weight: 600;
    margin: 0;
  }

  .import-subtitle {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
  }

  .import-error {
    color: var(--danger);
    font-size: 0.875rem;
    background: rgba(242, 63, 66, 0.1);
    padding: 12px 16px;
    border-radius: 8px;
    animation: shake 0.3s;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-10px); }
    75% { transform: translateX(10px); }
  }

  .import-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .key-textarea {
    width: 100%;
    padding: 16px;
    background: var(--border-subtle);
    border: 2px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-family: 'Courier New', monospace;
    resize: vertical;
    outline: none;
    transition: all 0.2s;
  }

  .key-textarea:focus {
    border-color: var(--accent);
    background: var(--bg-hover);
    box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.2);
  }

  .key-textarea:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .key-textarea::placeholder {
    color: var(--text-muted);
  }

  .import-actions {
    display: flex;
    gap: 12px;
  }

  .btn-primary, .btn-secondary {
    flex: 1;
    height: 48px;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    outline: none;
  }

  .btn-primary {
    background: var(--accent);
    color: #ffffff;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 4px 12px rgba(88, 101, 242, 0.4);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: transparent;
    color: var(--text-muted);
    border: 2px solid var(--border);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--border-subtle);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .import-notice {
    padding: 12px 16px;
    background: rgba(88, 101, 242, 0.1);
    border-radius: 8px;
    border-left: 3px solid var(--accent);
  }

  .import-notice p {
    color: var(--text-muted);
    font-size: 0.75rem;
    margin: 0;
    line-height: 1.5;
  }
</style>

