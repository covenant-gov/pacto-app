<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { EditEntry } from '../../stores/dm';
  import {
    editableBody,
    formatEditTime,
    lastEditedAt,
    previousVersions,
  } from '../../lib/messaging/message-edit';

  interface Props {
    messageId: string;
    editHistory?: EditEntry[] | null;
  }

  let { messageId, editHistory = null }: Props = $props();

  let historyOpen = $state(false);
  let editedAt = $derived(lastEditedAt(editHistory));
  let versions = $derived(previousVersions(editHistory));
  let originalAt = $derived(
    editHistory && editHistory.length > 0
      ? Math.min(...editHistory.map((e) => e.edited_at))
      : null,
  );
  let label = $derived(
    editedAt != null
      ? $t('messaging.message.editedAt', { values: { time: formatEditTime(editedAt) } })
      : $t('messaging.message.edited'),
  );
  let historyId = $derived(`edit-history-${messageId}`);
</script>

{#if versions.length > 0}
  <button
    type="button"
    class="edited-label"
    aria-expanded={historyOpen}
    aria-controls={historyId}
    title={historyOpen ? $t('messaging.message.editHistoryHide') : $t('messaging.message.editHistoryShow')}
    onclick={() => (historyOpen = !historyOpen)}
    onpointerdown={(e) => e.stopPropagation()}
  >
    {#if editedAt != null}
      <time datetime={new Date(editedAt).toISOString()}>{label}</time>
    {:else}
      {label}
    {/if}
  </button>
{:else}
  <span class="edited-label static">{label}</span>
{/if}
{#if historyOpen && versions.length > 0}
  <ol id={historyId} class="edit-history" aria-label={$t('messaging.message.editHistoryAria')}>
    {#each versions as version, i (i)}
      <li class="edit-history-entry">
        <span class="edit-history-meta">
          {version.edited_at === originalAt
            ? $t('messaging.message.editHistoryOriginal', { values: { time: formatEditTime(version.edited_at) } })
            : $t('messaging.message.editHistoryVersion', { values: { time: formatEditTime(version.edited_at) } })}
        </span>
        <span class="edit-history-content">{editableBody(version.content)}</span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .edited-label {
    display: inline;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.75rem;
    line-height: inherit;
    cursor: pointer;
    border-radius: 4px;
  }

  .edited-label.static {
    cursor: default;
  }

  button.edited-label:hover {
    color: var(--text-secondary);
    text-decoration: underline;
  }

  button.edited-label:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .edit-history {
    list-style: none;
    margin: 6px 0 0;
    padding: 6px 0 6px 10px;
    border-left: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .edit-history-entry {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .edit-history-meta {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .edit-history-content {
    color: var(--text-muted);
    font-size: 0.875rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
