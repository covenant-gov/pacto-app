<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Modal from '../ui/Modal.svelte';
  import type { MentionCandidate } from '../../lib/messaging/mentions';

  export let candidates: MentionCandidate[] = [];
  export let open: boolean = false;

  let query = '';
  let selectedIndex = 0;
  let searchInput: HTMLInputElement | undefined;

  const dispatch = createEventDispatcher<{ select: MentionCandidate; close: void }>();

  function fuzzyMatch(query: string, candidate: MentionCandidate): boolean {
    if (!query) return true;
    const q = query.toLowerCase().trim();
    const haystack = `${candidate.displayName} ${candidate.alias} ${candidate.npub}`.toLowerCase();
    let i = 0;
    for (const ch of haystack) {
      if (ch === q[i]) i++;
      if (i === q.length) return true;
    }
    return i === q.length;
  }

  $: filtered = candidates.filter((c) => fuzzyMatch(query, c));
  $: safeIndex = filtered.length === 0 ? -1 : Math.max(0, Math.min(selectedIndex, filtered.length - 1));

  function close() {
    query = '';
    selectedIndex = 0;
    dispatch('close');
  }

  function select(candidate: MentionCandidate) {
    query = '';
    selectedIndex = 0;
    dispatch('select', candidate);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (filtered.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = (safeIndex + 1) % filtered.length;
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = safeIndex <= 0 ? filtered.length - 1 : safeIndex - 1;
      return;
    }
    if (event.key === 'Enter' && safeIndex >= 0) {
      event.preventDefault();
      select(filtered[safeIndex]);
    }
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

  $: if (open) {
    query = '';
    selectedIndex = 0;
  }

  $: if (searchInput) searchInput.focus();
</script>

{#if open}
  <Modal titleId="mention-picker-title" onClose={close}>
    <div class="mention-picker" role="dialog" aria-labelledby="mention-picker-title">
      <h2 id="mention-picker-title" class="mention-picker-title">Mention a member</h2>
      <input
        bind:this={searchInput}
        type="text"
        class="mention-picker-input"
        placeholder="Search by name or npub…"
        bind:value={query}
        on:input={() => (selectedIndex = 0)}
        on:keydown={handleKeydown}
        aria-label="Search members"
      />
      <div class="mention-picker-list" role="listbox" aria-label="Members">
        {#if filtered.length === 0}
          <div class="mention-picker-empty">No members match “{query}”</div>
        {:else}
          {#each filtered as candidate, i (candidate.npub)}
            <button
              type="button"
              class="mention-picker-item"
              class:selected={i === safeIndex}
              role="option"
              aria-selected={i === safeIndex}
              on:click={() => onItemClick(candidate)}
              on:mouseenter={() => onItemMouseEnter(i)}
            >
              {#if candidate.avatar}
                <img class="mention-picker-avatar" src={candidate.avatar} alt="" />
              {:else}
                <div class="mention-picker-avatar-placeholder">{avatarPlaceholder(candidate.displayName)}</div>
              {/if}
              <div class="mention-picker-text">
                <span class="mention-picker-name">{candidate.displayName}</span>
                <span class="mention-picker-subtitle">{candidate.subtitle}</span>
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </Modal>
{/if}

<style>
  .mention-picker {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mention-picker-title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .mention-picker-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    font-size: 0.9375rem;
    color: var(--text-primary);
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    outline: none;
  }

  .mention-picker-input::placeholder {
    color: var(--text-muted);
  }

  .mention-picker-input:focus {
    border-color: var(--accent);
  }

  .mention-picker-list {
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .mention-picker-empty {
    padding: 16px 8px;
    font-size: 0.875rem;
    color: var(--text-muted);
    text-align: center;
  }

  .mention-picker-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: none;
    border: none;
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
    border-radius: 6px;
    transition: background 0.1s;
  }

  .mention-picker-item.selected,
  .mention-picker-item:hover {
    background: var(--bg-hover);
  }

  .mention-picker-avatar,
  .mention-picker-avatar-placeholder {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    object-fit: cover;
  }

  .mention-picker-avatar-placeholder {
    background: var(--accent);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .mention-picker-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .mention-picker-name {
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mention-picker-subtitle {
    font-size: 0.75rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
