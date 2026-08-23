<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { profiles, loadProfile } from '../../stores/profiles';
  import { showToast } from '../../stores/toast';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import type { CommonsJoinRequestDto } from '../../lib/commons/types';
  import {
    isJoinRequestRespondInFlight,
    joinRequestRespondInFlight,
    respondToMlsJoinRequest,
  } from '../../lib/squad/squad-join-mls';
  import { muteJoinRequester } from '../../lib/squad/squad-join-spam';
  import { getSquadBotState, type SquadBotState } from '../../lib/squad/squad-bot';
  import {
    ensureJoinRequestsHydrated,
    joinRequestsErrorBySquadId,
    joinRequestsHydratedBySquadId,
    joinRequestsSyncingBySquadId,
    pendingJoinRequestsBySquadId,
    removePendingJoinRequest,
    syncJoinRequestsForSquad,
  } from '../../stores/squad-join-requests';
  import { admitMemberToSquad } from '../../lib/parent/admit-member';
  import {
    enqueuePendingAdmit,
    listPendingAdmitForParent,
    pendingAdmitQueue,
    clearPendingAdmitForMember,
  } from '../../lib/parent/pending-admit';
  import type { Squad } from '../../stores/squads';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';

  let { squad }: { squad: Squad } = $props();

  let refreshError = $state('');
  let profileLoadToken = 0;
  let botState = $state<SquadBotState | null>(null);
  let botStateLoading = $state(true);

  const tFn = get(t);

  let anyRespondInFlight = $derived($joinRequestRespondInFlight.size > 0);
  let requests = $derived($pendingJoinRequestsBySquadId[squad.id] ?? []);
  let hydrated = $derived($joinRequestsHydratedBySquadId[squad.id] ?? false);
  let syncing = $derived($joinRequestsSyncingBySquadId[squad.id] ?? false);
  let loadError = $derived($joinRequestsErrorBySquadId[squad.id] ?? refreshError);
  let loading = $derived((!hydrated && syncing) || botStateLoading);
  let canAct = $derived(!!(botState?.iAmHolder && botState?.hasLocalSecret));
  let admitting = $derived.by(() => {
    void $pendingAdmitQueue;
    return listPendingAdmitForParent(squad.id).filter((e) => e.kind === 'join');
  });

  $effect(() => {
    if (squad?.id) {
      void ensureJoinRequestsHydrated(squad.id);
      void loadBotState(squad.id);
    }
  });

  $effect(() => {
    if (requests.length === 0 && admitting.length === 0) return;
    const token = ++profileLoadToken;
    const npubs = [
      ...new Set([
        ...requests.map((r) => r.requesterNpub),
        ...admitting.map((a) => a.memberNpub),
      ]),
    ];
    void Promise.all(npubs.map((npub) => loadProfile(npub))).then(() => {
      if (token !== profileLoadToken) return;
    });
  });

  async function loadBotState(squadId: string) {
    botStateLoading = true;
    try {
      botState = await getSquadBotState(squadId);
    } catch {
      botState = null;
    } finally {
      botStateLoading = false;
    }
  }

  async function refresh() {
    refreshError = '';
    try {
      await loadBotState(squad.id);
      await syncJoinRequestsForSquad(squad.id);
    } catch (e) {
      refreshError = e instanceof Error ? e.message : tFn('squad.joinRequests.loadError');
    }
  }

  async function handleMute(request: CommonsJoinRequestDto) {
    if (!canAct || anyRespondInFlight) return;
    muteJoinRequester(squad.id, request.requesterNpub);
    removePendingJoinRequest(squad.id, request.eventId);
    showToast(tFn('squad.joinRequests.muteToast'));
  }

  async function handleReject(request: CommonsJoinRequestDto) {
    if (!canAct || anyRespondInFlight || isJoinRequestRespondInFlight(request.eventId)) return;
    const result = await respondToMlsJoinRequest({
      requestId: request.eventId,
      squadId: request.squadId,
      status: 'rejected',
    });
    if (!result.ok) {
      if (result.error) showToast(result.error);
      return;
    }
    removePendingJoinRequest(squad.id, request.eventId);
    showToast(tFn('squad.joinRequests.rejectToast'));
  }

  async function handleAccept(request: CommonsJoinRequestDto) {
    if (!canAct || anyRespondInFlight || isJoinRequestRespondInFlight(request.eventId)) return;
    const respondResult = await respondToMlsJoinRequest({
      requestId: request.eventId,
      squadId: request.squadId,
      status: 'accepted',
    });
    if (!respondResult.ok) {
      if (respondResult.error) showToast(respondResult.error);
      return;
    }

    removePendingJoinRequest(squad.id, request.eventId);
    enqueuePendingAdmit({
      kind: 'join',
      parentId: squad.id,
      memberNpub: request.requesterNpub,
      requestId: request.eventId,
    });
    showToast(tFn('squad.joinRequests.approvedPendingToast'));

    const admitResult = await admitMemberToSquad({
      parent: squad,
      memberNpub: request.requesterNpub,
    });
    if (admitResult.ok) {
      clearPendingAdmitForMember(squad.id, request.requesterNpub);
      const name =
        getProfileDisplayName($profiles[request.requesterNpub]) ||
        tFn('squad.joinRequests.memberFallback');
      showToast(tFn('squad.joinRequests.joinToast', { values: { name } }));
    } else if (admitResult.error) {
      enqueuePendingAdmit({
        kind: 'join',
        parentId: squad.id,
        memberNpub: request.requesterNpub,
        requestId: request.eventId,
        lastError: admitResult.error,
        lastAttemptAt: Date.now(),
      });
    }
  }

  function requesterLabel(npub: string): string {
    return getProfileDisplayName($profiles[npub]) || npub.slice(0, 12) + '…';
  }

  function relativeCreated(createdAt: number): string {
    const ms = createdAt * 1000 - Date.now();
    const abs = Math.abs(ms);
    const minutes = Math.floor(abs / 60000);
    if (minutes < 60) return tFn('squad.joinRequests.minutesAgo', { values: { minutes: Math.max(minutes, 1) } });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return tFn('squad.joinRequests.hoursAgo', { values: { hours } });
    return tFn('squad.joinRequests.daysAgo', { values: { days: Math.floor(hours / 24) } });
  }
