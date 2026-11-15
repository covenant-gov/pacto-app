<script lang="ts">
  import { t } from 'svelte-i18n';
  import CommonsTagPicker from '../commons/CommonsTagPicker.svelte';
  import InfoTip from '../ui/InfoTip.svelte';
  import type { SquadVisibility } from '../../stores/squads';

  let {
    visibility = $bindable('private'),
    tags = $bindable([]),
    tagError = $bindable(''),
    fieldsetName = 'squad-commons',
    disabled = false,
  }: {
    visibility?: SquadVisibility;
    tags?: string[];
    tagError?: string;
    fieldsetName?: string;
    disabled?: boolean;
  } = $props();

  export function resetCommonsFields() {
    visibility = 'private';
    tags = [];
    tagError = '';
  }
</script>

<fieldset class="commons-visibility-fieldset">
  <legend class="commons-visibility-legend">
    <span>{$t('commons.visibility.legend')}</span>
    <InfoTip
      text={$t('commons.visibility.hint')}
      ariaLabel={$t('commons.visibility.hintAria')}
    />
  </legend>
  <label class="commons-visibility-option">
    <input type="radio" name={fieldsetName} value="private" bind:group={visibility} {disabled} />
    <span>{$t('commons.visibility.off')}</span>
  </label>
  <label class="commons-visibility-option">
    <input type="radio" name={fieldsetName} value="public" bind:group={visibility} {disabled} />
    <span>{$t('commons.visibility.on')}</span>
  </label>
</fieldset>

{#if visibility === 'public'}
  <span class="commons-tags-label">{$t('commons.broadcast.tagsLabel')}</span>
  <CommonsTagPicker bind:selected={tags} {disabled} placeholder={$t('commons.tagPicker.searchPlaceholder')} />
  {#if tagError}
    <p class="commons-tags-error" role="alert">{tagError}</p>
  {/if}
{/if}

<style>
  .commons-visibility-fieldset {
    border: none;
    margin: 0 0 16px;
    padding: 0;
  }

  .commons-visibility-legend {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    float: none;
    width: auto;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin: 0 0 8px;
    padding: 0;
  }

  .commons-visibility-option {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9375rem;
    color: var(--text-secondary);
    margin-bottom: 6px;
    cursor: pointer;
  }

  .commons-tags-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  .commons-tags-error {
    color: var(--danger, #e55);
    font-size: 0.8125rem;
    margin: 0 0 12px;
  }
</style>
