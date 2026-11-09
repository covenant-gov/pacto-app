<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { profiles, loadProfile } from '../../stores/profiles';
  import { showToast } from '../../stores/toast';
  import { getProfileDisplayName } from '../../lib/utils/profile';
  import type { CommonsJoinRequestDto } from '../../lib/commons/types';
  import {
    clearJoinRequestRespondInFlight,
    isJoinRequestRespondInFlight,
    joinRequestRespondInFlight,
    markJoinRequestRespondInFlight,
    respondToMlsJoinRequest,
  } from '../../lib/squad/squad-join-mls';
  import { admitMemberToSquad, type AdmitMemberResult } from '../../lib/parent/admit-member';
  import { muteJoinRequester } from '../../lib/squad/squad-join-spam';
  import { getJoinInboxState, type JoinInboxState } from '../../lib/squad/join-inbox';
  import {
    ensureJoinRequestsHydrated,
    joinRequestsErrorBySquadId,
    joinRequestsHydratedBySquadId,
    joinRequestsSyncingBySquadId,
    pendingJoinRequestsBySquadId,
    removePendingJoinRequest,
    syncJoinRequestsForSquad,
  } from '../../stores/squad-join-requests';
  import {
    ensureOutboundInvitesHydrated,
    outboundInvitesErrorBySquadId,
    outboundInvitesHydratedBySquadId,
    outboundInvitesSyncingBySquadId,
    pendingOutboundInvitesBySquadId,
    removePendingOutboundInvite,
    syncOutboundInvitesForSquad,
  } from '../../stores/squad-outbound-invites';
  import {
    revokeOutboundInviteAnnounce,
    type PendingOutboundInviteDto,
  } from '../../lib/squad/squad-outbound-invite';
  import {
    enqueuePendingAdmit,
    listPendingAdmitForParent,
    pendingAdmitQueue,
    clearPendingAdmitForMember,
  } from '../../lib/parent/pending-admit';
  import type { Squad } from '../../stores/squads';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';

  let {
    squad,
    onInvite = () => {},
  }: {
    squad: Squad;
    onInvite?: () => void;
  } = $props();

  let refreshError = $state('');
  let profileLoadToken = 0;
  let inboxState = $state<JoinInboxState | null>(null);
  let inboxStateLoading = $state(true);
  let revokingInviteIds = $state(new Set<string>());

  const tFn = get(t);

  let anyRespondInFlight = $derived($joinRequestRespondInFlight.size > 0);
  let requests = $derived($pendingJoinRequestsBySquadId[squad.id] ?? []);
  let invites = $derived($pendingOutboundInvitesBySquadId[squad.id] ?? []);
  let requestsHydrated = $derived($joinRequestsHydratedBySquadId[squad.id] ?? false);
  let invitesHydrated = $derived($outboundInvitesHydratedBySquadId[squad.id] ?? false);
  let requestsSyncing = $derived($joinRequestsSyncingBySquadId[squad.id] ?? false);
  let invitesSyncing = $derived($outboundInvitesSyncingBySquadId[squad.id] ?? false);
  let syncing = $derived(requestsSyncing || invitesSyncing);
  let loadError = $derived(
    $joinRequestsErrorBySquadId[squad.id] ??
      $outboundInvitesErrorBySquadId[squad.id] ??
      refreshError
  );
  let loading = $derived(
    ((!requestsHydrated && requestsSyncing) || (!invitesHydrated && invitesSyncing) || inboxStateLoading) &&
      requests.length === 0 &&
      invites.length === 0
  );
  let canAct = $derived(!!(inboxState?.iAmHolder && inboxState?.hasLocalSecret));
  let admitting = $derived.by(() => {
    void $pendingAdmitQueue;
    return listPendingAdmitForParent(squad.id).filter((e) => e.kind === 'join' || e.kind === 'invite');
  });
  let isEmpty = $derived(requests.length === 0 && invites.length === 0 && admitting.length === 0);

  $effect(() => {
    if (squad?.id) {
      void ensureJoinRequestsHydrated(squad.id);
      void ensureOutboundInvitesHydrated(squad.id);
      void loadInboxState(squad.id);
    }
  });

  $effect(() => {
    if (requests.length === 0 && invites.length === 0 && admitting.length === 0) return;
    const token = ++profileLoadToken;
    const npubs = [
      ...new Set([
        ...requests.map((r) => r.requesterNpub),
        ...invites.map((i) => i.inviteeNpub),
        ...admitting.map((a) => a.memberNpub),
      ]),
    ];
    void Promise.all(npubs.map((npub) => loadProfile(npub))).then(() => {
      if (token !== profileLoadToken) return;
    });
  });

  async function loadInboxState(squadId: string) {
    inboxStateLoading = true;
    try {
      inboxState = await getJoinInboxState(squadId);
    } catch {
      inboxState = null;
    } finally {
      inboxStateLoading = false;
    }
  }

  async function refresh() {
    refreshError = '';
    try {
      await loadInboxState(squad.id);
      await Promise.all([syncJoinRequestsForSquad(squad.id), syncOutboundInvitesForSquad(squad.id)]);
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
    markJoinRequestRespondInFlight(request.eventId);
    try {
      const result = await respondToMlsJoinRequest({
        requestId: request.eventId,
        squadId: request.squadId,
        status: 'rejected',
        callerOwnsInFlight: true,
      });
      if (!result.ok) {
        if (result.error) showToast(result.error);
        return;
      }
      removePendingJoinRequest(squad.id, request.eventId);
      showToast(tFn('squad.joinRequests.rejectToast'));
    } finally {
      clearJoinRequestRespondInFlight(request.eventId);
    }
  }

  async function handleAccept(request: CommonsJoinRequestDto) {
    if (!canAct || anyRespondInFlight || isJoinRequestRespondInFlight(request.eventId)) return;

    markJoinRequestRespondInFlight(request.eventId);
    try {
      // Admit first so Welcome is in flight before the requester is told "accepted".
      enqueuePendingAdmit({
        kind: 'join',
        parentId: squad.id,
        memberNpub: request.requesterNpub,
        requestId: request.eventId,
      });

      let admitResult: AdmitMemberResult;
      try {
        admitResult = await admitMemberToSquad({
          parent: squad,
          memberNpub: request.requesterNpub,
        });
      } catch (e) {
        const lastError = e instanceof Error ? e.message : String(e);
        enqueuePendingAdmit({
          kind: 'join',
          parentId: squad.id,
          memberNpub: request.requesterNpub,
          requestId: request.eventId,
          lastError,
          lastAttemptAt: Date.now(),
        });
        admitResult = {
          ok: false,
          announcementsOk: false,
          openChannelsInvited: 0,
          error: lastError,
        };
      }

      if (admitResult.ok) {
        clearPendingAdmitForMember(squad.id, request.requesterNpub);
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

      const respondResult = await respondToMlsJoinRequest({
        requestId: request.eventId,
        squadId: request.squadId,
        status: 'accepted',
        callerOwnsInFlight: true,
      });
      if (!respondResult.ok) {
        if (respondResult.error) showToast(respondResult.error);
        return;
      }

      removePendingJoinRequest(squad.id, request.eventId);
      if (admitResult.ok) {
        const name =
          getProfileDisplayName($profiles[request.requesterNpub]) ||
          tFn('squad.joinRequests.memberFallback');
        showToast(tFn('squad.joinRequests.joinToast', { values: { name } }));
      } else {
        showToast(tFn('squad.joinRequests.approvedPendingToast'));
      }
    } finally {
      clearJoinRequestRespondInFlight(request.eventId);
    }
  }

  async function handleCancelInvite(invite: PendingOutboundInviteDto) {
    if (revokingInviteIds.has(invite.inviteId)) return;
    revokingInviteIds = new Set(revokingInviteIds).add(invite.inviteId);
    try {
      const ok = await revokeOutboundInviteAnnounce(squad, invite.inviteId, invite.inviteeNpub);
      if (!ok) {
        showToast(tFn('squad.pendingAccess.cancelFailed'));
        return;
      }
      removePendingOutboundInvite(squad.id, invite.inviteId);
      showToast(tFn('squad.pendingAccess.cancelToast'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : tFn('squad.pendingAccess.cancelFailed'));
    } finally {
      const next = new Set(revokingInviteIds);
      next.delete(invite.inviteId);
      revokingInviteIds = next;
    }
  }

  function personLabel(npub: string): string {
    return getProfileDisplayName($profiles[npub]) || npub.slice(0, 12) + '…';
  }

  function relativeCreated(createdAt: number): string {
    // Join-request createdAt is unix seconds; outbound invite `at` may be ms.
    const ms = createdAt > 1e12 ? createdAt : createdAt * 1000;
    const abs = Math.abs(ms - Date.now());
    const minutes = Math.floor(abs / 60000);
    if (minutes < 60) return tFn('squad.joinRequests.minutesAgo', { values: { minutes: Math.max(minutes, 1) } });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return tFn('squad.joinRequests.hoursAgo', { values: { hours } });
    return tFn('squad.joinRequests.daysAgo', { values: { days: Math.floor(hours / 24) } });
  }
</script>

<section class="access-invite-section" aria-labelledby="settings-access-invite-heading">
  <div class="access-invite-header">
    <h3 id="settings-access-invite-heading" class="section-heading">{$t('squad.pendingAccess.title')}</h3>
    <RefreshIconButton
      disabled={syncing}
      spinning={syncing}
      ariaLabel={syncing
        ? $t('squad.pendingAccess.refreshingAria')
        : $t('squad.pendingAccess.refreshAria')}
      onclick={() => refresh()}
    />
  </div>

  <button type="button" class="btn-primary" onclick={onInvite}>
    {$t('nav.parentSidebar.invite')}
  </button>

  <div class="pending-block" aria-labelledby="settings-access-pending-heading">
    <h4 id="settings-access-pending-heading" class="pending-heading">
      {$t('squad.pendingAccess.pendingHeading')}
    </h4>

    {#if !loading && !canAct && requests.length > 0}
      <p class="join-requests-muted">{$t('squad.pendingAccess.holdersOnlyHint')}</p>
    {/if}

    {#if loading}
      <p class="join-requests-muted" role="status">{$t('squad.pendingAccess.loading')}</p>
    {:else if loadError && isEmpty}
      <p class="join-requests-error" role="alert">{loadError}</p>
    {:else if isEmpty}
      <p class="join-requests-muted">{$t('squad.pendingAccess.empty')}</p>
    {:else}
      <ul class="join-requests-list" role="list">
        {#each admitting as entry (entry.memberNpub + (entry.requestId ?? entry.inviteId ?? ''))}
          <li class="join-request-card">
            <div class="join-request-main">
              <div class="badge-row">
                <p class="join-request-badge">{$t('squad.joinRequests.admittingBadge')}</p>
                <p class="status-pending">{$t('squad.pendingAccess.statusPending')}</p>
              </div>
              <p class="join-request-name">{personLabel(entry.memberNpub)}</p>
              <p class="join-request-meta">{$t('squad.joinRequests.admittingDetail')}</p>
              {#if entry.lastError}
                <p class="join-request-meta">
                  {$t('squad.joinRequests.admittingError', { values: { error: entry.lastError } })}
                </p>
              {/if}
            </div>
          </li>
        {/each}

        {#each requests as request (request.eventId)}
          <li class="join-request-card">
            <div class="join-request-main">
              <div class="badge-row">
                <p class="join-request-badge is-requested">{$t('squad.pendingAccess.kindRequested')}</p>
                <p class="status-pending">{$t('squad.pendingAccess.statusPending')}</p>
              </div>
              <p class="join-request-name">{personLabel(request.requesterNpub)}</p>
              <p class="join-request-meta">
                {$t('squad.joinRequests.requestedTime', {
                  values: { time: relativeCreated(request.createdAt) },
                })}
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

        {#each invites as invite (invite.inviteId)}
          <li class="join-request-card">
            <div class="join-request-main">
              <div class="badge-row">
                <p class="join-request-badge is-invited">{$t('squad.pendingAccess.kindInvited')}</p>
                <p class="status-pending">{$t('squad.pendingAccess.statusPending')}</p>
              </div>
              <p class="join-request-name">{personLabel(invite.inviteeNpub)}</p>
              <p class="join-request-meta">
                {$t('squad.pendingAccess.invitedTime', {
                  values: { time: relativeCreated(invite.createdAt) },
                })}
              </p>
              <p class="join-request-npub">{invite.inviteeNpub}</p>
            </div>
            <div class="join-request-actions">
              <button
                type="button"
                class="join-request-btn is-reject"
                disabled={revokingInviteIds.has(invite.inviteId)}
                onclick={() => handleCancelInvite(invite)}
              >
                {revokingInviteIds.has(invite.inviteId)
                  ? $t('squad.pendingAccess.cancelWorking')
                  : $t('squad.pendingAccess.cancel')}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .access-invite-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .access-invite-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  }

  .btn-primary {
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 0.875rem;
    font-family: inherit;
    background: var(--brand);
    color: var(--on-brand);
    border: none;
    cursor: pointer;
    align-self: flex-start;
  }

  .btn-primary:hover {
    filter: brightness(1.05);
  }

  .pending-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .pending-heading {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-secondary);
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

  .badge-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .join-request-badge {
    display: inline-block;
    margin: 0;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--brand) 18%, transparent);
    color: var(--brand);
    font-size: 0.75rem;
    font-weight: 500;
    width: fit-content;
  }

  .join-request-badge.is-invited {
    background: color-mix(in srgb, var(--text-secondary) 18%, transparent);
    color: var(--text-secondary);
  }

  .status-pending {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
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
    margin: 0;
    font-size: 0.875rem;
  }

  .join-requests-muted {
    color: var(--text-muted);
  }

  .join-requests-error {
    color: var(--danger);
  }
</style>
