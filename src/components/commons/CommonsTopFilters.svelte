<script lang="ts">
  import type {
    CommonsAudienceFilter,
    CommonsSubjectFilter,
  } from '../../lib/commons/commons-feed';
  import { findCommonsTagCategory } from '../../lib/commons/tag-catalog';

  export let tags: string[] = [];
  export let categoryId: string | null = null;
  export let subjectFilter: CommonsSubjectFilter = 'both';
  export let audienceFilter: CommonsAudienceFilter = 'any';
  /** Whether the focused tag (genre) menu is open; hides the passive tiles. */
  export let tagMenuOpen = false;

  $: categoryLabel = categoryId ? (findCommonsTagCategory(categoryId)?.title ?? categoryId) : null;

  function removeTag(tag: string) {
    tags = tags.filter((t) => t !== tag);
  }

  function removeCategory() {
    categoryId = null;
  }

  function toggleMenu() {
    tagMenuOpen = !tagMenuOpen;
    if (tagMenuOpen) categoryId = null;
  }

  // Categories = the default grid view; also resets all filters back to defaults.
  function showCategories() {
    tags = [];
    categoryId = null;
    subjectFilter = 'both';
    audienceFilter = 'any';
    tagMenuOpen = false;
  }

  $: isDefaultView =
    !tagMenuOpen &&
    tags.length === 0 &&
    categoryId == null &&
    subjectFilter === 'both' &&
    audienceFilter === 'any';
</script>

<div class="commons-filters" role="search">
  <div class="commons-filters-tags">
    <button
      type="button"
      class="commons-filters-browse"
      class:is-open={isDefaultView}
      on:click={showCategories}
    >
      Categories
    </button>
    <button
      type="button"
      class="commons-filters-browse"
      class:is-open={tagMenuOpen}
      aria-expanded={tagMenuOpen}
      on:click={toggleMenu}
    >
      Tags
      <span class="commons-filters-browse-chevron" aria-hidden="true">{tagMenuOpen ? '–' : '+'}</span>
    </button>

    {#if categoryLabel}
      <ul class="commons-filters-chips" role="list">
        <li>
          <span class="commons-filters-chip commons-filters-chip-category">{categoryLabel}</span>
          <button
            type="button"
            class="commons-filters-chip-remove"
            aria-label="Remove category {categoryLabel}"
            on:click={removeCategory}
          >
            ×
          </button>
        </li>
      </ul>
    {:else if tags.length > 0}
      <ul class="commons-filters-chips" role="list">
        {#each tags as tag (tag)}
          <li>
            <span class="commons-filters-chip">#{tag}</span>
            <button
              type="button"
              class="commons-filters-chip-remove"
              aria-label="Remove tag {tag}"
              on:click={() => removeTag(tag)}
            >
              ×
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="commons-filters-controls">
    <div class="commons-segmented" role="radiogroup" aria-label="Show users or squads">
      <label class="commons-segmented-option">
        <input type="radio" name="subject-filter" value="both" bind:group={subjectFilter} />
        <span>All</span>
      </label>
      <label class="commons-segmented-option">
        <input type="radio" name="subject-filter" value="squads" bind:group={subjectFilter} />
        <span>Squads</span>
      </label>
      <label class="commons-segmented-option">
        <input type="radio" name="subject-filter" value="users" bind:group={subjectFilter} />
        <span>Users</span>
      </label>
    </div>

    <div class="commons-segmented" role="radiogroup" aria-label="User audience">
      <label class="commons-segmented-option">
        <input type="radio" name="audience-filter" value="any" bind:group={audienceFilter} />
        <span>All</span>
      </label>
      <label class="commons-segmented-option">
        <input type="radio" name="audience-filter" value="new_user" bind:group={audienceFilter} />
        <span>New</span>
      </label>
      <label class="commons-segmented-option">
        <input type="radio" name="audience-filter" value="active_user" bind:group={audienceFilter} />
        <span>Active</span>
      </label>
    </div>
  </div>
</div>

<style>
  .commons-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px 16px;
    padding: 12px 0;
  }

  .commons-filters-tags {
    min-width: 0;
    flex: 1 1 280px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .commons-filters-browse {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
  }

  .commons-filters-browse.is-open {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .commons-filters-browse-chevron {
    font-size: 1rem;
    line-height: 1;
    color: var(--text-muted);
  }

  .commons-filters-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .commons-filters-chips li {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .commons-filters-chip {
    font-size: 0.8125rem;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }

  .commons-filters-chip-category {
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .commons-filters-chip-remove {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 2px;
  }

  .commons-filters-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
  }

  .commons-segmented {
    display: inline-flex;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    overflow: hidden;
  }

  .commons-segmented-option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 7px 12px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    cursor: pointer;
    border-right: 1px solid var(--border-subtle);
  }

  .commons-segmented-option:last-child {
    border-right: none;
  }

  .commons-segmented-option:has(input:checked) {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .commons-segmented-option input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
</style>
