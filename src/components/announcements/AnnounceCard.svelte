<script lang="ts">
  import {
    ANNOUNCE_TYPE_SAFE_UPDATED,
    ANNOUNCE_TYPE_SAFE_PROPOSAL,
    ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE,
    type AnnounceMessage,
  } from '../../lib/announcements';
  import SafeAnnounceBody from './Safe/SafeAnnounceBody.svelte';
  import SignerShareAnnounceBody from './SignerShareAnnounceBody.svelte';

  export let id: string = '';
  export let announce: AnnounceMessage;
  export let authorName: string = '';
  /** Sender npub (MLS group messages); used by signer-share card to highlight which member posted this update. */
  export let authorNpub: string | undefined = undefined;
  export let timestamp: string = '';

  type SafeAnnounceOnly = Extract<
    AnnounceMessage,
    | { type: typeof ANNOUNCE_TYPE_SAFE_UPDATED }
    | { type: typeof ANNOUNCE_TYPE_SAFE_PROPOSAL }
  >;

  $: safeAnnounceOnly =
    announce.type === ANNOUNCE_TYPE_SAFE_UPDATED || announce.type === ANNOUNCE_TYPE_SAFE_PROPOSAL
      ? (announce as SafeAnnounceOnly)
      : null;

  $: signerSharePayload =
    announce.type === ANNOUNCE_TYPE_SQUAD_MEMBER_EVM_SHARE ? announce.payload : null;

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
  {#if signerSharePayload}
    <SignerShareAnnounceBody
      payload={signerSharePayload}
      {authorName}
      {authorNpub}
      {timestamp}
    />
  {:else if safeAnnounceOnly}
    <SafeAnnounceBody announce={safeAnnounceOnly} {authorName} {timestamp} />
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
