<script lang="ts">
  import {
    COMMONS_TAG_TREE,
    commonsCategoryLiveCount,
    commonsTagArtSrc,
    commonsTagGradient,
    type CommonsTagCategory,
  } from '../../lib/commons/tag-catalog';

  export let categories: CommonsTagCategory[] = COMMONS_TAG_TREE;
  export let activeCategoryId: string | null = null;
  /** Active broadcast count per leaf tag. */
  export let countsByTag: Record<string, number> = {};
  export let onSelectCategory: (categoryId: string) => void = () => {};
</script>

<div class="commons-browser">
  <ul class="commons-browser-grid" role="list">
    {#each categories as category (category.id)}
      {@const art = commonsTagArtSrc(category)}
      {@const count = commonsCategoryLiveCount(category, countsByTag)}
      {@const isActive = activeCategoryId === category.id}
      <li>
        <button
          type="button"
          class="commons-browser-tile"
          class:commons-browser-tile-active={isActive}
          style={art ? '' : `background-image: ${commonsTagGradient(category.id)}`}
          aria-pressed={isActive}
          on:click={() => onSelectCategory(category.id)}
        >
          {#if art}
            <img class="commons-browser-art" src={art} alt="" loading="eager" decoding="async" />
          {/if}
          <span class="commons-browser-scrim" aria-hidden="true"></span>
          <span class="commons-browser-content">
            <span class="commons-browser-title">{category.title}</span>
            <span class="commons-browser-desc">{category.description}</span>
          </span>
          {#if count > 0}
            <span class="commons-browser-badge">{count} live</span>
          {/if}
          <span class="commons-browser-frame" aria-hidden="true"></span>
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .commons-browser {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .commons-browser-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 4px;
  }

  .commons-browser-tile {
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
    color: var(--commons-tile-text, #fff);
    text-align: left;
  }

  .commons-browser-art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: var(--commons-tile-art-filter, none);
    transition: transform 0.3s ease;
  }

  .commons-browser-scrim {
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

  .commons-browser-content {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-items: center;
    padding: 16px;
    box-sizing: border-box;
    pointer-events: none;
  }

  .commons-browser-title {
    font-size: 1.0625rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-shadow: var(--commons-tile-title-shadow, 0 1px 6px rgba(0, 0, 0, 0.5));
    line-height: 1.2;
  }

  .commons-browser-desc {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 14px;
    z-index: 2;
    font-size: 0.8125rem;
    line-height: 1.4;
    text-align: center;
    max-width: none;
    margin: 0;
    opacity: 0;
    transform: translateY(6px);
    transition: opacity 0.15s ease, transform 0.15s ease;
    text-shadow: var(--commons-tile-desc-shadow, 0 1px 4px rgba(0, 0, 0, 0.6));
    pointer-events: none;
  }

  .commons-browser-tile:hover .commons-browser-desc,
  .commons-browser-tile:focus-visible .commons-browser-desc {
    opacity: 0.95;
    transform: translateY(0);
  }

  .commons-browser-tile:hover .commons-browser-art {
    transform: scale(1.04);
  }

  .commons-browser-frame {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    box-shadow: inset 0 0 0 1px var(--accent);
    transition: box-shadow 0.2s ease;
  }

  .commons-browser-tile:hover:not(.commons-browser-tile-active) .commons-browser-frame {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .commons-browser-tile-active .commons-browser-frame,
  .commons-browser-tile:focus-visible .commons-browser-frame {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .commons-browser-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 5;
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }
</style>
