<script lang="ts">
  import { t } from 'svelte-i18n';
  import * as Popover from '$lib/components/ui/popover';
  import type { EditEntry } from '../../stores/dm';
  import { diffMessageWords, editableBody, formatEditTime, historyVersions, lastEditedAt } from '../../lib/messaging/message-edit';

  interface Props {
    messageId: string;
    editHistory?: EditEntry[] | null;
  }

  let { messageId, editHistory = null }: Props = $props();
  let historyOpen = $state(false);
  let editedAt = $derived(lastEditedAt(editHistory));
  let versions = $derived(historyVersions(editHistory));
  let label = $derived(
    editedAt != null
      ? $t('messaging.message.editedAt', { values: { time: formatEditTime(editedAt) } })
      : $t('messaging.message.edited'),
  );
  let titleId = $derived(`edit-history-title-${messageId}`);
</script>

{#if versions.length > 0}
  <Popover.Root bind:open={historyOpen}>
    <Popover.Trigger
      class="edited-label"
      title={historyOpen ? $t('messaging.message.editHistoryHide') : $t('messaging.message.editHistoryShow')}
      onpointerdown={(event) => event.stopPropagation()}
    >
      {#if editedAt != null}
        <time datetime={new Date(editedAt).toISOString()}>{label}</time>
      {:else}
        {label}
      {/if}
    </Popover.Trigger>
    <Popover.Content
      align="start"
      sideOffset={6}
      role="dialog"
      aria-labelledby={titleId}
      class="w-96 max-w-[calc(100vw-2rem)] p-0"
    >
      <div class="history-header">
        <h3 id={titleId}>{$t('messaging.message.editHistoryAria')}</h3>
        <span class="history-legend">
          <del>{$t('messaging.message.editHistoryRemoved')}</del>
          <ins>{$t('messaging.message.editHistoryAdded')}</ins>
        </span>
      </div>
      <ol class="edit-history" aria-label={$t('messaging.message.editHistoryAria')}>
        {#each versions as version, i (i)}
          {@const diff = i > 0 ? diffMessageWords(versions[i - 1].content, version.content) : null}
          <li class="edit-history-entry">
            <time class="edit-history-meta" datetime={new Date(version.edited_at).toISOString()}>
              {$t(i === 0
                ? 'messaging.message.editHistoryOriginal'
                : i === versions.length - 1
                  ? 'messaging.message.editHistoryCurrent'
                  : 'messaging.message.editHistoryVersion', {
                values: { time: formatEditTime(version.edited_at, true) },
              })}
            </time>
            <p class="edit-history-content">{#if diff}{#each diff as part, index (index)}{#if part.type === 'delete'}<del>{part.text}</del>{:else if part.type === 'insert'}<ins>{part.text}</ins>{:else}{part.text}{/if}{/each}{:else}{editableBody(version.content)}{/if}</p>
          </li>
        {/each}
      </ol>
    </Popover.Content>
  </Popover.Root>
{:else}
  <span class="edited-label static">{label}</span>
{/if}

<style>
  :global(button.edited-label), .edited-label.static {
    display: inline;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.75rem;
    line-height: inherit;
    border-radius: 4px;
  }

  :global(button.edited-label) { cursor: pointer; }
  :global(button.edited-label:hover) { color: var(--text-secondary); text-decoration: underline; }
  :global(button.edited-label:focus-visible) { outline: 2px solid var(--brand); outline-offset: 2px; }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  h3 { margin: 0; color: var(--text-primary); font-size: 0.875rem; font-weight: 600; }
  .history-legend { display: flex; gap: 8px; font-size: 0.75rem; }

  .edit-history {
    list-style: none;
    margin: 0;
    padding: 0 14px;
    max-height: min(24rem, 60vh);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .edit-history-entry { padding: 12px 0; min-width: 0; }
  .edit-history-entry + .edit-history-entry { border-top: 1px solid var(--border); }
  .edit-history-meta { color: var(--text-muted); font-size: 0.75rem; }
  .edit-history-content {
    margin: 4px 0 0;
    color: var(--text-primary);
    font-size: 0.875rem;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  del { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); text-decoration: line-through; }
  ins { color: var(--success); background: color-mix(in srgb, var(--success) 12%, transparent); text-decoration: underline; text-underline-offset: 2px; }
</style>
