<svelte:options runes={true} />

<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { SquadDocAddedPayload } from '../../lib/announcements';
  import { eventChannelName } from '../../lib/squad/squad-event-form';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
  import { openSquadDocs } from '../../stores/docs-navigation';
  import { squads } from '../../stores/squads';

  let {
    payload,
    authorName,
    timestamp,
  }: {
    payload: SquadDocAddedPayload;
    authorName: string;
    timestamp: string;
  } = $props();

  const channelName = $derived(
    eventChannelName($squads.find((s) => s.id === payload.parent_id)?.channels ?? [], payload.channel_id)
  );
</script>

<!-- Masked link only: no reveal, no copy, no preview fetch. -->
<button
  type="button"
  class="doc-announce-body"
  aria-label={$t('docs.announce.openAria', { values: { title: payload.title } })}
  onclick={() => openSquadDocs(payload.parent_id, { docId: payload.id })}
>
  <span class="doc-announce-badge">{$t('announcements.docAdded.badge')}</span>
  <span class="doc-announce-title">{payload.title}</span>
  <span class="doc-announce-provider">{$t(`docs.provider.${payload.provider}`)}</span>
  <span class="doc-announce-url">{payload.display_url}</span>
  {#if channelName}
    <span class="doc-announce-channel">#{channelName}</span>
  {/if}
  <span class="doc-announce-meta">
    {#if authorName}{authorName}{/if}
    {#if timestamp} — {formatMessageTimestamp(timestamp)}{/if}
  </span>
</button>

<style>
  .doc-announce-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .doc-announce-body:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 4px;
    border-radius: 4px;
  }

  .doc-announce-badge {
    margin-bottom: 2px;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--brand);
  }

  .doc-announce-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.35;
  }

  .doc-announce-provider {
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .doc-announce-url {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .doc-announce-channel,
  .doc-announce-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
