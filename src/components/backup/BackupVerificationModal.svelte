<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import { exportRecoveryPhrase } from '../../lib/api/auth';
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import { createChallenge, checkChallenge } from '../../lib/utils/seed-verification';
  import type { SeedChallenge } from '../../lib/utils/seed-verification';
  import { markBackupVerified, backupVerificationModalOpen } from '../../stores/backup-verification';

  export let open = false;
  export let onClose: () => void = () => {};

  type Phase = 'show' | 'confirm' | 'quiz' | 'success';

  const titleId = 'backup-verification-title';
  const descId = 'backup-verification-desc';
  const MAX_ATTEMPTS = 3;
  const tFn = get(t);

  let phase: Phase = 'show';
  let seed = '';
  let seedWords: string[] = [];
  let revealed = false;
  let copied = false;
  let writtenDown = false;
  let challenge: SeedChallenge = { positions: [], answers: [] };
  let inputs: string[] = [];
  let attempts = 0;
  let quizError = '';
  let busy = false;
  let loadError = '';
  let inputEls: HTMLInputElement[] = [];

  function resetState(): void {
    phase = 'show';
    seed = '';
    seedWords = [];
    revealed = false;
    copied = false;
    writtenDown = false;
    attempts = 0;
    quizError = '';
    loadError = '';
    challenge = { positions: [], answers: [] };
    inputs = [];
  }

  function handleClose(): void {
    resetState();
    onClose();
  }

  async function loadSeed(): Promise<void> {
    if (seedWords.length > 0) return;
    busy = true;
    loadError = '';
    try {
      const raw = await exportRecoveryPhrase();
      seed = raw;
      seedWords = raw.trim().split(/\s+/);
      if (seedWords.length !== 12 && seedWords.length !== 24) {
        throw new Error(tFn('backup.error.seedPhraseLength'));
      }
      challenge = seedWords.length >= 3 ? createChallenge(seedWords, 3) : { positions: [], answers: [] };
      inputs = new Array(challenge.positions.length).fill('');
    } catch (e) {
      loadError = getInvokeErrorMessage(e, tFn('backup.error.loadRecoveryPhrase'));
    } finally {
      busy = false;
    }
  }

  $: {
    if (open) {
      void loadSeed();
    } else if (!open) {
      resetState();
    }
  }

  function toggleReveal(): void {
    revealed = !revealed;
  }

  async function copySeed(): Promise<void> {
    if (!seed) return;
    const ok = await copyTextToClipboard(seed);
    if (ok) {
      copied = true;
      showToast(tFn('export.toast.copied', { values: { label: tFn('export.modal.label.seedPhrase') } }));
      setTimeout(() => {
        copied = false;
      }, 2000);
    } else {
      showToast(tFn('export.toast.couldNotCopy', { values: { label: tFn('export.modal.label.seedPhrase') } }));
    }
  }

  function goToConfirm(): void {
    if (!revealed) return;
    writtenDown = false;
    phase = 'confirm';
  }

  function goToQuiz(): void {
    if (!writtenDown) return;
    inputs = new Array(challenge.positions.length).fill('');
    attempts = 0;
    quizError = '';
    phase = 'quiz';
    setTimeout(() => inputEls[0]?.focus(), 0);
  }

  function goToShow(): void {
    challenge = seedWords.length >= 3 ? createChallenge(seedWords, 3) : { positions: [], answers: [] };
    attempts = 0;
    quizError = '';
    inputs = new Array(challenge.positions.length).fill('');
    phase = 'show';
  }

  async function submitQuiz(): Promise<void> {
    if (challenge.positions.length === 0) {
      quizError = tFn('backup.quiz.noChallenge');
      return;
    }
    if (inputs.some((v) => !v.trim())) {
      quizError = tFn('backup.quiz.enterAllWords');
      return;
    }
    const result = checkChallenge(seedWords, challenge.positions, inputs);
    if (result.correct) {
      quizError = '';
      try {
        await markBackupVerified(true);
        phase = 'success';
        setTimeout(() => {
          handleClose();
          backupVerificationModalOpen.set(false);
        }, 1200);
      } catch (e) {
        quizError = getInvokeErrorMessage(e, tFn('backup.error.saveBackupStatus'));
      }
      return;
    }
    attempts += 1;
    if (attempts >= MAX_ATTEMPTS) {
      quizError = tFn('backup.quiz.tooManyAttempts');
      setTimeout(() => goToShow(), 1500);
      return;
    }
    const mismatchLabels = result.details
      .filter((d) => d.expected.trim().toLowerCase() !== d.actual.trim().toLowerCase())
      .map((d) => `#${d.position}`)
      .join(', ');
    quizError = tFn('backup.quiz.wordMismatch', {
      values: { positions: mismatchLabels, attempts: MAX_ATTEMPTS - attempts },
    });
  }

  function handleInputKey(index: number, e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      if (index === inputs.length - 1) {
        void submitQuiz();
      } else {
        inputEls[index + 1]?.focus();
      }
    }
  }

  onMount(() => {
    return () => resetState();
  });
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={handleClose} dismissible={!busy}>
    <h2 id={titleId}>
      {#if phase === 'show'}
        {$t('backup.modal.title.backUp')}
      {:else if phase === 'confirm'}
        {$t('backup.modal.title.confirm')}
      {:else if phase === 'quiz'}
        {$t('backup.modal.title.verify')}
      {:else}
        {$t('backup.modal.title.verified')}
      {/if}
    </h2>

    <p id={descId} class="backup-desc">
      {#if phase === 'show'}
        {$t('backup.modal.desc.backUp')}
      {:else if phase === 'confirm'}
        {$t('backup.modal.desc.confirm')}
      {:else if phase === 'quiz'}
        {$t('backup.modal.desc.verify')}
      {:else}
        {$t('backup.modal.desc.verified')}
      {/if}
    </p>

    {#if loadError}
      <div class="backup-error" role="alert">{loadError}</div>
    {/if}

    {#if phase === 'show'}
      {#if seedWords.length > 0}
        <p class="backup-warning" role="alert">
          {$t('backup.modal.warning')}
        </p>

        <div class="seed-grid-shell">
          <ol class="seed-grid">
            {#each seedWords as word, i (i)}
              <li class="seed-word" class:seed-word--revealed={revealed}>
                <span class="seed-index">{i + 1}</span>
                <span class="seed-value">
                  {#if revealed}
                    {word}
                  {:else}
                    <span class="seed-mask" aria-hidden="true">{'•'.repeat(Math.max(4, word.length))}</span>
                  {/if}
                </span>
              </li>
            {/each}
          </ol>
        </div>

        <div class="backup-toolbar">
          <button
            type="button"
            class="btn-reveal"
            on:click={toggleReveal}
            aria-pressed={revealed}
          >
          {revealed ? $t('backup.modal.hideSeedPhrase') : $t('backup.modal.showSeedPhrase')}
          </button>
          <button
            type="button"
            class="btn-copy"
            on:click={() => void copySeed()}
            disabled={!revealed}
          >
            {copied ? $t('settings.copied') : $t('settings.copy')}
          </button>
        </div>
      {/if}

      <div class="backup-actions">
        <button type="button" class="btn-secondary" on:click={handleClose}>{$t('backup.modal.later')}</button>
        <button
          type="button"
          class="btn-primary"
          on:click={goToConfirm}
          disabled={!revealed || seedWords.length === 0}
        >
          {$t('backup.modal.wroteItDown')}
        </button>
      </div>
    {:else if phase === 'confirm'}
      <div class="backup-confirm">
        <label class="backup-checkbox-label">
          <input type="checkbox" bind:checked={writtenDown} />
          <span>
            {$t('backup.modal.confirmCheckbox', { values: { count: seedWords.length } })}
          </span>
        </label>
      </div>

      <div class="backup-actions">
        <button type="button" class="btn-secondary" on:click={() => (phase = 'show')}>{$t('auth.back')}</button>
        <button
          type="button"
          class="btn-primary"
          on:click={goToQuiz}
          disabled={!writtenDown}
        >
          {$t('auth.continue')}
        </button>
      </div>
    {:else if phase === 'quiz'}
      <div class="backup-quiz">
        {#each challenge.positions as position, i (i)}
          <label class="backup-quiz-label" for={`backup-word-${position}`}>
            {$t('backup.quiz.wordLabel', { values: { position } })}
          </label>
          <input
            id={`backup-word-${position}`}
            type="text"
            class="backup-quiz-input"
            bind:value={inputs[i]}
            bind:this={inputEls[i]}
            autocomplete="off"
            spellcheck="false"
            aria-label={$t('backup.quiz.wordNumberAria', { values: { position } })}
            on:keydown={(e) => handleInputKey(i, e)}
          />
        {/each}
      </div>

      {#if quizError}
        <div class="backup-error" role="alert">{quizError}</div>
      {/if}

      <div class="backup-actions">
        <button type="button" class="btn-secondary" on:click={goToShow}>{$t('backup.modal.showSeedAgain')}</button>
        <button type="button" class="btn-primary" on:click={() => void submitQuiz()}>
          {$t('commons.verify')}
        </button>
      </div>
    {:else}
      <div class="backup-success" role="status">
        <span class="backup-success-icon">✓</span>
        <p>{$t('backup.modal.success.closing')}</p>
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .backup-desc {
    margin: 0 0 16px 0;
    color: var(--text-muted);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .backup-warning {
    margin: 0 0 16px 0;
    padding: 12px 14px;
    border-radius: 8px;
    border-left: 3px solid var(--warning);
    background: rgba(250, 166, 26, 0.1);
    color: var(--warning);
    font-size: 0.875rem;
    line-height: 1.45;
  }

  .backup-error {
    margin: 0 0 16px 0;
    padding: 12px 14px;
    border-radius: 8px;
    background: rgba(242, 63, 66, 0.1);
    color: var(--danger);
    font-size: 0.875rem;
  }

  .seed-grid-shell {
    padding: 16px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    margin-bottom: 16px;
  }

  .seed-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px 12px;
    padding: 0;
    margin: 0;
    list-style: none;
  }

  @media (min-width: 480px) {
    .seed-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .seed-word {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-elevated);
    font-family: ui-monospace, monospace;
    font-size: 0.875rem;
  }

  .seed-word--revealed {
    background: var(--bg-elevated);
  }

  .seed-index {
    color: var(--text-muted);
    font-size: 0.75rem;
    min-width: 1.5em;
  }

  .seed-value {
    color: var(--text-primary);
    flex: 1;
  }

  .seed-mask {
    color: var(--text-muted);
    letter-spacing: 0.08em;
    user-select: none;
  }

  .backup-toolbar {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
  }

  .backup-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .backup-confirm {
    margin-bottom: 20px;
  }

  .backup-checkbox-label {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    line-height: 1.45;
    cursor: pointer;
  }

  .backup-checkbox-label input {
    margin-top: 3px;
  }

  .backup-quiz {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 16px;
  }

  .backup-quiz-label {
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .backup-quiz-input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 1rem;
  }

  .backup-quiz-input:focus {
    border-color: var(--brand);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 20%, transparent);
    outline: none;
  }

  .backup-success {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 24px 0;
    color: var(--success);
    font-size: 1rem;
    text-align: center;
  }

  .backup-success-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.15);
    font-size: 1.5rem;
    font-weight: 700;
  }

  .backup-success p {
    margin: 0;
  }

  .btn-primary,
  .btn-secondary,
  .btn-reveal,
  .btn-copy {
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 0.9375rem;
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .btn-primary {
    border: none;
    background: var(--brand);
    color: var(--on-brand);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary,
  .btn-reveal,
  .btn-copy {
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .btn-copy:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
