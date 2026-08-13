<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { gateState } from '../../lib/updater/update-gate';
  import { updateStatus, checkForUpdates } from '../../lib/updater/update-check';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import UpdateAvailablePanel from './UpdateAvailablePanel.svelte';

  // Compile-time constant, deliberately never derived from the (unsigned)
  // updater manifest - this screen is non-dismissible with an urgent
  // audience, the worst possible place to render an attacker-supplied link.
  const RELEASE_PAGE_URL = 'https://github.com/covenant-gov/pacto-app/releases/latest';

  let { children }: { children: Snippet } = $props();

  let panelEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    if ($gateState.status !== 'blocked' || !panelEl) return;
    void tick().then(() => {
      const focusTarget =
        panelEl?.querySelector<HTMLElement>('a[href], button:not([disabled]), input, [tabindex]') ?? panelEl;
      focusTarget?.focus();
    });
  });

  function handleRetry(): void {
    void checkForUpdates();
  }

  function handleReleasePageClick(event: MouseEvent): void {
    event.preventDefault();
    void openExternalUrl(RELEASE_PAGE_URL);
  }

  const hasLiveInstallAction = $derived(
    $updateStatus.status === 'available' ||
      $updateStatus.status === 'downloading' ||
      $updateStatus.status === 'installing' ||
      $updateStatus.status === 'installed' ||
      $updateStatus.status === 'error',
  );
</script>

{#if $gateState.status === 'resolving'}
  <!-- Matches Login.svelte's own checking-screen exactly: markup, colors,
       copy. Login mounts and shows this same treatment the instant the
       gate clears, so two visually different spinners in sequence never
       read as a reload. -->
  <div class="checking-screen" role="status" aria-live="polite">
    <div class="checking-spinner"></div>
    <p class="checking-text">{$t('auth.checkingAccount')}</p>
  </div>
{:else if $gateState.status === 'blocked'}
  {@const state = $gateState}
  <div class="gate-block-screen">
    <div
      class="gate-block-panel"
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="update-gate-title"
      aria-describedby="update-gate-description"
      tabindex="-1"
      bind:this={panelEl}
    >
      <h2 id="update-gate-title">
        {state.reason === 'minimum-version'
          ? $t('updater.gate.minimumVersionTitle')
          : $t('updater.gate.storageFormatTitle')}
      </h2>
      <p id="update-gate-description">
        {#if state.reason === 'minimum-version'}
          {$t('updater.gate.minimumVersionDescription', {
            values: { installed: state.installedVersion, required: state.requiredVersion ?? '' },
          })}
        {:else}
          {$t('updater.gate.storageFormatDescription', { values: { count: state.unrecognizedCount } })}
        {/if}
      </p>

      {#if hasLiveInstallAction}
        <UpdateAvailablePanel />
      {:else if state.reason === 'minimum-version'}
        <div class="gate-block-fallback">
          <button type="button" class="btn-primary" onclick={handleRetry}>
            {$t('updater.gate.retry')}
          </button>
          <a href={RELEASE_PAGE_URL} onclick={handleReleasePageClick}>
            {$t('updater.gate.releasePageLink')}
          </a>
        </div>
      {:else}
        <div class="gate-block-fallback">
          <p class="gate-block-nontransient">{$t('updater.gate.storageFormatNonTransient')}</p>
        </div>
      {/if}
    </div>
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .checking-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100vh;
    gap: 16px;
    background: var(--bg-page, #1c1c1c);
  }

  .checking-spinner {
    width: 48px;
    height: 48px;
    border: 4px solid var(--border-subtle, #313338);
    border-top-color: var(--brand, #5865f2);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .checking-text {
    color: var(--text-secondary, #dbdee1);
    font-size: 0.9375rem;
    margin: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .gate-block-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100vh;
    padding: 32px;
    background: var(--bg-page, #1c1c1c);
  }

  .gate-block-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    max-width: 440px;
    padding: 32px;
    border-radius: 12px;
    background: var(--bg-elevated, #2b2d31);
    border: 1px solid var(--border-subtle, #313338);
  }

  .gate-block-panel:focus {
    outline: none;
  }

  #update-gate-title {
    margin: 0;
    color: var(--text-primary, #f2f3f5);
    font-size: 1.25rem;
  }

  #update-gate-description {
    margin: 0;
    color: var(--text-secondary, #dbdee1);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .gate-block-fallback {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .gate-block-nontransient {
    margin: 0;
    color: var(--text-secondary, #dbdee1);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .gate-block-fallback a {
    color: var(--brand, #5865f2);
    font-size: 0.875rem;
  }

  .btn-primary {
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    background: var(--brand, #5865f2);
    color: var(--on-brand);
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
  }
</style>
