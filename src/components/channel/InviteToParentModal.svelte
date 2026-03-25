<script lang="ts">
  export let open = false;
  export let parentType: 'squad' | 'network' = 'squad';
  export let parentName = '';
  export let title = '';
  export let subtitle = '';
  export let candidates: string[] = [];
  export let selectedNpubs: string[] = [];
  export let inviteByNpub = '';
  export let loading = false;
  export let emptyMessage = '';
  export let error = '';
  export let inviting = false;

  export let onClose: () => void = () => {};
  export let onInvite: () => void = () => {};
  export let onToggleCandidate: (npub: string) => void = () => {};
  /** Used to display each candidate's name in the list. */
  export let getCandidateDisplayName: (npub: string) => string = (npub) => npub;

  $: canInvite =
    (selectedNpubs.length > 0 || inviteByNpub.trim().length > 0) && !inviting;

  const titleId = 'invite-to-parent-modal-title';
  $: ariaLabel =
    (title || (parentType === 'squad' ? 'Invite to Squad' : 'Invite to Network')) +
    ' for ' +
    (parentName || (parentType === 'squad' ? 'squad' : 'network'));
</script>

{#if open}
  <div
    class="parent-modal-overlay"
    role="button"
    tabindex="-1"
    on:click={onClose}
    on:keydown={(e) => e.key === 'Escape' && onClose()}
  >
    <div
      class="parent-modal-content invite-to-parent-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-label={ariaLabel}
      data-parent-type={parentType}
      tabindex="0"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && onClose()}
    >
      <h2 id={titleId}>{title || (parentType === 'squad' ? 'Invite to Squad' : 'Invite to Network')}</h2>
      <p class="invite-to-parent-subtitle">{subtitle}</p>
      {#if loading}
        <p class="invite-to-parent-loading">Loading…</p>
      {:else if candidates.length === 0}
        <p class="invite-to-parent-empty">{emptyMessage}</p>
      {:else}
        <div class="invite-to-parent-members">
          {#each candidates as npub (npub)}
            <label
              class="invite-to-parent-row"
              class:selected={selectedNpubs.includes(npub)}
            >
              <input
                type="checkbox"
                checked={selectedNpubs.includes(npub)}
                on:change={() => onToggleCandidate(npub)}
              />
              <span class="invite-to-parent-member-name">{getCandidateDisplayName(npub)}</span>
            </label>
          {/each}
        </div>
      {/if}
      <p class="invite-to-parent-npub-label">Or invite by npub:</p>
      <input
        type="text"
        class="invite-to-parent-npub-input"
        placeholder="npub1…"
        bind:value={inviteByNpub}
        disabled={inviting}
      />
      {#if error}
        <p class="invite-to-parent-error" role="alert">{error}</p>
      {/if}
      <div class="invite-to-parent-actions">
        <button
          type="button"
          class="invite-to-parent-btn-cancel"
          on:click={onClose}
          disabled={inviting}
        >
          Cancel
        </button>
        <button
          type="button"
          class="invite-to-parent-btn-invite"
          on:click={onInvite}
          disabled={!canInvite}
        >
          {inviting ? 'Inviting…' : 'Invite'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .parent-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    backdrop-filter: blur(4px);
  }

  .parent-modal-content {
    background: var(--bg-elevated);
    border-radius: 12px;
    padding: 32px;
    max-width: 420px;
    width: 90%;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .parent-modal-content h2 {
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 8px 0;
  }

  .invite-to-parent-subtitle {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 24px 0;
  }

  .invite-to-parent-loading,
  .invite-to-parent-empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px 0;
  }

  .invite-to-parent-loading {
    padding: 8px 12px;
  }

  .invite-to-parent-members {
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: 16px;
    padding: 8px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
  }

  .invite-to-parent-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
    border-radius: 4px;
  }

  .invite-to-parent-row input[type="checkbox"] {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin: 0;
    cursor: pointer;
    accent-color: var(--accent);
  }

  .invite-to-parent-row:hover {
    background: var(--bg-hover);
  }

  .invite-to-parent-row.selected {
    background: var(--border);
  }

  .invite-to-parent-member-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .invite-to-parent-npub-label {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 6px 0;
  }

  .invite-to-parent-npub-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
    margin-bottom: 16px;
  }

  .invite-to-parent-npub-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .invite-to-parent-error {
    color: var(--danger);
    background: rgba(242, 63, 66, 0.1);
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 16px;
    font-size: 0.875rem;
  }

  .invite-to-parent-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .invite-to-parent-btn-cancel {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .invite-to-parent-btn-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .invite-to-parent-btn-invite {
    padding: 8px 16px;
    background: var(--accent);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .invite-to-parent-btn-invite:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .invite-to-parent-btn-invite:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
