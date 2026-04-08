<script lang="ts">
  import { publishSquadMemberEvmShare } from '../../lib/squad/squad-member-evm-share';
  import {
    sharedSquadInviteEvmMessageIds,
    skippedSquadInviteEvmMessageIds,
  } from '../../stores/invite-decisions';
  import { showToast } from '../../stores/toast';

  /**
   * Unified invite card for DM thread: squad, network, channel-in-squad, channel-in-network.
   * Same layout and behavior; variant controls title, subtitle, body text, and optional badge.
   */
  export let variant: 'squad' | 'network' | 'channel-in-squad' | 'channel-in-network';
  export let squadName = '';
  export let networkName = '';
  export let channelName = '';
  export let memberSquads: { id: string; name: string }[] = [];
  export let isMine: boolean;
  export let inviterName: string;
  export let inviterAvatarSrc: string | null = null;
  export let status: 'pending' | 'accepted' | 'declined';
  export let accepting: boolean;
  export let onAccept: () => void;
  export let onDecline: () => void;
  /** For squad invites: DM message id (persists share/skip for the post-accept EVM step). */
  export let inviteMessageId = '';
  /** Announcements MLS group id (roster parent); required for the EVM share step. */
  export let announcementsGroupId = '';

  let squadEvmSharing = false;

  $: squadEvmDecisionDone =
    !inviteMessageId ||
    $sharedSquadInviteEvmMessageIds.includes(inviteMessageId) ||
    $skippedSquadInviteEvmMessageIds.includes(inviteMessageId);

  $: showSquadEvmPrompt =
    variant === 'squad' &&
    status === 'accepted' &&
    !isMine &&
    announcementsGroupId.trim().length > 0 &&
    inviteMessageId.length > 0 &&
    !squadEvmDecisionDone;

  $: title = (() => {
    if (variant === 'squad') return squadName;
    if (variant === 'network') return networkName;
    if (variant === 'channel-in-squad') return `${squadName} · #${channelName}`;
    return `${networkName} · #${channelName}`;
  })();

  $: memberSquadsLabel =
    memberSquads?.length > 0 ? memberSquads.map((s) => s.name).join(', ') : '';
  $: subtitle =
    (variant === 'network' || variant === 'channel-in-network') && memberSquadsLabel
      ? `Includes squads: ${memberSquadsLabel}`
      : '';

  $: bodyText = (() => {
    if (variant === 'squad') {
      return isMine ? `You invited ${inviterName} to this squad.` : `${inviterName} invited you to this squad.`;
    }
    if (variant === 'network') {
      return isMine ? `You invited ${inviterName} to this network.` : `${inviterName} invited you to this network.`;
    }
    if (variant === 'channel-in-squad') {
      return isMine
        ? `You added ${inviterName} to #${channelName}.`
        : `${inviterName} added you to #${channelName} in this squad.`;
    }
    return isMine
      ? `You added ${inviterName} to #${channelName}.`
      : `${inviterName} added you to #${channelName} in this network.`;
  })();

  $: iconPlaceholder =
    variant === 'squad' && squadName
      ? squadName.charAt(0).toUpperCase()
      : variant === 'network'
        ? 'N'
        : '#';

  $: showBadge = variant === 'network';
  $: isNetworkVariant = variant === 'network';
  $: collapsed = (status === 'accepted' || status === 'declined') && !showSquadEvmPrompt;

  async function handleShareSquadEvm(): Promise<void> {
    if (squadEvmSharing || !announcementsGroupId.trim() || !inviteMessageId) return;
    squadEvmSharing = true;
    try {
      const ok = await publishSquadMemberEvmShare(announcementsGroupId.trim());
      if (!ok) {
        showToast('Could not share your signer address. Check your wallet and try again.');
        return;
      }
      sharedSquadInviteEvmMessageIds.update((ids) =>
        ids.includes(inviteMessageId) ? ids : [...ids, inviteMessageId]
      );
      skippedSquadInviteEvmMessageIds.update((ids) => ids.filter((id) => id !== inviteMessageId));
      showToast('Squad signer address shared.');
    } finally {
      squadEvmSharing = false;
    }
  }

  function handleSkipSquadEvm(): void {
    if (!inviteMessageId) return;
    skippedSquadInviteEvmMessageIds.update((ids) =>
      ids.includes(inviteMessageId) ? ids : [...ids, inviteMessageId]
    );
    sharedSquadInviteEvmMessageIds.update((ids) => ids.filter((id) => id !== inviteMessageId));
  }
