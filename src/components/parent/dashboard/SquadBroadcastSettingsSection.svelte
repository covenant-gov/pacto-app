<script lang="ts">
  import BroadcastSquadModal from '../../commons/BroadcastSquadModal.svelte';
  import { commonsTagGradient } from '../../../lib/commons/tag-catalog';
  import {
    cancelSquadCommonsBroadcast,
    fetchActiveSquadCommonsBroadcast,
  } from '../../../lib/commons/squad-broadcast';
  import { isPublicSquadForCommonsBroadcast } from '../../../lib/commons/squad-create-broadcast';
  import {
    canBroadcastSquad,
    broadcastSquadRoleDeniedReason,
    COMMONS_BROADCAST_ROLE_DENIED_REASON,
  } from '../../../lib/commons/permissions';
  import {
    COMMONS_MESSAGE_PREVIEW_MAX,
    isCommonsMessageTruncated,
    truncateCommonsMessage,
  } from '../../../lib/commons/message-preview';
  import { persistSquadPatch } from '../../../lib/squad/squad-catalog';
  import { showToast } from '../../../stores/toast';
  import { currentUser } from '../../../stores/auth';
  import type { CommonsBroadcastLocalState } from '../../../lib/commons/types';
  import type { Squad } from '../../../stores/squads';

  export let squad: Squad;

  type BroadcastMode = 'disabled' | 'enabled';

  let mode: BroadcastMode = squad.visibility === 'public' ? 'enabled' : 'disabled';
  let savingMode = false;
  let activeBroadcast: CommonsBroadcastLocalState | null = null;
  let loadingBroadcast = true;
  let cancelling = false;
  let messageExpanded = false;
  let showBroadcastModal = false;
  let refreshToken = 0;
  let prevSquadId = '';

  $: broadcastEnabled = isPublicSquadForCommonsBroadcast(squad);
  $: broadcastTarget = {
    id: squad.id,
    name: squad.name,
    kind: squad.kind,
    iconUrl: squad.iconUrl,
    visibility: squad.visibility,
    commonsTags: squad.commonsTags,
  };
  $: roleAllowed = canBroadcastSquad({ userNpub: $currentUser?.npub, squad: broadcastTarget });
  $: broadcastDeniedReason =
    broadcastSquadRoleDeniedReason({ userNpub: $currentUser?.npub, squad: broadcastTarget }) ??
    COMMONS_BROADCAST_ROLE_DENIED_REASON;
  $: hasActive = !!activeBroadcast;
  $: fullMessage = activeBroadcast?.message ?? '';
  $: messageTruncated = isCommonsMessageTruncated(fullMessage, COMMONS_MESSAGE_PREVIEW_MAX);
  $: previewMessage = messageTruncated
    ? truncateCommonsMessage(fullMessage, COMMONS_MESSAGE_PREVIEW_MAX)
    : fullMessage;
  $: canStartBroadcast = broadcastEnabled && roleAllowed && !hasActive && !loadingBroadcast;

  $: if (squad.id !== prevSquadId) {
    prevSquadId = squad.id;
    mode = squad.visibility === 'public' ? 'enabled' : 'disabled';
    refreshToken += 1;
  }

  $: squad.id, refreshToken, void loadBroadcast();

  function relativeExpiry(expiresAt: number): string {
    const ms = expiresAt * 1000 - Date.now();
    if (ms <= 0) return 'expired';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${Math.max(minutes, 1)}m left`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h left`;
    return `${Math.floor(hours / 24)}d left`;
  }

  async function loadBroadcast() {
    if (!squad.id) return;
    loadingBroadcast = true;
    try {
      activeBroadcast = await fetchActiveSquadCommonsBroadcast(squad.id);
      messageExpanded = false;
    } finally {
      loadingBroadcast = false;
    }
  }

  async function setMode(next: BroadcastMode) {
    if (savingMode || next === mode) return;
    savingMode = true;
    try {
      if (next === 'disabled') {
        const result = await persistSquadPatch(squad.id, (s) => ({
          ...s,
          visibility: 'private',
          commonsTags: undefined,
        }));
        if (!result) {
          showToast('Could not update Commons settings.');
          return;
        }
        mode = 'disabled';
        return;
      }

      const result = await persistSquadPatch(squad.id, (s) => ({
        ...s,
        visibility: 'public',
      }));
      if (!result) {
        showToast('Could not turn Commons on for this squad.');
        return;
      }
      mode = 'enabled';
    } finally {
      savingMode = false;
    }
  }

  function openBroadcastModal() {
    if (!canStartBroadcast) return;
    showBroadcastModal = true;
  }

  function closeBroadcastModal() {
    showBroadcastModal = false;
    refreshToken += 1;
  }

  async function handleTerminate() {
    if (!activeBroadcast || cancelling) return;
    cancelling = true;
    const result = await cancelSquadCommonsBroadcast(squad.id);
    cancelling = false;
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    activeBroadcast = null;
    showToast('Broadcast terminated. You can publish a new one now.');
    refreshToken += 1;
  }
