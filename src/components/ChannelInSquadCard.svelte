<script lang="ts">
  /** Card for "new channel in existing squad" in DM thread — accept adds channel to your existing squad. */
  export let squadName: string;
  export let channelName: string;
  export let isMine: boolean;
  export let inviterName: string;
  export let inviterAvatarSrc: string | null = null;
  export let status: 'pending' | 'accepted' | 'declined';
  export let accepting: boolean;
  export let onAccept: () => void;
  export let onDecline: () => void;
</script>

<div class="channel-in-squad-card">
  <div class="channel-in-squad-icon">
    {#if inviterAvatarSrc}
      <img src={inviterAvatarSrc} alt="" class="channel-in-squad-icon-img" />
    {:else}
      <span class="channel-in-squad-icon-placeholder">#</span>
    {/if}
  </div>
  <div class="channel-in-squad-body">
    <p class="channel-in-squad-title">{squadName} · #{channelName}</p>
    <p class="channel-in-squad-text">
      {#if isMine}
        You added {inviterName} to #{channelName}.
      {:else}
        {inviterName} added you to #{channelName} in this squad.
      {/if}
    </p>
    {#if isMine}
      <!-- Sender: no actions -->
    {:else if status === 'accepted'}
      <p class="channel-in-squad-status channel-in-squad-accepted">Accepted</p>
    {:else if status === 'declined'}
      <p class="channel-in-squad-status channel-in-squad-declined">Declined</p>
    {:else}
      <div class="channel-in-squad-actions">
        <button
          type="button"
          class="channel-in-squad-btn channel-in-squad-btn-accept"
          disabled={accepting}
          on:click={onAccept}
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          class="channel-in-squad-btn channel-in-squad-btn-decline"
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
  .channel-in-squad-card {
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

  .channel-in-squad-icon {
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

  .channel-in-squad-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .channel-in-squad-icon-placeholder {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .channel-in-squad-body {
    flex: 1;
    min-width: 0;
  }

  .channel-in-squad-title {
    margin: 0 0 4px;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .channel-in-squad-text {
    margin: 0 0 10px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .channel-in-squad-status {
    margin: 0;
    font-size: 0.8125rem;
  }

  .channel-in-squad-accepted {
    color: var(--success);
  }

  .channel-in-squad-declined {
    color: var(--text-muted);
  }

  .channel-in-squad-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .channel-in-squad-btn {
    padding: 6px 16px;
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    border: none;
  }

  .channel-in-squad-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .channel-in-squad-btn-accept {
    background: var(--accent);
    color: #fff;
  }

  .channel-in-squad-btn-accept:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .channel-in-squad-btn-decline {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .channel-in-squad-btn-decline:hover:not(:disabled) {
    background: var(--bg-hover);
  }
</style>