</script>

<section class="join-requests-panel" aria-label={$t('squad.joinRequests.ariaLabel')}>
  <header class="join-requests-header">
    <h2 class="join-requests-title">{$t('squad.joinRequests.title')}</h2>
    {#if !loading && !canAct}
      <p class="join-requests-muted" role="status">{$t('squad.joinRequests.holdersOnlyHint')}</p>
    {/if}
  </header>

  {#if loading}
    <p class="join-requests-muted" role="status">{$t('squad.joinRequests.loading')}</p>
  {:else if loadError}
    <p class="join-requests-error" role="alert">{loadError}</p>
  {:else if requests.length === 0 && admitting.length === 0}
    <p class="join-requests-muted">{$t('squad.joinRequests.empty')}</p>
  {:else}
    <ul class="join-requests-list" role="list">
      {#each admitting as entry (entry.memberNpub + (entry.requestId ?? ''))}
        <li class="join-request-card">
          <div class="join-request-main">
            <p class="join-request-badge">{$t('squad.joinRequests.admittingBadge')}</p>
            <p class="join-request-name">{requesterLabel(entry.memberNpub)}</p>
            <p class="join-request-meta">{$t('squad.joinRequests.admittingDetail')}</p>
            {#if entry.lastError}
              <p class="join-request-meta">{$t('squad.joinRequests.admittingError', { values: { error: entry.lastError } })}</p>
            {/if}
          </div>
        </li>
      {/each}
      {#each requests as request (request.eventId)}
        <li class="join-request-card">
          <div class="join-request-main">
            <p class="join-request-badge">{$t('squad.joinRequests.badge')}</p>
            <p class="join-request-name">{requesterLabel(request.requesterNpub)}</p>
            <p class="join-request-meta">
              {$t('squad.joinRequests.requestedTime', { values: { time: relativeCreated(request.createdAt) } })}
            </p>
            <p class="join-request-npub">{request.requesterNpub}</p>
          </div>
          {#if canAct}
            <div class="join-request-actions">
              <button
                type="button"
                class="join-request-btn is-mute"
                disabled={anyRespondInFlight}
                onclick={() => handleMute(request)}
              >
                {$t('squad.joinRequests.mute')}
              </button>
              <button
                type="button"
                class="join-request-btn is-reject"
                disabled={anyRespondInFlight}
                onclick={() => handleReject(request)}
              >
                {$joinRequestRespondInFlight.has(request.eventId)
                  ? $t('squad.joinRequests.working')
                  : $t('squad.joinRequests.reject')}
              </button>
              <button
                type="button"
                class="join-request-btn is-accept"
                disabled={anyRespondInFlight}
                onclick={() => handleAccept(request)}
              >
                {$joinRequestRespondInFlight.has(request.eventId)
                  ? $t('squad.joinRequests.working')
                  : $t('squad.joinRequests.accept')}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="join-requests-footer">
    <RefreshIconButton
      disabled={syncing}
      spinning={syncing}
      ariaLabel={syncing ? $t('squad.joinRequests.refreshingAria') : $t('squad.joinRequests.refreshAria')}
      onclick={() => refresh()}
    />
  </div>
</section>

<style>
  .join-requests-panel {
    padding: 16px;
  }

  .join-requests-header {
    margin-bottom: 16px;
  }

  .join-requests-title {
    margin: 0 0 4px 0;
    font-size: 1.125rem;
    color: var(--text-primary);
  }

  .join-requests-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .join-request-card {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px;
    background: var(--bg-elevated);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .join-request-badge {
    display: inline-block;
    margin: 0 0 4px 0;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--brand) 18%, transparent);
    color: var(--brand);
    font-size: 0.75rem;
    font-weight: 500;
    width: fit-content;
  }

  .join-request-name {
    margin: 0;
    font-weight: 600;
    color: var(--text-primary);
  }

  .join-request-meta,
  .join-request-npub {
    margin: 2px 0 0 0;
    color: var(--text-muted);
    font-size: 0.8125rem;
  }

  .join-request-npub {
    font-family: monospace;
    word-break: break-all;
  }

  .join-request-actions {
    display: flex;
    gap: 8px;
  }

  .join-request-btn {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .join-request-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .join-request-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .join-request-btn.is-accept {
    background: var(--brand);
    border-color: var(--brand);
    color: var(--on-brand);
  }

  .join-request-btn.is-accept:hover:not(:disabled) {
    background: var(--brand-hover);
  }

  .join-request-btn.is-reject {
    color: var(--danger);
    border-color: var(--danger);
  }

  .join-request-btn.is-mute {
    color: var(--text-muted);
    border-style: dashed;
  }

  .join-requests-muted,
  .join-requests-error {
    margin: 8px 0;
    font-size: 0.875rem;
  }

  .join-requests-muted {
    color: var(--text-muted);
  }

  .join-requests-error {
    color: var(--danger);
  }

  .join-requests-footer {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