</script>

<section
  id="settings-squad-broadcast"
  class="dashboard-section squad-broadcast-section"
  aria-labelledby="settings-squad-broadcast-heading"
>
  <h3 id="settings-squad-broadcast-heading" class="section-heading">Squad Broadcast</h3>

  <div class="squad-broadcast-mode" role="radiogroup" aria-label="Commons broadcast">
    <label class="squad-broadcast-mode-option">
      <input
        type="radio"
        name="squad-broadcast-mode"
        value="disabled"
        checked={mode === 'disabled'}
        disabled={savingMode}
        on:change={() => void setMode('disabled')}
      />
      <span>Commons off</span>
    </label>
    <label class="squad-broadcast-mode-option">
      <input
        type="radio"
        name="squad-broadcast-mode"
        value="enabled"
        checked={mode === 'enabled'}
        disabled={savingMode}
        on:change={() => void setMode('enabled')}
      />
      <span>Commons on</span>
    </label>
  </div>

  {#if mode === 'enabled'}
    <p class="squad-broadcast-hint muted">
      Your squad stays private and encrypted. Commons only posts a public discovery card with exactly
      3 tags while you broadcast. You can pick different tags on the next broadcast.
    </p>

    <div class="commons-personal squad-broadcast-status" aria-label="Squad broadcast status">
      <div class="commons-personal-row">
        <div
          class="commons-personal-avatar"
          class:is-active={hasActive}
          style={squad.iconUrl ? '' : `background-image: ${commonsTagGradient(squad.id || squad.name)}`}
        >
          {#if squad.iconUrl}
            <img src={squad.iconUrl} alt="" loading="lazy" decoding="async" />
          {:else}
            <span aria-hidden="true">{squad.name.charAt(0).toUpperCase()}</span>
          {/if}
        </div>

        <div class="commons-personal-block">
          {#if loadingBroadcast}
            <span class="commons-personal-status muted">Checking…</span>
          {:else if hasActive && activeBroadcast}
            <div class="commons-personal-status-row">
              <span class="commons-personal-status">
                <span class="commons-status-dot commons-status-dot-active" aria-hidden="true"></span>
                Active broadcast - {relativeExpiry(activeBroadcast.expiresAt)}
              </span>
              <button
                type="button"
                class="commons-personal-inline-btn is-danger"
                on:click={handleTerminate}
                disabled={cancelling || !roleAllowed}
                title={!roleAllowed ? broadcastDeniedReason : undefined}
              >
                {cancelling ? 'Terminating…' : 'Terminate'}
              </button>
            </div>
            <p class="commons-personal-message muted">
              <span class="commons-personal-message-text">
                “{messageExpanded ? fullMessage : previewMessage}{messageTruncated && !messageExpanded ? '…' : ''}”
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
            {#if activeBroadcast.tags.length > 0}
              <ul class="commons-personal-tags" role="list">
                {#each activeBroadcast.tags as tag (tag)}
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
              <button
                type="button"
                class="commons-personal-inline-btn is-accent"
                on:click={openBroadcastModal}
                disabled={!canStartBroadcast}
                title={!roleAllowed ? broadcastDeniedReason : undefined}
              >
                Start Broadcast
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <p class="squad-broadcast-hint muted">Broadcasting to Commons is off for this squad.</p>
  {/if}
</section>

{#if showBroadcastModal && broadcastEnabled}
  <BroadcastSquadModal
    squad={broadcastTarget}
    broadcastAllowed={roleAllowed}
    {broadcastDeniedReason}
    onClose={closeBroadcastModal}
  />
{/if}

<style>
  .squad-broadcast-section {
    margin-bottom: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }

  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px;
  }

  .squad-broadcast-mode {
    display: inline-flex;
    align-items: stretch;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 12px;
  }

  .squad-broadcast-mode-option {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    cursor: pointer;
    border-right: 1px solid var(--border-subtle);
  }

  .squad-broadcast-mode-option:last-child {
    border-right: none;
  }

  .squad-broadcast-mode-option:has(input:checked) {
    background: var(--bg-elevated);
    color: var(--text-primary);
  }

  .squad-broadcast-mode-option input {
    accent-color: var(--accent);
  }

  .squad-broadcast-hint {
    margin: 0 0 12px;
    font-size: 0.8125rem;
    line-height: 1.45;
  }

  .squad-broadcast-status {
    margin-top: 4px;
  }

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
