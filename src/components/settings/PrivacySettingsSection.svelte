<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { getSqlSetting } from '../../lib/api/settings';
  import { setTorRoutingEnabled } from '../../lib/api/tor';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';

  const TOR_SETTING_KEY = 'route_traffic_through_tor';

  let enabled = $state(false);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    void loadSetting();
  });

  async function loadSetting(): Promise<void> {
    loading = true;
    error = null;
    try {
      const value = await getSqlSetting(TOR_SETTING_KEY);
      enabled = value === 'true';
    } catch (e) {
      error = getInvokeErrorMessage(e, $t('settings.routeTrafficThroughTorLoadError'));
    } finally {
      loading = false;
    }
  }

  /** Optimistically flips the toggle, reverting and surfacing an error if the backend rejects. */
  async function handleToggle(e: Event): Promise<void> {
    const next = (e.currentTarget as HTMLInputElement).checked;
    const previous = enabled;
    enabled = next;
    saving = true;
    error = null;
    try {
      await setTorRoutingEnabled(next);
    } catch (err) {
      enabled = previous;
      error = getInvokeErrorMessage(err, $t('settings.routeTrafficThroughTorSaveError'));
    } finally {
      saving = false;
    }
  }
</script>

<div class="privacy-section" aria-labelledby="privacy-heading">
  <h3 id="privacy-heading" class="theme-subheading">{$t('settings.privacyTitle')}</h3>

  <label class="tor-toggle">
    <input type="checkbox" checked={enabled} disabled={loading || saving} onchange={handleToggle} />
    <span>{$t('settings.routeTrafficThroughTorLabel')}</span>
  </label>

  {#if saving}
    <p class="tor-status">{$t('settings.routeTrafficThroughTorConnecting')}</p>
  {/if}

  <p class="tor-description">{$t('settings.routeTrafficThroughTorDescription')}</p>
  <p class="tor-disclaimer">{$t('settings.routeTrafficThroughTorDisclaimer')}</p>

  {#if error}
    <p class="tor-error">{error}</p>
  {/if}
</div>

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
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
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
