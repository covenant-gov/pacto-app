<script lang="ts">
  import {
    checkForUpdates,
    updateStatus,
    downloadAndInstallUpdate,
    relaunchApp,
    type UpdateState,
  } from '../../lib/updater/update-check';
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';

  const tFn = get(t);

  $: state = $updateStatus;

  function progressPercent(progress: number): string {
    return `${Math.round(progress * 100)}%`;
  }

  function primaryLabel(status: UpdateState['status']): string {
    switch (status) {
      case 'downloading':
        return tFn('updater.primary.downloading');
      case 'installing':
        return tFn('updater.primary.installing');
      case 'error':
        return tFn('updater.primary.retry');
      default:
        return tFn('updater.primary.downloadAndInstall');
    }
  }

  function progressLabel(status: UpdateState['status']): string {
    switch (status) {
      case 'downloading':
        return tFn('updater.primary.downloading');
      case 'installing':
        return tFn('updater.downloadedInstalling');
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
      {$t('updater.available', { values: { version: state.availableVersion ?? '' } })}
      {#if state.currentVersion}
        {$t('updater.youHave', { values: { version: state.currentVersion } })}
      {/if}
    </p>
  {:else if state.status === 'downloading' || state.status === 'installing'}
    <p class="update-version">
      {#if state.status === 'downloading'}
        {$t('updater.downloading', { values: { version: state.availableVersion ?? '' } })}
      {:else}
        {$t('updater.installing', { values: { version: state.availableVersion ?? '' } })}
      {/if}
      {#if state.currentVersion}
        {$t('updater.youHave', { values: { version: state.currentVersion } })}
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
      {$t('updater.installed', { values: { version: state.availableVersion ?? '' } })}
      {#if state.currentVersion}
        {$t('updater.youHave', { values: { version: state.currentVersion } })}
      {/if}
    </p>
    <p class="update-relaunch-prompt">
      {$t('updater.relaunchPrompt')}
    </p>
    <button type="button" class="btn-primary" on:click={() => void relaunchApp()}>
      {$t('updater.relaunchNow')}
    </button>
  {:else if state.status === 'error'}
    <p class="update-version">
      {#if state.currentVersion}
        {$t('updater.youHave', { values: { version: state.currentVersion } })}
      {/if}
    </p>
    <p class="update-error" role="alert">{state.error ?? $t('updater.updateCheckFailed')}</p>
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
    background-color: var(--bg-elevated);
    border-radius: 4px;
    overflow: hidden;
  }

  .update-progress-bar {
    height: 100%;
    background-color: var(--brand);
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
