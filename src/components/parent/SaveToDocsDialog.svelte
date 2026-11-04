<svelte:options runes={true} />

<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import Modal from '../ui/Modal.svelte';
  import AddDocModal from './AddDocModal.svelte';
  import { listSquadDocs, type SquadDocDto } from '../../lib/api/squad-docs';
  import { maskDocUrl } from '../../lib/docs/mask-url';
  import { extractMessageDocLinks, type MessageDocLink } from '../../lib/docs/message-links';
  import { needsWholeSquadConfirm, saveToDocsStep } from '../../lib/squad/squad-doc-form';
  import { squadRecordErrorMessage } from '../../lib/squad/squad-record-errors';
  import { openSquadDocs } from '../../stores/docs-navigation';
  import { showToast } from '../../stores/toast';

  interface Props {
    parentId: string;
    /** Announcements MLS group the shelf rides. */
    announcementsGroupId: string;
    /** Message text and the MLS group of the channel it was rendered in. */
    text: string;
    channelGroupId: string;
    onclose: () => void;
  }

  let { parentId, announcementsGroupId, text, channelGroupId, onclose }: Props = $props();

  const titleId = 'save-to-docs-pick-title';
  const links = $derived(extractMessageDocLinks(text));

  let rows = $state<SquadDocDto[] | null>(null);
  let picked = $state<MessageDocLink | null>(null);

  const step = $derived(rows ? saveToDocsStep(links, rows, channelGroupId, picked) : null);

  // Reads only the local replica; the doc URL is never fetched.
  $effect(() => {
    const pid = parentId.trim();
    let stale = false;
    listSquadDocs(pid)
      .then((r) => {
        if (!stale) rows = r;
      })
      .catch((e) => {
        if (stale) return;
        const tFn = get(t);
        showToast(squadRecordErrorMessage(e, tFn, tFn('docs.panel.errorLoad')));
        onclose();
      });
    return () => {
      stale = true;
    };
  });

  $effect(() => {
    if (rows && !step) onclose();
    if (step?.kind === 'openExisting') {
      showToast(get(t)('docs.save.alreadySaved'));
      openSquadDocs(parentId, { docId: step.doc.id });
      onclose();
    }
  });
</script>

{#if step?.kind === 'pick'}
  <Modal {titleId} onClose={onclose}>
    <h2 id={titleId}>{$t('docs.save.pickTitle')}</h2>
    <p class="pick-hint">{$t('docs.save.pickHint')}</p>
    <ul class="pick-list" role="list">
      {#each step.links as link (link.url)}
        <li>
          <button type="button" class="pick-item" onclick={() => (picked = link)}>
            {#if link.label}
              <span class="pick-label">{link.label}</span>
            {/if}
            <span class="pick-url">{maskDocUrl(link.url)}</span>
          </button>
        </li>
      {/each}
    </ul>
    <div class="modal-actions">
      <button type="button" class="btn-secondary" onclick={onclose}>{$t('docs.add.cancel')}</button>
    </div>
  </Modal>
{:else if step?.kind === 'add'}
  <AddDocModal
    open
    mlsGroupId={announcementsGroupId}
    {parentId}
    initial={step.initial}
    requireSquadConfirm={needsWholeSquadConfirm(channelGroupId, announcementsGroupId)}
    {onclose}
  />
{:else if step?.kind === 'edit'}
  <AddDocModal
    open
    mlsGroupId={announcementsGroupId}
    {parentId}
    editing={step.doc}
    initial={step.initial}
    {onclose}
  />
{/if}

<style>
  .pick-hint {
    margin: 0 0 12px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .pick-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .pick-item {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pick-item:hover {
    background: var(--bg-hover);
  }

  .pick-label {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .pick-url {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
