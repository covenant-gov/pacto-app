<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  const tFn = get(t);
  import Modal from '../ui/Modal.svelte';
  import type { ParentPoll, ParentPollOption } from '../../lib/parent/parent-polls';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';

  interface Props {
    open: boolean;
    parentId: string;
    onClose: () => void;
    onCreate: (poll: ParentPoll) => void | Promise<void>;
  }

  let { open, parentId, onClose, onCreate }: Props = $props();

  const titleId = 'create-poll-title';
  const descId = 'create-poll-desc';

  let title = $state('');
  let description = $state('');
  /** Editable labels; trimmed non-empty become options */
  let optionRows = $state<string[]>(['', '']);
  let saving = $state(false);
  let error = $state('');

  function reset() {
    title = '';
    description = '';
    optionRows = ['', ''];
    error = '';
    saving = false;
  }

  $effect(() => {
    if (!open) reset();
  });

  function addOption() {
    optionRows = [...optionRows, ''];
  }

  function removeOption(i: number) {
    if (optionRows.length <= 2) return;
    optionRows = optionRows.filter((_, idx) => idx !== i);
  }

  async function submit(): Promise<void> {
    const t = title.trim();
    if (!t) {
      error = tFn('governance.createPoll.errorTitle');
      return;
    }
    const labels = optionRows.map((s) => s.trim()).filter(Boolean);
    if (labels.length < 2) {
      error = tFn('governance.createPoll.errorOptions');
      return;
    }
    saving = true;
    error = '';
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `poll-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const options: ParentPollOption[] = labels.map((label) => ({
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `opt-${Math.random().toString(36).slice(2, 12)}`,
      label,
      votes: 0,
    }));
    const poll: ParentPoll = {
      id,
      parentId: parentId.trim(),
      title: t,
      description: description.trim(),
      options,
      createdAtMs: Date.now(),
    };
    try {
      await Promise.resolve(onCreate(poll));
      reset();
      onClose();
    } catch (e) {
      error = getInvokeErrorMessage(e, tFn('governance.createPoll.errorPublish'));
    } finally {
      saving = false;
    }
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={() => (!saving ? onClose() : undefined)} dismissible={!saving}>
    <h2 id={titleId}>{$t('governance.createPoll.title')}</h2>
    <p id={descId} class="create-poll-lead">{$t('governance.createPoll.lead')}</p>

    <label class="modal-field-label" for="poll-title">{$t('governance.createPoll.titleLabel')}</label>
    <input
      id="poll-title"
      type="text"
      class="create-poll-input"
      bind:value={title}
      disabled={saving}
      autocomplete="off"
      placeholder={$t('governance.createPoll.titlePlaceholder')}
    />

    <label class="modal-field-label" for="poll-description">{$t('governance.createPoll.descriptionLabel')}</label>
    <textarea
      id="poll-description"
      class="create-poll-textarea"
      bind:value={description}
      disabled={saving}
      rows="3"
      placeholder={$t('governance.createPoll.descriptionPlaceholder')}
    ></textarea>

    <p class="modal-field-label">{$t('governance.createPoll.choicesLabel')}</p>
    <ul class="create-poll-options" role="list">
      {#each optionRows as _, i (i)}
        <li class="create-poll-option-row">
          <input
            type="text"
            class="create-poll-input"
            value={optionRows[i]}
            oninput={(e) => {
              optionRows[i] = e.currentTarget.value;
            }}
            disabled={saving}
            placeholder={$t('governance.createPoll.optionPlaceholder', { values: { n: i + 1 } })}
            aria-label={$t('governance.createPoll.optionAriaLabel', { values: { n: i + 1 } })}
          />
          {#if optionRows.length > 2}
            <button
              type="button"
              class="create-poll-remove"
              disabled={saving}
              onclick={() => removeOption(i)}
              aria-label={$t('governance.createPoll.removeOptionAriaLabel', { values: { n: i + 1 } })}
            >
              {$t('governance.createPoll.removeOption')}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    <button type="button" class="create-poll-add-opt" disabled={saving} onclick={addOption}>
      {$t('governance.createPoll.addChoice')}
    </button>

    {#if error}
      <p class="create-poll-error" role="alert">{error}</p>
    {/if}

    <div class="modal-actions">
      <button type="button" class="btn-secondary" disabled={saving} onclick={onClose}>{$t('governance.createPoll.cancel')}</button>
      <button type="button" class="btn-primary" disabled={saving} onclick={submit}>{$t('governance.createPoll.create')}</button>
    </div>
  </Modal>
{/if}

<style>
  .create-poll-lead {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin: 0 0 16px 0;
    line-height: 1.45;
  }

  .modal-field-label {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    margin: 12px 0 6px 0;
  }

  .create-poll-input,
  .create-poll-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .create-poll-textarea {
    resize: vertical;
    min-height: 72px;
    font-family: inherit;
  }

  .create-poll-options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .create-poll-option-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .create-poll-option-row .create-poll-input {
    flex: 1;
  }

  .create-poll-remove {
    flex-shrink: 0;
    font-size: 0.8125rem;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .create-poll-remove:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .create-poll-add-opt {
    margin-top: 8px;
    font-size: 0.8125rem;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px dashed var(--border);
    background: transparent;
    color: var(--brand);
    cursor: pointer;
  }

  .create-poll-add-opt:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .create-poll-error {
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
