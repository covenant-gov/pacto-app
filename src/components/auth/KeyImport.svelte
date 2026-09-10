<script lang="ts">
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import './auth-step.css';

  let {
    onImport,
    onBack,
    isValidating = false,
    error = null,
  }: {
    onImport: (privateKey: string) => void;
    onBack: () => void;
    isValidating?: boolean;
    error?: string | null;
  } = $props();

  let privateKey = $state('');
  let localError: string | null = $state(null);

  let displayError = $derived(localError || error);

  function handleSubmit() {
    const trimmed = privateKey.trim();
    localError = null;

    if (!trimmed) {
      localError = get(t)('auth.errorMissingRecoveryPhrase');
      return;
    }

    const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
    if (words.length !== 12 && words.length !== 24) {
      localError = get(t)('auth.errorRecoveryPhraseLength', { values: { count: words.length } });
      return;
    }

    if (trimmed.startsWith('nsec1')) {
      localError = get(t)('auth.errorNsecNotAllowed');
      return;
    }

    onImport(words.join(' '));
  }

  function handlePaste(_event: ClipboardEvent) {
    // Let default paste behavior work, then trim
    setTimeout(() => {
      privateKey = privateKey.trim();
    }, 0);
  }

  // Clear errors when user starts typing
  function clearErrorsOnInput() {
    if (!privateKey) return;
    localError = null;
    if (error) {
      error = null;
    }
  }
</script>

<div class="key-import-container">
  <div class="key-import-content auth-step-column">
    <div class="import-header">
      <h2>{$t('auth.importTitle')}</h2>
      <p class="import-subtitle">
        {$t('auth.importSubtitle')}
      </p>
    </div>

    {#if displayError}
      <div class="import-error">{displayError}</div>
    {/if}

    <div class="import-form">
      <textarea
        bind:value={privateKey}
        oninput={clearErrorsOnInput}
        onpaste={handlePaste}
        placeholder={$t('auth.recoveryPhrasePlaceholder')}
        disabled={isValidating}
        class="key-textarea"
        rows="4"
      ></textarea>

      <div class="import-notice" role="note">
        <TriangleAlert class="import-notice-icon" aria-hidden="true" />
        <p>{$t('auth.recoveryPhraseNotice')}</p>
      </div>

      <div class="import-actions">
        <button
          type="button"
          class="btn-secondary"
          onclick={onBack}
          disabled={isValidating}
        >
          {$t('auth.back')}
        </button>
        <button
          type="button"
          class="btn-primary"
          onclick={handleSubmit}
          disabled={isValidating || !privateKey.trim()}
        >
          {isValidating ? $t('auth.validating') : $t('auth.continue')}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .key-import-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .key-import-content {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .import-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: center;
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
    width: 100%;
  }

  .key-textarea {
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    line-height: 1.55;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    transition:
      border-color 150ms ease,
      background-color 150ms ease,
      box-shadow 150ms ease;
  }

  .key-textarea:focus {
    border-color: color-mix(in srgb, var(--brand) 55%, var(--border-subtle));
    background: var(--bg-elevated);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent);
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
    flex-direction: row;
    gap: 12px;
    width: 100%;
  }

  .btn-primary,
  .btn-secondary {
    flex: 1;
    min-width: 0;
    width: auto;
    height: 48px;
    box-sizing: border-box;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease,
      box-shadow 150ms ease;
    outline: none;
  }

  .btn-primary:focus-visible,
  .btn-secondary:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .btn-primary {
    border: none;
    background: var(--brand);
    color: var(--on-brand);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--brand-hover);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--brand) 40%, transparent);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: color-mix(in srgb, var(--brand) 45%, var(--border-subtle));
    color: var(--text-primary);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .import-notice {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    box-sizing: border-box;
    width: 100%;
    border-radius: 8px;
    border: none;
    background: color-mix(in srgb, var(--warning) 14%, var(--bg-elevated));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warning) 22%, transparent);
    text-align: start;
  }

  .import-notice-icon {
    flex-shrink: 0;
    width: 1.125rem;
    height: 1.125rem;
    color: var(--warning);
  }

  .import-notice p {
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--text-primary);
    font-size: 0.8125rem;
    line-height: 1.5;
    text-align: start;
    text-wrap: pretty;
  }
</style>

