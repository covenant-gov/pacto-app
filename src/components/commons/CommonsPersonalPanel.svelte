<script lang="ts">
  import { currentUser } from '../../stores/auth';
  import { activeView, activeChannelId, activeHubChannelName } from '../../stores/navigation';
  import { profiles } from '../../stores/profiles';
  import { getProfileAvatarSrc, getProfileDisplayName } from '../../lib/utils/profile';
  import { commonsTagGradient } from '../../lib/commons/tag-catalog';
  import {
    cancelUserCommonsBroadcast,
    fetchActiveUserCommonsBroadcast,
  } from '../../lib/commons/user-broadcast';
  import { showToast } from '../../stores/toast';
  import type { CommonsBroadcastLocalState } from '../../lib/commons/types';
  import {
    COMMONS_MESSAGE_PREVIEW_MAX,
    isCommonsMessageTruncated,
    truncateCommonsMessage,
  } from '../../lib/commons/message-preview';
  import { commonsUserHasActiveBroadcast } from '../../stores/commons-ui';

  /** Bump to force a reload after publishing. */
  export let refreshKey = 0;
  export let onBroadcast: () => void = () => {};
  /** Notify parent (feed) after the active broadcast changes. */
  export let onChanged: () => void = () => {};

  let lastBroadcast: CommonsBroadcastLocalState | null = null;
  let loading = true;
  let loadedKey = -1;
  let cancelling = false;
  let messageExpanded = false;

  $: npub = $currentUser?.npub ?? '';
  $: profile = npub ? $profiles[npub] : null;
  $: avatarSrc = getProfileAvatarSrc(profile);
  $: displayName = npub ? getProfileDisplayName(profile) : '';

  async function load() {
    if (!npub) {
      lastBroadcast = null;
      commonsUserHasActiveBroadcast.set(false);
      loading = false;
      return;
    }
    loading = true;
    lastBroadcast = await fetchActiveUserCommonsBroadcast(npub);
    commonsUserHasActiveBroadcast.set(!!lastBroadcast);
    messageExpanded = false;
    loading = false;
  }

  $: if (refreshKey !== loadedKey && npub) {
    loadedKey = refreshKey;
    void load();
  }

  function relativeExpiry(expiresAt: number): string {
    const ms = expiresAt * 1000 - Date.now();
    if (ms <= 0) return 'expired';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${Math.max(minutes, 1)}m left`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h left`;
    return `${Math.floor(hours / 24)}d left`;
  }

  function openSettings() {
    activeChannelId.set(null);
    activeHubChannelName.set(null);
    activeView.set('profile');
  }

  async function handleCancel() {
    if (!npub || cancelling) return;
    cancelling = true;
    const result = await cancelUserCommonsBroadcast(npub);
    cancelling = false;
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    lastBroadcast = null;
    commonsUserHasActiveBroadcast.set(false);
    showToast('Broadcast cancelled. You can broadcast again now.');
    onChanged();
  }

  $: hasActive = !!lastBroadcast;
  $: fullMessage = lastBroadcast?.message ?? '';
  $: messageTruncated = isCommonsMessageTruncated(fullMessage, COMMONS_MESSAGE_PREVIEW_MAX);
  $: previewMessage = messageTruncated
    ? truncateCommonsMessage(fullMessage, COMMONS_MESSAGE_PREVIEW_MAX)
    : fullMessage;
</script>

<section class="commons-personal" aria-label="Your broadcast">
  <div class="commons-personal-row">
    <button
      type="button"
      class="commons-personal-avatar"
      class:is-active={hasActive}
      style={avatarSrc ? '' : `background-image: ${commonsTagGradient(npub || displayName)}`}
      aria-label="Profile settings"
      title="Profile settings"
      on:click={openSettings}
    >
      {#if avatarSrc}
        <img src={avatarSrc} alt="" loading="lazy" decoding="async" />
      {:else}
        <span aria-hidden="true">{(displayName || '?').charAt(0).toUpperCase()}</span>
      {/if}
    </button>

    <div class="commons-personal-block">
      {#if loading}
        <span class="commons-personal-status muted">Checking…</span>
      {:else if hasActive && lastBroadcast}
        <div class="commons-personal-status-row">
          <span class="commons-personal-status">
            <span class="commons-status-dot commons-status-dot-active" aria-hidden="true"></span>
            Active broadcast - {relativeExpiry(lastBroadcast.expiresAt)}
          </span>
          <button
            type="button"
            class="commons-personal-inline-btn is-danger"
            on:click={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Terminating broadcast…' : 'Terminate Broadcast'}
          </button>
        </div>
        <p class="commons-personal-message muted">
          <span class="commons-personal-message-text">
            “{messageExpanded ? fullMessage : previewMessage}{messageTruncated && !messageExpanded
              ? '…'
              : ''}”
          </span>
          {#if messageTruncated}
            <button
              type="button"
              class="commons-personal-see-more"
              on:click={() => (messageExpanded = !messageExpanded)}
            >
              {messageExpanded ? 'see less' : 'see more…'}
            </button>
          {/if}
        </p>
        {#if lastBroadcast.tags.length > 0}
          <ul class="commons-personal-tags" role="list">
            {#each lastBroadcast.tags as tag (tag)}
              <li>#{tag}</li>
            {/each}
          </ul>
        {/if}
      {:else}
        <div class="commons-personal-status-row">
          <span class="commons-personal-status">
            <span class="commons-status-dot" aria-hidden="true"></span>
            No active broadcast
          </span>
          <button type="button" class="commons-personal-inline-btn is-accent" on:click={onBroadcast}>
            Start Broadcast
          </button>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .commons-personal {
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    background: var(--bg-panel);
    padding: 14px 16px;
  }

  .commons-personal-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 14px;
  }

  .commons-personal-avatar {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    flex-shrink: 0;
    overflow: hidden;
    padding: 0;
    background-color: var(--bg-elevated);
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--border-subtle);
    cursor: pointer;
  }

  .commons-personal-avatar:hover {
    border-color: var(--text-muted);
  }

  .commons-personal-avatar.is-active {
    border-color: var(--accent);
  }

  .commons-personal-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .commons-personal-avatar span {
    font-size: 1.25rem;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.92);
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.4);
  }

  .commons-personal-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 200px;
    flex: 1;
  }

  .commons-personal-status-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .commons-personal-status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .commons-personal-inline-btn {
    flex-shrink: 0;
    padding: 2px 6px;
    border: 1px solid var(--border-subtle);
    border-radius: 0;
    background: transparent;
    font-size: 0.75rem;
    font-weight: 400;
    line-height: 1.2;
    cursor: pointer;
  }

  .commons-personal-inline-btn.is-danger {
    color: var(--danger, #e55);
  }

  .commons-personal-inline-btn.is-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger, #e55) 10%, transparent);
  }

  .commons-personal-inline-btn.is-accent {
    color: var(--accent);
  }

  .commons-personal-inline-btn.is-accent:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .commons-personal-inline-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .commons-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
  }

  .commons-status-dot-active {
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .commons-personal-message {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    max-width: 60ch;
  }

  .commons-personal-message-text {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .commons-personal-see-more {
    display: inline;
    margin-left: 4px;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-size: inherit;
    line-height: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .commons-personal-see-more:hover {
    color: var(--text-primary);
  }

  .commons-personal-tags {
    list-style: none;
    margin: 2px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .commons-personal-tags li {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 2px 8px;
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    text-transform: uppercase;
  }

  .muted {
    color: var(--text-muted);
  }
</style>
