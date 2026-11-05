<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { untrack } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import { squads } from '../../stores/squads';
  import { showToast } from '../../stores/toast';
  import {
    sendSquadDocAdd,
    sendSquadDocUpdate,
    type SquadDocDto,
    type SquadDocInput,
  } from '../../lib/api/squad-docs';
  import {
    squadDocFormValues,
    squadDocInputFromDoc,
    squadDocInputFromForm,
    validateSquadDocForm,
    type SquadDocFormValues,
  } from '../../lib/squad/squad-doc-form';
  import { eventChannelOptions } from '../../lib/squad/squad-event-form';
  import { squadRecordErrorMessage } from '../../lib/squad/squad-record-errors';

  interface Props {
    open: boolean;
    /** Announcements MLS group the doc rumors ride. */
    mlsGroupId: string;
    parentId: string;
    /** Row being edited; its id is reused. */
    editing?: SquadDocDto | null;
    /** Prefill (Save to Docs); defaults to the edited row or an empty form. */
    initial?: SquadDocInput | null;
    /** Link comes from a channel the whole squad cannot read: require an explicit confirm. */
    requireSquadConfirm?: boolean;
    onclose: () => void;
  }

  let {
    open,
    mlsGroupId,
    parentId,
    editing = null,
    initial = null,
    requireSquadConfirm = false,
    onclose,
  }: Props = $props();

  const tFn = get(t);
  const titleId = 'add-doc-title';

  const channels = $derived($squads.find((s) => s.id === parentId)?.channels ?? []);
  const channelOptions = $derived(eventChannelOptions(channels));
  const isEdit = $derived(editing != null);

  let values = $state<SquadDocFormValues>(squadDocFormValues(null));
  let squadConfirmed = $state(false);
  let saving = $state(false);
  let error = $state('');
  /** Minted once per open so a retry reuses the id. */
  let draftId = '';

  $effect(() => {
    if (!open) return;
    untrack(() => {
      values = squadDocFormValues(initial ?? (editing ? squadDocInputFromDoc(editing) : null));
      squadConfirmed = false;
      error = '';
      saving = false;
      draftId = editing?.id ?? crypto.randomUUID();
    });
  });

  function close(): void {
    if (!saving) onclose();
  }

  async function submit(): Promise<void> {
    if (saving) return;
    const invalid = validateSquadDocForm(values);
    if (invalid) {
      error = tFn(`docs.add.error.${invalid}`);
      return;
    }
    if (requireSquadConfirm && !squadConfirmed) {
      error = tFn('docs.add.error.confirm');
      return;
    }
    const gid = mlsGroupId.trim();
    const pid = parentId.trim();
    if (!gid || !pid) {
      error = tFn('docs.add.errorNotReady');
      return;
    }
    const params = { mlsGroupId: gid, parentId: pid, docId: draftId, doc: squadDocInputFromForm(values) };
    saving = true;
    error = '';
    try {
      if (isEdit) {
        await sendSquadDocUpdate(params);
        showToast(tFn('docs.add.updated'));
      } else {
        await sendSquadDocAdd(params);
        showToast(tFn('docs.add.published'));
      }
      saving = false;
      onclose();
    } catch (e) {
      error = squadRecordErrorMessage(e, tFn, tFn(isEdit ? 'docs.add.errorSave' : 'docs.add.errorPublish'));
      saving = false;
    }
  }
</script>

{#if open}
  <Modal {titleId} onClose={close} dismissible={!saving}>
    <h2 id={titleId}>{isEdit ? $t('docs.add.editTitle') : $t('docs.add.title')}</h2>
    <form
      class="add-doc-form"
      novalidate
      onsubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label class="field-label" for="doc-url">{$t('docs.add.urlLabel')}</label>
      <input
        id="doc-url"
        type="url"
        class="field-input"
        bind:value={values.url}
        disabled={saving}
        autocomplete="off"
        placeholder={$t('docs.add.urlPlaceholder')}
      />

      <label class="field-label" for="doc-title">{$t('docs.add.titleLabel')}</label>
      <input
        id="doc-title"
        type="text"
        class="field-input"
        bind:value={values.title}
        disabled={saving}
        autocomplete="off"
        placeholder={$t('docs.add.titlePlaceholder')}
      />

      <label class="field-label" for="doc-channel">{$t('docs.add.channelLabel')}</label>
      <select id="doc-channel" class="field-input" bind:value={values.channelId} disabled={saving}>
        <option value="">{$t('docs.add.channelNone')}</option>
        {#each channelOptions as option (option.groupId)}
          <option value={option.groupId}>#{option.name}</option>
        {/each}
      </select>

      <label class="field-label" for="doc-note">{$t('docs.add.noteLabel')}</label>
      <textarea
        id="doc-note"
        class="field-input field-textarea"
        bind:value={values.note}
        disabled={saving}
        rows="3"
        placeholder={$t('docs.add.notePlaceholder')}
      ></textarea>
      <p class="field-hint">{$t('docs.add.privacyHint')}</p>

      {#if requireSquadConfirm && !isEdit}
        <label class="field-check">
          <input type="checkbox" bind:checked={squadConfirmed} disabled={saving} />
          {$t('docs.add.squadConfirm')}
        </label>
      {/if}

      {#if error}
        <p class="add-doc-error" role="alert">{error}</p>
      {/if}

      <div class="modal-actions">
        <button type="button" class="btn-secondary" disabled={saving} onclick={close}>
          {$t('docs.add.cancel')}
        </button>
        <button
          type="submit"
          class="btn-primary"
          disabled={saving || (requireSquadConfirm && !isEdit && !squadConfirmed)}
          aria-busy={saving}
        >
          {#if saving}
            {$t('docs.add.saving')}
          {:else if isEdit}
            {$t('docs.add.save')}
          {:else}
            {$t('docs.add.submit')}
          {/if}
        </button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .add-doc-form {
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

  .field-check {
    display: inline-flex;
    align-items: flex-start;
    gap: 8px;
    margin: 12px 0 0;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .field-hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .add-doc-error {
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
