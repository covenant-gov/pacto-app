<script lang="ts">
  import { t } from 'svelte-i18n';
  import Modal from '../ui/Modal.svelte';
  import SquadCommonsVisibilityFields from './SquadCommonsVisibilityFields.svelte';
  import AvatarPicker from '../ui/AvatarPicker.svelte';
  import SquadAvatar from './SquadAvatar.svelte';
  import type { Squad } from '../../stores/app';
  import type { SquadVisibility } from '../../stores/squads';
  import { appConfig } from '../../stores/app-config';

  export let open = false;
  export let anchorSquadName = '';
  export let candidates: Squad[] = [];
  export let error = '';
  export let creating = false;

  export let onClose: () => void = () => {};
  export let onCreate: (params: {
    name: string;
    partnerSquadId: string;
    iconUrl?: string;
    visibility: SquadVisibility;
    commonsTags?: string[];
  }) => void = () => {};

  let pairName = '';
  let iconUrl = '';
  let selectedPartnerSquadId = '';
  let visibility: SquadVisibility = 'private';
  let tags: string[] = [];
  let tagError = '';
  let commonsFields: SquadCommonsVisibilityFields;

  $: maxCommonsTags = $appConfig.commonsMaxTags;

  $: canCreate =
    pairName.trim().length > 0 &&
    !!selectedPartnerSquadId &&
    candidates.length > 0 &&
    !creating &&
    (visibility !== 'public' || tags.length === maxCommonsTags);

  $: if (open) {
    setTimeout(() => document.getElementById('squad-pair-name')?.focus(), 0);
  }

  function selectPartner(squadId: string) {
    selectedPartnerSquadId = squadId;
  }

  function handleSubmit() {
    if (!canCreate) return;
    onCreate({
      name: pairName.trim(),
      partnerSquadId: selectedPartnerSquadId,
      iconUrl: iconUrl.trim() || undefined,
      visibility,
      commonsTags: visibility === 'public' ? tags : undefined,
    });
  }

  export function resetForm() {
    pairName = '';
    iconUrl = '';
    selectedPartnerSquadId = '';
    commonsFields?.resetCommonsFields();
  }
</script>

{#if open}
  <Modal titleId="pair-squad-title" descriptionId="pair-squad-description" onClose={onClose}>
    <h2 id="pair-squad-title">{$t('squad.pair.title')}</h2>
    <p id="pair-squad-description" class="pair-modal-subtitle">
      {$t('squad.pair.subtitle', { values: { anchorSquadName } })}
    </p>
    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <label class="pair-label" for="squad-pair-name">{$t('squad.pair.nameLabel')}</label>
      <input
        id="squad-pair-name"
        type="text"
        class="pair-input"
        placeholder={$t('squad.pair.namePlaceholder')}
        bind:value={pairName}
        required
        aria-required="true"
      />
      <span class="pair-label">{$t('squad.pair.iconLabel')}</span>
      <AvatarPicker
        src={iconUrl || null}
        editable
        allowClear={!!iconUrl}
        size={72}
        chooseTitle={$t('squad.pfp.choose')}
        editAriaLabel={$t('squad.pfp.change')}
        cropTitle={$t('squad.pfp.cropTitle')}
        onChange={(url) => (iconUrl = url)}
        onClear={() => (iconUrl = '')}
      >
        {#snippet fallback()}
          <SquadAvatar src={null} name={pairName} seed={pairName} fill />
        {/snippet}
      </AvatarPicker>
      <span class="pair-label">{$t('squad.pair.partnerLabel')}</span>
      <div class="pair-candidates" role="radiogroup" aria-label={$t('squad.pair.partnerAriaLabel')}>
        {#each candidates as squad (squad.id)}
          <label class="pair-candidate-row">
            <input
              type="radio"
              name="partner-squad"
              value={squad.id}
              checked={selectedPartnerSquadId === squad.id}
              onchange={() => selectPartner(squad.id)}
            />
            <SquadAvatar src={squad.iconUrl} name={squad.name} seed={squad.id || squad.name} size={28} />
            <span class="pair-candidate-name">{squad.name}</span>
          </label>
        {/each}
      </div>
      {#if candidates.length === 0}
        <p class="pair-empty">{$t('squad.pair.empty', { values: { anchorSquadName } })}</p>
      {/if}
      <SquadCommonsVisibilityFields
        bind:this={commonsFields}
        bind:visibility
        bind:tags
        bind:tagError={tagError}
        fieldsetName="pair-squad-visibility"
      />
      {#if error}
        <p class="pair-error" role="alert">{error}</p>
      {/if}
      <div class="pair-actions">
        <button type="button" class="pair-btn-cancel" onclick={onClose} aria-label={$t('squad.pair.cancel')}>
          {$t('squad.pair.cancel')}
        </button>
        <button type="submit" class="pair-btn-create" disabled={!canCreate} aria-label={$t('squad.pair.createAria')}>
          {creating ? $t('squad.pair.creating') : $t('squad.pair.create')}
        </button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .pair-modal-subtitle {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 24px 0;
  }

  .pair-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 6px;
  }

  .pair-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    margin-bottom: 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .pair-candidates {
    max-height: 180px;
    overflow-y: auto;
    margin-bottom: 16px;
    padding: 8px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
  }

  .pair-candidate-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .pair-candidate-row:hover {
    background: var(--bg-hover);
  }

  .pair-candidate-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pair-empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px 0;
  }

  .pair-error {
    color: var(--danger);
    font-size: 0.875rem;
    margin: 0 0 12px 0;
  }

  .pair-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .pair-btn-cancel {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .pair-btn-create {
    padding: 8px 16px;
    background: var(--brand);
    border: none;
    border-radius: 8px;
    color: var(--on-brand);
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .pair-btn-create:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
