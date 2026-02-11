<script lang="ts">
  /** Card for network invites in DM thread — visually distinct from squad invite; shows network name and member squads. */
  export let networkName: string;
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

<div class="network-invite-card" class:collapsed={status === 'accepted' || status === 'declined'}>
  <div class="network-invite-icon">
    {#if inviterAvatarSrc}
      <img src={inviterAvatarSrc} alt="" class="network-invite-icon-img" />
    {:else}
      <span class="network-invite-icon-placeholder" aria-hidden="true">N</span>
    {/if}
  </div>
  <div class="network-invite-body">
    <p class="network-invite-badge">Network</p>
    <p class="network-invite-title">{networkName}</p>
    {#if memberSquadsLabel}
      <p class="network-invite-squads">Includes squads: {memberSquadsLabel}</p>
    {/if}
    <p class="network-invite-text">
      {#if isMine}
        You invited {inviterName} to this network.
      {:else}
        {inviterName} invited you to this network.
      {/if}
    </p>
    {#if isMine}
      <!-- Sender: no actions -->
    {:else if status === 'accepted'}
      <p class="network-invite-status network-invite-accepted" aria-live="polite">Accepted</p>
    {:else if status === 'declined'}
      <p class="network-invite-status network-invite-declined" aria-live="polite">Declined</p>
    {:else}
      <div class="network-invite-actions">
        <button
          type="button"
          class="network-invite-btn network-invite-btn-accept"
          disabled={accepting}
          on:click={onAccept}
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          class="network-invite-btn network-invite-btn-decline"
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
  .network-invite-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: 8px 16px;
    padding: 12px 14px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    max-width: 380px;
    border-left: 3px solid var(--accent);
  }

  .network-invite-card.collapsed {
    align-items: center;
    padding: 8px 14px;
    gap: 10px;
  }

  .network-invite-card.collapsed .network-invite-icon {
    width: 28px;
    height: 28px;
  }

  .network-invite-card.collapsed .network-invite-icon-placeholder {
    font-size: 0.875rem;
  }

  .network-invite-card.collapsed .network-invite-badge {
    display: none;
  }

  .network-invite-card.collapsed .network-invite-title {
    margin: 0;
    font-size: 0.9375rem;
  }

  .network-invite-card.collapsed .network-invite-squads,
  .network-invite-card.collapsed .network-invite-text {
    display: none;
  }

  .network-invite-card.collapsed .network-invite-status {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 0.75rem;
  }

  .network-invite-icon {
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

  .network-invite-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .network-invite-icon-placeholder {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--accent);
  }

  .network-invite-body {
    flex: 1;
    min-width: 0;
  }

  .network-invite-badge {
    margin: 0 0 2px 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }

  .network-invite-title {
    margin: 0 0 4px 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .network-invite-squads {
    margin: 0 0 6px 0;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.35;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .network-invite-text {
    margin: 0 0 10px 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .network-invite-status {
    margin: 0;
    font-size: 0.8125rem;
  }

  .network-invite-accepted {
    color: var(--success);
  }

  .network-invite-declined {
    color: var(--text-muted);
  }

  .network-invite-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .network-invite-btn {
    padding: 6px 16px;
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    border: none;
  }

  .network-invite-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .network-invite-btn-accept {
    background: var(--accent);
    color: #fff;
  }

  .network-invite-btn-accept:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .network-invite-btn-decline {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .network-invite-btn-decline:hover:not(:disabled) {
    background: var(--bg-hover);
  }
</style>
