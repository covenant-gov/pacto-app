<script lang="ts">
  import {
    commonsTagArtSrc,
    commonsTagGradient,
    findCommonsTagCategory,
  } from '../../lib/commons/tag-catalog';

  export let categoryId: string;
  /** True while filtering ANY tag in the category (ALL chip). */
  export let categoryAllMode = false;
  export let activeTags: string[] = [];
  export let countsByTag: Record<string, number> = {};
  export let onToggleTag: (tag: string) => void = () => {};
  export let onClearFocus: () => void = () => {};

  $: category = findCommonsTagCategory(categoryId);
  $: art = category ? commonsTagArtSrc(category) : null;
  $: activeSet = new Set(activeTags);
</script>

{#if category}
  <div class="commons-category-focus" role="region" aria-label="{category.title} tags">
    <div class="commons-category-focus-tile-wrap">
      <button
        type="button"
        class="commons-category-focus-tile"
        style={art ? '' : `background-image: ${commonsTagGradient(category.id)}`}
        aria-label="Close {category.title} and show all categories"
        on:click={onClearFocus}
      >
        {#if art}
          <img class="commons-category-focus-art" src={art} alt="" loading="eager" decoding="async" />
        {/if}
        <span class="commons-category-focus-scrim" aria-hidden="true"></span>
        <span class="commons-category-focus-title">{category.title}</span>
        <span class="commons-category-focus-frame" aria-hidden="true"></span>
      </button>
    </div>

    <ul class="commons-category-focus-tags" role="list">
      {#each category.children as child (child.tag)}
        {@const count = countsByTag[child.tag] ?? 0}
        {@const isActive = !categoryAllMode && activeSet.has(child.tag)}
        <li>
          <button
            type="button"
            class="commons-category-focus-tag"
            class:is-active={isActive}
            aria-pressed={isActive}
            on:click={() => onToggleTag(child.tag)}
          >
            {child.title}{#if count > 0}<span class="commons-category-focus-tag-count">{count}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .commons-category-focus {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }

  .commons-category-focus-tile-wrap {
    flex: 0 0 min(280px, 42%);
    max-width: 320px;
    min-width: 200px;
  }

  .commons-category-focus-tile {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 10;
    border: none;
    padding: 0;
    margin: 0;
    overflow: hidden;
    cursor: pointer;
    background-color: var(--bg-elevated);
    background-size: cover;
    background-position: center;
    text-align: left;
  }

  .commons-category-focus-tile:hover .commons-category-focus-art {
    transform: scale(1.04);
  }

  .commons-category-focus-art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: var(--commons-tile-art-filter, none);
    transition: transform 0.3s ease;
  }

  .commons-category-focus-scrim {
    position: absolute;
    inset: 0;
    z-index: 1;
    background-color: var(--commons-tile-veil, transparent);
    background-image:
      linear-gradient(
        180deg,
        var(--commons-tile-scrim-top, rgba(0, 0, 0, 0.28)) 0%,
        var(--commons-tile-scrim-mid, rgba(0, 0, 0, 0.42)) 45%,
        var(--commons-tile-scrim-bottom, rgba(0, 0, 0, 0.68)) 100%
      );
  }

  .commons-category-focus-title {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    padding: 16px;
    font-size: 1.0625rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-shadow: var(--commons-tile-title-shadow, 0 1px 6px rgba(0, 0, 0, 0.5));
    color: var(--commons-tile-text, #fff);
    pointer-events: none;
  }

  .commons-category-focus-frame {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .commons-category-focus-tags {
    list-style: none;
    margin: 0;
    padding: 8px 0;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 8px;
  }

  .commons-category-focus-tag {
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

  .commons-category-focus-tag:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .commons-category-focus-tag.is-active {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .commons-category-focus-tag-count {
    font-size: 0.6875rem;
    opacity: 0.85;
  }
</style>
