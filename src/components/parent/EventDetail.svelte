<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import CreateEventModal from './CreateEventModal.svelte';
  import EditIconButton from '../ui/EditIconButton.svelte';
  import { hydrateCatchUp } from '../../stores/catch-up';
  import { profiles, loadProfile } from '../../stores/profiles';
  import { squads } from '../../stores/squads';
  import { eventChannelName } from '../../lib/squad/squad-event-form';
  import {
    RSVP_STATUSES,
    formatEventEnd,
    formatEventStart,
    formatEventTimestampMs,
    formatEventZoneStart,
    memberDisplayLabel,
    rsvpCounts,
    rsvpMembersByStatus,
  } from '../../lib/squad/squad-event-display';
  import {
    getSquadEventReminderPrefs,
    resolveSquadEventReminderCatchUp,
    sendSquadEventCancel,
    sendSquadEventRsvp,
    setSquadEventReminderPrefs,
    type SquadEventDto,
    type SquadEventReminderPrefs,
    type SquadEventRsvpStatus,
  } from '../../lib/api/squad-events';
  import { squadRecordErrorMessage } from '../../lib/squad/squad-record-errors';
  import { openExternalUrl } from '../../lib/utils/open-external';

  interface Props {
    event: SquadEventDto;
    mlsGroupId: string;
    parentId: string;
    onclose: () => void;
  }

  let { event, mlsGroupId, parentId, onclose }: Props = $props();

  const LEAD_OPTIONS = [5, 10, 15, 30, 60, 120];

  const RSVP_LABEL_KEYS: Record<SquadEventRsvpStatus, string> = {
    accepted: 'events.detail.rsvp.accepted',
    tentative: 'events.detail.rsvp.tentative',
    declined: 'events.detail.rsvp.declined',
  };

  const timeOpts = $derived({ locale: $locale ?? undefined });
  const cancelled = $derived(event.status === 'cancelled');
  const startText = $derived(formatEventStart(event, timeOpts));
  const endText = $derived(formatEventEnd(event, timeOpts));
  const zoneStartText = $derived(formatEventZoneStart(event, timeOpts));
  const counts = $derived(rsvpCounts(event.rsvps));
  const membersByStatus = $derived(rsvpMembersByStatus(event.rsvps));
  const unknownMemberLabel = $derived($t('events.detail.unknownMember'));
  const channelName = $derived(
    eventChannelName($squads.find((s) => s.id === parentId)?.channels ?? [], event.channelId),
  );
  const location = $derived(event.location.trim());
  const locationIsLink = $derived(/^https?:\/\//i.test(location));

  /** Optimistic own answer; resets when the replica row changes. */
  let myRsvp = $derived(event.myRsvp);
  let rsvpSending = $state<SquadEventRsvpStatus | null>(null);
  let confirmingCancel = $state(false);
  let cancelSending = $state(false);
  let actionError = $state<string | null>(null);
  let editing = $state(false);
  const busy = $derived(rsvpSending !== null || cancelSending);

  let prefs = $state<SquadEventReminderPrefs | null>(null);
  let prefsSaving = $state(false);
  let prefsError = $state<string | null>(null);
  const leadOptions = $derived(
    prefs && !LEAD_OPTIONS.includes(prefs.leadMinutes)
      ? [...LEAD_OPTIONS, prefs.leadMinutes].sort((a, b) => a - b)
      : LEAD_OPTIONS,
  );

  /** Replica reloads pass a new object with the same id; only an id change re-runs these. */
  const eventId = $derived(event.id);

  $effect(() => {
    const id = eventId;
    resolveSquadEventReminderCatchUp(id)
      .then(() => hydrateCatchUp())
      .catch((e) => {
        console.warn('[squad-events] resolve reminder catch-up failed', id, e);
      });
  });

  $effect(() => {
    const id = eventId;
    let stale = false;
    prefs = null;
    prefsError = null;
    getSquadEventReminderPrefs(id)
      .then((p) => {
        if (!stale) prefs = p;
      })
      .catch((e) => {
        if (!stale) prefsError = squadRecordErrorMessage(e, get(t), get(t)('events.detail.errorReminderLoad'));
      });
    return () => {
      stale = true;
    };
  });

  const requestedProfiles = new Set<string>();
  $effect(() => {
    for (const npub of [event.updatedByNpub, ...event.rsvps.map((r) => r.memberNpub)]) {
      if (!npub || $profiles[npub] || requestedProfiles.has(npub)) continue;
      requestedProfiles.add(npub);
      void loadProfile(npub).catch(() => {});
    }
  });

  async function sendRsvp(status: SquadEventRsvpStatus) {
    if (busy || cancelled) return;
    rsvpSending = status;
    actionError = null;
    try {
      await sendSquadEventRsvp({ mlsGroupId, parentId, eventId: event.id, status });
      myRsvp = status;
    } catch (e) {
      actionError = squadRecordErrorMessage(e, $t, $t('events.detail.errorRsvp'));
    } finally {
      rsvpSending = null;
    }
  }

  async function cancelEvent() {
    if (busy || cancelled) return;
    cancelSending = true;
    actionError = null;
    try {
      await sendSquadEventCancel({ mlsGroupId, parentId, eventId: event.id });
      confirmingCancel = false;
    } catch (e) {
      actionError = squadRecordErrorMessage(e, $t, $t('events.detail.errorCancel'));
    } finally {
      cancelSending = false;
    }
  }

  async function savePrefs(next: SquadEventReminderPrefs) {
    if (prefsSaving) return;
    const id = eventId;
    const previous = prefs;
    prefs = next;
    prefsSaving = true;
    prefsError = null;
    try {
      await setSquadEventReminderPrefs({ eventId: id, leadMinutes: next.leadMinutes, muted: next.muted });
    } catch (e) {
      if (id === eventId) {
        prefs = previous;
        prefsError = squadRecordErrorMessage(e, $t, $t('events.detail.errorReminderSave'));
      }
    } finally {
      prefsSaving = false;
    }
  }
</script>

<section class="event-detail" aria-label={$t('events.detail.ariaLabel')}>
  <div class="event-detail-topbar">
    <button type="button" class="btn-link event-detail-back" onclick={onclose}>
      <span aria-hidden="true">←</span>
      {$t('events.detail.back')}
    </button>
    {#if event.canEdit && !cancelled}
      <EditIconButton ariaLabel={$t('events.detail.editAria')} title={$t('events.detail.editAria')} disabled={busy} onclick={() => (editing = true)} />
    {/if}
  </div>

  <div class="event-detail-card">
    <div class="event-detail-title-row">
      <h3 class="event-detail-title">{event.title}</h3>
      {#if cancelled}
        <span class="event-detail-badge">{$t('events.detail.cancelledBadge')}</span>
      {/if}
    </div>
    {#if cancelled}
      <p class="event-detail-notice">{$t('events.detail.cancelledNotice')}</p>
    {/if}
    {#if event.summary.trim()}
      <p class="event-detail-summary">{event.summary}</p>
    {/if}

    <dl class="event-detail-facts">
      <dt>{$t('events.detail.whenHeading')}</dt>
      <dd>
        <span>{startText}</span>
        {#if event.startUnix == null}
          <span class="muted"> · {$t('events.detail.allDay')}</span>
        {/if}
        {#if endText}
          <span class="event-detail-sub">{$t('events.detail.until', { values: { end: endText } })}</span>
        {/if}
        {#if zoneStartText}
          <span class="event-detail-sub muted">
            {$t('events.detail.eventZoneTime', { values: { time: zoneStartText, zone: event.startTzid } })}
          </span>
        {/if}
      </dd>

      <dt>{$t('events.detail.placeHeading')}</dt>
      <dd>
        <span class="muted">
          {event.place === 'online' ? $t('events.detail.placeOnline') : $t('events.detail.placeOffline')}
        </span>
        {#if location}
          <span class="event-detail-sub event-detail-location">{location}</span>
          {#if event.place === 'online' && locationIsLink}
            <button type="button" class="btn-link event-detail-open-link" onclick={() => void openExternalUrl(location)}>
              {$t('events.detail.openLink')}
            </button>
          {/if}
        {/if}
      </dd>

      {#if channelName}
        <dt>{$t('events.detail.channelHeading')}</dt>
        <dd>#{channelName}</dd>
      {/if}
    </dl>

    {#if actionError}
      <p class="event-detail-error" role="alert">{actionError}</p>
    {/if}

    <div class="event-detail-section">
      <h4 class="event-detail-section-title">{$t('events.detail.rsvpHeading')}</h4>
      <div class="event-detail-rsvp" role="group" aria-label={$t('events.detail.rsvpHeading')}>
        {#each RSVP_STATUSES as status (status)}
          <button
            type="button"
            class="event-detail-rsvp-btn"
            class:mine={myRsvp === status}
            aria-pressed={myRsvp === status}
            aria-busy={rsvpSending === status}
            title={myRsvp === status ? $t('events.detail.rsvpYours') : undefined}
            disabled={busy || cancelled}
            onclick={() => sendRsvp(status)}
          >
            <span>{rsvpSending === status ? $t('events.detail.rsvpSending') : $t(RSVP_LABEL_KEYS[status])}</span>
            <span class="event-detail-rsvp-count">{counts[status]}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="event-detail-section">
      <h4 class="event-detail-section-title">{$t('events.detail.responsesHeading')}</h4>
      {#if counts.accepted + counts.tentative + counts.declined === 0}
        <p class="muted event-detail-small">{$t('events.detail.noResponses')}</p>
      {:else}
        {#each RSVP_STATUSES as status (status)}
          {#if membersByStatus[status].length > 0}
            <div class="event-detail-attendee-group">
              <span class="event-detail-attendee-label">{$t(RSVP_LABEL_KEYS[status])} · {counts[status]}</span>
              <ul class="event-detail-attendees" role="list">
                {#each membersByStatus[status] as npub (npub)}
                  <li>{memberDisplayLabel($profiles[npub], unknownMemberLabel)}</li>
                {/each}
              </ul>
            </div>
          {/if}
        {/each}
      {/if}
    </div>

    {#if !cancelled}
      <div class="event-detail-section">
        <h4 class="event-detail-section-title">{$t('events.detail.reminderHeading')}</h4>
        {#if prefsError}
          <p class="event-detail-error" role="alert">{prefsError}</p>
        {/if}
        {#if prefs}
          {@const current = prefs}
          <div class="event-detail-reminder-row">
            <label class="event-detail-lead">
              <span>{$t('events.detail.leadLabel')}</span>
              <select
                value={current.leadMinutes}
                disabled={prefsSaving}
                onchange={(e) => savePrefs({ ...current, leadMinutes: Number(e.currentTarget.value) })}
              >
                {#each leadOptions as minutes (minutes)}
                  <option value={minutes}>
                    {minutes >= 60 && minutes % 60 === 0
                      ? $t('events.detail.leadHours', { values: { count: minutes / 60 } })
                      : $t('events.detail.leadMinutes', { values: { count: minutes } })}
                  </option>
                {/each}
              </select>
            </label>
            <label class="event-detail-mute">
              <input
                type="checkbox"
                role="switch"
                checked={current.muted}
                disabled={prefsSaving}
                onchange={(e) => savePrefs({ ...current, muted: e.currentTarget.checked })}
              />
              <span>{$t('events.detail.muteLabel')}</span>
            </label>
          </div>
          <p class="muted event-detail-small">{$t('events.detail.muteHint')}</p>
          {#if myRsvp !== 'accepted' && myRsvp !== 'tentative'}
            <p class="muted event-detail-small">{$t('events.detail.reminderNeedsRsvp')}</p>
          {/if}
        {/if}
      </div>
    {/if}

    {#if event.canEdit && !cancelled}
      <div class="event-detail-section event-detail-cancel">
        {#if confirmingCancel}
          <p class="event-detail-small">{$t('events.detail.cancelConfirm')}</p>
          <div class="event-detail-cancel-actions">
            <button type="button" class="btn-secondary" disabled={cancelSending} onclick={() => (confirmingCancel = false)}>
              {$t('events.detail.cancelConfirmNo')}
            </button>
            <button type="button" class="event-detail-danger-btn" disabled={busy} aria-busy={cancelSending} onclick={cancelEvent}>
              {cancelSending ? $t('events.detail.cancelling') : $t('events.detail.cancelConfirmYes')}
            </button>
          </div>
        {:else}
          <button type="button" class="event-detail-danger-btn" disabled={busy} onclick={() => (confirmingCancel = true)}>
            {$t('events.detail.cancelEvent')}
          </button>
        {/if}
      </div>
    {/if}

    <p class="muted event-detail-small event-detail-changed">
      {$t('events.detail.lastChanged', {
        values: {
          name: memberDisplayLabel($profiles[event.updatedByNpub], unknownMemberLabel),
          time: formatEventTimestampMs(event.updatedAtMs, timeOpts),
        },
      })}
    </p>
  </div>
</section>

{#if editing}
  <CreateEventModal open={editing} {mlsGroupId} {parentId} editing={event} onclose={() => (editing = false)} />
{/if}

<style>
  .event-detail {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .event-detail-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .event-detail-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }

  .event-detail-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px 14px;
    background: var(--bg-elevated);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .event-detail-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .event-detail-title {
    margin: 0;
    font-size: 16px;
  }

  .event-detail-badge {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--danger);
    color: var(--danger);
  }

  .event-detail-notice,
  .event-detail-summary {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .event-detail-summary {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .event-detail-facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 12px;
    margin: 0;
    font-size: 13px;
  }

  .event-detail-facts dt {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
    padding-top: 2px;
  }

  .event-detail-facts dd {
    margin: 0;
    min-width: 0;
  }

  .event-detail-sub {
    display: block;
    margin-top: 2px;
  }

  .event-detail-location {
    overflow-wrap: anywhere;
    user-select: text;
  }

  .event-detail-open-link {
    font-size: 12px;
    margin-top: 4px;
  }

  .event-detail-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle);
  }

  .event-detail-section-title {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }

  .event-detail-rsvp {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .event-detail-rsvp-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 12px;
  }

  .event-detail-rsvp-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .event-detail-rsvp-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .event-detail-rsvp-btn.mine {
    border-color: var(--brand);
    color: var(--brand);
  }

  .event-detail-rsvp-count {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .event-detail-attendee-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .event-detail-attendee-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .event-detail-attendees {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 13px;
  }

  .event-detail-reminder-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;
    font-size: 13px;
  }

  .event-detail-lead {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .event-detail-lead select {
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 12px;
  }

  .event-detail-mute {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .event-detail-mute input {
    accent-color: var(--brand);
  }

  .event-detail-cancel-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .event-detail-danger-btn {
    align-self: flex-start;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--danger);
    background: transparent;
    color: var(--danger);
    cursor: pointer;
    font-size: 12px;
  }

  .event-detail-danger-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .event-detail-danger-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .event-detail-error {
    margin: 0;
    font-size: 13px;
    color: var(--danger);
  }

  .event-detail-small {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
  }

  .event-detail-changed {
    padding-top: 4px;
  }

  .muted {
    color: var(--text-secondary);
  }
</style>
