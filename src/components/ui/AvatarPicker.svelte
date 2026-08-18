<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import EditIconButton from './EditIconButton.svelte';
  import AvatarCropModal from './AvatarCropModal.svelte';
  import { pickLocalImage } from '../../lib/media/pick-local-image';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';

  let {
    src = null,
    editable = false,
    allowClear = false,
    disabled = false,
    size = 128,
    chooseTitle,
    editAriaLabel,
    cropTitle,
    onChange,
    onClear,
    fallback,
    fallbackText = '',
  }: {
    src?: string | null;
    editable?: boolean;
    allowClear?: boolean;
    disabled?: boolean;
    size?: number;
    chooseTitle: string;
    editAriaLabel: string;
    cropTitle: string;
    onChange?: (url: string) => void;
    onClear?: () => void;
    fallback?: Snippet;
    fallbackText?: string;
  } = $props();

  let cropOpen = $state(false);
  let cropFilepath = $state('');
  let pickError = $state<string | null>(null);
  let imageBroken = $state(false);

  const displaySrc = $derived(src?.trim() && !imageBroken ? src.trim() : null);
  const showClear = $derived(editable && allowClear && !!displaySrc && !disabled);

  $effect(() => {
    src;
    imageBroken = false;
  });

  async function handleEdit() {
    if (!editable || disabled) return;
    pickError = null;
    try {
      const selected = await pickLocalImage({
        title: chooseTitle,
        filterName: $t('media.avatarCrop.imagesFilter'),
      });
      if (selected == null) return;
      cropFilepath = selected;
      cropOpen = true;
    } catch (e) {
      pickError = getInvokeErrorMessage(e, $t('media.avatarCrop.decodeError'));
    }
  }

  function handleCropConfirm(url: string) {
    cropOpen = false;
    onChange?.(url);
  }

  function handleCropCancel() {
    cropOpen = false;
  }
</script>

<div class="avatar-picker" style="--avatar-picker-size: {size}px">
  <div class="avatar-picker-preview">
    {#if displaySrc}
      <img
        src={displaySrc}
        alt=""
        class="avatar-picker-img"
        onerror={() => (imageBroken = true)}
      />
    {:else if fallback}
      <div class="avatar-picker-fallback">
        {@render fallback()}
      </div>
    {:else}
      <div class="avatar-picker-letter" aria-hidden="true">{fallbackText.slice(0, 1).toUpperCase()}</div>
    {/if}
  </div>
  {#if editable}
    <div class="avatar-picker-actions">
      <EditIconButton
        ariaLabel={editAriaLabel}
        title={editAriaLabel}
        disabled={disabled}
        on:click={() => void handleEdit()}
      />
      {#if showClear}
        <button
          type="button"
          class="avatar-picker-clear"
          disabled={disabled}
          aria-label={$t('media.avatarCrop.clear')}
          title={$t('media.avatarCrop.clear')}
          onclick={() => onClear?.()}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      {/if}
    </div>
  {/if}
  {#if pickError}
    <p class="avatar-picker-error" role="alert">{pickError}</p>
  {/if}
</div>

<AvatarCropModal
  open={cropOpen}
  filepath={cropFilepath}
  title={cropTitle}
  onConfirm={handleCropConfirm}
  onCancel={handleCropCancel}
/>

<style>
  .avatar-picker {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .avatar-picker-preview {
    width: var(--avatar-picker-size);
    height: var(--avatar-picker-size);
    border-radius: 50%;
    overflow: hidden;
    border: 4px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .avatar-picker-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .avatar-picker-fallback,
  .avatar-picker-letter {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .avatar-picker-letter {
    background: var(--brand);
    color: var(--on-brand);
    font-weight: 600;
    font-size: calc(var(--avatar-picker-size) * 0.375);
  }

  .avatar-picker-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .avatar-picker-clear {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .avatar-picker-clear:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .avatar-picker-clear:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .avatar-picker-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger);
  }
</style>
