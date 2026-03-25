<script lang="ts">
  export let open = false;
  export let parentType: 'squad' | 'network' = 'squad';
  export let parentName = '';
  export let subtitle = '';
  export let membersLabel = '';
  export let channelName = '';
  export let memberList: string[] = [];
  export let loading = false;
  export let selectedNpubs: string[] = [];
  export let selectAllLabel = 'Add everyone';
  export let emptyMessage = '';
  export let error = '';
  export let creating = false;
  export let canCreate = false;
  export let inputId: string | undefined = undefined;

  export let onClose: () => void = () => {};
  export let onCreate: () => void = () => {};
  export let onToggleMember: (npub: string) => void = () => {};
  export let onToggleSelectAll: () => void = () => {};
  /** Used to display each member's name in the list. */
  export let getMemberDisplayName: (npub: string) => string = (npub) => npub;

  $: allSelected =
    memberList.length > 0 &&
    selectedNpubs.length === memberList.length &&
    memberList.every((n) => selectedNpubs.includes(n));

  const titleId = 'create-channel-modal-title';
  const resolvedInputId = inputId ?? 'create-channel-name';
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
      class="parent-modal-content create-channel-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-label="Create channel for {parentName || (parentType === 'squad' ? 'squad' : 'network')}"
      data-parent-type={parentType}
      tabindex="0"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && onClose()}
    >
      <h2 id={titleId}>Create channel</h2>
      <p class="create-channel-subtitle">{subtitle}</p>
      <form on:submit|preventDefault={onCreate}>
        <label class="create-channel-label" for={resolvedInputId}>Channel name</label>
        <input
          id={resolvedInputId}
          type="text"
          class="create-channel-input"
          placeholder="e.g. general"
          bind:value={channelName}
          required
        />
        <span class="create-channel-label">{membersLabel}</span>
        <label class="create-channel-select-everyone">
          <input
            type="checkbox"
            checked={allSelected}
            on:change={onToggleSelectAll}
          />
          {selectAllLabel}
        </label>
        <div class="create-channel-members">
          {#if loading}
            <p class="create-channel-loading">Loading…</p>
          {:else}
            {#each memberList as npub (npub)}
              <label class="create-channel-member-row">
                <input
                  type="checkbox"
                  checked={selectedNpubs.includes(npub)}
                  on:change={() => onToggleMember(npub)}
                />
                <span class="create-channel-member-name">{getMemberDisplayName(npub)}</span>
              </label>
            {/each}
          {/if}
        </div>
        {#if !loading && memberList.length === 0}
          <p class="create-channel-empty">{emptyMessage}</p>
        {/if}
        {#if error}
          <p class="create-channel-error" role="alert">{error}</p>
        {/if}
        <div class="create-channel-actions">
          <button
            type="button"
            class="create-channel-btn-cancel"
            on:click={onClose}
            disabled={creating}
          >
            Cancel
          </button>
          <button
            type="submit"
            class="create-channel-btn-create"
            disabled={!canCreate || creating}
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
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

  .create-channel-subtitle {
    color: var(--text-muted);
    font-size: 0.9375rem;
    margin: 0 0 24px 0;
  }

  .create-channel-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 6px;
  }

  .create-channel-select-everyone {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .create-channel-select-everyone input {
    cursor: pointer;
  }

  .create-channel-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    margin-bottom: 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .create-channel-members {
    max-height: 200px;
    overflow-y: auto;
    margin-bottom: 16px;
    padding: 8px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
  }

  .create-channel-member-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .create-channel-member-row:hover {
    background: var(--bg-hover);
  }

  .create-channel-member-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .create-channel-loading,
  .create-channel-empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px 0;
  }

  .create-channel-loading {
    padding: 8px 12px;
  }

  .create-channel-error {
    color: var(--danger);
    background: rgba(242, 63, 66, 0.1);
    padding: 12px 16px;
    border-radius: 8px;
    margin-bottom: 16px;
    font-size: 0.875rem;
  }

  .create-channel-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  .create-channel-btn-cancel {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .create-channel-btn-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .create-channel-btn-create {
    padding: 8px 16px;
    background: var(--accent);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .create-channel-btn-create:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .create-channel-btn-create:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
