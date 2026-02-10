<script lang="ts">
  /** Discord-style invite card for squad invites in DM thread. */
  export let squadName: string;
  export let isMine: boolean;
  export let inviterName: string;
  export let inviterAvatarSrc: string | null = null;
  export let status: 'pending' | 'accepted' | 'declined';
  export let accepting: boolean;
  export let onAccept: () => void;
  export let onDecline: () => void;
</script>

<div class="squad-invite-card">
  <div class="squad-invite-icon">
    {#if inviterAvatarSrc}
      <img src={inviterAvatarSrc} alt="" class="squad-invite-icon-img" />
    {:else}
      <span class="squad-invite-icon-placeholder">{squadName.charAt(0).toUpperCase()}</span>
    {/if}
  </div>
  <div class="squad-invite-body">
    <p class="squad-invite-title">{squadName}</p>
    <p class="squad-invite-text">
      {#if isMine}
        You invited {inviterName} to this squad.
      {:else}
        {inviterName} invited you to this squad.
      {/if}
    </p>
    {#if isMine}
      <!-- Inviter: no actions -->
    {:else if status === 'accepted'}
      <p class="squad-invite-status squad-invite-accepted">Accepted</p>
    {:else if status === 'declined'}
      <p class="squad-invite-status squad-invite-declined">Declined</p>
    {:else}
      <div class="squad-invite-actions">
        <button
          type="button"
          class="squad-invite-btn squad-invite-btn-accept"
          disabled={accepting}
          on:click={onAccept}
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          class="squad-invite-btn squad-invite-btn-decline"
          disabled={accepting}
          on:click={onDecline}
        >
          Decline
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .squad-invite-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 8px 16px;
    padding: 12px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    max-width: 380px;
  }

  .squad-invite-icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: var(--bg-panel);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .squad-invite-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .squad-invite-icon-placeholder {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .squad-invite-body {
    flex: 1;
    min-width: 0;
  }

  .squad-invite-title {
    margin: 0 0 4px;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .squad-invite-text {
    margin: 0 0 10px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .squad-invite-status {
    margin: 0;
    font-size: 0.8125rem;
  }

  .squad-invite-accepted {
    color: var(--success);
  }

  .squad-invite-declined {
    color: var(--text-muted);
  }

  .squad-invite-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .squad-invite-btn {
    padding: 6px 16px;
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    border: none;
  }

  .squad-invite-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .squad-invite-btn-accept {
    background: var(--accent);
    color: #fff;
  }

  .squad-invite-btn-accept:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .squad-invite-btn-decline {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .squad-invite-btn-decline:hover:not(:disabled) {
    background: var(--bg-hover);
  }
</style>
