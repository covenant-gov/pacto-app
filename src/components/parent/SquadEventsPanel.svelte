<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import CreateEventModal from './CreateEventModal.svelte';
  import EventDetail from './EventDetail.svelte';
  import { listen } from '../../lib/api';
  import { listSquadEvents, type SquadEventDto } from '../../lib/api/squad-events';
  import { getSquadContentPolicy, type SquadContentPolicyView } from '../../lib/api/squad-content-policy';
  import {
    eventZoneDiffers,
    formatEventStart,
    formatEventZoneStart,
    rsvpCounts,
    viewerTimeZone,
  } from '../../lib/squad/squad-event-display';
  import { eventChannelName } from '../../lib/squad/squad-event-form';
  import { orderShelfEvents, shelfCreateControl, shelfOpenEvent } from '../../lib/squad/squad-events-shelf';
  import { squadRecordErrorMessage } from '../../lib/squad/squad-record-errors';
  import { squadEventReplicaNonceByParentId } from '../../stores/events-hub-alerts';
  import { eventsFocus } from '../../stores/events-navigation';
  import { squads } from '../../stores/squads';

  interface Props {
    /** Squad id (announcements MLS group id). */
    parentId: string;
    /** Announcements MLS group the event rumors ride. */
    mlsGroupId: string | null;
  }

  let { parentId, mlsGroupId }: Props = $props();

  const viewerZone = viewerTimeZone();

  let events = $state<SquadEventDto[]>([]);
  let loaded = $state(false);
  /** Last load failure, shown only while nothing is listed. */
  let loadError = $state('');
  let policy = $state<SquadContentPolicyView | null>(null);
  let policySettled = $state(false);
  let openEventId = $state<string | null>(null);
  let seriesFilter = $state<string | null>(null);
  let showCreate = $state(false);
  let nowMs = $state(Date.now());

  const pid = $derived(parentId.trim());
  const gid = $derived(mlsGroupId?.trim() ?? '');
  const replicaNonce = $derived(pid ? ($squadEventReplicaNonceByParentId[pid] ?? 0) : 0);
  const channels = $derived($squads.find((s) => s.id === pid)?.channels ?? []);
  const timeOpts = $derived({ locale: $locale ?? undefined, viewerZone });
  const ordered = $derived(orderShelfEvents(events, { nowMs, viewerZone, seriesId: seriesFilter }));
  const openEvent = $derived(shelfOpenEvent(events, openEventId));
  const createControl = $derived(shelfCreateControl(policy));

  let loadGen = 0;
  async function loadEvents(id: string): Promise<void> {
    const gen = ++loadGen;
    try {
      const rows = await listSquadEvents(id);
      if (gen !== loadGen) return;
      events = rows;
      loadError = '';
    } catch (e) {
      if (gen !== loadGen) return;
      const tFn = get(t);
      loadError = squadRecordErrorMessage(e, tFn, tFn('events.panel.errorLoad'));
    } finally {
      if (gen === loadGen) {
        loaded = true;
        nowMs = Date.now();
      }
    }
  }

  let policyGen = 0;
  async function loadPolicy(group: string, id: string): Promise<void> {
    const gen = ++policyGen;
    try {
      const view = await getSquadContentPolicy(group, id);
      if (gen === policyGen) policy = view;
    } catch {
      if (gen === policyGen) policy = null;
    } finally {
      if (gen === policyGen) policySettled = true;
    }
  }

  $effect(() => {
    void replicaNonce;
    if (pid) void loadEvents(pid);
  });

  $effect(() => {
    if (pid && gid) void loadPolicy(gid, pid);
  });

  $effect(() => {
    if (!pid || !gid) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void listen<{ parentId?: string }>('squad_content_policy_updated', (e) => {
      if (e.payload?.parentId === pid) void loadPolicy(gid, pid);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  $effect(() => {
    const timer = setInterval(() => (nowMs = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  // Deep links: open one event's detail or filter to one weekly series, then consume the request.
  $effect(() => {
    const focus = $eventsFocus;
    if (!focus || focus.parentId !== pid) return;
    openEventId = focus.eventId;
    seriesFilter = focus.seriesId;
    eventsFocus.set(null);
  });

  // An open detail whose event left the replica (e.g. removed by a restriction) closes.
  $effect(() => {
    if (loaded && openEventId && !openEvent) openEventId = null;
  });
</script>

<div class="events-shell">
  {#if openEvent}
    <div class="events-scroll">
      <EventDetail event={openEvent} mlsGroupId={gid} parentId={pid} onclose={() => (openEventId = null)} />
    </div>
  {:else}
    <div class="events-scroll" role="feed" aria-label={$t('events.panel.ariaLabel')} aria-busy={!loaded}>
      {#if seriesFilter}
        <div class="events-filter">
          <span class="events-filter-label">{$t('events.panel.seriesFilter')}</span>
          <button
            type="button"
            class="events-filter-clear"
            aria-label={$t('events.panel.seriesFilterClear')}
            title={$t('events.panel.seriesFilterClear')}
            onclick={() => (seriesFilter = null)}
          >
            ×
          </button>
        </div>
      {/if}
      {#if !loaded}
        <p class="events-msg muted">{$t('events.panel.loading')}</p>
      {:else if loadError && events.length === 0}
        <p class="events-msg muted" role="alert">{loadError}</p>
      {:else if ordered.upcoming.length === 0 && ordered.past.length === 0}
        <p class="events-msg muted">{$t('events.panel.empty')}</p>
      {:else}
        {#each [{ key: 'upcoming', list: ordered.upcoming }, { key: 'past', list: ordered.past }] as section (section.key)}
          {#if section.list.length > 0}
            <h3 class="events-section-title">{$t(`events.panel.${section.key}`)}</h3>
            <ul class="events-list" role="list">
              {#each section.list as ev (ev.id)}
                {@const counts = rsvpCounts(ev.rsvps)}
                {@const zoneStart = formatEventZoneStart(ev, timeOpts)}
                {@const channelName = eventChannelName(channels, ev.channelId)}
                <li>
                  <button
                    type="button"
                    class="event-card"
                    class:event-card--cancelled={ev.status === 'cancelled'}
                    aria-label={$t('events.panel.openAria', { values: { title: ev.title } })}
                    onclick={() => (openEventId = ev.id)}
                  >
                    <span class="event-card-head">
                      <span class="event-card-title">{ev.title}</span>
                      {#if ev.status === 'cancelled'}
                        <span class="event-card-badge">{$t('events.panel.cancelled')}</span>
                      {/if}
                    </span>
                    <span class="event-card-when">
                      {formatEventStart(ev, timeOpts)}
                      {#if ev.startUnix == null}
                        · {$t('events.panel.allDay')}
                      {/if}
                    </span>
                    {#if zoneStart && eventZoneDiffers(ev.startTzid, viewerZone)}
                      <span class="event-card-zone">
                        {$t('events.panel.eventZone', { values: { time: zoneStart, zone: ev.startTzid } })}
                      </span>
                    {/if}
                    <span class="event-card-meta">
                      {#if channelName}
                        <span>{$t('events.panel.channel', { values: { name: channelName } })}</span>
                      {/if}
                      <span>
                        {$t('events.panel.rsvpCounts', {
                          values: { going: counts.accepted, maybe: counts.tentative, notGoing: counts.declined },
                        })}
                      </span>
                      {#if ev.myRsvp}
                        <span class="event-card-mine">{$t(`events.panel.myRsvp.${ev.myRsvp}`)}</span>
                      {/if}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/each}
      {/if}
    </div>
    {#if policySettled || !gid}
      <div class="events-composer">
        {#if createControl === 'create'}
          <button type="button" class="btn-primary events-create-btn" onclick={() => (showCreate = true)}>
            {$t('events.panel.create')}
          </button>
        {:else}
          <p class="events-msg muted">{$t(`events.panel.${createControl}`)}</p>
        {/if}
      </div>
    {/if}
  {/if}
</div>

{#if showCreate}
  <CreateEventModal open={showCreate} mlsGroupId={gid} parentId={pid} onclose={() => (showCreate = false)} />
{/if}

<style>
  .events-shell {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 8px 12px 12px;
  }

  .events-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .events-msg {
    margin: 0;
    padding: 8px 0;
    font-size: 13px;
    line-height: 1.45;
  }

  .muted {
    color: var(--text-secondary);
  }

  .events-filter {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    font-size: 12px;
  }

  .events-filter-clear {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 4px;
  }

  .events-section-title {
    margin: 8px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }

  .events-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .event-card {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px 14px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    cursor: pointer;
    font: inherit;
  }

  .event-card:hover {
    background: var(--bg-hover);
  }

  .event-card--cancelled .event-card-title {
    text-decoration: line-through;
    color: var(--text-secondary);
  }

  .event-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .event-card-title {
    font-size: 15px;
    font-weight: 600;
  }

  .event-card-badge {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--danger, #e85d5d);
    color: var(--danger, #e85d5d);
  }

  .event-card-when {
    font-size: 13px;
  }

  .event-card-zone,
  .event-card-meta {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .event-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
  }

  .event-card-mine {
    color: var(--brand);
  }

  .events-composer {
    flex-shrink: 0;
    padding: 12px;
    margin-top: 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-elevated);
  }

  .events-create-btn {
    width: 100%;
    padding: 10px 16px;
    font-size: 0.9375rem;
  }
</style>
