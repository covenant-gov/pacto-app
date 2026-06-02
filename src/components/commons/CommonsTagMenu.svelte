<script lang="ts">
  import { COMMONS_TAG_TREE, type CommonsTagCategory } from '../../lib/commons/tag-catalog';

  export let categories: CommonsTagCategory[] = COMMONS_TAG_TREE;
  export let activeTags: string[] = [];
  /** Active broadcast count per leaf tag. */
  export let countsByTag: Record<string, number> = {};
  export let onToggleTag: (tag: string) => void = () => {};
  /** Force every category open (e.g. while a text query is filtering). */
  export let expandAll = false;
  /** Denser typography for modal / inline pickers. */
  export let compact = false;

  let openIds = new Set<string>();

  $: activeSet = new Set(activeTags);

  function toggle(id: string) {
    const next = new Set(openIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    openIds = next;
  }
</script>

<div class="commons-menu" class:commons-menu-compact={compact} role="group" aria-label="Browse tags">
  <ul class="commons-menu-list" role="list">
    {#each categories as category (category.id)}
      {@const open = expandAll || openIds.has(category.id)}
      <li class="commons-menu-row">
        <button
          type="button"
          class="commons-menu-cat"
          class:is-open={open}
          aria-expanded={open}
          on:click={() => toggle(category.id)}
        >
          <span class="commons-menu-cat-title">{category.title}</span>
          <span class="commons-menu-chevron" aria-hidden="true">{open ? '–' : '+'}</span>
        </button>
        {#if open}
          <ul class="commons-menu-children" role="list">
            {#each category.children as child (child.tag)}
              {@const count = countsByTag[child.tag] ?? 0}
              <li>
                <button
                  type="button"
                  class="commons-menu-child"
                  class:is-active={activeSet.has(child.tag)}
                  aria-pressed={activeSet.has(child.tag)}
                  on:click={() => onToggleTag(child.tag)}
                >
                  {child.title}{#if count > 0}<span class="commons-menu-child-count">{count}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .commons-menu {
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }

  .commons-menu-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .commons-menu-row {
    border-bottom: 1px solid var(--border-subtle);
  }

  .commons-menu-row:last-child {
    border-bottom: none;
  }

  .commons-menu-cat {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 14px 16px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .commons-menu-cat:hover,
  .commons-menu-cat.is-open {
    background: var(--bg-elevated);
  }

  .commons-menu-cat-title {
    font-size: 0.9375rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .commons-menu-chevron {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-muted);
    line-height: 1;
  }

  .commons-menu-children {
    list-style: none;
    margin: 0;
    padding: 8px 16px 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .commons-menu-child {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-base, var(--bg-primary));
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .commons-menu-child:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .commons-menu-child.is-active {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .commons-menu-child-count {
    font-size: 0.6875rem;
    opacity: 0.85;
  }

  .commons-menu-compact .commons-menu-cat {
    padding: 8px 12px;
  }

  .commons-menu-compact .commons-menu-cat-title {
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .commons-menu-compact .commons-menu-chevron {
    font-size: 0.875rem;
  }

  .commons-menu-compact .commons-menu-children {
    padding: 6px 12px 10px;
    gap: 6px;
  }

  .commons-menu-compact .commons-menu-child {
    padding: 5px 10px;
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }
</style>
