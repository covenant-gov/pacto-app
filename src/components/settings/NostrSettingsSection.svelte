<script lang="ts">
  import { onMount } from 'svelte';
  import {
    addCustomRelay,
    getRelayCertificate,
    getRelayLogs,
    getRelayMetrics,
    listRelays,
    probeRelay,
    relayModeLabel,
    relayStatusLabel,
    removeCustomRelay,
    setRelayEnabled,
    toggleCustomRelay,
    validateRelayUrlInput,
    type RelayCertificate,
    type RelayInfo,
    type RelayLog,
    type RelayMetrics,
    type RelayMode,
    type ProbeResult,
  } from '../../lib/api/relays';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
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
      showToast('Could not copy nPub.');
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

  // Pre-add probe state
  let probeResult: ProbeResult | null = null;
  let probing = false;

  // Per-relay detail panel state (keyed by normalized relay URL)
  const expandedRelays = new Set<string>();
  let expandedSnapshot = '';
  const relayDiagnostics = new Map<
    string,
    {
      logs: RelayLog[];
      metrics: RelayMetrics | null;
      certificate: RelayCertificate | null;
      loading: boolean;
      error: string | null;
    }
  >();

  // Force reactive updates for Map/Set state.
  function bumpDiagnostics() {
    expandedSnapshot = Date.now().toString();
  }

  function isExpanded(url: string): boolean {
    return expandedRelays.has(url);
  }

  function toggleExpanded(url: string) {
    if (expandedRelays.has(url)) {
      expandedRelays.delete(url);
    } else {
      expandedRelays.add(url);
      void loadDiagnostics(url);
    }
    bumpDiagnostics();
  }

  function formatUnixTimestamp(seconds: number): string {
    return formatMessageTimestamp(new Date(seconds * 1000).toISOString()) || '—';
  }

  function probeStatusLabel(status: string): string {
    switch (status) {
      case 'healthy':
        return 'Healthy';
      case 'timeout':
        return 'Timed out';
      case 'connection_refused':
        return 'Connection refused';
      case 'dns_failed':
        return 'DNS lookup failed';
      case 'not_a_relay':
        return 'Not a Nostr relay';
      case 'protocol_error':
        return 'Protocol error';
      case 'tls_certificate_expired':
        return 'TLS certificate expired';
      case 'tls_certificate_invalid':
        return 'TLS certificate invalid';
      case 'tls_failed':
        return 'TLS handshake failed';
      case 'connection_failed':
        return 'Connection failed';
      default:
        return status ? status.replace(/_/g, ' ') : 'Unknown';
    }
  }

  function probeStatusClass(status: string): string {
    if (status === 'healthy') return 'nostr-probe-status--ok';
    return 'nostr-probe-status--warn';
  }

  function logLevelClass(level: string): string {
    switch (level) {
      case 'error':
        return 'nostr-log-level--error';
      case 'warn':
        return 'nostr-log-level--warn';
      default:
        return 'nostr-log-level--info';
    }
  }

  function certificateStatusClass(cert: RelayCertificate): string {
    if (cert.validation_error) return 'nostr-cert-status--warn';
    const now = Date.now() / 1000;
    if (cert.not_after < now) return 'nostr-cert-status--warn';
    if (cert.not_after - now < 7 * 24 * 60 * 60) return 'nostr-cert-status--pending';
    return 'nostr-cert-status--ok';
  }

  function certificateSummary(cert: RelayCertificate): string {
    if (cert.validation_error) {
      return `Invalid — ${cert.validation_error}`;
    }
    const now = Date.now() / 1000;
    if (cert.not_after < now) {
      return 'Expired';
    }
    const days = Math.floor((cert.not_after - now) / (24 * 60 * 60));
    if (days < 0) return 'Expired';
    return `${days} day${days === 1 ? '' : 's'} until expiry`;
  }

  function truncateMessage(message: string, max = 200): string {
    if (message.length <= max) return message;
    return `${message.slice(0, max)}…`;
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / k ** i).toFixed(i ? 1 : 0)} ${sizes[i]}`;
  }

  async function loadDiagnostics(url: string) {
    let entry = relayDiagnostics.get(url);
    if (!entry) {
      entry = { logs: [], metrics: null, certificate: null, loading: true, error: null };
      relayDiagnostics.set(url, entry);
    } else {
      entry.loading = true;
      entry.error = null;
    }
    bumpDiagnostics();

    try {
      const [logs, metrics, certificate] = await Promise.all([
        getRelayLogs(url).catch((e) => {
          console.error('Failed to load relay logs:', e);
          return [] as RelayLog[];
        }),
        getRelayMetrics(url).catch((e) => {
          console.error('Failed to load relay metrics:', e);
          return null;
        }),
        getRelayCertificate(url).catch((e) => {
          console.error('Failed to load relay certificate:', e);
          return null;
        }),
      ]);
      entry.logs = logs.slice(0, 20);
      entry.metrics = metrics;
      entry.certificate = certificate;
    } catch (e) {
      entry.error = getInvokeErrorMessage(e, 'Could not load relay details.');
    } finally {
      entry.loading = false;
      bumpDiagnostics();
    }
  }

  async function handleProbeAndAdd() {
    addError = validateRelayUrlInput(newRelayUrl);
    if (addError || probing || adding) return;

    probing = true;
    probeResult = null;
    try {
      const result = await probeRelay(newRelayUrl.trim());
      probeResult = result;
      if (result.status === 'healthy') {
        await doAddRelay();
      }
    } catch (e) {
      probeResult = { status: 'unknown', message: getInvokeErrorMessage(e, 'Probe failed.') };
    } finally {
      probing = false;
    }
  }

  async function handleAddAnyway() {
    await doAddRelay(false);
  }

  async function doAddRelay(enabled = true) {
    addError = validateRelayUrlInput(newRelayUrl);
    if (addError || adding) return;

    adding = true;
    try {
      const added = await addCustomRelay(newRelayUrl.trim(), newRelayMode);
      const addedUrl = added.url;
      newRelayUrl = '';
      newRelayMode = 'both';
      probeResult = null;
      await refreshRelays();
      if (!enabled) {
        // add_custom_relay always saves enabled; disable it if the user chose
        // "Add anyway" after a failed probe.
        await toggleCustomRelay(addedUrl, false).catch(() => {
          // Swallow; the relay exists, just may remain enabled.
        });
        await refreshRelays();
      }
      showToast(enabled ? 'Custom relay added.' : 'Custom relay added as disabled.');
    } catch (e) {
      addError = getInvokeErrorMessage(e, 'Could not add relay.');
      showToast(addError);
    } finally {
      adding = false;
    }
  }

  async function handleAddRelay() {
    // The legacy Add button now probes first. If the user wants to skip the
    // probe on a known-good URL, they can still confirm after seeing the result.
    await handleProbeAndAdd();
  }

  const MODE_OPTIONS: { value: RelayMode; label: string }[] = [
    { value: 'both', label: 'Read & write' },
    { value: 'read', label: 'Read only' },
    { value: 'write', label: 'Write only' },
  ];

  onMount(() => {
    void refreshRelays();
  });

  async function refreshRelays() {
    loading = true;
    loadError = null;
    try {
      relays = await listRelays();
    } catch (e) {
      loadError = getInvokeErrorMessage(e, 'Could not load relays.');
    } finally {
      loading = false;
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
      showToast(getInvokeErrorMessage(e, 'Could not update relay.'));
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
        showToast('Custom relay removed.');
      } else {
        showToast('Relay not found.');
      }
    } catch (e) {
      showToast(getInvokeErrorMessage(e, 'Could not remove relay.'));
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

  function hasFailureReason(relay: RelayInfo): boolean {
    return relay.enabled && relay.status !== 'connected' && !!relay.failure_reason;
  }
</script>

<SettingsCollapsibleSection sectionId="settings-nostr" title="Nostr settings">

  <div class="nostr-npub-block" aria-labelledby="nostr-npub-heading">
    <h3 id="nostr-npub-heading" class="nostr-settings-subheading">nPub</h3>
    <p class="nostr-npub-note">
      Same as <strong>Account ID</strong>  — your sharable public Nostr identity on relays, that is linked to your EVM accounts within the Pacto client.
    </p>
    {#if userNpub}
      <div class="nostr-npub-row">
        <code class="nostr-npub-value">{userNpub}</code>
        <button
          type="button"
          class="nostr-npub-copy-btn"
          aria-label={copiedNpub ? 'Copied' : 'Copy nPub'}
          title={copiedNpub ? 'Copied' : 'Copy'}
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
        Export key
      </button>
    {:else}
      <p class="nostr-settings-muted">Log in to see your nPub.</p>
    {/if}
  </div>

  <p class="nostr-settings-lead">
    Relays power your Kind 0 profile, direct messages, and squad channels. Defaults ship with the app; add your own
    <code class="nostr-settings-code">wss://</code> endpoints when needed.
  </p>

  <div class="nostr-add-relay" aria-labelledby="nostr-add-relay-heading">
    <h3 id="nostr-add-relay-heading" class="nostr-settings-subheading">Add custom relay</h3>
    <div class="nostr-add-relay-row">
      <label class="nostr-add-relay-field nostr-add-relay-field--grow">
        <span class="nostr-add-relay-label">Relay URL</span>
        <input
          type="url"
          class="nostr-add-relay-input"
          placeholder="wss://relay.example.com"
          bind:value={newRelayUrl}
          disabled={adding || probing}
          autocomplete="off"
          spellcheck="false"
          on:keydown={(e) => e.key === 'Enter' && handleAddRelay()}
        />
      </label>
      <label class="nostr-add-relay-field">
        <span class="nostr-add-relay-label">Mode</span>
        <select class="nostr-add-relay-select" bind:value={newRelayMode} disabled={adding || probing}>
          {#each MODE_OPTIONS as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </label>
      <button type="button" class="nostr-add-relay-btn" disabled={adding || probing} on:click={handleAddRelay}>
        {#if probing}
          Testing…
        {:else if adding}
          Adding…
        {:else}
          Add
        {/if}
      </button>
    </div>
    {#if addError}
      <p class="nostr-settings-error" role="alert">{addError}</p>
    {/if}
    {#if probeResult}
      <div class="nostr-probe-result {probeStatusClass(probeResult.status)}">
        <span class="nostr-probe-result-label">{probeStatusLabel(probeResult.status)}</span>
        {#if probeResult.rtt_ms != null}
          <span class="nostr-probe-result-rtt">{probeResult.rtt_ms} ms</span>
        {/if}
        {#if probeResult.message}
          <span class="nostr-probe-result-message">{probeResult.message}</span>
        {/if}
        {#if probeResult.status !== 'healthy'}
          <button
            type="button"
            class="nostr-add-relay-btn nostr-add-relay-btn--secondary"
            disabled={adding}
            on:click={handleAddAnyway}
          >
            {adding ? 'Adding…' : 'Add anyway'}
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="nostr-relay-list-wrap" aria-labelledby="nostr-relay-list-heading">
    <div class="nostr-relay-list-head">
      <h3 id="nostr-relay-list-heading" class="nostr-settings-subheading">Connected relays</h3>
      <RefreshIconButton
        disabled={loading}
        spinning={loading}
        ariaLabel={loading ? 'Refreshing relays' : 'Refresh relays'}
        on:click={refreshRelays}
      />
    </div>

    {#if loading && relays.length === 0}
      <p class="nostr-settings-muted">Loading relays…</p>
    {:else if loadError}
      <p class="nostr-settings-error" role="alert">{loadError}</p>
    {:else if relays.length === 0}
      <p class="nostr-settings-muted">No relays configured.</p>
    {:else}
      <ul class="nostr-relay-list">
        {#each relays as relay (relay.url)}
          <li class="nostr-relay-row" class:nostr-relay-row--expanded={isExpanded(relay.url)}>
            <button
              type="button"
              class="nostr-relay-expand"
              aria-expanded={isExpanded(relay.url)}
              aria-controls="relay-details-{encodeURIComponent(relay.url)}"
              aria-label={isExpanded(relay.url) ? 'Hide relay details' : 'Show relay details'}
              on:click={() => toggleExpanded(relay.url)}
            >
              <svg
                class="nostr-relay-expand-icon"
                class:nostr-relay-expand-icon--open={isExpanded(relay.url)}
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <div class="nostr-relay-main">
              <code class="nostr-relay-url">{relay.url}</code>
              <div class="nostr-relay-meta">
                {#if relay.is_default}
                  <span class="nostr-relay-badge">Default</span>
                {/if}
                {#if relay.is_custom}
                  <span class="nostr-relay-badge nostr-relay-badge--custom">Custom</span>
                {/if}
                <span class="nostr-relay-mode">{relayModeLabel(relay.mode)}</span>
                <span class="nostr-relay-status {statusClass(relay.status, relay.enabled)}">
                  {relay.enabled ? relayStatusLabel(relay.status) : 'Off'}
                </span>
                {#if hasFailureReason(relay)}
                  <span class="nostr-relay-failure">— {relay.failure_reason}</span>
                {/if}
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
                <span>Enabled</span>
              </label>
              {#if relay.is_custom}
                <button
                  type="button"
                  class="nostr-relay-remove-btn"
                  disabled={busyUrl === relay.url}
                  on:click={() => handleRemove(relay)}
                >
                  Remove
                </button>
              {/if}
            </div>
            {#if isExpanded(relay.url)}
              {#key expandedSnapshot}
                {@const details = relayDiagnostics.get(relay.url)}
                <div
                  id="relay-details-{encodeURIComponent(relay.url)}"
                  class="nostr-relay-details"
                >
                  {#if details?.loading}
                    <p class="nostr-settings-muted">Loading details…</p>
                  {:else if details?.error}
                    <p class="nostr-settings-error" role="alert">{details.error}</p>
                  {:else}
                    {#if relay.failure_reason}
                      <div class="nostr-detail-block">
                        <h4 class="nostr-detail-title">Failure reason</h4>
                        <p class="nostr-relay-failure nostr-relay-failure--standalone">{relay.failure_reason}</p>
                      </div>
                    {/if}

                    {#if details?.metrics}
                      <div class="nostr-detail-block">
                        <h4 class="nostr-detail-title">Metrics</h4>
                        <div class="nostr-metrics-grid">
                          <div class="nostr-metric">
                            <span class="nostr-metric-label">Last ping</span>
                            <span class="nostr-metric-value">
                              {details.metrics.ping_ms != null ? `${details.metrics.ping_ms} ms` : '—'}
                            </span>
                          </div>
                          <div class="nostr-metric">
                            <span class="nostr-metric-label">Up</span>
                            <span class="nostr-metric-value">{formatBytes(details.metrics.bytes_up)}</span>
                          </div>
                          <div class="nostr-metric">
                            <span class="nostr-metric-label">Down</span>
                            <span class="nostr-metric-value">{formatBytes(details.metrics.bytes_down)}</span>
                          </div>
                          <div class="nostr-metric">
                            <span class="nostr-metric-label">Last check</span>
                            <span class="nostr-metric-value">
                              {details.metrics.last_check != null
                                ? formatUnixTimestamp(details.metrics.last_check)
                                : '—'}
                            </span>
                          </div>
                          <div class="nostr-metric">
                            <span class="nostr-metric-label">Events sent</span>
                            <span class="nostr-metric-value">{details.metrics.events_sent}</span>
                          </div>
                          <div class="nostr-metric">
                            <span class="nostr-metric-label">Events received</span>
                            <span class="nostr-metric-value">{details.metrics.events_received}</span>
                          </div>
                        </div>
                      </div>
                    {/if}

                    {#if details?.certificate}
                      {@const cert = details.certificate}
                      <div class="nostr-detail-block">
                        <h4 class="nostr-detail-title">TLS certificate</h4>
                        {#if cert.validation_error}
                          <p class="nostr-cert-validation" role="alert">{cert.validation_error}</p>
                        {/if}
                        {#if cert.subject}
                          <div class="nostr-cert-summary {certificateStatusClass(cert)}">
                            <span class="nostr-cert-summary-text">{certificateSummary(cert)}</span>
                          </div>
                          <details class="nostr-cert-details">
                            <summary>Show certificate details</summary>
                            <dl class="nostr-cert-list">
                              <div class="nostr-cert-row">
                                <dt>Subject</dt>
                                <dd>{cert.subject}</dd>
                              </div>
                              <div class="nostr-cert-row">
                                <dt>Issuer</dt>
                                <dd>{cert.issuer}</dd>
                              </div>
                              <div class="nostr-cert-row">
                                <dt>Valid from</dt>
                                <dd>{formatUnixTimestamp(cert.not_before)}</dd>
                              </div>
                              <div class="nostr-cert-row">
                                <dt>Valid until</dt>
                                <dd>{formatUnixTimestamp(cert.not_after)}</dd>
                              </div>
                              <div class="nostr-cert-row">
                                <dt>Fingerprint (SHA-256)</dt>
                                <dd>{cert.sha256_fingerprint}</dd>
                              </div>
                              <div class="nostr-cert-row">
                                <dt>Key algorithm</dt>
                                <dd>{cert.key_algorithm} ({cert.key_bits} bits)</dd>
                              </div>
                              {#if cert.san_list.length > 0}
                                <div class="nostr-cert-row">
                                  <dt>SANs</dt>
                                  <dd>{cert.san_list.join(', ')}</dd>
                                </div>
                              {/if}
                            </dl>
                          </details>
                        {:else if !cert.validation_error}
                          <p class="nostr-settings-muted">No certificate details available.</p>
                        {/if}
                      </div>
                    {/if}

                    <div class="nostr-detail-block">
                      <h4 class="nostr-detail-title">Recent logs</h4>
                      {#if details?.logs && details.logs.length > 0}
                        <ul class="nostr-relay-logs">
                          {#each details.logs as log (log.timestamp + log.message)}
                            <li class="nostr-relay-log">
                              <span class="nostr-log-timestamp">{formatUnixTimestamp(log.timestamp)}</span>
                              <span class="nostr-log-level {logLevelClass(log.level)}">{log.level.toUpperCase()}</span>
                              <span class="nostr-log-message">{truncateMessage(log.message)}</span>
                            </li>
                          {/each}
                        </ul>
                      {:else}
                        <p class="nostr-settings-muted">No recent logs.</p>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/key}
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

  .nostr-relay-row {
    position: relative;
    padding-left: 44px;
  }

  .nostr-relay-row--expanded {
    border-color: var(--border);
  }

  .nostr-relay-expand {
    position: absolute;
    left: 10px;
    top: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: color 0.2s, transform 0.2s;
  }

  .nostr-relay-expand:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .nostr-relay-expand-icon {
    transition: transform 0.2s;
  }

  .nostr-relay-expand-icon--open {
    transform: rotate(180deg);
  }

  .nostr-relay-failure {
    font-size: 0.8125rem;
    color: var(--danger);
  }

  .nostr-relay-failure--standalone {
    margin: 0;
  }

  .nostr-relay-details {
    width: 100%;
    margin-top: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--border-subtle);
  }

  .nostr-detail-block {
    margin-bottom: 18px;
  }

  .nostr-detail-title {
    margin: 0 0 8px 0;
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .nostr-metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
  }

  .nostr-metric {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
  }

  .nostr-metric-label {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .nostr-metric-value {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .nostr-relay-logs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .nostr-relay-log {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-panel);
    font-size: 0.8125rem;
  }

  .nostr-log-timestamp {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .nostr-log-level {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 4px;
  }

  .nostr-log-level--info {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .nostr-log-level--warn {
    color: var(--warning);
    background: rgba(251, 191, 36, 0.1);
  }

  .nostr-log-level--error {
    color: var(--danger);
    background: rgba(244, 114, 182, 0.1);
  }

  .nostr-log-message {
    flex: 1;
    min-width: 0;
    color: var(--text-primary);
    word-break: break-word;
  }

  .nostr-probe-result {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    font-size: 0.875rem;
  }

  .nostr-probe-status--ok {
    border-left: 3px solid var(--success);
  }

  .nostr-probe-status--warn {
    border-left: 3px solid var(--danger);
  }

  .nostr-probe-result-label {
    font-weight: 600;
  }

  .nostr-probe-result-rtt {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .nostr-probe-result-message {
    flex: 1 1 100%;
    min-width: 0;
    color: var(--text-secondary);
  }

  .nostr-probe-result .nostr-add-relay-btn {
    margin-left: auto;
  }

  .nostr-add-relay-btn--secondary {
    background: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .nostr-add-relay-btn--secondary:hover:not(:disabled) {
    background: var(--bg-elevated);
    border-color: var(--accent);
  }

  .nostr-cert-validation {
    margin: 0 0 10px 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: rgba(244, 114, 182, 0.1);
    color: var(--danger);
    font-size: 0.8125rem;
  }

  .nostr-cert-summary {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    margin-bottom: 10px;
  }

  .nostr-cert-status--ok {
    background: rgba(52, 211, 153, 0.1);
    color: var(--success);
  }

  .nostr-cert-status--pending {
    background: rgba(251, 191, 36, 0.1);
    color: var(--warning);
  }

  .nostr-cert-status--warn {
    background: rgba(244, 114, 182, 0.1);
    color: var(--danger);
  }

  .nostr-cert-details {
    font-size: 0.875rem;
  }

  .nostr-cert-details > summary {
    cursor: pointer;
    color: var(--text-secondary);
    user-select: none;
  }

  .nostr-cert-details > summary:hover {
    color: var(--text-primary);
  }

  .nostr-cert-list {
    margin: 10px 0 0 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .nostr-cert-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    align-items: baseline;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-panel);
  }

  .nostr-cert-row dt {
    flex: 0 0 130px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .nostr-cert-row dd {
    flex: 1 1 0;
    min-width: 0;
    margin: 0;
    color: var(--text-primary);
    word-break: break-all;
    font-size: 0.8125rem;
  }
</style>
