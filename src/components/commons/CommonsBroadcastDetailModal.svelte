<script lang="ts">
  import Modal from '../ui/Modal.svelte';
  import type { CommonsBroadcastDto } from '../../lib/commons/types';
  import { profiles } from '../../stores/profiles';
  import { squads } from '../../stores/squads';
  import { currentUser } from '../../stores/auth';
  import { getProfileDisplayName, getProfileAvatarSrc } from '../../lib/utils/profile';
  import { showToast } from '../../stores/toast';
  import { openCommonsUserDmRequest, sendCommonsJoinRequest } from '../../lib/commons/commons-card-actions';
  import { commonsJoinRequestBlockReason, commonsJoinRequestRevision } from '../../lib/commons/commons-join-request';
  import { commonsTagGradient } from '../../lib/commons/tag-catalog';

  export let broadcast: CommonsBroadcastDto;
  export let onClose: () => void;

  let messageBusy = false;
  let joinBusy = false;
  let actionError = '';

  function formatExpiry(expiresAt: number): string {
    const ms = expiresAt * 1000 - Date.now();
    if (ms <= 0) return 'Expired';
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 60) return `${Math.max(totalMinutes, 1)}m left`;
    const h = Math.floor(totalMinutes / 60);
    if (h < 24) return `${h}h left`;
    const d = Math.floor(h / 24);
    return `${d}d left`;
  }

  $: isSquad = broadcast.subject === 'squad';
  $: isUser = broadcast.subject === 'user';
  $: userProfile = isUser ? $profiles[broadcast.authorNpub] : null;
  $: userLabel =
    isUser && userProfile
      ? getProfileDisplayName(userProfile) || broadcast.authorNpub.slice(0, 16) + '…'
      : isUser
        ? broadcast.authorNpub.slice(0, 16) + '…'
        : '';
  $: squadLabel = broadcast.squadName ?? 'Squad';
  $: title = isSquad ? squadLabel : userLabel;
  $: coverImage = isSquad ? broadcast.squadIconUrl : getProfileAvatarSrc(userProfile);
  $: coverSeed = isSquad ? broadcast.squadId ?? squadLabel : broadcast.authorNpub;
  $: subtitle = (() => {
    if (isUser && broadcast.audience) {
      return broadcast.audience === 'new_user' ? 'New user' : 'Active user';
    }
    if (isSquad) {
      return broadcast.squadKind === 'squad-pair' ? 'Partner squad' : 'Squad';
    }
    return 'User';
  })();
  $: localSquadIds = $squads.map((s) => s.id);
  $: myNpub = $currentUser?.npub;
  $: joinBlockReason = (() => {
    $commonsJoinRequestRevision;
    return isSquad ? commonsJoinRequestBlockReason(broadcast, myNpub, localSquadIds) : null;
  })();
  $: canMessage = isUser && !!myNpub && broadcast.authorNpub !== myNpub;
  $: canJoin = isSquad && !joinBlockReason && !!myNpub;
  $: profileName = userProfile ? getProfileDisplayName(userProfile) : '';
  $: greetingName = profileName && !profileName.startsWith('npub1') ? profileName : '';

  function handleRequestDm() {
    if (!canMessage || messageBusy) return;
    actionError = '';
    messageBusy = true;
    try {
      openCommonsUserDmRequest(broadcast.authorNpub, greetingName);
      onClose();
    } finally {
      messageBusy = false;
    }
  }

  async function handleJoinRequest() {
    if (!canJoin || !myNpub || joinBusy) return;
    actionError = '';
    joinBusy = true;
    try {
      const result = await sendCommonsJoinRequest(broadcast, myNpub, localSquadIds);
      if (!result.ok) {
        actionError = result.error;
        return;
      }
      actionError = '';
      showToast(`Join request sent to ${squadLabel}.`);
      onClose();
    } finally {
      joinBusy = false;
    }
  }
</script>

<Modal
  titleId="commons-broadcast-detail-title"
  descriptionId="commons-broadcast-detail-message"
  {onClose}
  contentClass="commons-detail-modal"
>
  <div
    class="commons-detail-cover"
    style={coverImage ? '' : `background-image: ${commonsTagGradient(coverSeed)}`}
  >
    {#if coverImage}
      <img class="commons-detail-img" src={coverImage} alt="" decoding="async" />
    {:else}
      <span class="commons-detail-initial" aria-hidden="true">{(title || '?').charAt(0).toUpperCase()}</span>
    {/if}
    <span class="commons-detail-expiry">{formatExpiry(broadcast.expiresAt)}</span>
  </div>

  <p class="commons-detail-subtitle">{subtitle}</p>
  <h2 id="commons-broadcast-detail-title" class="commons-detail-title">{title}</h2>
  <p id="commons-broadcast-detail-message" class="commons-detail-message">{broadcast.message}</p>

  {#if broadcast.tags.length > 0}
    <ul class="commons-detail-tags" role="list">
      {#each broadcast.tags as tag (tag)}
        <li>#{tag}</li>
      {/each}
    </ul>
  {/if}

  {#if canMessage || canJoin || (isSquad && joinBlockReason && myNpub && broadcast.authorNpub !== myNpub)}
    <div class="commons-detail-actions">
      {#if canMessage}
        <button type="button" class="commons-detail-btn" disabled={messageBusy} on:click={handleRequestDm}>
          {messageBusy ? 'Opening…' : 'Request DM'}
        </button>
      {/if}
      {#if canJoin}
        <button
          type="button"
          class="commons-detail-btn commons-detail-btn-primary"
          disabled={joinBusy}
          on:click={handleJoinRequest}
        >
          {joinBusy ? 'Sending…' : 'Request to join'}
        </button>
      {:else if isSquad && joinBlockReason && myNpub && broadcast.authorNpub !== myNpub}
        <p class="commons-detail-note muted">{joinBlockReason}</p>
      {/if}
    </div>
  {/if}
  {#if actionError}
    <p class="commons-detail-error" role="alert">{actionError}</p>
  {/if}
</Modal>

<style>
  :global(.commons-detail-modal) {
    max-width: 520px;
    width: min(92vw, 520px);
  }

  .commons-detail-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    margin: -8px 0 16px;
    border-radius: 8px;
    overflow: hidden;
    background-color: var(--bg-panel);
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .commons-detail-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .commons-detail-initial {
    font-size: 3rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.4);
  }

  .commons-detail-expiry {
    position: absolute;
    bottom: 10px;
    right: 10px;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
  }

  .commons-detail-subtitle {
    margin: 0 0 4px;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .commons-detail-title {
    margin: 0 0 12px;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.25;
  }

  .commons-detail-message {
    margin: 0;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 45vh;
    overflow-y: auto;
  }

  .commons-detail-tags {
    list-style: none;
    margin: 16px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .commons-detail-tags li {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 4px 10px;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    text-transform: uppercase;
  }

  .commons-detail-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 20px;
  }

  .commons-detail-btn {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .commons-detail-btn-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast, #fff);
  }

  .commons-detail-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .commons-detail-note {
    margin: 0;
    font-size: 0.8125rem;
  }

  .commons-detail-error {
    margin: 12px 0 0;
    font-size: 0.8125rem;
    color: var(--danger, #e55);
  }

  .muted {
    color: var(--text-muted);
  }
</style>
