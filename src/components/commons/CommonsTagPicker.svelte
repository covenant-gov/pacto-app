<script lang="ts">
  import { onMount } from 'svelte';
  import CommonsTagMenu from './CommonsTagMenu.svelte';
  import { COMMONS_TAG_GROUPS, findCommonsTagGroup } from '../../lib/commons/tag-catalog';

  /** Selected leaf tags (bindable). */
  export let selected: string[] = [];
  export let maxTags = 3;
  export let disabled = false;
  export let placeholder = 'Search tags…';

  let query = '';
  /** Flat predictive list visible (search mode only). */
  let listOpen = false;
  /** Category tree replaces the search bar. */
  let categoryBrowse = false;
  let container: HTMLDivElement;
  let blurCloseTimer: ReturnType<typeof setTimeout> | null = null;

  $: atMax = selected.length >= maxTags;
  $: q = query.trim().toLowerCase();
  $: activeSet = new Set(selected);

  $: flatMatches = COMMONS_TAG_GROUPS.filter((g) => {
    if (!q) return true;
    return g.title.toLowerCase().includes(q) || g.tag.includes(q);
  });

  function selectTag(tag: string) {
    const group = findCommonsTagGroup(tag);
    if (!group) return;
    if (selected.includes(group.tag)) {
      selected = selected.filter((t) => t !== group.tag);
      return;
    }
    if (atMax) return;
    selected = [...selected, group.tag];
    query = '';
  }

  function removeTag(tag: string) {
    selected = selected.filter((t) => t !== tag);
  }

  function openCategoryBrowse() {
    categoryBrowse = true;
    listOpen = false;
    query = '';
  }

  function closeCategoryBrowse() {
    categoryBrowse = false;
  }

  function openFlatList() {
    if (blurCloseTimer) {
      clearTimeout(blurCloseTimer);
      blurCloseTimer = null;
    }
    listOpen = true;
  }

  function scheduleCloseFlatList() {
    if (blurCloseTimer) clearTimeout(blurCloseTimer);
    blurCloseTimer = setTimeout(() => {
      listOpen = false;
      blurCloseTimer = null;
    }, 150);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (categoryBrowse) {
        closeCategoryBrowse();
        return;
      }
      if (listOpen) {
        listOpen = false;
        return;
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const unselected = flatMatches.filter((m) => !selected.includes(m.tag));
      if (unselected.length === 1) selectTag(unselected[0].tag);
    }
  }

  onMount(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (categoryBrowse) return;
      if (container && !container.contains(e.target as Node)) {
        listOpen = false;
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      if (blurCloseTimer) clearTimeout(blurCloseTimer);
    };
  });

  $: showFlatList = !categoryBrowse && listOpen;
</script>

<div class="tag-picker" bind:this={container}>
  {#if selected.length > 0}
    <ul class="tag-picker-chips" role="list">
      {#each selected as tag (tag)}
        <li>
          <span class="tag-picker-chip">#{tag}</span>
          <button
            type="button"
            class="tag-picker-chip-remove"
            aria-label="Remove tag {tag}"
            on:click={() => removeTag(tag)}
            {disabled}
          >
            ×
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="tag-picker-field" class:tag-picker-field-category={categoryBrowse}>
    {#if !categoryBrowse}
      <input
        type="text"
        class="tag-picker-input"
        {placeholder}
        bind:value={query}
        on:focus={openFlatList}
        on:blur={scheduleCloseFlatList}
        on:input={openFlatList}
        on:keydown={handleKeydown}
        {disabled}
        role="combobox"
        aria-controls="commons-tag-picker-flat-list"
        aria-autocomplete="list"
        aria-expanded={listOpen}
      />
    {/if}
    <button
      type="button"
      class="tag-picker-toggle"
      aria-label={categoryBrowse ? 'Back to search' : 'Browse by category'}
      aria-expanded={categoryBrowse}
      on:click={() => (categoryBrowse ? closeCategoryBrowse() : openCategoryBrowse())}
      {disabled}
    >
      {categoryBrowse ? '–' : '+'}
    </button>
  </div>

  {#if atMax}
    <p class="tag-picker-hint">Max {maxTags} tags. Remove one to pick another.</p>
  {/if}

  {#if categoryBrowse}
    <div class="tag-picker-menu" id="commons-tag-picker-category-menu">
      <CommonsTagMenu compact activeTags={selected} onToggleTag={selectTag} />
    </div>
  {:else if showFlatList}
    <div
      class="tag-picker-menu"
      id="commons-tag-picker-flat-list"
      role="listbox"
      on:mousedown|preventDefault
    >
      {#if flatMatches.length === 0}
        <p class="tag-picker-empty">No tags match “{query}”.</p>
      {:else}
        <ul class="tag-picker-flat" role="list">
          {#each flatMatches as group (group.tag)}
            <li>
              <button
                type="button"
                class="tag-picker-flat-item"
                class:is-selected={activeSet.has(group.tag)}
                role="option"
                aria-selected={activeSet.has(group.tag)}
                disabled={atMax && !activeSet.has(group.tag)}
                on:mousedown|preventDefault={() => selectTag(group.tag)}
              >
                <span class="tag-picker-flat-title">{group.title}</span>
                <span class="tag-picker-flat-tag">#{group.tag}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tag-picker {
    position: relative;
    margin-bottom: 12px;
  }

  .tag-picker-chips {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .tag-picker-chips li {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .tag-picker-chip {
    font-size: 0.8125rem;
    padding: 4px 8px;
    border-radius: 999px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .tag-picker-chip-remove {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 2px;
  }

  .tag-picker-field {
    display: flex;
    gap: 8px;
  }

  .tag-picker-field-category {
    justify-content: flex-end;
    min-height: 36px;
  }

  .tag-picker-input {
    flex: 1;
    box-sizing: border-box;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font-size: 0.875rem;
    line-height: 1.35;
  }

  .tag-picker-toggle {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-panel);
    color: var(--text-secondary);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
  }

  .tag-picker-toggle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tag-picker-hint {
    margin: 6px 0 0;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .tag-picker-menu {
    margin-top: 6px;
    max-height: 220px;
    overflow-y: auto;
    border-radius: 8px;
    font-size: 0.875rem;
  }

  .tag-picker-empty {
    margin: 0;
    padding: 10px 12px;
    font-size: 0.8125rem;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }

  .tag-picker-flat {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }

  .tag-picker-flat-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-primary);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
  }

  .tag-picker-flat li:last-child .tag-picker-flat-item {
    border-bottom: none;
  }

  .tag-picker-flat-item:hover:not(:disabled) {
    background: var(--bg-elevated);
  }

  .tag-picker-flat-item.is-selected {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .tag-picker-flat-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .tag-picker-flat-title {
    font-weight: 500;
  }

  .tag-picker-flat-tag {
    font-size: 0.6875rem;
    color: var(--text-muted);
    text-transform: lowercase;
  }
</style>
