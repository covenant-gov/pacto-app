<script lang="ts">
  import { theme, setTheme, THEME_OPTIONS } from '../../stores/theme';
  import { startupCheckEnabled } from '../../stores/startup-check';
  import {
    checkForUpdates,
    updateStatus,
    buildCommitHash,
    buildVersion,
  } from '../../lib/updater/update-check';
  import UpdateAvailablePanel from '../updater/UpdateAvailablePanel.svelte';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';

  $: isDev = $updateStatus.status === 'dev-disabled';
  $: isChecking = $updateStatus.status === 'checking';

  function versionLabel(): string {
    const version = $updateStatus.currentVersion || buildVersion;
    if (import.meta.env.DEV) {
      return `${version} (dev ${buildCommitHash})`;
    }
    return `${version} (${buildCommitHash})`;
  }

  function statusText(status: (typeof $updateStatus)['status'] | 'relaunchPending'): string {
    switch (status) {
      case 'idle':
        return '';
      case 'checking':
        return 'Checking…';
      case 'no-update':
        return 'You’re on the latest version.';
      case 'available':
      case 'downloading':
      case 'installing':
        return `Update ${$updateStatus.availableVersion ?? ''} available`;
      case 'error':
        return $updateStatus.error ?? 'Update check failed.';
      case 'relaunchPending':
        return 'Update installed — relaunch to apply.';
      case 'dev-disabled':
        return 'Updates are only available in release builds.';
    }
    return '';
  }

  function handleCheck(): void {
    void checkForUpdates();
  }

  function handleToggleStartupCheck(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    startupCheckEnabled.set(target.checked);
  }
</script>

<SettingsCollapsibleSection sectionId="settings-app" title="App settings">
  <div class="app-settings">
    <div class="theme-section" aria-labelledby="theme-heading">
      <h3 id="theme-heading" class="theme-subheading">Appearance</h3>
      <span class="theme-label">Theme</span>
      <div class="theme-options" role="radiogroup" aria-label="App theme">
        {#each THEME_OPTIONS as opt (opt.value)}
          <label class="theme-option">
            <input
              type="radio"
              name="theme"
              value={opt.value}
              checked={$theme === opt.value}
              on:change={() => setTheme(opt.value)}
            />
            <span class="theme-option-label">{opt.label}</span>
          </label>
        {/each}
      </div>
    </div>

    <hr class="app-settings-divider" />

    <div class="updates-section" aria-labelledby="updates-heading">
      <h3 id="updates-heading" class="theme-subheading">Updates</h3>

      <p class="update-current-version">
        Current version: {versionLabel()}
      </p>

      <button
        type="button"
        class="btn-primary check-for-updates-btn"
        disabled={isChecking}
        on:click={handleCheck}
      >
        {isChecking ? 'Checking…' : (isDev ? 'Release-build only' : 'Check for Updates')}
      </button>

      {#if $updateStatus.status !== 'idle'}
        <p class="update-status-line" class:update-status-line--error={$updateStatus.status === 'error'}>
          {statusText($updateStatus.status)}
        </p>
      {/if}

      {#if $updateStatus.status === 'available' || $updateStatus.status === 'downloading' || $updateStatus.status === 'installing' || $updateStatus.status === 'error' || $updateStatus.relaunchPending}
        <div class="inline-update-panel">
          <UpdateAvailablePanel />
        </div>
      {/if}

      <label class="startup-check-toggle">
        <input
          type="checkbox"
          checked={$startupCheckEnabled}
          on:change={handleToggleStartupCheck}
        />
        <span>Check for updates on startup</span>
      </label>

      {#if isDev}
        <p class="dev-build-note">
          The in-app updater is disabled in dev builds. Use a release build to check for and install published updates.
        </p>
      {/if}
    </div>
  </div>
</SettingsCollapsibleSection>

<style>
  .app-settings {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .theme-section {
    margin: 0;
  }

  .theme-subheading {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .theme-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 8px;
  }

  .theme-options {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .theme-option {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .theme-option input {
    accent-color: var(--accent);
  }

  .theme-option-label {
    user-select: none;
  }

  .app-settings-divider {
    width: 100%;
    border: 0;
    border-top: 1px solid var(--border-subtle);
    margin: 0;
  }

  .updates-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .update-current-version {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .check-for-updates-btn {
    align-self: flex-start;
  }

  .update-status-line {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
    min-height: 1.2em;
  }

  .update-status-line--error {
    color: var(--danger, #e53e3e);
  }

  .inline-update-panel {
    margin-top: 4px;
  }

  .startup-check-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .startup-check-toggle input {
    accent-color: var(--accent);
  }

  .dev-build-note {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .btn-primary {
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
