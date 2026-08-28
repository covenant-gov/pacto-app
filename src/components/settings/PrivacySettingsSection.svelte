<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { getTorStatus } from '../../lib/api/tor';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { torRoutingEnabled, torAvailable, torStartupError, toggleTorRouting } from '../../stores/tor';
  import torIcon from '../../icons/tor.svg';

  let loading = $state(true);
  let saving = $state(false);
  /** Direction of the in-flight toggle, so the status line while `saving`
   *  can say "connecting" vs "disconnecting" instead of always the former. */
  let pendingTarget = $state<boolean | null>(null);
  let error = $state<string | null>(null);

  onMount(() => {
    void loadStatus();
  });

  async function loadStatus(): Promise<void> {
    loading = true;
    error = null;
    try {
      const status = await getTorStatus();
      torRoutingEnabled.set(status.enabled);
      torAvailable.set(status.available);
      torStartupError.set(status.startup_error);
    } catch (e) {
      error = getInvokeErrorMessage(e, $t('settings.routeTrafficThroughTorLoadError'));
    } finally {
      loading = false;
    }
  }

  async function handleToggle(e: Event): Promise<void> {
    const next = (e.currentTarget as HTMLInputElement).checked;
    saving = true;
    pendingTarget = next;
    error = null;
    error = await toggleTorRouting(next, $t('settings.routeTrafficThroughTorSaveError'));
    saving = false;
    pendingTarget = null;
  }
</script>

<section class="privacy-section" aria-labelledby="privacy-heading">
  <h3 id="privacy-heading" class="theme-subheading">{$t('settings.privacyTitle')}</h3>

  {#if !$torAvailable}
    <p class="tor-status">{$t('settings.routeTrafficThroughTorUnavailable')}</p>
  {/if}

  <label class="tor-toggle">
    <input
      type="checkbox"
      checked={$torRoutingEnabled}
      disabled={loading || saving || !$torAvailable}
      onchange={handleToggle}
    />
    <span>{$t('settings.routeTrafficThroughTorLabel')}</span>
  </label>

  {#if saving}
    <p class="tor-status">
      {pendingTarget
        ? $t('settings.routeTrafficThroughTorConnecting')
        : $t('settings.routeTrafficThroughTorDisconnecting')}
    </p>
  {/if}

  <p class="tor-description">
    <img class="tor-logo" src={torIcon} alt="" />
    {$t('settings.routeTrafficThroughTorDescription')}
  </p>
  <p class="tor-disclaimer">{$t('settings.routeTrafficThroughTorDisclaimer')}</p>

  {#if $torStartupError}
    <p class="tor-error" role="alert">
      {$t('settings.routeTrafficThroughTorStartupWarning')} {$torStartupError}
    </p>
  {/if}

  {#if error}
    <p class="tor-error" role="alert">{error}</p>
  {/if}
</section>

<style>
  .privacy-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .theme-subheading {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .tor-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .tor-toggle input {
    accent-color: var(--brand);
  }

  .tor-toggle input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tor-status {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .tor-description {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .tor-logo {
    width: 16px;
    height: 16px;
    margin-top: 1px;
    flex-shrink: 0;
  }

  .tor-disclaimer {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .tor-error {
    margin: 0;
    color: var(--danger);
    font-size: 0.8125rem;
  }
</style>
