<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import type { CommonsBroadcastDto } from '../../lib/commons/types';
  import { profiles } from '../../stores/profiles';
  import { squads } from '../../stores/squads';
  import { currentUser } from '../../stores/auth';
  import { getProfileDisplayName, getProfileAvatarSrc } from '../../lib/utils/profile';
  import { showToast } from '../../stores/toast';
  import { openCommonsUserDmRequest, sendCommonsJoinRequest } from '../../lib/commons/commons-card-actions';
  import {
    commonsJoinRequestBlockReason,
    commonsJoinRequestRevision,
    isJoinRequestInFlight,
    squadIdFromBroadcast,
  } from '../../lib/commons/commons-join-request';
  import { commonsTagGradient } from '../../lib/commons/tag-catalog';
  import SquadAvatar from '../squad/SquadAvatar.svelte';
  import {
    COMMONS_MESSAGE_PREVIEW_MAX,
    isCommonsMessageTruncated,
    truncateCommonsMessage,
  } from '../../lib/commons/message-preview';
  import CommonsBroadcastDetailModal from './CommonsBroadcastDetailModal.svelte';

  export let broadcast: CommonsBroadcastDto;

  const tFn = get(t);

  let detailOpen = false;
  let messageBusy = false;
  let actionError = '';

  function formatExpiry(expiresAt: number): string {
    const ms = expiresAt * 1000 - Date.now();
    if (ms <= 0) return tFn('commons.duration.expired');
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 60) return tFn('commons.duration.minutesLeft', { values: { minutes: Math.max(totalMinutes, 1) } });
    const h = Math.floor(totalMinutes / 60);
    if (h < 24) return tFn('commons.duration.hoursLeft', { values: { hours: h } });
    const d = Math.floor(h / 24);
    return tFn('commons.duration.daysLeft', { values: { days: d } });
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
  $: squadLabel = broadcast.squadName ?? tFn('commons.card.squadDefault');
  $: title = isSquad ? squadLabel : userLabel;
  $: coverImage = getProfileAvatarSrc(userProfile);
  $: coverSeed = isSquad ? broadcast.squadId ?? squadLabel : broadcast.authorNpub;
  $: subtitle = (() => {
    if (isUser && broadcast.audience) {
      return broadcast.audience === 'new_user' ? tFn('commons.card.newUser') : tFn('commons.card.activeUser');
    }
    if (isSquad) {
      return broadcast.squadKind === 'squad-pair' ? tFn('commons.card.partnerSquad') : tFn('commons.card.squadDefault');
    }
    return tFn('commons.card.user');
  })();
  $: localSquadIds = $squads.map((s) => s.id);
  $: myNpub = $currentUser?.npub;
  $: joinBlockReason = (() => {
    $commonsJoinRequestRevision;
    return isSquad ? commonsJoinRequestBlockReason(broadcast, myNpub, localSquadIds) : null;
  })();
  $: joinInFlight = (() => {
    $commonsJoinRequestRevision;
    return isSquad && isJoinRequestInFlight(squadIdFromBroadcast(broadcast));
  })();
  $: canMessage = isUser && !!myNpub && broadcast.authorNpub !== myNpub;
  $: canJoin = isSquad && !joinBlockReason && !!myNpub;
  $: profileName = userProfile ? getProfileDisplayName(userProfile) : '';
  $: greetingName = profileName && !profileName.startsWith('npub1') ? profileName : '';
  $: messageTruncated = isCommonsMessageTruncated(broadcast.message, COMMONS_MESSAGE_PREVIEW_MAX);
  $: previewMessage = messageTruncated
    ? truncateCommonsMessage(broadcast.message, COMMONS_MESSAGE_PREVIEW_MAX)
    : broadcast.message;

  function openDetail() {
    detailOpen = true;
  }

  function handleCardClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('button, a')) return;
    openDetail();
  }

  function handleCardKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as HTMLElement).closest('button, a')) return;
    e.preventDefault();
    openDetail();
  }

  function handleRequestDm() {
    if (!canMessage || messageBusy) return;
    actionError = '';
    messageBusy = true;
    try {
      openCommonsUserDmRequest(broadcast.authorNpub, greetingName);
    } finally {
      messageBusy = false;
    }
  }

  async function handleJoinRequest() {
    if (!canJoin || !myNpub || joinInFlight) return;
    actionError = '';
    const result = await sendCommonsJoinRequest(broadcast, myNpub, localSquadIds);
    if (!result.ok) {
      actionError = result.error;
      return;
    }
    actionError = '';
    showToast(tFn('commons.card.joinToast', { values: { squadLabel } }));
  }
