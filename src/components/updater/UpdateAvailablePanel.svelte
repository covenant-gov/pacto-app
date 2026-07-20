<script lang="ts">
  import {
    checkForUpdates,
    updateStatus,
    downloadAndInstallUpdate,
    relaunchApp,
    type UpdateState,
  } from '../../lib/updater/update-check';

  $: state = $updateStatus;

  function progressPercent(progress: number): string {
    return `${Math.round(progress * 100)}%`;
  }

  function primaryLabel(status: UpdateState['status']): string {
    switch (status) {
      case 'downloading':
        return 'Downloading…';
      case 'installing':
        return 'Installing…';
      case 'error':
        return 'Retry';
      default:
        return 'Download and install';
    }
  }

  function progressLabel(status: UpdateState['status']): string {
    switch (status) {
      case 'downloading':
        return 'Downloading…';
      case 'installing':
        return 'Downloaded. Installing update…';
      default:
        return '';
    }
  }

  function handlePrimary(): void {
    if (state.status === 'error') {
      void checkForUpdates();
      return;
    }
    void downloadAndInstallUpdate();
  }
</script>

<div class="update-panel">
  {#if state.status === 'available'}
    <p class="update-version">
      Update {state.availableVersion ?? ''} is available.
      {#if state.currentVersion}
        You have {state.currentVersion}.
      {/if}
    </p>
  {:else if state.status === 'downloading' || state.status === 'installing'}
    <p class="update-version">
      Update {state.availableVersion ?? ''} is {state.status}.
      {#if state.currentVersion}
        You have {state.currentVersion}.
      {/if}
    </p>
    <div
      class="update-progress"
      role="progressbar"
      aria-valuenow={state.downloadProgress}
      aria-valuemin={0}
      aria-valuemax={1}
    >
      <div class="update-progress-bar" style="width: {progressPercent(state.downloadProgress)}"></div>
    </div>
    <p class="update-progress-label">
      {#if state.status === 'downloading'}
        {progressLabel(state.status)} {progressPercent(state.downloadProgress)}
      {:else}
        {progressLabel(state.status)}
      {/if}
    </p>
  {:else if state.status === 'installed'}
    <p class="update-version">
      Update {state.availableVersion ?? ''} is installed.
      {#if state.currentVersion}
        You have {state.currentVersion}.
      {/if}
    </p>
    <p class="update-relaunch-prompt">
      Relaunch Pacto to start the new version.
    </p>
    <button type="button" class="btn-primary" on:click={() => void relaunchApp()}>
      Relaunch now
    </button>
  {:else if state.status === 'error'}
    <p class="update-version">
      {#if state.currentVersion}
        You have {state.currentVersion}.
      {/if}
    </p>
    <p class="update-error" role="alert">{state.error ?? 'Update check failed.'}</p>
  {/if}

  {#if state.status === 'available'}
    <button
      type="button"
      class="btn-primary"
      on:click={handlePrimary}
    >
      {primaryLabel(state.status)}
    </button>
  {:else if state.status === 'error'}
    <button
      type="button"
      class="btn-primary"
      on:click={handlePrimary}
    >
      {primaryLabel(state.status)}
    </button>
  {:else if state.status === 'downloading' || state.status === 'installing'}
    <button
      type="button"
      class="btn-primary"
      disabled
    >
      {primaryLabel(state.status)}
    </button>
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
    height: 8px;
    background-color: var(--bg-tertiary);
    border-radius: 4px;
    overflow: hidden;
  }

  .update-progress-bar {
    height: 100%;
    background-color: var(--accent-primary);
    transition: width 0.2s ease;
  }

  .update-progress-label {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  .update-error {
    margin: 0;
    color: var(--danger);
    font-size: 0.9375rem;
  }

  .update-relaunch-prompt {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9375rem;
  }
</style>
