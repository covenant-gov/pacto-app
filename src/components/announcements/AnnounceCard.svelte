<script lang="ts">
  import {
    ANNOUNCE_TYPE_SAFE_UPDATED,
    ANNOUNCE_TYPE_SAFE_PROPOSAL,
    type AnnounceMessage,
  } from '../../lib/announcements';
  import SafeAnnounceBody from './Safe/SafeAnnounceBody.svelte';

  export let id: string = '';
  export let announce: AnnounceMessage;
  export let authorName: string = '';
  export let timestamp: string = '';

  const isSafeAnnounce =
    announce.type === ANNOUNCE_TYPE_SAFE_UPDATED || announce.type === ANNOUNCE_TYPE_SAFE_PROPOSAL;

  function formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
</script>

<div class="announce-card" id={id ? `msg-${id}` : undefined} data-announce-type={announce.type}>
  {#if isSafeAnnounce}
    <SafeAnnounceBody {announce} {authorName} {timestamp} />
  {:else}
    <div class="announce-body">
      <p class="announce-title">Announcement</p>
      <p class="announce-meta">
        {#if authorName}{authorName}{/if}
        {#if timestamp} — {formatTime(timestamp)}{/if}
      </p>
    </div>
  {/if}
</div>

<style>
  .announce-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 16px;
    margin: 4px 0;
    background: var(--bg-hover, rgba(0, 0, 0, 0.04));
    border-radius: 8px;
    border-left: 3px solid var(--accent);
  }

  .announce-body {
    flex: 1;
    min-width: 0;
  }

  .announce-title {
    margin: 0 0 4px 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .announce-meta {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
