<script lang="ts">
  import { t } from 'svelte-i18n';
  import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
  import { readFile } from '@tauri-apps/plugin-fs';
  import type { Squad } from '../../../stores/squads';
  import { stickerPacks } from '../../../stores/stickers';
  import { saveStickerPack, uploadStickerImage, type StickerEntry } from '../../../lib/api/stickers';
  import { sendDmMessage } from '../../../lib/api/nostr';
  import { ANNOUNCE_TYPE_STICKER_PACK_UPDATED, buildAnnounceContent } from '../../../lib/announcements';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { validateShortcode } from '../../../lib/squad/sticker-pack-validation';

  type Props = {
    squad: Squad;
    announcementsGroupId: string | null;
  };
  const { squad, announcementsGroupId }: Props = $props();

  /** A pending pack entry: uploading, ready to save, or failed. Local-only until Save. */
  interface DraftEntry {
    id: string;
    shortcode: string;
    fileName: string;
    filePath: string;
    status: 'uploading' | 'ready' | 'error';
    error: string;
    entry: StickerEntry | null;
  }

  const squadId = $derived(announcementsGroupId?.trim() ?? '');
  const existingPack = $derived($stickerPacks.find((p) => p.squadId === squadId) ?? null);

  let packId = $state('');
  let packName = $state('');
  let draftEntries = $state<DraftEntry[]>([]);
  let saving = $state(false);
  let saveError = $state('');
  let saveSuccess = $state(false);
  let hydratedForPackId: string | null = null;

  $effect(() => {
    const pack = existingPack;
    const targetId = pack?.packId ?? null;
    if (hydratedForPackId === targetId) return;
    hydratedForPackId = targetId;
    packId = pack?.packId ?? crypto.randomUUID();
    packName = pack?.name ?? '';
    saveSuccess = false;
    saveError = '';
    draftEntries = (pack?.entries ?? []).map((entry) => ({
      id: crypto.randomUUID(),
      shortcode: entry.shortcode,
      fileName: entry.shortcode,
      filePath: '',
      status: 'ready' as const,
      error: '',
      entry,
    }));
  });

  const isUploading = $derived(draftEntries.some((d) => d.status === 'uploading'));
  const validationEntries = $derived(draftEntries.filter((d) => d.status !== 'error'));

  function fieldError(entry: DraftEntry): string {
    const error = validateShortcode(entry, validationEntries);
    if (error === 'empty') return $t('squad.stickers.shortcodeEmptyError');
    if (error === 'duplicate') return $t('squad.stickers.shortcodeDuplicateError');
    return '';
  }

  const hasValidationErrors = $derived(validationEntries.some((entry) => fieldError(entry) !== ''));
  const canSave = $derived(squadId !== '' && !saving && !isUploading && !hasValidationErrors);

  function basenameFromPath(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || path;
  }

  function stripExtension(fileName: string): string {
    const idx = fileName.lastIndexOf('.');
    return idx > 0 ? fileName.slice(0, idx) : fileName;
  }

  async function handleAddImage() {
    if (!squadId || saving) return;
    try {
      const selected = await openFileDialog({
        title: $t('squad.stickers.addImageButton'),
        filters: [{ name: $t('squad.stickers.addImageButton'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
        multiple: true,
      });
      if (selected == null) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        void uploadFromPath(path);
      }
    } catch (e) {
      console.error('Sticker image pick failed:', e);
    }
  }

  async function uploadFromPath(path: string) {
    const fileName = basenameFromPath(path);
    const draftId = crypto.randomUUID();
    draftEntries = [
      ...draftEntries,
      {
        id: draftId,
        shortcode: stripExtension(fileName),
        fileName,
        filePath: path,
        status: 'uploading' as const,
        error: '',
        entry: null,
      },
    ];
    try {
      const bytes = await readFile(path);
      const uploaded = await uploadStickerImage(bytes, fileName);
      draftEntries = draftEntries.map((d) =>
        d.id === draftId
          ? { ...d, status: 'ready' as const, error: '', entry: { shortcode: d.shortcode, ...uploaded } }
          : d,
      );
    } catch (e) {
      draftEntries = draftEntries.map((d) =>
        d.id === draftId ? { ...d, status: 'error' as const, error: getInvokeErrorMessage(e) } : d,
      );
    }
  }

  function retryUpload(id: string) {
    const draft = draftEntries.find((d) => d.id === id);
    if (!draft || !draft.filePath) return;
    draftEntries = draftEntries.filter((d) => d.id !== id);
    void uploadFromPath(draft.filePath);
  }

  function updateShortcode(id: string, value: string) {
    draftEntries = draftEntries.map((d) =>
      d.id === id
        ? { ...d, shortcode: value, entry: d.entry ? { ...d.entry, shortcode: value } : d.entry }
        : d,
    );
  }

  function removeEntry(id: string) {
    draftEntries = draftEntries.filter((d) => d.id !== id);
  }

  async function handleSave() {
    if (!canSave) return;
    saving = true;
    saveError = '';
    saveSuccess = false;
    try {
      const entries: StickerEntry[] = validationEntries
        .filter((d): d is DraftEntry & { entry: StickerEntry } => d.status === 'ready' && d.entry != null)
        .map((d) => ({ ...d.entry, shortcode: d.shortcode.trim() }));
      const saved = await saveStickerPack(squadId, packId, packName.trim(), entries, false);
      packId = saved.packId;
      await sendDmMessage(
        squadId,
        buildAnnounceContent(
          {
            type: ANNOUNCE_TYPE_STICKER_PACK_UPDATED,
            payload: {
              squad_id: saved.squadId,
              pack_id: saved.packId,
              name: saved.name,
              entries: saved.entries,
              updated_at: saved.updatedAt,
              deleted: saved.deleted,
            },
          },
          { virtualBucket: 'announcements' },
        ),
        '',
        { virtualBucket: 'announcements' },
      );
      saveSuccess = true;
    } catch (e) {
      saveError = getInvokeErrorMessage(e);
    } finally {
      saving = false;
    }
  }
</script>

<section class="stickers-section" aria-label={`${$t('squad.stickers.sectionAria')} — ${squad.name}`}>
  {#if !squadId}
    <p class="stickers-empty-state">{$t('squad.stickers.emptyState')}</p>
    <p class="muted stickers-empty-hint">{$t('squad.stickers.emptyStateHint')}</p>
  {:else}
    <h3 class="stickers-title">{$t('squad.stickers.sectionTitle')}</h3>

    <div class="stickers-field-row">
      <label class="meta-label" for="sticker-pack-name">{$t('squad.stickers.packNameLabel')}</label>
      <input
        id="sticker-pack-name"
        type="text"
        class="stickers-name-input"
        placeholder={$t('squad.stickers.packNamePlaceholder')}
        bind:value={packName}
        disabled={saving}
      />
    </div>

    <div class="stickers-entries-header">
      <span class="meta-label">{$t('squad.stickers.entriesTitle')}</span>
      <button
        type="button"
        class="btn-text"
        onclick={handleAddImage}
        disabled={saving}
        aria-label={$t('squad.stickers.addImageAria')}
      >
        {$t('squad.stickers.addImageButton')}
      </button>
    </div>

    {#if draftEntries.length === 0}
      <p class="muted stickers-no-entries">{$t('squad.stickers.noEntriesHint')}</p>
    {:else}
      <ul class="stickers-entry-list" role="list">
        {#each draftEntries as entry (entry.id)}
          <li class="stickers-entry-row">
            <span
              class="stickers-entry-thumb"
              class:stickers-entry-thumb-loading={entry.status === 'uploading'}
              class:stickers-entry-thumb-error={entry.status === 'error'}
              aria-hidden="true"
            ></span>
            <div class="stickers-entry-fields">
              <input
                type="text"
                class="stickers-shortcode-input"
                placeholder={$t('squad.stickers.shortcodePlaceholder')}
                aria-label={$t('squad.stickers.shortcodeLabel')}
                value={entry.shortcode}
                oninput={(e) => updateShortcode(entry.id, (e.currentTarget as HTMLInputElement).value)}
                disabled={saving}
              />
              {#if entry.status === 'uploading'}
                <span class="stickers-entry-status">
                  {$t('squad.stickers.uploadingNamed', { values: { fileName: entry.fileName } })}
                </span>
              {:else if entry.status === 'error'}
                <span class="stickers-entry-status stickers-entry-status-error" role="alert">
                  {$t('squad.stickers.uploadFailedNamed', { values: { fileName: entry.fileName } })}
                </span>
                <button
                  type="button"
                  class="btn-text"
                  onclick={() => retryUpload(entry.id)}
                  disabled={saving}
                  aria-label={$t('squad.stickers.retryUploadAria', { values: { fileName: entry.fileName } })}
                >
                  {$t('squad.stickers.addImageButton')}
                </button>
              {:else if fieldError(entry)}
                <span class="stickers-entry-status stickers-entry-status-error" role="alert">
                  {fieldError(entry)}
                </span>
              {/if}
            </div>
            <button
              type="button"
              class="stickers-remove-btn"
              onclick={() => removeEntry(entry.id)}
              disabled={saving}
              aria-label={$t('squad.stickers.removeEntryAria', {
                values: { shortcode: entry.shortcode || entry.fileName },
              })}
            >
              &times;
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="stickers-save-row">
      <button type="button" class="btn-primary" onclick={handleSave} disabled={!canSave}>
        {#if saving}
          {$t('squad.stickers.savingStatus')}
        {:else if existingPack}
          {$t('squad.stickers.saveButton')}
        {:else}
          {$t('squad.stickers.createPackButton')}
        {/if}
      </button>
      {#if saveError}
        <span class="stickers-save-error" role="alert">{saveError}</span>
      {:else if saveSuccess}
        <span class="stickers-save-success" role="status">{$t('squad.stickers.saveSuccess')}</span>
      {/if}
    </div>
  {/if}
</section>

<style>
  .stickers-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 0.875rem;
  }

  .stickers-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .muted {
    color: var(--text-muted);
  }

  .stickers-empty-state {
    margin: 0;
    font-weight: 600;
    color: var(--text-primary);
  }

  .stickers-empty-hint {
    margin: 0;
    font-size: 0.8125rem;
  }

  .meta-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .stickers-field-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .stickers-name-input,
  .stickers-shortcode-input {
    padding: 6px 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-primary, transparent);
    color: var(--text-primary);
    font: inherit;
  }

  .stickers-entries-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--border-subtle);
  }

  .btn-text {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-text:disabled {
    color: var(--text-muted);
    cursor: default;
  }

  .stickers-no-entries {
    margin: 0;
    font-size: 0.8125rem;
  }

  .stickers-entry-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .stickers-entry-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .stickers-entry-thumb {
    width: 2rem;
    height: 2rem;
    flex: none;
    border-radius: 6px;
    background: var(--border-subtle);
  }

  .stickers-entry-thumb-loading {
    opacity: 0.5;
  }

  .stickers-entry-thumb-error {
    background: color-mix(in srgb, red 25%, var(--border-subtle));
  }

  .stickers-entry-fields {
    flex: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-width: 0;
  }

  .stickers-entry-status {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .stickers-entry-status-error {
    color: #c0392b;
  }

  .stickers-remove-btn {
    flex: none;
    width: 1.75rem;
    height: 1.75rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
  }

  .stickers-remove-btn:hover:not(:disabled) {
    background: var(--border-subtle);
    color: var(--text-primary);
  }

  .stickers-remove-btn:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .stickers-save-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 8px;
    border-top: 1px solid var(--border-subtle);
  }

  .btn-primary {
    padding: 6px 14px;
    border: none;
    border-radius: 6px;
    background: var(--accent, #2563eb);
    color: #fff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .stickers-save-error {
    color: #c0392b;
    font-size: 0.8125rem;
  }

  .stickers-save-success {
    color: #1a7f4b;
    font-size: 0.8125rem;
  }
</style>
