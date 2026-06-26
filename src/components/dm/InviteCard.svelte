<script lang="ts">
  /** Invite card for squad, squad-pair, or channel-in-squad DMs. */
  export let variant: 'squad' | 'squad-pair' | 'channel-in-squad';
  export let squadName = '';
  export let channelName = '';
  export let memberSquads: { id: string; name: string }[] = [];
  export let isMine: boolean;
  export let inviterName: string;
  export let inviterAvatarSrc: string | null = null;
  export let status: 'pending' | 'accepted' | 'declined';
  export let accepting: boolean;
  export let onAccept: () => void;
  export let onDecline: () => void;
  /** Opens a DM with the inviter (Pacto App inbox). */
  export let onMessageInviter: (() => void) | undefined = undefined;

  $: title = (() => {
    if (variant === 'squad' || variant === 'squad-pair') return squadName;
    return `${squadName} · #${channelName}`;
  })();

  $: memberSquadsLabel =
    memberSquads?.length > 0 ? memberSquads.map((s) => s.name).join(', ') : '';
  $: subtitle =
    variant === 'squad-pair' && memberSquadsLabel ? `Partner squads: ${memberSquadsLabel}` : '';

  $: bodyText = (() => {
    if (variant === 'squad') {
      return isMine
        ? `You invited ${inviterName} to this squad.`
        : `${inviterName} invited you to join this squad.`;
    }
    if (variant === 'squad-pair') {
      return isMine
        ? `You invited ${inviterName} to this partner squad.`
        : `${inviterName} invited you to join this partner squad.`;
    }
    return isMine
      ? `You added ${inviterName} to #${channelName}.`
      : `${inviterName} added you to #${channelName} in this squad.`;
  })();

  $: iconPlaceholder =
    variant === 'squad' || variant === 'squad-pair'
      ? squadName
        ? squadName.charAt(0).toUpperCase()
        : 'S'
      : '#';

  $: showBadge = variant === 'squad-pair';
  $: badgeLabel = 'Partner squad';
  $: collapsed = status === 'accepted' || status === 'declined';
</script>

<div class="invite-card" class:collapsed role="article">
  <div class="invite-card-icon">
    {#if inviterAvatarSrc}
      <img src={inviterAvatarSrc} alt="" class="invite-card-icon-img" />
    {:else}
      <span class="invite-card-icon-placeholder" aria-hidden="true">{iconPlaceholder}</span>
    {/if}
  </div>
  <div class="invite-card-body">
    {#if showBadge}
      <p class="invite-card-badge">{badgeLabel}</p>
    {/if}
    <p class="invite-card-title">{title}</p>
    {#if subtitle}
      <p class="invite-card-subtitle">{subtitle}</p>
    {/if}
    <p class="invite-card-text">
      {#if !isMine && onMessageInviter}
        <button type="button" class="invite-card-inviter-link" on:click={onMessageInviter}>
          {inviterName}
        </button>
        {variant === 'squad-pair' ? ' invited you to join this partner squad.' : variant === 'squad' ? ' invited you to join this squad.' : ` invited you.`}
      {:else}
        {bodyText}
      {/if}
    </p>
    {#if isMine}
      <!-- Sender: no actions -->
    {:else if status === 'accepted'}
      <p class="invite-card-status invite-card-status-accepted" aria-live="polite">Accepted</p>
      {#if variant === 'squad' || variant === 'squad-pair'}
        <p class="invite-card-evm-caption muted">
          Set your roster signer in the squad <strong>#inbox</strong> channel when you open it.
        </p>
      {/if}
    {:else if status === 'declined'}
      <p class="invite-card-status invite-card-status-declined" aria-live="polite">Declined</p>
    {:else}
      <div class="invite-card-actions">
        <button
          type="button"
          class="invite-card-btn invite-card-btn-accept"
          disabled={accepting}
          on:click={onAccept}
        >
          {accepting ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          class="invite-card-btn invite-card-btn-decline"
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
  .invite-card {
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

  .invite-card.collapsed {
    align-items: center;
    padding: 8px 14px;
    gap: 10px;
  }

  .invite-card.collapsed .invite-card-icon {
    width: 28px;
    height: 28px;
  }

  .invite-card.collapsed .invite-card-icon-placeholder {
    font-size: 0.875rem;
  }

  .invite-card-icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .invite-card-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .invite-card-icon-placeholder {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .invite-card-body {
    flex: 1;
    min-width: 0;
  }

  .invite-card-badge {
    margin: 0 0 4px 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }

  .invite-card-title {
    margin: 0 0 2px 0;
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .invite-card-subtitle {
    margin: 0 0 4px 0;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .invite-card-text {
    margin: 0 0 8px 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .invite-card-inviter-link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    text-decoration: underline;
  }

  .invite-card-inviter-link:hover {
    color: var(--accent-hover, var(--accent));
  }

  .invite-card.collapsed .invite-card-text,
  .invite-card.collapsed .invite-card-subtitle,
  .invite-card.collapsed .invite-card-evm-caption {
    display: none;
  }

  .invite-card-status {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .invite-card-status-accepted {
    color: var(--success, #2d8a4e);
  }

  .invite-card-status-declined {
    color: var(--text-muted);
  }

  .invite-card-evm-caption {
    margin: 6px 0 0 0;
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .invite-card-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .invite-card-btn {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .invite-card-btn-accept {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .invite-card-btn-decline {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border-color: var(--border-subtle);
  }

  .invite-card-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
