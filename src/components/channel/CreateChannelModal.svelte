<script lang="ts">
  import { t } from 'svelte-i18n';
  import { appConfig } from '../../stores/app-config';
  export let open = false;
  export let parentName = '';
  export let subtitle = '';
  export let membersLabel = '';
  export let channelName = '';
  export let memberList: string[] = [];
  export let loading = false;
  export let selectedNpubs: string[] = [];
  export let emptyMessage = '';
  export let error = '';
  export let creating = false;
  /** When true, show closed-channel member picker. */
  export let showMemberPicker = false;
  export let canCreateClosed = false;
  export let inputId: string | undefined = undefined;

  export let onClose: () => void = () => {};
  export let onOpenChannel: () => void = () => {};
  export let onChooseClosed: () => void = () => {};
  export let onCreateClosed: () => void = () => {};
  export let onToggleMember: (npub: string) => void = () => {};
  export let getMemberDisplayName: (npub: string) => string = (npub) => npub;

  $: maxChannelNameLength = $appConfig.channelNameMaxLength;

  const titleId = 'create-channel-modal-title';
  const resolvedInputId = inputId ?? 'create-channel-name';

  $: nameReady = channelName.trim().length > 0;
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
      aria-label={$t('messaging.channel.createForAria', { values: { parentName: parentName || $t('messaging.channel.createDefaultParent') } })}
      data-parent-type="squad"
      tabindex="0"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && onClose()}
    >
      <h2 id={titleId}>{$t('messaging.channel.createTitle')}</h2>
      <p class="create-channel-subtitle">{subtitle}</p>
      <label class="create-channel-label" for={resolvedInputId}>{$t('messaging.channel.nameLabel')}</label>
      <input
        id={resolvedInputId}
        type="text"
        class="create-channel-input"
        placeholder={$t('messaging.channel.namePlaceholder')}
        bind:value={channelName}
        maxlength={maxChannelNameLength}
        required
        disabled={creating}
        aria-describedby="{resolvedInputId}-char-count"
      />
      <p id="{resolvedInputId}-char-count" class="create-channel-char-count">
        {$t('messaging.channel.nameCharCount', {
          values: { count: channelName.length, max: maxChannelNameLength },
        })}
      </p>

      {#if !showMemberPicker}
        <p class="create-channel-hint">
          {$t('messaging.channel.openClosedHint')}
        </p>
        {#if error}
          <p class="create-channel-error" role="alert">{error}</p>
        {/if}
        <div class="create-channel-path-actions">
          <button
            type="button"
            class="create-channel-btn-create"
            disabled={!nameReady || creating}
            on:click={onOpenChannel}
          >
            {creating ? $t('messaging.channel.creating') : $t('messaging.channel.openChannel')}
          </button>
          <button
            type="button"
            class="create-channel-btn-secondary"
            disabled={!nameReady || creating}
            on:click={onChooseClosed}
          >
            {$t('messaging.channel.closedChannel')}
          </button>
        </div>
        <div class="create-channel-actions">
          <button
            type="button"
            class="create-channel-btn-cancel"
            on:click={onClose}
            disabled={creating}
          >
            {$t('messaging.channel.cancel')}
          </button>
        </div>
      {:else}
        <span class="create-channel-label">{membersLabel}</span>
        <div class="create-channel-members">
          {#if loading}
            <p class="create-channel-loading">{$t('messaging.channel.loading')}</p>
          {:else}
            {#each memberList as npub (npub)}
              <label class="create-channel-member-row">
                <input
                  type="checkbox"
                  checked={selectedNpubs.includes(npub)}
                  on:change={() => onToggleMember(npub)}
                  disabled={creating}
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
            {$t('messaging.channel.cancel')}
          </button>
          <button
            type="button"
            class="create-channel-btn-create"
            disabled={!canCreateClosed || creating}
            on:click={onCreateClosed}
          >
            {creating ? $t('messaging.channel.creating') : $t('messaging.channel.create')}
          </button>
        </div>
      {/if}
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

  .create-channel-hint {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0 0 16px 0;
    line-height: 1.4;
  }

  .create-channel-label {
    display: block;
    color: var(--text-secondary);
    font-size: 0.875rem;
    margin-bottom: 6px;
  }

  .create-channel-input {
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    margin-bottom: 6px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .create-channel-char-count {
    color: var(--text-muted);
    font-size: 0.75rem;
    margin: 0 0 16px 0;
    text-align: right;
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

  .create-channel-path-actions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 16px;
  }

  .create-channel-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 8px;
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

  .create-channel-btn-create,
  .create-channel-btn-secondary {
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 0.9375rem;
    cursor: pointer;
    width: 100%;
  }

  .create-channel-btn-create {
    background: var(--accent);
    border: none;
    color: #fff;
  }

  .create-channel-btn-create:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .create-channel-btn-secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-primary);
  }

  .create-channel-btn-secondary:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .create-channel-actions .create-channel-btn-create {
    width: auto;
  }

  .create-channel-btn-create:disabled,
  .create-channel-btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
