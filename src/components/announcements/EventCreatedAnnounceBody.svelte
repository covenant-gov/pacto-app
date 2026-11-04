<svelte:options runes={true} />

<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { squadEventCardView, type SquadEventCreatedPayload } from '../../lib/announcements';
  import type { SquadEventDto } from '../../lib/api/squad-events';
  import {
    formatEventStart,
    formatEventZoneStart,
    viewerTimeZone,
  } from '../../lib/squad/squad-event-display';
  import { eventChannelName } from '../../lib/squad/squad-event-form';
  import { squads } from '../../stores/squads';
  import { squadEventReplicaNonceByParentId } from '../../stores/events-hub-alerts';
  import { focusSquadEvent } from '../../stores/events-navigation';
  import { formatMessageTimestamp } from '../../lib/utils/message-formatting';
  import { squadEventRowsForCards } from '../../lib/squad/squad-event-card-replica';

  let {
    payload,
    authorName,
    timestamp,
  }: {
    payload: SquadEventCreatedPayload;
    authorName: string;
    timestamp: string;
  } = $props();

  let rows = $state<SquadEventDto[] | null>(null);

  $effect(() => {
    const parentId = payload.parent_id;
    const nonce = $squadEventReplicaNonceByParentId[parentId] ?? 0;
    let stale = false;
    void squadEventRowsForCards(parentId, nonce).then((r) => {
      if (!stale) rows = r;
    });
    return () => {
      stale = true;
    };
  });

  const view = $derived(squadEventCardView(payload, rows));
  const timeOpts = $derived({ locale: $locale ?? undefined, viewerZone: viewerTimeZone() });
  const startLabel = $derived(formatEventStart(view.start, timeOpts));
  const zoneStart = $derived(formatEventZoneStart(view.start, timeOpts));
  const channelName = $derived(
    eventChannelName($squads.find((s) => s.id === payload.parent_id)?.channels ?? [], payload.channel_id)
  );
</script>

<button
  type="button"
  class="event-announce-body"
  aria-label={$t('events.card.openAria', { values: { title: view.title } })}
  disabled={view.unavailable}
  onclick={() => {
    if (!view.unavailable) focusSquadEvent(payload.parent_id, payload.id);
  }}
>
  <span class="event-announce-badge">{$t('announcements.eventCreated.badge')}</span>
  <span class="event-announce-title">
    {view.title}
    {#if view.unavailable}
      <span class="event-announce-status">{$t('events.card.unavailable')}</span>
    {:else if view.cancelled}
      <span class="event-announce-status">{$t('events.card.cancelled')}</span>
    {/if}
  </span>
  <span
    class="event-announce-start"
    class:event-announce-start-inactive={view.cancelled || view.unavailable}
  >{startLabel}</span>
  {#if zoneStart}
    <span class="event-announce-zone">
      {$t('events.card.eventZone', { values: { zone: view.start.startTzid, time: zoneStart } })}
    </span>
  {/if}
  {#if channelName}
    <span class="event-announce-channel">#{channelName}</span>
  {/if}
  <span class="event-announce-meta">
    {#if authorName}{authorName}{/if}
    {#if timestamp} — {formatMessageTimestamp(timestamp)}{/if}
  </span>
</button>

<style>
  .event-announce-body {
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

  .event-announce-body:disabled {
    cursor: default;
  }

  .event-announce-body:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 4px;
    border-radius: 4px;
  }

  .event-announce-badge {
    margin-bottom: 2px;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--brand);
  }

  .event-announce-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.35;
  }

  .event-announce-status {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--danger);
    border: 1px solid currentColor;
  }

  .event-announce-start {
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .event-announce-start-inactive {
    text-decoration: line-through;
    color: var(--text-muted);
  }

  .event-announce-zone,
  .event-announce-channel,
  .event-announce-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
</style>
