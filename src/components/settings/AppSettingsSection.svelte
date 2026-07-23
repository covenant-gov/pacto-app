<script lang="ts">
  import { onMount } from 'svelte';
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
  import { getSessionTimeout, setSessionTimeout } from '../../lib/api/auth';
  import { locale, setLocale, LOCALE_OPTIONS } from '../../stores/locale';

  $: isDev = $updateStatus.status === 'dev-disabled';
  $: isChecking = $updateStatus.status === 'checking';

  function versionLabel(): string {
    const version = $updateStatus.currentVersion || buildVersion;
    if (import.meta.env.DEV) {
      return `${version} (dev ${buildCommitHash})`;
    }
    return `${version} (${buildCommitHash})`;
  }

  function statusText(status: (typeof $updateStatus)['status']): string {
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
      case 'installed':
        return 'Update installed — relaunch to apply.';
      case 'error':
        return $updateStatus.error ?? 'Update check failed.';
      case 'dev-disabled':
        return 'Updates are only available in release builds.';
    }
    return '';
  }

  function handleCheck(): void {
    void checkForUpdates();
  }

  const TIMEOUT_OPTIONS = [
    { minutes: 1, label: '1 minute' },
    { minutes: 5, label: '5 minutes' },
    { minutes: 15, label: '15 minutes' },
    { minutes: 30, label: '30 minutes' },
    { minutes: 60, label: '1 hour' },
    { minutes: 0, label: 'Never' },
  ];

  let selectedTimeout = 15;
  let savingTimeout = false;
  let savedTimeoutMessage: string | null = null;

  onMount(async () => {
    try {
      selectedTimeout = await getSessionTimeout();
    } catch (error) {
      console.error('Failed to load session timeout:', error);
    }
  });

  async function handleTimeoutChange(minutes: number): Promise<void> {
    if (savingTimeout || minutes === selectedTimeout) return;
    savingTimeout = true;
    savedTimeoutMessage = null;
    try {
      await setSessionTimeout(minutes);
      selectedTimeout = minutes;
      savedTimeoutMessage = 'Saved';
      globalThis.setTimeout(() => {
        savedTimeoutMessage = null;
      }, 2000);
    } catch (error) {
      console.error('Failed to set session timeout:', error);
      savedTimeoutMessage = 'Failed to save';
    } finally {
      savingTimeout = false;
    }
  }

  function handleToggleStartupCheck(e: Event): void {
    const target = e.currentTarget as HTMLInputElement;
    startupCheckEnabled.set(target.checked);
  }
</script>

<SettingsCollapsibleSection sectionId="settings-app" title="App settings">
  <div class="app-settings">
    <div class="language-section" aria-labelledby="language-heading">
      <h3 id="language-heading" class="theme-subheading">Language</h3>
      <span class="theme-label">Display language</span>
      <div class="theme-options" role="radiogroup" aria-label="App language">
        {#each LOCALE_OPTIONS as opt (opt.value)}
          <label class="theme-option">
            <input
              type="radio"
              name="locale"
              value={opt.value}
              checked={$locale === opt.value}
              on:change={() => setLocale(opt.value)}
            />
            <span class="theme-option-label">{opt.label}</span>
          </label>
        {/each}
      </div>
    </div>

    <hr class="app-settings-divider" />

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

      {#if $updateStatus.status === 'available' || $updateStatus.status === 'downloading' || $updateStatus.status === 'installing' || $updateStatus.status === 'installed' || $updateStatus.status === 'error'}
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

    <hr class="app-settings-divider" />

    <div class="security-section" aria-labelledby="security-heading">
      <h3 id="security-heading" class="theme-subheading">Security</h3>

      <span class="security-label">Auto-lock after inactivity</span>
      <div class="timeout-options" role="radiogroup" aria-label="Session idle timeout">
        {#each TIMEOUT_OPTIONS as opt (opt.minutes)}
          <label class="timeout-option">
            <input
              type="radio"
              name="session-timeout"
              value={opt.minutes}
              checked={selectedTimeout === opt.minutes}
              disabled={savingTimeout}
              on:change={() => handleTimeoutChange(opt.minutes)}
            />
            <span class="timeout-option-label">{opt.label}</span>
          </label>
        {/each}
      </div>
      {#if savedTimeoutMessage}
        <p class="timeout-status" class:timeout-status--error={savedTimeoutMessage === 'Failed to save'}>{savedTimeoutMessage}</p>
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

  .security-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .security-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 8px;
  }

  .timeout-options {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .timeout-option {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .timeout-option input {
    accent-color: var(--accent);
  }

  .timeout-option input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .timeout-option-label {
    user-select: none;
  }

  .timeout-status {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--success, #38a169);
    min-height: 1.2em;
  }

  .timeout-status--error {
    color: var(--danger, #e53e3e);
  }
</style>
