<script module lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import type { SquadEventFormValues as DraftValues, SquadEventDraftIds as DraftIds } from '../../lib/squad/squad-event-form';
  const retryDrafts = new Map<string, DraftValues>();
  const pendingDrafts = new SvelteMap<string, DraftIds>();
</script>

<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { parseDateTime, toZoned } from '@internationalized/date';
  import EventCivilDateTimeInput from './EventCivilDateTimeInput.svelte';
  import EventTimeFormatSelect from './EventTimeFormatSelect.svelte';
  import { eventTimeFormat } from '../../stores/event-time-format';
  import { get } from 'svelte/store';
  import { onDestroy, untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import { currentUser } from '../../stores/auth-session';
  import { squads } from '../../stores/squads';
  import { showToast } from '../../stores/toast';
  import {
    sendSquadEventCreate,
    sendSquadEventSeries,
    sendSquadEventUpdate,
    type SquadEventDto,
    type SquadEventPlace,
  } from '../../lib/api/squad-events';
  import {
    addCivilDays,
    isValidSquadEventStart,
    applySquadEventDuration,
    synchronizeSquadEventStart,
    squadEventOccurrences,
    validateSquadEventSchedule,
    buildSquadEventSubmission,
    emptySquadEventFormValues,
    eventChannelOptions,
    formValuesFromEvent,
    settleSquadEventDraftIds,
    squadEventDraftIds,
    timeZoneOptions,
    validateSquadEventForm,
    type SquadEventFormValues,
  } from '../../lib/squad/squad-event-form';
  import { formatEventCivil, formatEventDuration, viewerTimeZone } from '../../lib/squad/squad-event-display';
  import { squadRecordErrorMessage } from '../../lib/squad/squad-record-errors';

  interface Props {
    open: boolean;
    mlsGroupId: string;
    parentId: string;
    editing?: SquadEventDto | null;
    onclose: () => void;
  }

  let { open, mlsGroupId, parentId, editing = null, onclose }: Props = $props();

  const tFn = get(t);
  const titleId = 'create-event-title';
  const viewerZone = viewerTimeZone();

  const channels = $derived($squads.find((s) => s.id === parentId)?.channels ?? []);
  const channelOptions = $derived(eventChannelOptions(channels));

  let values = $state<SquadEventFormValues>(emptySquadEventFormValues(viewerZone, null));
  let saving = $state(false);
  let error = $state('');
  let alive = true;
  let ownRequest: DraftIds | null = null;
  onDestroy(() => { alive = false; });
  let retryDraft = $state(false);
  let durationError = $state(false);
  let presetMinutes = $state<number | null>(null);
  let original = $state<SquadEventFormValues | undefined>();
  const occurrences = $derived(squadEventOccurrences(values));
  const timeOpts = $derived({ locale: $locale ?? undefined, clockFormat: $eventTimeFormat });

  function occurrenceDuration(start: string, end: string): string {
    if (values.allDay) return formatEventDuration({ startUnix: null, endUnix: null, startDate: start, endDate: end ? addCivilDays(end, 1) : null, startTzid: values.startTzid }, timeOpts);
    // Preserve the original instant difference for historical overlap intervals.
    if (editing && !values.weekly && start === original?.start && end === original?.end && values.startTzid === original?.startTzid) return formatEventDuration(editing, timeOpts);
    try {
      const startUnix = toZoned(parseDateTime(start), values.startTzid, 'earlier').toDate().getTime() / 1000;
      const endUnix = end ? toZoned(parseDateTime(end), values.startTzid, 'earlier').toDate().getTime() / 1000 : null;
      return formatEventDuration({ startUnix, endUnix, startDate: null, endDate: null, startTzid: values.startTzid }, timeOpts);
    } catch {
      return formatEventDuration({ startUnix: null, endUnix: null, startDate: null, endDate: null, startTzid: values.startTzid }, timeOpts);
    }
  }
  const scheduleError = $derived(validateSquadEventSchedule(values, { original }));
  const formError = $derived(validationError());

  function validationError() {
    if (durationError) return 'endInvalid';
    const invalid = validateSquadEventForm(values, { original });
    // Exact retries may contain already-published dates; the backend checks unsent dates.
    return retryDraft && invalid === 'startPast' ? null : invalid;
  }
  const startError = $derived(scheduleError === 'startInvalid' || scheduleError === 'startPast' ? scheduleError : null);
  const endError = $derived(durationError ? 'durationUnavailable' : scheduleError === 'endInvalid' || scheduleError === 'endBeforeStart' ? scheduleError : null);
  const presetDisabled = $derived(!isValidSquadEventStart(values));

  const zoneOptions = $derived(timeZoneOptions([viewerZone, values.startTzid]));
  const isEdit = $derived(editing != null);
  const draftKey = $derived(JSON.stringify([$currentUser?.npub ?? '', parentId, editing?.id ?? 'new']));

  $effect(() => {
    if (!open) return;
    const key = draftKey;
    untrack(() => {
      values = editing
        ? formValuesFromEvent(editing)
        : emptySquadEventFormValues(viewerZone, channelOptions[0]?.groupId ?? null);
      const cached = retryDrafts.get(key);
      retryDraft = cached != null;
      if (cached) values = structuredClone(cached);
      original = editing ? formValuesFromEvent(editing) : undefined;
      presetMinutes = null;
      durationError = false;
      error = '';
      saving = pendingDrafts.has(key);
      ownRequest = null;
    });
  });

  $effect(() => {
    if (!open) return;
    const key = draftKey;
    const pending = pendingDrafts.has(key);
    untrack(() => {
      // A remounted modal observes completion without an old instance closing it.
      if (!pending && saving && ownRequest === null) {
        const cached = retryDrafts.get(key);
        retryDraft = cached != null;
        values = cached
          ? structuredClone(cached)
          : editing
            ? formValuesFromEvent(editing)
            : emptySquadEventFormValues(viewerZone, channelOptions[0]?.groupId ?? null);
        saving = false;
      }
    });
  });

  function setAllDay(allDay: boolean): void {
    if (allDay === values.allDay) return;
    presetMinutes = null;
    durationError = false;
    values.allDay = allDay;
    values.start = allDay ? values.start.slice(0, 10) : values.start ? `${values.start}T09:00` : '';
    values.end = allDay ? values.end.slice(0, 10) : '';
  }

  function setStart(start: string): void {
    if (presetMinutes != null && !values.allDay) {
      const candidate = { ...values, start };
      const next = applySquadEventDuration(candidate, presetMinutes);
      durationError = isValidSquadEventStart(candidate) && next === candidate;
      values = next;
    } else {
      values = synchronizeSquadEventStart(values, start, null);
      durationError = false;
    }
  }

  function setEnd(end: string): void {
    presetMinutes = null;
    durationError = false;
    values.end = end;
  }

  function selectDuration(minutes: number): void {
    const next = applySquadEventDuration(values, minutes);
    if (next === values) {
      durationError = true;
      return;
    }
    durationError = false;
    values = next;
    presetMinutes = minutes;
  }

  function setZone(zone: string): void {
    values.startTzid = zone;
    if (presetMinutes != null) {
      const next = applySquadEventDuration(values, presetMinutes);
      durationError = isValidSquadEventStart(values) && next === values;
      values = next;
    }
  }

  function setCount(count: number): void {
    values.occurrenceCount = count;
  }

  function removeOccurrence(weekOffset: number): void {
    values.excludedWeeks = [...values.excludedWeeks, weekOffset];
  }

  function setPlace(place: SquadEventPlace): void {
    if (place === values.place) return;
    values.place = place;
    // Only the field for the chosen kind is kept.
    if (place === 'online') values.address = '';
    else values.link = '';
  }

  function discardRetry(): void {
    retryDrafts.delete(draftKey);
    settleSquadEventDraftIds(draftKey, 'create', squadEventDraftIds(draftKey));
    settleSquadEventDraftIds(draftKey, 'series', squadEventDraftIds(draftKey));
    values = editing
      ? formValuesFromEvent(editing)
      : emptySquadEventFormValues(viewerZone, channelOptions[0]?.groupId ?? null);
    retryDraft = false;
    presetMinutes = null;
    durationError = false;
    error = '';
  }

  function close(): void {
    if (!saving) onclose();
  }

  async function submit(): Promise<void> {
    if (saving) return;
    const invalid = validationError();
    if (invalid) {
      error = tFn(`events.create.error.${invalid}`);
      return;
    }
    const gid = mlsGroupId.trim();
    const pid = parentId.trim();
    if (!gid || !pid) {
      error = tFn('events.create.errorNotReady');
      return;
    }
    const key = draftKey;
    const ids = squadEventDraftIds(key);
    if (pendingDrafts.has(key)) return;
    const submission = buildSquadEventSubmission({
      values,
      ids,
      mlsGroupId: gid,
      parentId: pid,
      editingId: editing?.id ?? null,
    });
    const submittedValues = structuredClone($state.snapshot(values));
    retryDrafts.set(key, submittedValues);
    ownRequest = ids;
    pendingDrafts.set(key, ids);
    saving = true;
    error = '';
    try {
      if (submission.op === 'update') {
        await sendSquadEventUpdate(submission.params);
      } else if (submission.op === 'series') {
        await sendSquadEventSeries(submission.params);
      } else {
        await sendSquadEventCreate(submission.params);
      }
      if (squadEventDraftIds(key) !== ids) return;
      pendingDrafts.delete(key);
      if (submission.op !== 'update') settleSquadEventDraftIds(key, submission.op, ids);
      retryDrafts.delete(key);
      if (!alive || key !== draftKey) return;
      showToast(tFn(submission.op === 'update' ? 'events.create.updated' : submission.op === 'series' ? 'events.create.seriesPublished' : 'events.create.published'));
      retryDraft = false;
      saving = false;
      onclose();
    } catch (e) {
      if (squadEventDraftIds(key) !== ids) return;
      pendingDrafts.delete(key);
      retryDrafts.set(key, submittedValues);
      if (!alive || key !== draftKey) return;
      retryDraft = true;
      error = squadRecordErrorMessage(e, tFn, tFn(isEdit ? 'events.create.errorSave' : 'events.create.errorPublish'));
      saving = false;
    }
  }
</script>

{#if open}
  <Modal {titleId} onClose={close} dismissible={!saving}>
    <h2 id={titleId}>{isEdit ? $t('events.create.editTitle') : $t('events.create.title')}</h2>
    <form
      class="create-event-form"
      novalidate
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <EventTimeFormatSelect />
      <fieldset class="draft-fields" disabled={saving || retryDraft}>
      <label class="field-label" for="event-title">{$t('events.create.titleLabel')}</label>
      <input
        id="event-title"
        type="text"
        class="field-input"
        bind:value={values.title}
        disabled={saving}
        autocomplete="off"
        placeholder={$t('events.create.titlePlaceholder')}
      />

      <label class="field-label" for="event-summary">{$t('events.create.summaryLabel')}</label>
      <textarea
        id="event-summary"
        class="field-input field-textarea"
        bind:value={values.summary}
        disabled={saving}
        rows="3"
        placeholder={$t('events.create.summaryPlaceholder')}
      ></textarea>

      <label class="field-check">
        <input
          type="checkbox"
          checked={values.allDay}
          disabled={saving}
          onchange={(e) => setAllDay(e.currentTarget.checked)}
        />
        {$t('events.create.allDayLabel')}
      </label>

      <div class="field-row">
        <div class="field-col">
          <label class="field-label" for="event-start">{$t('events.create.startLabel')}</label>
          {#if values.allDay}
            <input id="event-start" type="date" class="field-input" value={values.start} oninput={(e) => setStart(e.currentTarget.value)} aria-invalid={startError ? true : undefined} aria-describedby={startError ? "event-start-error" : undefined} disabled={saving} />
          {:else}
            <EventCivilDateTimeInput id="event-start" label={$t('events.create.startLabel')} value={values.start} clockFormat={$eventTimeFormat} oninput={setStart} invalid={startError != null} describedby={startError ? 'event-start-error' : undefined} disabled={saving} />
          {/if}
          {#if startError}<p id="event-start-error" class="create-event-error">{$t(`events.create.error.${startError}`)}</p>{/if}
        </div>
        <div class="field-col">
          <label class="field-label" for="event-end">{$t('events.create.endLabel')}</label>
          {#if values.allDay}
            <input id="event-end" type="date" class="field-input" value={values.end} oninput={(e) => setEnd(e.currentTarget.value)} aria-invalid={endError ? true : undefined} aria-describedby={endError ? "event-end-error" : undefined} disabled={saving} />
          {:else}
            <EventCivilDateTimeInput id="event-end" label={$t('events.create.endLabel')} value={values.end} clockFormat={$eventTimeFormat} oninput={setEnd} invalid={endError != null} describedby={endError ? 'event-end-error' : undefined} disabled={saving} />
          {/if}
          {#if endError}<p id="event-end-error" class="create-event-error">{$t(`events.create.error.${endError}`)}</p>{/if}
        </div>
      </div>

      {#if !values.allDay}
        <fieldset class="duration-options" disabled={saving || presetDisabled}>
          <legend class="field-label">{$t('events.create.durationLabel')}</legend>
          {#each [30, 60, 90, 120] as minutes (minutes)}
            <button type="button" class="duration-button" aria-pressed={presetMinutes === minutes} onclick={() => selectDuration(minutes)}>
              {$t('events.create.durationMinutes', { values: { minutes } })}
            </button>
          {/each}
        </fieldset>
      {/if}

      <label class="field-label" for="event-zone">{$t('events.create.zoneLabel')}</label>
      <select id="event-zone" class="field-input" value={values.startTzid} onchange={(e) => setZone(e.currentTarget.value)} aria-invalid={scheduleError === "zoneInvalid" ? true : undefined} aria-describedby={scheduleError === "zoneInvalid" ? "event-zone-error" : undefined} disabled={saving}>
        {#each zoneOptions as zone (zone)}
          <option value={zone}>{zone}</option>
        {/each}
      </select>
      {#if scheduleError === 'zoneInvalid'}<p id="event-zone-error" class="create-event-error">{$t('events.create.error.zoneInvalid')}</p>{/if}

      {#if channelOptions.length > 0}
        <label class="field-label" for="event-channel">{$t('events.create.channelLabel')}</label>
        <select id="event-channel" class="field-input" bind:value={values.channelId} disabled={saving}>
          {#each channelOptions as option (option.groupId)}
            <option value={option.groupId}>#{option.name}</option>
          {/each}
        </select>
      {/if}

      <fieldset class="field-place" disabled={saving}>
        <legend class="field-label">{$t('events.create.placeLabel')}</legend>
        <label class="field-check">
          <input
            type="radio"
            name="event-place"
            checked={values.place === 'online'}
            onchange={() => setPlace('online')}
          />
          {$t('events.create.placeOnline')}
        </label>
        <label class="field-check">
          <input
            type="radio"
            name="event-place"
            checked={values.place === 'offline'}
            onchange={() => setPlace('offline')}
          />
          {$t('events.create.placeOffline')}
        </label>
      </fieldset>
      {#if values.place === 'online'}
        <label class="field-label" for="event-link">{$t('events.create.linkLabel')}</label>
        <input
          id="event-link"
          type="url"
          class="field-input"
          bind:value={values.link}
          disabled={saving}
          autocomplete="off"
          placeholder={$t('events.create.linkPlaceholder')}
        />
      {:else}
        <label class="field-label" for="event-address">{$t('events.create.addressLabel')}</label>
        <input
          id="event-address"
          type="text"
          class="field-input"
          bind:value={values.address}
          disabled={saving}
          autocomplete="off"
          placeholder={$t('events.create.addressPlaceholder')}
        />
      {/if}
      <p class="field-hint">{$t('events.create.placePrivacyHint')}</p>

      {#if !isEdit}
        <label class="field-check">
          <input type="checkbox" bind:checked={values.weekly} disabled={saving} />
          {$t('events.create.weeklyLabel')}
        </label>
        {#if values.weekly}
          <label class="field-label" for="event-count">{$t('events.create.countLabel')}</label>
          <input id="event-count" class="field-input" type="number" min="1" max="8" step="1" value={values.occurrenceCount} disabled={saving} oninput={(e) => setCount(e.currentTarget.valueAsNumber)} />
          <p class="field-hint">{$t('events.create.weeklyHint')}</p>
          {#if scheduleError === 'countInvalid'}<p class="create-event-error">{$t('events.create.error.countInvalid')}</p>{/if}
        {/if}
      {/if}

      {#if values.start}
        <section class="occurrence-preview" aria-labelledby="event-preview-heading">
          <h3 id="event-preview-heading" class="field-label">{$t('events.create.previewLabel')}</h3>
          <p class="field-hint" aria-live="polite">{$t('events.create.retainedCount', { values: { count: occurrences.length } })}</p>
          <ol>
            {#each occurrences as occurrence (occurrence.weekOffset)}
              <li>
                <div class="occurrence-times">
                  <div class="occurrence-field"><span class="occurrence-label">{$t('events.create.previewStart')}</span><time datetime={occurrence.start}>{formatEventCivil(occurrence.start, timeOpts)}</time></div>
                  <div class="occurrence-field"><span class="occurrence-label">{$t('events.create.previewEnd')}</span>{#if occurrence.end}<time datetime={occurrence.end}>{formatEventCivil(occurrence.end, timeOpts)}</time>{:else}<span>{$t('events.create.noEnd')}</span>{/if}</div>
                  <div class="occurrence-meta"><span>{$t('events.create.previewDuration')}: {occurrenceDuration(occurrence.start, occurrence.end)}</span><small>{values.startTzid}</small></div>
                </div>
                {#if values.weekly && !isEdit}
                  <button type="button" class="remove-occurrence" disabled={saving} aria-label={$t('events.create.removeOccurrence', { values: { count: occurrence.weekOffset + 1, date: occurrence.start } })} onclick={() => removeOccurrence(occurrence.weekOffset)}>{$t('events.create.remove')}</button>
                {/if}
              </li>
            {/each}
          </ol>
          {#if values.weekly && values.excludedWeeks.length > 0}
            <button type="button" class="btn-secondary" disabled={saving} onclick={() => (values.excludedWeeks = [])}>{$t('events.create.restoreOccurrences')}</button>
          {/if}
          {#if scheduleError === 'noOccurrences'}<p class="create-event-error">{$t('events.create.error.noOccurrences')}</p>{/if}
        </section>
      {/if}

      </fieldset>
      {#if retryDraft}
        <p class="field-hint" role="status">{$t('events.create.retryUnchanged')}</p>
        <p class="field-hint">{$t('events.create.discardRetryHint')}</p>
        <button type="button" class="btn-secondary discard-retry" disabled={saving} onclick={discardRetry}>
          {$t(isEdit ? 'events.create.discardRetry' : 'events.create.newDraft')}
        </button>
      {/if}
      {#if error}
        <p class="create-event-error" role="alert">{error}</p>
      {/if}

      <div class="modal-actions">
        <button type="button" class="btn-secondary" disabled={saving} onclick={close}>
          {$t('events.create.cancel')}
        </button>
        <button type="submit" class="btn-primary" disabled={saving || formError != null} aria-busy={saving}>
          {#if saving}
            {$t('events.create.saving')}
          {:else if isEdit}
            {$t('events.create.save')}
          {:else}
            {$t('events.create.submit')}
          {/if}
        </button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .draft-fields {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }

  .create-event-form {
    display: flex;
    flex-direction: column;
  }

  .field-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 12px 0 6px 0;
    padding: 0;
  }

  .field-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .field-textarea {
    resize: vertical;
    min-height: 72px;
    font-family: inherit;
  }

  .field-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .field-col {
    flex: 1;
    min-width: min(180px, 100%);
  }

  .field-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 12px 16px 0 0;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .field-place {
    border: none;
    margin: 0;
    padding: 0;
  }

  .field-place .field-check {
    margin-top: 0;
  }

  .field-hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .create-event-error {
    color: var(--danger);
    font-size: 0.8125rem;
    margin: 12px 0 0 0;
  }

  .duration-options {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .duration-button, .remove-occurrence {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    color: var(--text-primary);
    padding: 7px 10px;
    cursor: pointer;
  }

  .duration-button[aria-pressed='true'] {
    background: var(--brand);
    color: var(--on-brand);
  }

  .duration-button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .occurrence-preview ol {
    padding: 0;
    list-style: none;
    margin: 8px 0;
    max-height: 240px;
    overflow-y: auto;
  }

  .occurrence-preview li {
    display: flex;
    align-items: start;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.8125rem;
    color: var(--text-primary);
  }

  .occurrence-times { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
  .occurrence-field { min-width: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  .occurrence-label { display: block; color: var(--text-muted); font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; margin-bottom: 4px; }
  .occurrence-meta { grid-column: 1 / -1; color: var(--text-secondary); overflow-wrap: anywhere; }
  .remove-occurrence { flex-shrink: 0; }
  @media (max-width: 520px) {
    .occurrence-times { grid-template-columns: minmax(0, 1fr); }
    .field-row { flex-direction: column; }
  }

  .occurrence-preview small {
    display: block;
    color: var(--text-secondary);
    margin-top: 3px;
  }

  .discard-retry {
    align-self: flex-start;
    margin-top: 8px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }
</style>
