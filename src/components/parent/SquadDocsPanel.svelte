<script lang="ts">
  import { t, locale } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { tick } from 'svelte';
  import AddDocModal from './AddDocModal.svelte';
  import EditIconButton from '../ui/EditIconButton.svelte';
  import { listSquadDocs, sendSquadDocRemove, type SquadDocDto } from '../../lib/api/squad-docs';
  import { requireMySquadPrivilege } from '../../lib/governance/squad-privilege-enforce';
  import { maskDocUrl } from '../../lib/docs/mask-url';
  import { filterDocs, sortDocsNewestFirst, type DocsFilter } from '../../lib/docs/shelf';
  import { formatEventTimestampMs, memberDisplayLabel } from '../../lib/squad/squad-event-display';
  import { eventChannelName, eventChannelOptions } from '../../lib/squad/squad-event-form';
  import { squadRecordErrorMessage } from '../../lib/squad/squad-record-errors';
  import { copyTextToClipboard } from '../../lib/utils/clipboard-copy';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { currentUser } from '../../stores/auth-session';
  import { squadDocReplicaNonceByParentId } from '../../stores/docs-hub-alerts';
  import { docsFocus } from '../../stores/docs-navigation';
  import { loadProfile, profiles } from '../../stores/profiles';
  import { squads } from '../../stores/squads';
  import { showToast } from '../../stores/toast';

  interface Props {
    /** Squad id (announcements MLS group id). */
    parentId: string;
    /** Announcements MLS group the doc rumors ride. */
    mlsGroupId: string | null;
  }

  let { parentId, mlsGroupId }: Props = $props();

  let docs = $state<SquadDocDto[]>([]);
  let loaded = $state(false);
  /** Last load failure, shown only while nothing is listed. */
  let loadError = $state('');
  /** `null` while unknown or after a failed read (add stays offered). */
  let canAdd = $state<boolean | null>(null);
  let policySettled = $state(false);
  let filter = $state<DocsFilter>({ kind: 'all' });
  let revealedIds = $state<Record<string, boolean>>({});
  let highlightId = $state<string | null>(null);
  let showAdd = $state(false);
  let editingDoc = $state<SquadDocDto | null>(null);
  let confirmingRemoveId = $state<string | null>(null);
  let removingId = $state<string | null>(null);
  let actionError = $state('');

  const pid = $derived(parentId.trim());
  const gid = $derived(mlsGroupId?.trim() ?? '');
  const replicaNonce = $derived(pid ? ($squadDocReplicaNonceByParentId[pid] ?? 0) : 0);
  const channels = $derived($squads.find((s) => s.id === pid)?.channels ?? []);
  const channelOptions = $derived(eventChannelOptions(channels));
  const visible = $derived(sortDocsNewestFirst(filterDocs(docs, filter)));
  const timeOpts = $derived({ locale: $locale ?? undefined });
  const selfNpub = $derived($currentUser?.npub);
  const youLabel = $derived($t('docs.card.you'));
  const addControl = $derived(canAdd === false ? 'denied' : 'add');
  const filterValue = $derived(
    filter.kind === 'channel' ? `channel:${filter.channelId}` : filter.kind
  );

  // A reused panel must not show or act on the previous squad's rows.
  let shownPid = '';
  $effect.pre(() => {
    if (shownPid === pid) return;
    shownPid = pid;
    docs = [];
    loaded = false;
    loadError = '';
    canAdd = null;
    policySettled = false;
    filter = { kind: 'all' };
    revealedIds = {};
    highlightId = null;
    showAdd = false;
    editingDoc = null;
    confirmingRemoveId = null;
    removingId = null;
    actionError = '';
  });

  function setFilter(value: string): void {
    if (value === 'untagged') filter = { kind: 'untagged' };
    else if (value.startsWith('channel:')) filter = { kind: 'channel', channelId: value.slice('channel:'.length) };
    else filter = { kind: 'all' };
  }

  let loadGen = 0;
  async function loadDocs(id: string): Promise<void> {
    const gen = ++loadGen;
    try {
      const rows = await listSquadDocs(id);
      if (gen !== loadGen) return;
      docs = rows;
      loadError = '';
    } catch (e) {
      if (gen !== loadGen) return;
      const tFn = get(t);
      loadError = squadRecordErrorMessage(e, tFn, tFn('docs.panel.errorLoad'));
    } finally {
      if (gen === loadGen) loaded = true;
    }
  }

  let policyGen = 0;
  async function loadPrivilege(id: string): Promise<void> {
    const gen = ++policyGen;
    try {
      const decision = await requireMySquadPrivilege(id, 'addDoc');
      if (gen === policyGen) canAdd = decision.ok;
    } catch {
      if (gen === policyGen) canAdd = null;
    } finally {
      if (gen === policyGen) policySettled = true;
    }
  }

  $effect(() => {
    void replicaNonce;
    if (pid) void loadDocs(pid);
  });

  $effect(() => {
    if (pid) void loadPrivilege(pid);
  });

  // Deep links: pre-select a channel filter, or show one row, then consume the request.
  $effect(() => {
    const focus = $docsFocus;
    if (!focus || focus.parentId !== pid) return;
    if (focus.docId) {
      filter = { kind: 'all' };
      highlightId = focus.docId;
    } else {
      filter = focus.channelId ? { kind: 'channel', channelId: focus.channelId } : { kind: 'all' };
      highlightId = null;
    }
    docsFocus.set(null);
  });

  $effect(() => {
    const id = highlightId;
    if (!id || !loaded || !docs.some((d) => d.id === id)) return;
    void tick().then(() => document.getElementById(`doc-${id}`)?.scrollIntoView?.({ block: 'nearest' }));
  });

  const requestedProfiles = new Set<string>();
  $effect(() => {
    for (const doc of docs) {
      for (const npub of [doc.authorNpub, doc.updatedByNpub]) {
        if (!npub || $profiles[npub] || requestedProfiles.has(npub)) continue;
        requestedProfiles.add(npub);
        void loadProfile(npub).catch(() => {});
      }
    }
  });

  function memberName(npub: string): string {
    return memberDisplayLabel(npub, $profiles[npub], selfNpub, youLabel);
  }

  async function copyLink(doc: SquadDocDto): Promise<void> {
    const ok = await copyTextToClipboard(doc.url);
    showToast(get(t)(ok ? 'docs.card.copied' : 'docs.card.copyFailed'));
  }

  async function removeDoc(doc: SquadDocDto): Promise<void> {
    if (removingId || !gid || !pid) return;
    const removingFrom = pid;
    removingId = doc.id;
    actionError = '';
    let error = '';
    try {
      await sendSquadDocRemove({ mlsGroupId: gid, parentId: pid, docId: doc.id });
      showToast(get(t)('docs.card.removed'));
    } catch (e) {
      const tFn = get(t);
      error = squadRecordErrorMessage(e, tFn, tFn('docs.card.errorRemove'));
    }
    if (removingFrom !== pid) return;
    removingId = null;
    if (error) actionError = error;
    else confirmingRemoveId = null;
  }
