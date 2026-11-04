<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import { squads } from '../../stores/squads';
  import { showToast } from '../../stores/toast';
  import {
    WEEKLY_SERIES_COUNT,
    sendSquadEventCreate,
    sendSquadEventSeries,
    sendSquadEventUpdate,
    type SquadEventDto,
    type SquadEventPlace,
  } from '../../lib/api/squad-events';
  import {
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
  import { viewerTimeZone } from '../../lib/squad/squad-event-display';
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

  const zoneOptions = $derived(timeZoneOptions([viewerZone, values.startTzid]));
  const isEdit = $derived(editing != null);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      values = editing
        ? formValuesFromEvent(editing)
        : emptySquadEventFormValues(viewerZone, channelOptions[0]?.groupId ?? null);
      error = '';
      saving = false;
    });
  });

  function setAllDay(allDay: boolean): void {
    if (allDay === values.allDay) return;
    values.allDay = allDay;
    values.start = allDay ? values.start.slice(0, 10) : values.start ? `${values.start}T09:00` : '';
    values.end = allDay ? values.end.slice(0, 10) : '';
  }

  function setPlace(place: SquadEventPlace): void {
    if (place === values.place) return;
    values.place = place;
    // Only the field for the chosen kind is kept.
    if (place === 'online') values.address = '';
    else values.link = '';
  }

  function close(): void {
    if (!saving) onclose();
  }

  async function submit(): Promise<void> {
    if (saving) return;
    const invalid = validateSquadEventForm(values);
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
    const submission = buildSquadEventSubmission({
      values,
      ids: squadEventDraftIds(pid),
      mlsGroupId: gid,
      parentId: pid,
      editingId: editing?.id ?? null,
    });
    saving = true;
    error = '';
    try {
      if (submission.op === 'update') {
        await sendSquadEventUpdate(submission.params);
        showToast(tFn('events.create.updated'));
      } else if (submission.op === 'series') {
        await sendSquadEventSeries(submission.params);
        settleSquadEventDraftIds(pid, 'series');
        showToast(tFn('events.create.seriesPublished'));
      } else {
        await sendSquadEventCreate(submission.params);
        settleSquadEventDraftIds(pid, 'create');
        showToast(tFn('events.create.published'));
      }
      saving = false;
      onclose();
    } catch (e) {
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
            <input id="event-start" type="date" class="field-input" bind:value={values.start} disabled={saving} />
          {:else}
            <input id="event-start" type="datetime-local" class="field-input" bind:value={values.start} disabled={saving} />
          {/if}
        </div>
        <div class="field-col">
          <label class="field-label" for="event-end">{$t('events.create.endLabel')}</label>
          {#if values.allDay}
            <input id="event-end" type="date" class="field-input" bind:value={values.end} disabled={saving} />
          {:else}
            <input id="event-end" type="datetime-local" class="field-input" bind:value={values.end} disabled={saving} />
          {/if}
        </div>
      </div>

      <label class="field-label" for="event-zone">{$t('events.create.zoneLabel')}</label>
      <select id="event-zone" class="field-input" bind:value={values.startTzid} disabled={saving}>
        {#each zoneOptions as zone (zone)}
          <option value={zone}>{zone}</option>
        {/each}
      </select>

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
          {$t('events.create.weeklyLabel', { values: { count: WEEKLY_SERIES_COUNT } })}
        </label>
        {#if values.weekly}
          <p class="field-hint">{$t('events.create.weeklyHint')}</p>
        {/if}
      {/if}

      {#if error}
        <p class="create-event-error" role="alert">{error}</p>
      {/if}

      <div class="modal-actions">
        <button type="button" class="btn-secondary" disabled={saving} onclick={close}>
          {$t('events.create.cancel')}
        </button>
        <button type="submit" class="btn-primary" disabled={saving} aria-busy={saving}>
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
    min-width: 180px;
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
    color: var(--danger, #e85d5d);
    font-size: 0.8125rem;
    margin: 12px 0 0 0;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
  }
</style>
