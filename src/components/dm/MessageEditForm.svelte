<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';

  interface Props {
    initialBody: string;
    /** Resolve `true` once the edit is sent so the editor can close. */
    onSave: (body: string) => Promise<boolean>;
    onCancel: () => void;
  }

  let { initialBody, onSave, onCancel }: Props = $props();

  // Seeded once; later prop changes must not clobber what the author is typing.
  let draft = $state(untrack(() => initialBody));
  let saving = $state(false);
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  let canSave = $derived(!saving && draft.trim().length > 0);

  function resize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = `${textareaEl.scrollHeight}px`;
  }

  onMount(() => {
    queueMicrotask(() => {
      if (!textareaEl) return;
      resize();
      textareaEl.focus();
      textareaEl.setSelectionRange(draft.length, draft.length);
    });
  });

  async function save() {
    if (!canSave) return;
    saving = true;
    try {
      await onSave(draft);
    } finally {
      saving = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!saving) onCancel();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void save();
    }
  }
</script>

<form
  class="message-edit-form"
  onsubmit={(e) => {
    e.preventDefault();
    void save();
  }}
  onpointerdown={(e) => e.stopPropagation()}
  oncontextmenu={(e) => e.stopPropagation()}
>
  <textarea
    bind:this={textareaEl}
    bind:value={draft}
    class="message-edit-input"
    name="message-edit"
    rows="1"
    aria-label={$t('messaging.message.editAria')}
    disabled={saving}
    oninput={resize}
    onkeydown={handleKeydown}
  ></textarea>
  <div class="message-edit-footer">
    <span class="message-edit-hint">{$t('messaging.message.editHint')}</span>
    <div class="message-edit-actions">
      <button type="button" class="message-edit-cancel" disabled={saving} onclick={onCancel}>
        {$t('messaging.message.editCancel')}
      </button>
      <button type="submit" class="message-edit-save" disabled={!canSave}>
        {#if saving}
          <LoaderCircle size={14} class="message-edit-spinner" aria-hidden="true" />
        {/if}
        {$t('messaging.message.editSave')}
      </button>
    </div>
  </div>
</form>

<style>
  .message-edit-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 2px;
  }

  .message-edit-input {
    box-sizing: border-box;
    width: 100%;
    min-height: 40px;
    max-height: 240px;
    padding: 8px 10px;
    resize: none;
    overflow-y: auto;
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    font: inherit;
    font-size: 0.9375rem;
    line-height: 1.375rem;
  }

  .message-edit-input:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: -1px;
  }

  .message-edit-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  .message-edit-hint {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .message-edit-actions {
    display: flex;
    gap: 6px;
  }

  .message-edit-cancel,
  .message-edit-save {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, opacity 0.1s;
  }

  .message-edit-cancel {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .message-edit-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .message-edit-save {
    background: var(--brand);
    border: 1px solid var(--brand);
    color: var(--on-brand);
  }

  .message-edit-save:disabled,
  .message-edit-cancel:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .message-edit-cancel:focus-visible,
  .message-edit-save:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  :global(.message-edit-spinner) {
    animation: message-edit-spin 0.8s linear infinite;
  }

  @keyframes message-edit-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.message-edit-spinner) {
      animation: none;
    }
  }
</style>
