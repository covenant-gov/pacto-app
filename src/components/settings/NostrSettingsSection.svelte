<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    addCustomRelay,
    getRelayLogs,
    getRelayMetrics,
    hasRelayHealthData,
    listRelays,
    relayModeLabel,
    relayStatusLabel,
    removeCustomRelay,
    setRelayEnabled,
    validateRelayUrlInput,
    type RelayInfo,
    type RelayLog,
    type RelayMetrics,
    type RelayMode,
  } from '../../lib/api/relays';
  import { formatFileSize } from '../../lib/messaging/attachment-composer';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { showToast } from '../../stores/toast';
  import { currentUser } from '../../stores/auth';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
  import EvmAccountKeyExportModal from './EvmAccountKeyExportModal.svelte';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';

  $: userNpub = $currentUser?.npub ?? '';

  let copiedNpub = false;
  let exportModalOpen = false;

  async function copyNpub() {
    if (!userNpub) return;
    try {
      await navigator.clipboard.writeText(userNpub);
      copiedNpub = true;
      setTimeout(() => (copiedNpub = false), 2000);
    } catch (_) {
      showToast($t('settings.toast.couldNotCopyNpub'));
    }
  }

  let relays: RelayInfo[] = [];
  let loading = true;
  let loadError: string | null = null;

  let newRelayUrl = '';
  let newRelayMode: RelayMode = 'both';
  let addError: string | null = null;
  let adding = false;

  let busyUrl: string | null = null;

  type RelayDetailState = {
    loading: boolean;
    error: string | null;
    metrics: RelayMetrics | null;
    logs: RelayLog[];
  };

  let openUrls = new Set<string>();
  let detailByUrl: Record<string, RelayDetailState> = {};

  function toggleDetail(url: string) {
    const next = new Set(openUrls);
    if (next.has(url)) {
      next.delete(url);
      openUrls = next;
      return;
    }
    next.add(url);
    openUrls = next;
    if (!detailByUrl[url]) void loadDetail(url);
  }

  async function loadDetail(url: string) {
    const previous = detailByUrl[url];
    detailByUrl = {
      ...detailByUrl,
      [url]: { loading: true, error: null, metrics: previous?.metrics ?? null, logs: previous?.logs ?? [] },
    };
    const startedAt = Date.now();
    try {
      const [metrics, logs] = await Promise.all([getRelayMetrics(url), getRelayLogs(url)]);
      await waitForMinSpin(startedAt);
      detailByUrl = { ...detailByUrl, [url]: { loading: false, error: null, metrics, logs } };
    } catch (e) {
      await waitForMinSpin(startedAt);
      detailByUrl = {
        ...detailByUrl,
        [url]: {
          loading: false,
          error: getInvokeErrorMessage(e, $t('settings.toast.couldNotLoadRelayDetail')),
          metrics: previous?.metrics ?? null,
          logs: previous?.logs ?? [],
        },
      };
    }
  }

  function unixToTimestamp(unixSeconds: number): string {
    return formatMessageTimestamp(new Date(unixSeconds * 1000).toISOString());
  }

  const MODE_OPTIONS: { value: RelayMode; label: string }[] = [
    { value: 'both', label: $t('settings.relayModeBoth') },
    { value: 'read', label: $t('settings.relayModeRead') },
    { value: 'write', label: $t('settings.relayModeWrite') },
  ];

  onMount(() => {
    void refreshRelays();
  });

  // Keeps the refresh spinner visible long enough to register as feedback;
  // local/cached fetches can otherwise resolve within a single frame.
  const MIN_SPIN_MS = 400;

  async function waitForMinSpin(startedAt: number) {
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_SPIN_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS - elapsed));
    }
  }

  async function refreshRelays() {
    loading = true;
    loadError = null;
    const startedAt = Date.now();
    try {
      relays = await listRelays();
    } catch (e) {
      loadError = getInvokeErrorMessage(e, $t('settings.toast.couldNotLoadRelays'));
    } finally {
      await waitForMinSpin(startedAt);
      loading = false;
    }
  }

  async function handleAddRelay() {
    addError = validateRelayUrlInput(newRelayUrl);
    if (addError || adding) return;

    adding = true;
    try {
      await addCustomRelay(newRelayUrl.trim(), newRelayMode);
      newRelayUrl = '';
      newRelayMode = 'both';
      await refreshRelays();
      showToast($t('settings.toast.customRelayAdded'));
    } catch (e) {
      addError = getInvokeErrorMessage(e, $t('settings.toast.couldNotAddRelay'));
      showToast(addError);
    } finally {
      adding = false;
    }
  }

  async function handleToggleEnabled(relay: RelayInfo, enabled: boolean) {
    if (busyUrl) return;
    busyUrl = relay.url;
    const previous = relay.enabled;
    relays = relays.map((r) => (r.url === relay.url ? { ...r, enabled } : r));

    try {
      await setRelayEnabled(relay, enabled);
      await refreshRelays();
    } catch (e) {
      relays = relays.map((r) => (r.url === relay.url ? { ...r, enabled: previous } : r));
      showToast(getInvokeErrorMessage(e, $t('settings.toast.couldNotUpdateRelay')));
    } finally {
      busyUrl = null;
    }
  }

  async function handleRemove(relay: RelayInfo) {
    if (!relay.is_custom || busyUrl) return;
    busyUrl = relay.url;
    try {
      const removed = await removeCustomRelay(relay.url);
      if (removed) {
        await refreshRelays();
        showToast($t('settings.toast.customRelayRemoved'));
      } else {
        showToast($t('settings.toast.relayNotFound'));
      }
    } catch (e) {
      showToast(getInvokeErrorMessage(e, $t('settings.toast.couldNotRemoveRelay')));
    } finally {
      busyUrl = null;
    }
  }

  function statusClass(status: string, enabled: boolean): string {
    if (!enabled) return 'nostr-relay-status--off';
    if (status === 'connected') return 'nostr-relay-status--ok';
    if (status === 'connecting' || status === 'pending' || status === 'initialized') {
      return 'nostr-relay-status--pending';
    }
    return 'nostr-relay-status--warn';
  }
