<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import type { SquadBotAnnounceMessage } from '../../lib/squad/squad-bot-announce';
  import { shortNpub } from '../../lib/squad/squad-bot-announce';
  import { currentUser } from '../../stores/auth';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';

  export let id: string = '';
  export let announce: SquadBotAnnounceMessage;
  export let authorName: string = '';
  export let authorNpub: string | undefined = undefined;
  export let timestamp: string = '';

  const tFn = get(t);

  $: isMine =
    Boolean(authorNpub && $currentUser?.npub && authorNpub === $currentUser.npub);

  $: title =
    announce.kind === 'meta'
      ? isMine
        ? tFn('announcements.squadBot.rosterMine')
        : tFn('announcements.squadBot.rosterTheirs', { values: { authorName: authorName || tFn('announcements.squadBot.aMember') } })
      : announce.kind === 'key_rotated'
        ? isMine
          ? tFn('announcements.squadBot.rotatedMine')
          : tFn('announcements.squadBot.rotatedTheirs', { values: { authorName: authorName || tFn('announcements.squadBot.aMember') } })
        : tFn('announcements.squadBot.updateTitle');

  $: holderCount =
    announce.kind === 'meta' ? announce.payload.holders.length : null;

  $: botNpub =
    announce.kind === 'meta' || announce.kind === 'key_rotated'
      ? announce.payload.botNpub
      : '';

  $: keyEpoch =
    announce.kind === 'meta' || announce.kind === 'key_rotated'
      ? announce.payload.keyEpoch
      : null;
</script>

<div class="announce-card" id={id ? `msg-${id}` : undefined} data-squad-bot-announce={announce.kind}>
  <div class="announce-body">
    <p class="announce-title">{title}</p>
    <ul class="announce-details">
      {#if holderCount != null}
        <li>{$t('announcements.squadBot.keyHolders', { values: { count: holderCount } })}</li>
      {/if}
      {#if keyEpoch != null}
        <li>{$t('announcements.squadBot.keyEpoch', { values: { keyEpoch } })}</li>
      {/if}
      {#if botNpub}
        <li>{$t('announcements.squadBot.botLabel', { values: { shortNpub: shortNpub(botNpub) } })} <code title={botNpub}>{shortNpub(botNpub)}</code></li>
      {/if}
    </ul>
    <p class="announce-meta">
      {#if timestamp}{formatMessageTimestamp(timestamp)}{/if}
    </p>
  </div>
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
    margin: 0 0 6px 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .announce-details {
    margin: 0 0 6px 0;
    padding-left: 1.1rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .announce-details code {
    font-family: ui-monospace, 'Courier New', monospace;
    font-size: 0.8125rem;
  }

  .announce-meta {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
