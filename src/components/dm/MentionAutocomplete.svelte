<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MentionCandidate } from '../../lib/messaging/mentions';

  export let query: string = '';
  export let candidates: MentionCandidate[] = [];
  export let selectedIndex: number = 0;
  export let position: { top: number; left: number } = { top: 0, left: 0 };

  const dispatch = createEventDispatcher<{ select: MentionCandidate }>();

  $: safeIndex = candidates.length === 0 ? -1 : Math.max(0, Math.min(selectedIndex, candidates.length - 1));
  $: displayCandidates = candidates;

  function select(candidate: MentionCandidate) {
    dispatch('select', candidate);
  }

  function onItemClick(candidate: MentionCandidate) {
    select(candidate);
  }

  function onItemMouseEnter(index: number) {
    selectedIndex = index;
  }

  function avatarPlaceholder(name: string): string {
    return name.charAt(0).toUpperCase();
  }
</script>

{#if displayCandidates.length > 0}
  <div
    class="mention-autocomplete"
    role="listbox"
    aria-label="Mention a member"
    style="position: fixed; top: {position.top}px; left: {position.left}px;"
  >
    <div class="mention-autocomplete-header">
      Mention {query ? `“${query}”` : 'someone'}
    </div>
    <div class="mention-autocomplete-list">
      {#each displayCandidates as candidate, i (candidate.npub)}
        <button
          type="button"
          class="mention-autocomplete-item"
          class:selected={i === safeIndex}
          role="option"
          aria-selected={i === safeIndex}
          on:click={() => onItemClick(candidate)}
          on:mouseenter={() => onItemMouseEnter(i)}
        >
          {#if candidate.avatar}
            <img class="mention-autocomplete-avatar" src={candidate.avatar} alt="" />
          {:else}
            <div class="mention-autocomplete-avatar-placeholder">{avatarPlaceholder(candidate.displayName)}</div>
          {/if}
          <div class="mention-autocomplete-text">
            <span class="mention-autocomplete-name">{candidate.displayName}</span>
            <span class="mention-autocomplete-subtitle">{candidate.subtitle}</span>
          </div>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .mention-autocomplete {
    z-index: 200;
    min-width: 220px;
    max-width: 320px;
    max-height: 280px;
    overflow-y: auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    padding: 6px 0;
  }

  .mention-autocomplete-header {
    padding: 6px 12px 8px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .mention-autocomplete-list {
    display: flex;
    flex-direction: column;
  }

  .mention-autocomplete-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: none;
    border: none;
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .mention-autocomplete-item.selected,
  .mention-autocomplete-item:hover {
    background: var(--bg-hover);
  }

  .mention-autocomplete-avatar,
  .mention-autocomplete-avatar-placeholder {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
  }

  .mention-autocomplete-avatar-placeholder {
    background: var(--accent);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .mention-autocomplete-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .mention-autocomplete-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mention-autocomplete-subtitle {
    font-size: 0.75rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
