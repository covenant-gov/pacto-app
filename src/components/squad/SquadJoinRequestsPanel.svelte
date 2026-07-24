<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { profiles, loadProfile } from '../../stores/profiles';
  import { showToast } from '../../stores/toast';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import type { CommonsJoinRequestDto } from '../../lib/commons/types';
  import { respondToMlsJoinRequest } from '../../lib/squad/squad-join-mls';
  import { muteJoinRequester } from '../../lib/squad/squad-join-spam';
  import {
    ensureJoinRequestsHydrated,
    joinRequestsErrorBySquadId,
    joinRequestsHydratedBySquadId,
    joinRequestsSyncingBySquadId,
    pendingJoinRequestsBySquadId,
    removePendingJoinRequest,
    syncJoinRequestsForSquad,
  } from '../../stores/squad-join-requests';
  import { runAdmitMembersToSquad } from '../../lib/parent/admit-member';
  import type { Squad } from '../../stores/squads';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';

  export let squad: Squad;

  let actingOn: string | null = null;
  let refreshError = '';
  let profileLoadToken = 0;

  const tFn = get(t);

  $: requests = $pendingJoinRequestsBySquadId[squad.id] ?? [];
  $: hydrated = $joinRequestsHydratedBySquadId[squad.id] ?? false;
  $: syncing = $joinRequestsSyncingBySquadId[squad.id] ?? false;
  $: loadError = $joinRequestsErrorBySquadId[squad.id] ?? refreshError;
  $: loading = !hydrated && syncing;

  $: if (squad?.id) {
    void ensureJoinRequestsHydrated(squad.id);
  }

  $: if (requests.length > 0) {
    const token = ++profileLoadToken;
    const npubs = [...new Set(requests.map((r) => r.requesterNpub))];
    void Promise.all(npubs.map((npub) => loadProfile(npub))).then(() => {
      if (token !== profileLoadToken) return;
    });
  }

  async function refresh() {
    refreshError = '';
    try {
      await syncJoinRequestsForSquad(squad.id);
    } catch (e) {
      refreshError = e instanceof Error ? e.message : tFn('squad.joinRequests.loadError');
    }
  }

  async function handleMute(request: CommonsJoinRequestDto) {
    muteJoinRequester(squad.id, request.requesterNpub);
    removePendingJoinRequest(squad.id, request.eventId);
    showToast(tFn('squad.joinRequests.muteToast'));
  }

  async function handleReject(request: CommonsJoinRequestDto) {
    if (actingOn) return;
    actingOn = request.eventId;
    const result = await respondToMlsJoinRequest({
      requestId: request.eventId,
      squadId: request.squadId,
      status: 'rejected',
    });
    actingOn = null;
    if (!result.ok) {
      showToast(result.error);
      return;
    }
    removePendingJoinRequest(squad.id, request.eventId);
    showToast(tFn('squad.joinRequests.rejectToast'));
  }

  async function handleAccept(request: CommonsJoinRequestDto) {
    if (actingOn) return;
    actingOn = request.eventId;
    const respondResult = await respondToMlsJoinRequest({
      requestId: request.eventId,
      squadId: request.squadId,
      status: 'accepted',
    });
    if (!respondResult.ok) {
      actingOn = null;
      showToast(respondResult.error);
      return;
    }

    runAdmitMembersToSquad({
      parent: squad,
      npubs: [request.requesterNpub],
      onErrorBanner: (message) => showToast(message),
      onComplete: (admittedNpubs) => {
        actingOn = null;
        if (!admittedNpubs.includes(request.requesterNpub)) return;
        removePendingJoinRequest(squad.id, request.eventId);
        const name = getProfileDisplayName($profiles[request.requesterNpub]) || tFn('squad.joinRequests.memberFallback');
        showToast(tFn('squad.joinRequests.joinToast', { values: { name } }));
      },
    });
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
    <p class="join-requests-lead">
      {$t('squad.joinRequests.lead', { values: { squadName: squad.name } })}
    </p>
  </header>

  {#if loading}
    <p class="join-requests-muted" role="status">{$t('squad.joinRequests.loading')}</p>
  {:else if loadError}
    <p class="join-requests-error" role="alert">{loadError}</p>
  {:else if requests.length === 0}
    <p class="join-requests-muted">{$t('squad.joinRequests.empty')}</p>
  {:else}
    <ul class="join-requests-list" role="list">
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
          <div class="join-request-actions">
            <button
              type="button"
              class="join-request-btn is-mute"
              disabled={!!actingOn}
              on:click={() => handleMute(request)}
            >
              {$t('squad.joinRequests.mute')}
            </button>
            <button
              type="button"
              class="join-request-btn is-reject"
              disabled={!!actingOn}
              on:click={() => handleReject(request)}
            >
              {actingOn === request.eventId ? $t('squad.joinRequests.working') : $t('squad.joinRequests.reject')}
            </button>
            <button
              type="button"
              class="join-request-btn is-accept"
              disabled={!!actingOn}
              on:click={() => handleAccept(request)}
            >
              {actingOn === request.eventId ? $t('squad.joinRequests.working') : $t('squad.joinRequests.accept')}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="join-requests-footer">
    <RefreshIconButton
      disabled={syncing}
      spinning={syncing}
      ariaLabel={syncing ? $t('squad.joinRequests.refreshingAria') : $t('squad.joinRequests.refreshAria')}
      on:click={() => refresh()}
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

  .join-requests-lead {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.875rem;
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
    background: var(--accent-subtle);
    color: var(--accent);
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
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .join-request-btn.is-accept:hover:not(:disabled) {
    background: var(--accent-hover);
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
