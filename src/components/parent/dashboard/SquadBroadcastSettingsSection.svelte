<script lang="ts">
  import { t } from 'svelte-i18n';
  import DashboardAssetCard from './DashboardAssetCard.svelte';
  import { get } from 'svelte/store';
  const tFn = get(t);
  import BroadcastSquadModal from '../../commons/BroadcastSquadModal.svelte';
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
  import SquadAvatar from '../../squad/SquadAvatar.svelte';
  import { showToast } from '../../../stores/toast';
  import { currentUser } from '../../../stores/auth';
  import type { CommonsBroadcastLocalState } from '../../../lib/commons/types';
  import type { Squad } from '../../../stores/squads';

  interface Props {
    squad: Squad;
  }

  let { squad }: Props = $props();

  type BroadcastMode = 'disabled' | 'enabled';

  let mode = $state<BroadcastMode>(squad.visibility === 'public' ? 'enabled' : 'disabled');
  let savingMode = $state(false);
  let activeBroadcast = $state<CommonsBroadcastLocalState | null>(null);
  let loadingBroadcast = $state(true);
  let cancelling = $state(false);
  let messageExpanded = $state(false);
  let showBroadcastModal = $state(false);
  let refreshToken = $state(0);
  let prevSquadId = $state('');

  const broadcastEnabled = $derived(isPublicSquadForCommonsBroadcast(squad));
  const broadcastTarget = $derived({
    id: squad.id,
    name: squad.name,
    kind: squad.kind,
    iconUrl: squad.iconUrl,
    visibility: squad.visibility,
    commonsTags: squad.commonsTags,
  });
  const roleAllowed = $derived(canBroadcastSquad({ userNpub: $currentUser?.npub, squad: broadcastTarget }));
  const broadcastDeniedReason = $derived(
    broadcastSquadRoleDeniedReason({ userNpub: $currentUser?.npub, squad: broadcastTarget }) ??
      COMMONS_BROADCAST_ROLE_DENIED_REASON,
  );
  const hasActive = $derived(!!activeBroadcast);
  const fullMessage = $derived(activeBroadcast?.message ?? '');
  const messageTruncated = $derived(isCommonsMessageTruncated(fullMessage, COMMONS_MESSAGE_PREVIEW_MAX));
  const previewMessage = $derived(
    messageTruncated ? truncateCommonsMessage(fullMessage, COMMONS_MESSAGE_PREVIEW_MAX) : fullMessage,
  );
  const canStartBroadcast = $derived(broadcastEnabled && roleAllowed && !hasActive && !loadingBroadcast);

  $effect(() => {
    if (squad.id !== prevSquadId) {
      prevSquadId = squad.id;
      mode = squad.visibility === 'public' ? 'enabled' : 'disabled';
      refreshToken += 1;
    }
  });

  $effect(() => {
    void squad.id;
    void refreshToken;
    void loadBroadcast();
  });

  function relativeExpiry(expiresAt: number, tFn: (key: string, opts?: object) => string): string {
    const ms = expiresAt * 1000 - Date.now();
    if (ms <= 0) return tFn('governance.broadcast.expired');
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return tFn('governance.broadcast.minutesLeft', { values: { minutes: Math.max(minutes, 1) } });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return tFn('governance.broadcast.hoursLeft', { values: { hours } });
    return tFn('governance.broadcast.daysLeft', { values: { days: Math.floor(hours / 24) } });
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
          showToast(tFn('governance.broadcast.toastOffFailed'));
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
        showToast(tFn('governance.broadcast.toastOnFailed'));
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
    showToast(tFn('governance.broadcast.toastTerminated'));
    refreshToken += 1;
  }
</script>

<DashboardAssetCard
  id="settings-squad-broadcast"
  headingId="settings-squad-broadcast-heading"
  heading={$t('governance.broadcast.title')}
>
  <div class="squad-broadcast-mode" role="radiogroup" aria-label={$t('governance.broadcast.aria')}>
    <label class="squad-broadcast-mode-option">
      <input
        type="radio"
        name="squad-broadcast-mode"
        value="disabled"
        checked={mode === 'disabled'}
        disabled={savingMode}
        onchange={() => void setMode('disabled')}
      />
      <span>{$t('governance.broadcast.off')}</span>
    </label>
    <label class="squad-broadcast-mode-option">
      <input
        type="radio"
        name="squad-broadcast-mode"
        value="enabled"
        checked={mode === 'enabled'}
        disabled={savingMode}
        onchange={() => void setMode('enabled')}
      />
      <span>{$t('governance.broadcast.on')}</span>
    </label>
  </div>

  {#if mode === 'enabled'}
    <p class="squad-broadcast-hint muted">{$t('governance.broadcast.enabledHint')}</p>

    <div class="commons-personal squad-broadcast-status" aria-label={$t('governance.broadcast.statusAria')}>
      <div class="commons-personal-row">
        <div class="commons-personal-avatar" class:is-active={hasActive}>
          <SquadAvatar src={squad.iconUrl} name={squad.name} seed={squad.id || squad.name} fill />
        </div>

        <div class="commons-personal-block">
          {#if loadingBroadcast}
            <span class="commons-personal-status muted">{$t('governance.broadcast.checking')}</span>
          {:else if hasActive && activeBroadcast}
            <div class="commons-personal-status-row">
              <span class="commons-personal-status">
                <span class="commons-status-dot commons-status-dot-active" aria-hidden="true"></span>
                {$t('governance.broadcast.active', { values: { expiry: relativeExpiry(activeBroadcast.expiresAt, $t) } })}
              </span>
              <button
                type="button"
                class="commons-personal-inline-btn is-danger"
                onclick={handleTerminate}
                disabled={cancelling || !roleAllowed}
                title={!roleAllowed ? broadcastDeniedReason : undefined}
              >
                {cancelling ? $t('governance.common.terminating') : $t('governance.common.terminate')}
              </button>
            </div>
            <p class="commons-personal-message muted">
              <span class="commons-personal-message-text">
                “{messageExpanded ? fullMessage : previewMessage}{#if messageTruncated && !messageExpanded}{$t('commons.ellipsis')}{/if}”
              </span>
              {#if messageTruncated}
                <button
                  type="button"
                  class="commons-personal-see-more"
                  onclick={() => (messageExpanded = !messageExpanded)}
                >
                  {messageExpanded ? $t('governance.common.seeLess') : $t('governance.common.seeMore')}
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
                {$t('governance.broadcast.noActive')}
              </span>
              <button
                type="button"
                class="commons-personal-inline-btn is-accent"
                onclick={openBroadcastModal}
                disabled={!canStartBroadcast}
                title={!roleAllowed ? broadcastDeniedReason : undefined}
              >
                {$t('governance.broadcast.start')}
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {:else}
    <p class="squad-broadcast-hint muted">{$t('governance.broadcast.disabledHint')}</p>
  {/if}
</DashboardAssetCard>

{#if showBroadcastModal && broadcastEnabled}
  <BroadcastSquadModal
    squad={broadcastTarget}
    broadcastAllowed={roleAllowed}
    {broadcastDeniedReason}
    onClose={closeBroadcastModal}
  />
{/if}

<style>
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
    accent-color: var(--brand);
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
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--border-subtle);
  }

  .commons-personal-avatar.is-active {
    border-color: var(--brand);
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
    color: var(--brand);
  }

  .commons-personal-inline-btn.is-accent:hover:not(:disabled) {
    background: color-mix(in srgb, var(--brand) 12%, transparent);
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
    background: var(--brand);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 25%, transparent);
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
    color: var(--brand);
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
