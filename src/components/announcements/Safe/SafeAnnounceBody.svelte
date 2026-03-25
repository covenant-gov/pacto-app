<script lang="ts">
  import {
    ANNOUNCE_TYPE_SAFE_UPDATED,
    ANNOUNCE_TYPE_SAFE_PROPOSAL,
    type SafeUpdatedPayload,
    type SafeProposalPayload,
  } from '../../../lib/announcements';

  /** Safe-related announcement (address updated or proposal). */
  export let announce:
    | { type: typeof ANNOUNCE_TYPE_SAFE_UPDATED; payload: SafeUpdatedPayload }
    | { type: typeof ANNOUNCE_TYPE_SAFE_PROPOSAL; payload: SafeProposalPayload };
  export let authorName: string = '';
  export let timestamp: string = '';

  function formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }
</script>

{#if announce.type === ANNOUNCE_TYPE_SAFE_UPDATED}
  {@const payload = announce.payload}
  <div class="safe-icon" aria-hidden="true">🛡️</div>
  <div class="safe-body">
    <p class="safe-title">Safe address updated</p>
    <p class="safe-detail">Address: <code class="safe-address">{shortAddress(payload.safe_address)}</code></p>
    {#if authorName || timestamp}
      <p class="safe-meta">
        {#if authorName}{authorName}{/if}
        {#if authorName && timestamp}<span class="safe-meta-sep"> · </span>{/if}
        {#if timestamp}<time datetime={timestamp}>{formatTime(timestamp)}</time>{/if}
      </p>
    {/if}
  </div>
{:else if announce.type === ANNOUNCE_TYPE_SAFE_PROPOSAL}
  {@const payload = announce.payload}
  <div class="safe-icon" aria-hidden="true">📋</div>
  <div class="safe-body">
    <p class="safe-title">Safe proposal</p>
    <p class="safe-detail">
      Send {payload.amount} {payload.token === 'ETH' ? 'ETH' : shortAddress(payload.token)} to <code class="safe-address">{shortAddress(payload.to)}</code>
    </p>
    {#if authorName || timestamp}
      <p class="safe-meta">
        {#if authorName}{authorName}{/if}
        {#if authorName && timestamp}<span class="safe-meta-sep"> · </span>{/if}
        {#if timestamp}<time datetime={timestamp}>{formatTime(timestamp)}</time>{/if}
      </p>
    {/if}
    <div class="safe-actions">
      <button type="button" class="safe-btn" disabled>
        Sign
      </button>
      <button type="button" class="safe-btn safe-btn-secondary" disabled>
        Execute
      </button>
    </div>
  </div>
{/if}

<style>
  .safe-icon {
    font-size: 1.25rem;
    flex-shrink: 0;
  }

  .safe-body {
    flex: 1;
    min-width: 0;
  }

  .safe-title {
    margin: 0 0 4px 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .safe-detail {
    margin: 0 0 4px 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .safe-address {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    background: var(--bg-muted, rgba(0, 0, 0, 0.06));
    padding: 2px 6px;
    border-radius: 4px;
  }

  .safe-meta {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .safe-meta-sep {
    opacity: 0.8;
  }

  .safe-actions {
    margin-top: 8px;
    display: flex;
    gap: 8px;
  }

  .safe-btn {
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: not-allowed;
    opacity: 0.6;
  }

  .safe-btn-secondary {
    border-style: dashed;
  }
</style>