</script>

<div
  class="commons-tile"
  class:commons-tile-squad={isSquad}
  class:commons-tile-user={isUser}
  role="button"
  tabindex="0"
  aria-label={$t('commons.card.ariaLabel', { values: { title } })}
  on:click={handleCardClick}
  on:keydown={handleCardKeydown}
>
  <div class="commons-tile-cover" style={isSquad || coverImage ? '' : `background-image: ${commonsTagGradient(coverSeed)}`}>
    {#if isSquad}
      <SquadAvatar variant="cover" src={broadcast.squadIconUrl} name={title} seed={coverSeed} />
    {:else if coverImage}
      <img class="commons-tile-img" src={coverImage} alt="" loading="lazy" decoding="async" />
    {:else}
      <span class="commons-tile-initial" aria-hidden="true">{(title || '?').charAt(0).toUpperCase()}</span>
    {/if}
    <span class="commons-tile-expiry">{formatExpiry(broadcast.expiresAt)}</span>
  </div>

  <div class="commons-tile-body">
    <div class="commons-tile-meta">
      <span class="commons-tile-subtitle">{subtitle}</span>
    </div>
    <h3 class="commons-tile-title">{title}</h3>
    <p class="commons-tile-message">
      <span class="commons-tile-message-text">
        {previewMessage}{#if messageTruncated}{$t('commons.ellipsis')}{/if}
      </span>
    </p>

    {#if broadcast.tags.length > 0}
      <ul class="commons-tile-tags" role="list">
        {#each broadcast.tags as tag (tag)}
          <li>#{tag}</li>
        {/each}
      </ul>
    {/if}

    {#if canMessage || canJoin || (isSquad && joinBlockReason && myNpub && broadcast.authorNpub !== myNpub)}
      <div class="commons-tile-actions">
        {#if canMessage}
          <button
            type="button"
            class="commons-tile-btn"
            disabled={messageBusy}
            on:click|stopPropagation={handleRequestDm}
          >
            {messageBusy ? $t('commons.card.opening') : $t('commons.card.requestDm')}
          </button>
        {/if}
        {#if canJoin}
          <button
            type="button"
            class="commons-tile-btn commons-tile-btn-primary"
            disabled={joinInFlight}
            on:click|stopPropagation={handleJoinRequest}
          >
            {joinInFlight ? $t('commons.card.sending') : $t('commons.card.requestJoin')}
          </button>
        {:else if isSquad && joinBlockReason && myNpub && broadcast.authorNpub !== myNpub}
          <p class="commons-tile-note muted">{joinBlockReason}</p>
        {/if}
      </div>
    {/if}
    {#if actionError}
      <p class="commons-tile-error" role="alert">{actionError}</p>
    {/if}
  </div>
</div>

{#if detailOpen}
  <CommonsBroadcastDetailModal {broadcast} onClose={() => (detailOpen = false)} />
{/if}

<style>
  .commons-tile {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-subtle);
    background: var(--bg-elevated);
    overflow: hidden;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
  }

  .commons-tile:hover {
    border-color: var(--border);
    background: var(--bg-panel);
  }

  .commons-tile:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .commons-tile-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 10;
    background-color: var(--bg-panel);
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .commons-tile-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .commons-tile-initial {
    font-size: 2.5rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.4);
  }

  .commons-tile-expiry {
    position: absolute;
    bottom: 8px;
    right: 8px;
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
  }

  .commons-tile-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px 14px;
    flex: 1;
  }

  .commons-tile-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .commons-tile-subtitle {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }

  .commons-tile-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
  }

  .commons-tile-message {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-secondary);
    flex: 1;
    min-height: calc(0.8125rem * 1.45 * 4);
    overflow: hidden;
  }

  .commons-tile-message-text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .commons-tile-tags {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .commons-tile-tags li {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 3px 8px;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    text-transform: uppercase;
  }

  .commons-tile-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }

  .commons-tile-btn {
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .commons-tile-btn-primary {
    background: var(--brand);
    border-color: var(--brand);
    color: var(--on-brand);
  }

  .commons-tile-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .commons-tile-note {
    margin: 0;
    font-size: 0.75rem;
  }

  .commons-tile-error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger, #e55);
  }

  .muted {
    color: var(--text-muted);
  }
</style>
