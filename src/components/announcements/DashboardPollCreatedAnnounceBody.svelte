<script lang="ts">
  import type { DashboardPollCreatedPayload } from '../../lib/announcements';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';

  export let payload: DashboardPollCreatedPayload;
  export let authorName: string;
  export let timestamp: string;
</script>

<div class="poll-announce-body">
  <p class="poll-announce-badge">New poll</p>
  <h3 class="poll-announce-title">{payload.title}</h3>
  <p class="poll-announce-hint">
    Open <strong>Dashboard → Polls</strong> for this squad or network to cast your vote. Tallies sync for everyone in
    #announcements.
  </p>
  <p class="poll-announce-meta">
    {#if authorName}{authorName}{/if}
    {#if timestamp} — {formatMessageTimestamp(timestamp)}{/if}
  </p>
</div>

<style>
  .poll-announce-body {
    flex: 1;
    min-width: 0;
  }

  .poll-announce-badge {
    margin: 0 0 6px 0;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
  }

  .poll-announce-title {
    margin: 0 0 8px 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.35;
  }

  .poll-announce-hint {
    margin: 0 0 6px 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }

  .poll-announce-meta {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
