<script lang="ts">
  import {
    updateStatus,
    downloadAndInstallUpdate,
    relaunchApp,
    type UpdateState,
  } from '../../lib/updater/update-check';

  $: state = $updateStatus;

  function installLabel(status: UpdateState['status']): string {
    switch (status) {
      case 'downloading':
        return 'Downloading…';
      case 'installing':
        return 'Installing…';
      case 'error':
        return 'Retry install';
      default:
        return 'Download and install';
    }
  }

  function progressPercent(progress: number): string {
    return `${Math.round(progress * 100)}%`;
  }
</script>

<div class="update-panel">
  {#if state.status === 'available' || state.status === 'downloading' || state.status === 'installing' || state.status === 'error'}
    <p class="update-version">
      Update {state.availableVersion ?? ''} is available.
      {#if state.currentVersion}
        You have {state.currentVersion}.
      {/if}
    </p>

    {#if state.status === 'downloading' || state.status === 'installing'}
      <div class="update-progress" role="progressbar" aria-valuenow={state.downloadProgress} aria-valuemin={0} aria-valuemax={1}>
        <div class="update-progress-bar" style="width: {progressPercent(state.downloadProgress)}"></div>
      </div>
      <p class="update-progress-label">{installLabel(state.status)} {progressPercent(state.downloadProgress)}</p>
    {/if}

    {#if state.status === 'error'}
      <p class="update-error" role="alert">{state.error ?? 'Update failed.'}</p>
    {/if}

    {#if !state.relaunchPending}
      <button
        type="button"
        class="btn-primary"
        disabled={state.status === 'downloading' || state.status === 'installing'}
        on:click={() => void downloadAndInstallUpdate()}
      >
        {installLabel(state.status)}
      </button>
    {:else}
      <p class="update-relaunch-prompt">The update is installed. Relaunch to start the new version.</p>
      <button type="button" class="btn-primary" on:click={() => void relaunchApp()}>
        Relaunch now
      </button>
    {/if}
  {/if}
</div>

<style>
  .update-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .update-version {
    margin: 0;
    color: var(--text-primary);
    font-size: 0.9375rem;
    line-height: 1.4;
  }

  .update-progress {
    width: 100%;
    height: 6px;
    background: var(--border);
    border-radius: 3px;
    overflow: hidden;
  }

  .update-progress-bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }

  .update-progress-label {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .update-error {
    margin: 0;
    color: var(--danger, #e53e3e);
    font-size: 0.875rem;
  }

  .update-relaunch-prompt {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .btn-primary {
    align-self: flex-start;
    padding: 8px 16px;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: #ffffff;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
</style>
