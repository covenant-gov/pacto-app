<script lang="ts">
  import { normalizeCommonsTag } from '../../lib/commons/tags';
  import type { SquadVisibility } from '../../stores/squads';

  export let visibility: SquadVisibility = 'private';
  export let tags: string[] = [];
  export let tagError = '';
  export let fieldsetName = 'squad-visibility';

  let tagInput = '';

  function addTag() {
    tagError = '';
    const t = normalizeCommonsTag(tagInput);
    if (!t) {
      tagError = 'Use lowercase letters, numbers, or underscores (max 32).';
      return;
    }
    if (tags.includes(t)) {
      tagInput = '';
      return;
    }
    if (tags.length >= 3) {
      tagError = 'At most three tags.';
      return;
    }
    tags = [...tags, t];
    tagInput = '';
  }

  function removeTag(tag: string) {
    tags = tags.filter((t) => t !== tag);
    tagError = '';
  }

  function handleTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  }

  export function resetCommonsFields() {
    visibility = 'private';
    tags = [];
    tagInput = '';
    tagError = '';
  }
</script>

<fieldset class="commons-visibility-fieldset">
  <legend class="commons-visibility-legend">Visibility</legend>
  <label class="commons-visibility-option">
    <input type="radio" name={fieldsetName} value="private" bind:group={visibility} />
    <span>Private</span>
  </label>
  <label class="commons-visibility-option">
    <input type="radio" name={fieldsetName} value="public" bind:group={visibility} />
    <span>Public</span>
  </label>
  <p class="commons-visibility-hint muted">
    Public squads can be discovered in Commons when broadcasting (tags required).
  </p>
</fieldset>

{#if visibility === 'public'}
  <span class="commons-tags-label">Tags (1–3)</span>
  <div class="commons-tags-row">
    <input
      type="text"
      class="commons-tags-input"
      placeholder="#neo"
      bind:value={tagInput}
      on:keydown={handleTagKeydown}
      disabled={tags.length >= 3}
    />
    <button type="button" class="commons-tags-add" on:click={addTag} disabled={tags.length >= 3}>Add</button>
  </div>
  {#if tags.length > 0}
    <ul class="commons-tags-list" role="list">
      {#each tags as tag (tag)}
        <li>
          <span class="commons-tag-chip">#{tag}</span>
          <button type="button" class="commons-tag-remove" aria-label="Remove tag {tag}" on:click={() => removeTag(tag)}>
            ×
          </button>
        </li>
      {/each}
    </ul>
  {/if}
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
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 6px;
  }

  .commons-tags-row {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }

  .commons-tags-input {
    flex: 1;
    box-sizing: border-box;
    padding: 10px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .commons-tags-add {
    flex-shrink: 0;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .commons-tags-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .commons-tags-list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .commons-tags-list li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .commons-tag-chip {
    font-size: 0.8125rem;
    padding: 4px 8px;
    border-radius: 999px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .commons-tag-remove {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
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
