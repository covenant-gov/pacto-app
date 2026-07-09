<script lang="ts">
  import CommonsTagPicker from '../commons/CommonsTagPicker.svelte';
  import type { SquadVisibility } from '../../stores/squads';

  export let visibility: SquadVisibility = 'private';
  export let tags: string[] = [];
  export let tagError = '';
  export let fieldsetName = 'squad-commons';
  export let disabled = false;

  export function resetCommonsFields() {
    visibility = 'private';
    tags = [];
    tagError = '';
  }
</script>

<fieldset class="commons-visibility-fieldset">
  <legend class="commons-visibility-legend">Commons</legend>
  <label class="commons-visibility-option">
    <input type="radio" name={fieldsetName} value="private" bind:group={visibility} {disabled} />
    <span>Commons off</span>
  </label>
  <label class="commons-visibility-option">
    <input type="radio" name={fieldsetName} value="public" bind:group={visibility} {disabled} />
    <span>Commons on</span>
  </label>
  <p class="commons-visibility-hint muted">
    Your squad stays private and encrypted. Commons only posts a public discovery card with 3 tags
    while you broadcast.
  </p>
</fieldset>

{#if visibility === 'public'}
  <span class="commons-tags-label">Tags (exactly 3)</span>
  <CommonsTagPicker bind:selected={tags} maxTags={3} {disabled} placeholder="Search tags…" />
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
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 8px;
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

  .commons-visibility-hint {
    margin: 4px 0 0;
    font-size: 0.8125rem;
    line-height: 1.4;
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

  .muted {
    color: var(--text-muted);
  }
</style>