</script>

<div class="docs-shell">
  <div class="docs-toolbar">
    <div class="docs-toolbar-filters">
      <label class="docs-filter-label" for="docs-filter">{$t('docs.panel.filterLabel')}</label>
      <select
        id="docs-filter"
        class="docs-filter"
        value={filterValue}
        onchange={(e) => setFilter(e.currentTarget.value)}
      >
        <option value="all">{$t('docs.panel.filterAll')}</option>
        {#each channelOptions as option (option.groupId)}
          <option value={`channel:${option.groupId}`}>#{option.name}</option>
        {/each}
        <option value="untagged">{$t('docs.panel.filterUntagged')}</option>
      </select>
    </div>
    {#if policySettled || !gid}
      {#if addControl === 'add'}
        <button type="button" class="btn-primary docs-add-btn" onclick={() => (showAdd = true)}>
          {$t('docs.panel.add')}
        </button>
      {:else}
        <p class="docs-msg muted docs-toolbar-policy">{$t('docs.panel.denied')}</p>
      {/if}
    {/if}
  </div>

  <div class="docs-scroll" role="feed" aria-label={$t('docs.panel.ariaLabel')} aria-busy={!loaded}>
    {#if !loaded}
      <p class="docs-msg muted">{$t('docs.panel.loading')}</p>
    {:else if loadError && docs.length === 0}
      <p class="docs-msg muted" role="alert">{loadError}</p>
    {:else if docs.length === 0}
      <p class="docs-msg muted">{$t('docs.panel.empty')}</p>
    {:else if visible.length === 0}
      <p class="docs-msg muted">{$t('docs.panel.emptyFiltered')}</p>
    {:else}
      {#if actionError}
        <p class="docs-msg docs-error" role="alert">{actionError}</p>
      {/if}
      <ul class="docs-list" role="list">
        {#each visible as doc (doc.id)}
          {@const channelName = eventChannelName(channels, doc.channelId)}
          {@const masked = maskDocUrl(doc.url)}
          {@const revealed = revealedIds[doc.id] === true}
          <li id={`doc-${doc.id}`} class="doc-card" class:doc-card--highlight={highlightId === doc.id}>
            <div class="doc-card-head">
              <button
                type="button"
                class="doc-card-title"
                aria-label={$t('docs.card.openAria', { values: { title: doc.title } })}
                onclick={() => void openExternalUrl(doc.url)}
              >
                {doc.title}
              </button>
              {#if doc.canEdit}
                <EditIconButton
                  ariaLabel={$t('docs.card.editAria', { values: { title: doc.title } })}
                  title={$t('docs.card.editAria', { values: { title: doc.title } })}
                  disabled={removingId === doc.id}
                  onclick={() => (editingDoc = doc)}
                />
              {/if}
            </div>
            <span class="doc-card-meta">
              <span>{$t(`docs.provider.${doc.provider}`)}</span>
              {#if channelName}
                <span>#{channelName}</span>
              {/if}
            </span>
            <span class="doc-card-url-row">
              {#if masked === doc.url}
                <span class="doc-card-url">{doc.url}</span>
              {:else}
                <button
                  type="button"
                  class="doc-card-url doc-card-url-toggle"
                  aria-pressed={revealed}
                  aria-label={revealed ? $t('docs.card.hideAria') : $t('docs.card.revealAria')}
                  title={revealed ? $t('docs.card.hideAria') : $t('docs.card.revealAria')}
                  onclick={() => (revealedIds = { ...revealedIds, [doc.id]: !revealed })}
                >
                  {revealed ? doc.url : masked}
                </button>
              {/if}
              <button
                type="button"
                class="doc-card-copy"
                aria-label={$t('docs.card.copyAria', { values: { title: doc.title } })}
                title={$t('docs.card.copyAria', { values: { title: doc.title } })}
                onclick={() => void copyLink(doc)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </span>
            {#if doc.note?.trim()}
              <p class="doc-card-note">{doc.note}</p>
            {/if}
            <span class="doc-card-by">
              {$t('docs.card.addedBy', {
                values: { name: memberName(doc.authorNpub), time: formatEventTimestampMs(doc.createdAtMs, timeOpts) },
              })}
            </span>
            {#if doc.updatedAtMs > doc.createdAtMs}
              <span class="doc-card-by">
                {$t('docs.card.updatedBy', {
                  values: { name: memberName(doc.updatedByNpub), time: formatEventTimestampMs(doc.updatedAtMs, timeOpts) },
                })}
              </span>
            {/if}
            {#if doc.canEdit}
              <div class="doc-card-remove">
                {#if confirmingRemoveId === doc.id}
                  <p class="doc-card-by">{$t('docs.card.removeConfirm')}</p>
                  <div class="doc-card-remove-actions">
                    <button
                      type="button"
                      class="btn-secondary"
                      disabled={removingId === doc.id}
                      onclick={() => (confirmingRemoveId = null)}
                    >
                      {$t('docs.card.removeConfirmNo')}
                    </button>
                    <button
                      type="button"
                      class="doc-danger-btn"
                      disabled={removingId === doc.id}
                      aria-busy={removingId === doc.id}
                      onclick={() => void removeDoc(doc)}
                    >
                      {removingId === doc.id ? $t('docs.card.removing') : $t('docs.card.removeConfirmYes')}
                    </button>
                  </div>
                {:else}
                  <button
                    type="button"
                    class="doc-danger-btn"
                    aria-label={$t('docs.card.removeAria', { values: { title: doc.title } })}
                    onclick={() => (confirmingRemoveId = doc.id)}
                  >
                    {$t('docs.card.remove')}
                  </button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

{#if showAdd}
  <AddDocModal
    open={showAdd}
    mlsGroupId={gid}
    parentId={pid}
    initial={filter.kind === 'channel' ? { url: '', title: '', channelId: filter.channelId, note: null } : null}
    onclose={() => (showAdd = false)}
  />
{/if}

{#if editingDoc}
  <AddDocModal open mlsGroupId={gid} parentId={pid} editing={editingDoc} onclose={() => (editingDoc = null)} />
{/if}

<style>
  .docs-shell {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 8px 12px 12px;
  }

  .docs-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 8px;
    flex-shrink: 0;
  }

  .docs-toolbar-filters {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .docs-toolbar-policy {
    margin: 0;
    padding: 0;
    text-align: right;
    max-width: 50%;
  }

  .docs-filter-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .docs-filter {
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 13px;
  }

  .docs-add-btn {
    padding: 6px 12px;
    font-size: 0.875rem;
    flex-shrink: 0;
  }

  .docs-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .docs-msg {
    margin: 0;
    padding: 8px 0;
    font-size: 13px;
    line-height: 1.45;
  }

  .muted {
    color: var(--text-secondary);
  }

  .docs-error {
    color: var(--danger, #e85d5d);
  }

  .docs-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .doc-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px 14px;
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .doc-card--highlight {
    border-color: var(--brand);
  }

  .doc-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .doc-card-title {
    padding: 0;
    border: none;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .doc-card-title:hover {
    text-decoration: underline;
  }

  .doc-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .doc-card-url-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .doc-card-url {
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--text-secondary);
  }

  .doc-card-url-toggle {
    padding: 0;
    border: none;
    background: none;
    text-align: left;
    cursor: pointer;
  }

  .doc-card-copy {
    display: inline-flex;
    flex-shrink: 0;
    padding: 4px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }

  .doc-card-copy:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .doc-card-note {
    margin: 2px 0 0;
    font-size: 13px;
    white-space: pre-wrap;
  }

  .doc-card-by {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .doc-card-remove {
    margin-top: 6px;
  }

  .doc-card-remove-actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }

  .doc-danger-btn {
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--danger, #e85d5d);
    background: transparent;
    color: var(--danger, #e85d5d);
    font-size: 12px;
    cursor: pointer;
  }

</style>
