<script lang="ts">
  /** Card for "new channel in existing network" in DM thread — accept adds channel to your existing network. */
  export let networkName: string;
  export let channelName: string;
  export let memberSquads: { id: string; name: string }[] = [];
  export let isMine: boolean;
  export let inviterName: string;
  export let inviterAvatarSrc: string | null = null;
  export let status: 'pending' | 'accepted' | 'declined';
  export let accepting: boolean;
  export let onAccept: () => void;
  export let onDecline: () => void;

  $: memberSquadsLabel =
    memberSquads?.length > 0 ? memberSquads.map((s) => s.name).join(', ') : '';
</script>

<div class="channel-in-network-card" class:collapsed={status === 'accepted' || status === 'declined'}>
  <div class="channel-in-network-icon">
    {#if inviterAvatarSrc}
      <img src={inviterAvatarSrc} alt="" class="channel-in-network-icon-img" />
    {:else}
      <span class="channel-in-network-icon-placeholder">#</span>
    {/if}
  </div>
  <div class="channel-in-network-body">
    <p class="channel-in-network-title">{networkName} · #{channelName}</p>
    {#if memberSquadsLabel}
      <p class="channel-in-network-squads">Includes squads: {memberSquadsLabel}</p>
    {/if}
    <p class="channel-in-network-text">
      {#if isMine}
        You added {inviterName} to #{channelName}.
      {:else}
        {inviterName} added you to #{channelName} in this network.
      {/if}
    </p>
    {#if isMine}
      <!-- Sender: no actions -->
    {:else if status === 'accepted'}
      <p class="channel-in-network-status channel-in-network-accepted" aria-live="polite">Accepted</p>
    {:else if status === 'declined'}
      <p class="channel-in-network-status channel-in-network-declined" aria-live="polite">Declined</p>
    {:else}
      <div class="channel-in-network-actions">
        <button
          type="button"
          class="channel-in-network-btn channel-in-network-btn-accept"
          disabled={accepting}
          on:click={onAccept}
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          class="channel-in-network-btn channel-in-network-btn-decline"
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
  .channel-in-network-card {
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

  .channel-in-network-card.collapsed {
    align-items: center;
    padding: 8px 14px;
    gap: 10px;
  }

  .channel-in-network-card.collapsed .channel-in-network-icon {
    width: 28px;
    height: 28px;
  }

  .channel-in-network-card.collapsed .channel-in-network-icon-placeholder {
    font-size: 0.875rem;
  }

  .channel-in-network-card.collapsed .channel-in-network-title {
    margin: 0;
    font-size: 0.9375rem;
  }

  .channel-in-network-card.collapsed .channel-in-network-squads,
  .channel-in-network-card.collapsed .channel-in-network-text {
    display: none;
  }

  .channel-in-network-card.collapsed .channel-in-network-status {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 0.75rem;
  }

  .channel-in-network-icon {
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

  .channel-in-network-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .channel-in-network-icon-placeholder {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .channel-in-network-body {
    flex: 1;
    min-width: 0;
  }

  .channel-in-network-title {
    margin: 0 0 4px;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .channel-in-network-squads {
    margin: 0 0 4px;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.3;
  }

  .channel-in-network-text {
    margin: 0 0 10px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .channel-in-network-status {
    margin: 0;
    font-size: 0.8125rem;
  }

  .channel-in-network-accepted {
    color: var(--success);
  }

  .channel-in-network-declined {
    color: var(--text-muted);
  }

  .channel-in-network-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .channel-in-network-btn {
    padding: 6px 16px;
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    border: none;
  }

  .channel-in-network-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .channel-in-network-btn-accept {
    background: var(--accent);
    color: #fff;
  }

  .channel-in-network-btn-accept:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .channel-in-network-btn-decline {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .channel-in-network-btn-decline:hover:not(:disabled) {
    background: var(--bg-hover);
  }
</style>