</script>

<SettingsCollapsibleSection sectionId="settings-nostr" title={$t('settings.nostrSettingsTitle')}>

  <div class="nostr-npub-block" aria-labelledby="nostr-npub-heading">
    <h3 id="nostr-npub-heading" class="nostr-settings-subheading">{$t('settings.npubLabel')}</h3>
    <p class="nostr-npub-note">
      {$t('settings.npubNotePrefix')}
      <strong>{$t('settings.accountId')}</strong>
      {$t('settings.npubNoteSuffix')}
    </p>
    {#if userNpub}
      <div class="nostr-npub-row">
        <code class="nostr-npub-value">{userNpub}</code>
        <button
          type="button"
          class="nostr-npub-copy-btn"
          aria-label={copiedNpub ? $t('settings.copied') : $t('settings.copyNpub')}
          title={copiedNpub ? $t('settings.copied') : $t('settings.copy')}
          on:click={copyNpub}
        >
          <svg
            class="nostr-npub-copy-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
      </div>
      <button type="button" class="nostr-export-key-btn" on:click={() => (exportModalOpen = true)}>
        {$t('settings.exportKey')}
      </button>
    {:else}
      <p class="nostr-settings-muted">{$t('settings.loginToSeeNpub')}</p>
    {/if}
  </div>

  <p class="nostr-settings-lead">
    {$t('settings.relaysLead', { values: { wss: 'wss://' } })}
  </p>

  <div class="nostr-add-relay" aria-labelledby="nostr-add-relay-heading">
    <h3 id="nostr-add-relay-heading" class="nostr-settings-subheading">{$t('settings.addCustomRelayTitle')}</h3>
    <div class="nostr-add-relay-row">
      <label class="nostr-add-relay-field nostr-add-relay-field--grow">
        <span class="nostr-add-relay-label">{$t('settings.relayUrlLabel')}</span>
        <input
          type="url"
          class="nostr-add-relay-input"
          placeholder={$t('settings.relayUrlPlaceholder')}
          bind:value={newRelayUrl}
          disabled={adding}
          autocomplete="off"
          spellcheck="false"
          on:keydown={(e) => e.key === 'Enter' && handleAddRelay()}
        />
      </label>
      <label class="nostr-add-relay-field">
        <span class="nostr-add-relay-label">{$t('settings.relayModeLabel')}</span>
        <select class="nostr-add-relay-select" bind:value={newRelayMode} disabled={adding}>
          {#each MODE_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>
      <button type="button" class="nostr-add-relay-btn" disabled={adding} on:click={handleAddRelay}>
        {adding ? $t('settings.adding') : $t('settings.add')}
      </button>
    </div>
    {#if addError}
      <p class="nostr-settings-error" role="alert">{addError}</p>
    {/if}
  </div>

  <div class="nostr-relay-list-wrap" aria-labelledby="nostr-relay-list-heading">
    <div class="nostr-relay-list-head">
      <h3 id="nostr-relay-list-heading" class="nostr-settings-subheading">{$t('settings.connectedRelaysTitle')}</h3>
      <RefreshIconButton
        disabled={loading}
        spinning={loading}
        ariaLabel={loading ? $t('settings.refreshingRelays') : $t('settings.refreshRelays')}
        on:click={refreshRelays}
      />
    </div>

    {#if loading && relays.length === 0}
      <p class="nostr-settings-muted">{$t('settings.loadingRelays')}</p>
    {:else if loadError}
      <p class="nostr-settings-error" role="alert">{loadError}</p>
    {:else if relays.length === 0}
      <p class="nostr-settings-muted">{$t('settings.noRelaysConfigured')}</p>
    {:else}
      <ul class="nostr-relay-list">
        {#each relays as relay (relay.url)}
          <li class="nostr-relay-row-wrap">
            <div class="nostr-relay-row">
              <button
                type="button"
                class="nostr-relay-detail-toggle"
                aria-expanded={openUrls.has(relay.url)}
                aria-controls="nostr-relay-detail-{relay.url}"
                aria-label={$t('settings.relayDetailToggle')}
                on:click={() => toggleDetail(relay.url)}
              >
                <span class="nostr-relay-chevron" aria-hidden="true">{openUrls.has(relay.url) ? '−' : '+'}</span>
              </button>
              <div class="nostr-relay-main">
                <code class="nostr-relay-url">{relay.url}</code>
                <div class="nostr-relay-meta">
                  {#if relay.is_default}
                    <span class="nostr-relay-badge">{$t('settings.defaultRelayBadge')}</span>
                  {/if}
                  {#if relay.is_custom}
                    <span class="nostr-relay-badge nostr-relay-badge--custom">{$t('settings.customRelayBadge')}</span>
                  {/if}
                  <span class="nostr-relay-mode">{relayModeLabel(relay.mode)}</span>
                  <span class="nostr-relay-status {statusClass(relay.status, relay.enabled)}">
                    {relay.enabled ? relayStatusLabel(relay.status) : $t('settings.relayOff')}
                  </span>
                </div>
              </div>
              <div class="nostr-relay-actions">
                <label class="nostr-relay-toggle">
                  <input
                    type="checkbox"
                    checked={relay.enabled}
                    disabled={busyUrl === relay.url}
                    on:change={(e) => handleToggleEnabled(relay, e.currentTarget.checked)}
                  />
                  <span>{$t('settings.relayEnabledLabel')}</span>
                </label>
                {#if relay.is_custom}
                  <button
                    type="button"
                    class="nostr-relay-remove-btn"
                    disabled={busyUrl === relay.url}
                    on:click={() => handleRemove(relay)}
                  >
                    {$t('settings.remove')}
                  </button>
                {/if}
              </div>
            </div>
            {#if openUrls.has(relay.url)}
              {@const detail = detailByUrl[relay.url]}
              <div class="nostr-relay-detail" id="nostr-relay-detail-{relay.url}">
                {#if detail?.loading && !detail.metrics}
                  <p class="nostr-settings-muted">{$t('settings.loadingRelayDetail')}</p>
                {:else}
                  <div class="nostr-relay-detail-head">
                    <RefreshIconButton
                      spinning={detail?.loading ?? false}
                      disabled={detail?.loading ?? false}
                      ariaLabel={detail?.loading ? $t('settings.refreshingRelayDetail') : $t('settings.refreshRelayDetail')}
                      on:click={() => loadDetail(relay.url)}
                    />
                  </div>
                  {#if detail?.error}
                    <p class="nostr-settings-error" role="alert">{detail.error}</p>
                  {/if}
                  {#if detail?.metrics}
                    {#if hasRelayHealthData(detail.metrics)}
                      <dl class="nostr-relay-detail-stats">
                        <div>
                          <dt>{$t('settings.relayPingLabel')}</dt>
                          <dd>{detail.metrics.ping_ms !== null ? `${detail.metrics.ping_ms} ms` : '—'}</dd>
                        </div>
                        <div>
                          <dt>{$t('settings.relayLastCheckedLabel')}</dt>
                          <dd>{detail.metrics.last_check !== null ? unixToTimestamp(detail.metrics.last_check) : '—'}</dd>
                        </div>
                      </dl>
                    {:else}
                      <p class="nostr-settings-muted">{$t('settings.relayNotYetChecked')}</p>
                    {/if}
                    <dl class="nostr-relay-detail-stats">
                      <div>
                        <dt>{$t('settings.relayApproxBytesLabel')}</dt>
                        <dd>{formatFileSize(detail.metrics.bytes_up)} ↑ / {formatFileSize(detail.metrics.bytes_down)} ↓</dd>
                      </div>
                      <div>
                        <dt>{$t('settings.relayApproxEventsLabel')}</dt>
                        <dd>{detail.metrics.events_sent} ↑ / {detail.metrics.events_received} ↓</dd>
                      </div>
                    </dl>
                    {#if detail.logs.length > 0}
                      <div class="nostr-relay-detail-logs">
                        <h4 class="nostr-relay-detail-logs-title">{$t('settings.relayRecentActivityLabel')}</h4>
                        <ul class="nostr-relay-detail-log-list">
                          {#each detail.logs as log (log.timestamp + log.message)}
                            <li class="nostr-relay-detail-log-entry nostr-relay-detail-log-entry--{log.level}">
                              <span class="nostr-relay-detail-log-time">{unixToTimestamp(log.timestamp)}</span>
                              <span class="nostr-relay-detail-log-message">{log.message}</span>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                  {/if}
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</SettingsCollapsibleSection>

<EvmAccountKeyExportModal
  variant="nostr"
  open={exportModalOpen}
  npub={userNpub}
  onClose={() => (exportModalOpen = false)}
/>

<style>
  .nostr-npub-block {
    margin-bottom: 28px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .nostr-npub-note {
    margin: 0 0 12px 0;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.45;
  }

  .nostr-npub-note strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .nostr-npub-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  .nostr-npub-value {
    flex: 1;
    min-width: 0;
    font-size: 0.875rem;
    line-height: 1.45;
    word-break: break-all;
    color: var(--text-primary);
  }

  .nostr-npub-copy-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .nostr-npub-copy-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .nostr-export-key-btn {
    margin-top: 12px;
    min-height: 2rem;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-hover);
    color: var(--text-primary);
    font-size: 0.8125rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
  }

  .nostr-export-key-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .nostr-settings-lead {
    margin: 0 0 24px 0;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1.5;
  }

  .nostr-settings-code {
    font-size: 0.875em;
    padding: 0.1em 0.35em;
    border-radius: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
  }

  .nostr-settings-subheading {
    margin: 0 0 12px 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .nostr-settings-muted {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.9375rem;
  }

  .nostr-settings-error {
    margin: 8px 0 0 0;
    color: var(--danger);
    font-size: 0.875rem;
  }

  .nostr-add-relay {
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .nostr-add-relay-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: flex-end;
  }

  .nostr-add-relay-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 140px;
  }

  .nostr-add-relay-field--grow {
    flex: 1;
    min-width: 220px;
  }

  .nostr-add-relay-label {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .nostr-add-relay-input,
  .nostr-add-relay-select {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-family: inherit;
    outline: none;
  }

  .nostr-add-relay-input:focus,
  .nostr-add-relay-select:focus {
    border-color: var(--accent);
  }

  .nostr-add-relay-input:disabled,
  .nostr-add-relay-select:disabled {
    opacity: 0.65;
  }

  .nostr-add-relay-btn {
    padding: 10px 18px;
    border: none;
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    font-size: 0.9375rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    outline: none;
  }

  .nostr-add-relay-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .nostr-add-relay-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .nostr-relay-list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .nostr-relay-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .nostr-relay-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-elevated);
  }

  .nostr-relay-main {
    flex: 1;
    min-width: 200px;
  }

  .nostr-relay-url {
    display: block;
    font-size: 0.875rem;
    word-break: break-all;
    color: var(--text-primary);
  }

  .nostr-relay-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
  }

  .nostr-relay-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-muted);
  }

  .nostr-relay-badge--custom {
    background: rgba(88, 101, 242, 0.15);
    color: var(--accent);
  }

  .nostr-relay-mode {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .nostr-relay-status {
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .nostr-relay-status--ok {
    color: var(--success);
  }

  .nostr-relay-status--pending {
    color: var(--warning);
  }

  .nostr-relay-status--warn {
    color: var(--text-muted);
  }

  .nostr-relay-status--off {
    color: var(--text-muted);
  }

  .nostr-relay-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  .nostr-relay-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .nostr-relay-toggle input {
    accent-color: var(--accent);
  }

  .nostr-relay-remove-btn {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--danger);
    font-size: 0.8125rem;
    font-family: inherit;
    cursor: pointer;
    outline: none;
  }

  .nostr-relay-remove-btn:hover:not(:disabled) {
    background: rgba(242, 63, 66, 0.08);
  }

  .nostr-relay-remove-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .nostr-relay-detail-toggle {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-panel);
    color: var(--text-secondary);
    font-size: 0.9375rem;
    line-height: 1;
    cursor: pointer;
  }

  .nostr-relay-detail-toggle:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .nostr-relay-chevron {
    display: block;
  }

  .nostr-relay-detail {
    /* No explicit width: this app has no global box-sizing:border-box reset,
       so `width: 100%` (content-box) would add padding/border on top of the
       container's full width and overflow past `.nostr-relay-row` above it.
       `width: auto` (the block default) self-adjusts to match exactly. */
    margin-top: 4px;
    padding: 12px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  .nostr-relay-detail-head {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    margin-bottom: 10px;
  }

  .nostr-relay-detail-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 28px;
    margin: 0 0 10px 0;
  }

  .nostr-relay-detail-stats dt {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .nostr-relay-detail-stats dd {
    margin: 2px 0 0 0;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .nostr-relay-detail-logs-title {
    margin: 0 0 6px 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .nostr-relay-detail-log-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .nostr-relay-detail-log-entry {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .nostr-relay-detail-log-entry--warn {
    color: var(--warning);
  }

  .nostr-relay-detail-log-entry--error {
    color: var(--danger);
  }

  .nostr-relay-detail-log-time {
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .nostr-relay-detail-log-message {
    word-break: break-word;
  }
</style>