</script>

<div
  class="invite-card"
  class:collapsed
  class:network-variant={isNetworkVariant}
  role="article"
>
  <div class="invite-card-icon">
    {#if inviterAvatarSrc}
      <img src={inviterAvatarSrc} alt="" class="invite-card-icon-img" />
    {:else}
      <span class="invite-card-icon-placeholder" aria-hidden="true">{iconPlaceholder}</span>
    {/if}
  </div>
  <div class="invite-card-body">
    {#if showBadge}
      <p class="invite-card-badge">Network</p>
    {/if}
    <p class="invite-card-title">{title}</p>
    {#if subtitle}
      <p class="invite-card-subtitle">{subtitle}</p>
    {/if}
    <p class="invite-card-text">{bodyText}</p>
    {#if isMine}
      <!-- Sender: no actions -->
    {:else if status === 'accepted'}
      <p class="invite-card-status invite-card-status-accepted" aria-live="polite">Accepted</p>
      {#if showSquadEvmPrompt}
        <p class="invite-card-evm-caption">
          Share your squad signer address with members? It shows in the roster and when deploying a Safe.
        </p>
        <div class="invite-card-actions invite-card-actions-evm">
          <button
            type="button"
            class="invite-card-btn invite-card-btn-accept"
            disabled={squadEvmSharing}
            on:click={handleShareSquadEvm}
          >
            {squadEvmSharing ? 'Sharing…' : 'Share signer address'}
          </button>
          <button
            type="button"
            class="invite-card-btn invite-card-btn-decline"
            disabled={squadEvmSharing}
            on:click={handleSkipSquadEvm}
          >
            Not now
          </button>
        </div>
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

  .invite-card.network-variant {
    border-left: 3px solid var(--accent);
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

  .invite-card.collapsed .invite-card-badge {
    display: none;
  }

  .invite-card.collapsed .invite-card-title {
    margin: 0;
    font-size: 0.9375rem;
  }

  .invite-card.collapsed .invite-card-subtitle,
  .invite-card.collapsed .invite-card-text {
    display: none;
  }

  .invite-card-evm-caption {
    margin: 8px 0 0 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .invite-card-actions-evm {
    margin-top: 10px;
  }

  .invite-card.collapsed .invite-card-status {
    margin-left: auto;
    flex-shrink: 0;
    font-size: 0.75rem;
  }

  .invite-card-icon {
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

  .invite-card-icon-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .invite-card-icon-placeholder {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .invite-card.network-variant .invite-card-icon-placeholder {
    color: var(--accent);
  }

  .invite-card-body {
    flex: 1;
    min-width: 0;
  }

  .invite-card-badge {
    margin: 0 0 2px 0;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }

  .invite-card-title {
    margin: 0 0 4px 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .invite-card-subtitle {
    margin: 0 0 4px 0;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .invite-card-text {
    margin: 0 0 10px 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .invite-card-status {
    margin: 0;
    font-size: 0.8125rem;
  }

  .invite-card-status-accepted {
    color: var(--success);
  }

  .invite-card-status-declined {
    color: var(--text-muted);
  }

  .invite-card-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .invite-card-btn {
    padding: 6px 16px;
    font-size: 0.8125rem;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    border: none;
  }

  .invite-card-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .invite-card-btn-accept {
    background: var(--accent);
    color: #fff;
  }

  .invite-card-btn-accept:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .invite-card-btn-decline {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .invite-card-btn-decline:hover:not(:disabled) {
    background: var(--bg-hover);
  }
</style>
