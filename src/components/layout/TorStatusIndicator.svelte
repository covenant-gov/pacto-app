<script lang="ts">
  import { t } from 'svelte-i18n';
  import { torRoutingEnabled, toggleTorRouting } from '../../stores/tor';
  import { getTorStatus, type TorStatus } from '../../lib/api/tor';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { formatFileSize } from '../../lib/messaging/attachment-composer';
  import torIcon from '../../icons/tor.svg';

  // "Enabled for" only ever displays whole minutes (below), so there's no
  // need to poll fast enough to catch every second -- this also means far
  // fewer `get_tor_status` IPC round-trips while the popover sits open.
  const POLL_INTERVAL_MS = 15000;

  let open = $state(false);
  let status = $state<TorStatus | null>(null);
  let loadError = $state<string | null>(null);
  let disconnectError = $state<string | null>(null);
  let disconnecting = $state(false);
  let rootEl: HTMLDivElement | undefined = $state();
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  function togglePopover(): void {
    open = !open;
  }

  function closePopover(): void {
    open = false;
  }

  async function loadStatus(): Promise<void> {
    try {
      status = await getTorStatus();
      loadError = null;
    } catch (e) {
      loadError = getInvokeErrorMessage(e, $t('nav.topNavbar.torStatus.loadError'));
    }
  }

  /**
   * Only ever handles turning Tor off: the checkbox is always checked when
   * it's reachable at all (the popover only opens while `torRoutingEnabled`
   * is true), so it never needs to handle the opposite direction. The
   * popover stays mounted after a successful disconnect (see the root
   * `{#if}` below) so the checkbox visibly flips to unchecked and a
   * confirmation replaces the stats, instead of the whole indicator
   * vanishing out from under the cursor.
   */
  async function handleDisconnect(e: Event): Promise<void> {
    const checked = (e.currentTarget as HTMLInputElement).checked;
    if (checked) return;
    disconnecting = true;
    disconnectError = null;
    const err = await toggleTorRouting(false, $t('nav.topNavbar.torStatus.disconnectError'));
    if (err) disconnectError = err;
    disconnecting = false;
  }

  function onDocumentClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && rootEl && !rootEl.contains(target)) closePopover();
  }

  function onDocumentKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') closePopover();
  }

  // Outside-click / Escape stay live for as long as the popover is open,
  // independent of whether routing is still enabled (a user who just
  // disconnected can still dismiss the confirmation this way).
  $effect(() => {
    if (!open) return;
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onDocumentKeydown, true);
    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onDocumentKeydown, true);
    };
  });

  // Only polls while the popover is open *and* routing is still enabled --
  // nothing new to fetch once the user has disconnected.
  $effect(() => {
    if (!open || !$torRoutingEnabled) return;
    void loadStatus();
    pollTimer = setInterval(() => void loadStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(pollTimer);
  });

  /** "3m" / "1h 4m" -- whole minutes only, matching the poll cadence above. */
  function formatElapsed(seconds: number): string {
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }
</script>

{#if $torRoutingEnabled || open}
  <div class="tor-indicator-root" bind:this={rootEl}>
    <button
      type="button"
      class="tor-indicator-trigger"
      class:tor-indicator-trigger-off={!$torRoutingEnabled}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={$torRoutingEnabled ? $t('nav.topNavbar.torActiveIndicator') : $t('nav.topNavbar.torStatus.title')}
      title={$torRoutingEnabled ? $t('nav.topNavbar.torActiveIndicator') : $t('nav.topNavbar.torStatus.title')}
      onclick={togglePopover}
    >
      <img src={torIcon} alt="" />
    </button>

    {#if open}
      <div class="tor-indicator-popover" role="dialog" aria-label={$t('nav.topNavbar.torStatus.title')}>
        <p class="tor-indicator-popover-title">{$t('nav.topNavbar.torStatus.title')}</p>

        <label class="tor-indicator-toggle">
          <input
            type="checkbox"
            checked={$torRoutingEnabled}
            disabled={disconnecting}
            onchange={handleDisconnect}
          />
          <span>{$t('nav.topNavbar.torStatus.enabledCheckbox')}</span>
        </label>

        {#if disconnectError}
          <p class="tor-indicator-popover-error" role="alert">{disconnectError}</p>
        {/if}

        {#if !$torRoutingEnabled}
          <p class="tor-indicator-popover-loading">{$t('nav.topNavbar.torStatus.disconnected')}</p>
        {:else if loadError}
          <p class="tor-indicator-popover-error" role="alert">{loadError}</p>
        {:else if !status}
          <p class="tor-indicator-popover-loading">{$t('nav.topNavbar.torStatus.loading')}</p>
        {:else}
          <div
            class="tor-indicator-state"
            data-state={status.blocked_reason ? 'blocked' : status.bootstrapped ? 'connected' : 'connecting'}
          >
            <span class="tor-indicator-state-dot" aria-hidden="true"></span>
            {#if status.blocked_reason}
              {status.blocked_reason}
            {:else if status.bootstrapped}
              {$t('nav.topNavbar.torStatus.stateConnected')}
            {:else}
              {$t('nav.topNavbar.torStatus.stateConnecting', {
                values: { percent: Math.round(status.bootstrap_fraction * 100) },
              })}
            {/if}
          </div>

          <dl class="tor-indicator-stats">
            <div>
              <dt>{$t('nav.topNavbar.torStatus.activeConnections')}</dt>
              <dd>{status.active_connections}</dd>
            </div>
            <div>
              <dt>{$t('nav.topNavbar.torStatus.dataTransferred')}</dt>
              <dd>{formatFileSize(status.bytes_up)} ↑ / {formatFileSize(status.bytes_down)} ↓</dd>
            </div>
            <div>
              <dt>{$t('nav.topNavbar.torStatus.avgLatency')}</dt>
              <dd>{status.avg_connect_latency_ms !== null ? `${status.avg_connect_latency_ms} ms` : '—'}</dd>
            </div>
            <div>
              <dt>{$t('nav.topNavbar.torStatus.enabledFor')}</dt>
              <dd>{status.enabled_seconds !== null ? formatElapsed(status.enabled_seconds) : '—'}</dd>
            </div>
          </dl>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .tor-indicator-root {
    position: relative;
    display: inline-flex;
    margin-left: auto;
  }

  .tor-indicator-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    margin: -4px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 50%;
  }

  .tor-indicator-trigger:hover,
  .tor-indicator-trigger:focus-visible {
    background: var(--bg-hover);
  }

  .tor-indicator-trigger img {
    width: 20px;
    height: 20px;
  }

  .tor-indicator-trigger-off img {
    opacity: 0.4;
    filter: grayscale(1);
  }

  .tor-indicator-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    width: 280px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }

  .tor-indicator-popover-title {
    margin: 0 0 8px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .tor-indicator-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 10px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .tor-indicator-toggle input {
    accent-color: var(--brand);
  }

  .tor-indicator-toggle input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tor-indicator-popover-error {
    margin: 0;
    font-size: 0.75rem;
    color: var(--danger);
  }

  .tor-indicator-popover-loading {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .tor-indicator-state {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 10px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .tor-indicator-state-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warning);
    flex-shrink: 0;
  }

  .tor-indicator-state[data-state='connected'] .tor-indicator-state-dot {
    background: var(--success);
  }

  .tor-indicator-state[data-state='blocked'] .tor-indicator-state-dot {
    background: var(--danger);
  }

  .tor-indicator-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 12px;
    margin: 0;
  }

  .tor-indicator-stats dt {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--text-muted);
  }

  .tor-indicator-stats dd {
    margin: 2px 0 0 0;
    font-size: 0.8125rem;
    color: var(--text-primary);
  }
</style>
