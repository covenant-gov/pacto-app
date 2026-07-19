<script lang="ts">
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
        throw new Error('Seed phrase must be 12 or 24 words.');
      }
      challenge = seedWords.length >= 3 ? createChallenge(seedWords, 3) : { positions: [], answers: [] };
      inputs = new Array(challenge.positions.length).fill('');
    } catch (e) {
      loadError = getInvokeErrorMessage(e, 'Could not load your recovery phrase.');
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
      showToast('Seed phrase copied');
      setTimeout(() => {
        copied = false;
      }, 2000);
    } else {
      showToast('Could not copy seed phrase');
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
      quizError = 'No backup challenge available. Try again.';
      return;
    }
    if (inputs.some((v) => !v.trim())) {
      quizError = 'Enter all requested words.';
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
        quizError = getInvokeErrorMessage(e, 'Could not save backup status. Try again.');
      }
      return;
    }
    attempts += 1;
    if (attempts >= MAX_ATTEMPTS) {
      quizError = 'Too many incorrect attempts. The seed phrase will be shown again.';
      setTimeout(() => goToShow(), 1500);
      return;
    }
    const mismatchLabels = result.details
      .filter((d) => d.expected.trim().toLowerCase() !== d.actual.trim().toLowerCase())
      .map((d) => `#${d.position}`)
      .join(', ');
    quizError = `Word ${mismatchLabels} does not match. You have ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts === 1 ? '' : 's'} left.`;
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
        Back up your account
      {:else if phase === 'confirm'}
        Confirm you wrote it down
      {:else if phase === 'quiz'}
        Verify your backup
      {:else}
        Backup verified
      {/if}
    </h2>

    <p id={descId} class="backup-desc">
      {#if phase === 'show'}
        This recovery phrase is the only way to restore your account and funds. Write it down
        offline and keep it safe.
      {:else if phase === 'confirm'}
        Make sure you have the words written in the correct order before continuing.
      {:else if phase === 'quiz'}
        Enter the words from your written copy.
      {:else}
        Your backup is verified. You can now use gated features like squads and sends.
      {/if}
    </p>

    {#if loadError}
      <div class="backup-error" role="alert">{loadError}</div>
    {/if}

    {#if phase === 'show'}
      {#if seedWords.length > 0}
        <p class="backup-warning" role="alert">
          Never share this phrase or save it online. Anyone with these words can control your
          account.
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
            {revealed ? 'Hide seed phrase' : 'Show seed phrase'}
          </button>
          <button
            type="button"
            class="btn-copy"
            on:click={() => void copySeed()}
            disabled={!revealed}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      {/if}

      <div class="backup-actions">
        <button type="button" class="btn-secondary" on:click={handleClose}>Do this later</button>
        <button
          type="button"
          class="btn-primary"
          on:click={goToConfirm}
          disabled={!revealed || seedWords.length === 0}
        >
          I wrote it down
        </button>
      </div>
    {:else if phase === 'confirm'}
      <div class="backup-confirm">
        <label class="backup-checkbox-label">
          <input type="checkbox" bind:checked={writtenDown} />
          <span>
            I have written down all {seedWords.length} words in the correct order on paper.
          </span>
        </label>
      </div>

      <div class="backup-actions">
        <button type="button" class="btn-secondary" on:click={() => (phase = 'show')}>Back</button>
        <button
          type="button"
          class="btn-primary"
          on:click={goToQuiz}
          disabled={!writtenDown}
        >
          Continue
        </button>
      </div>
    {:else if phase === 'quiz'}
      <div class="backup-quiz">
        {#each challenge.positions as position, i (i)}
          <label class="backup-quiz-label" for={`backup-word-${position}`}>
            Word #{position}
          </label>
          <input
            id={`backup-word-${position}`}
            type="text"
            class="backup-quiz-input"
            bind:value={inputs[i]}
            bind:this={inputEls[i]}
            autocomplete="off"
            spellcheck="false"
            aria-label={`Word number ${position}`}
            on:keydown={(e) => handleInputKey(i, e)}
          />
        {/each}
      </div>

      {#if quizError}
        <div class="backup-error" role="alert">{quizError}</div>
      {/if}

      <div class="backup-actions">
        <button type="button" class="btn-secondary" on:click={goToShow}>Show seed again</button>
        <button type="button" class="btn-primary" on:click={() => void submitQuiz()}>
          Verify
        </button>
      </div>
    {:else}
      <div class="backup-success" role="status">
        <span class="backup-success-icon">✓</span>
        <p>Your backup is verified. Closing…</p>
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
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.2);
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
    background: var(--accent);
    color: white;
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
