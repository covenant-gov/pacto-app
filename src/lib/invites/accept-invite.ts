import { get, writable } from 'svelte/store';
import {
  listPendingMlsWelcomes,
  acceptMlsWelcome,
  parseSquadInviteMessage,
  syncMlsGroupsNow,
  type PendingMlsWelcome,
} from '../api/nostr';
import { defaultChannelRowsForGroupId } from '../parent-navbar';
import { backendDmMessages } from '../../stores/dm';
import { normalizeStoredSquad } from '../squad-pair';
import { persistSquad, persistSquadPatch } from '../squad/squad-catalog';
import { appendSquadNavId } from '../squad/squad-nav-order';
import { dmError } from '../utils/dm-debug';
import { getInvokeErrorMessage } from '../utils/tauri-errors';
import {
  squads,
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  activeTopNavTab,
  activeView,
  acceptedSquadInviteIds,
  acceptedChannelInviteMessageIds,
  bumpMembershipVersion,
  ANNOUNCEMENTS_CHANNEL_NAME,
  squadNavOrder,
  type DmMessage,
  type Squad,
} from '../../stores/app';
import { pendingReadyToast, showToast } from '../../stores/toast';
import { maybeAutoRequestSquadStateSyncAfterJoin } from '../squad/squad-state-sync';
import { publishInviteAcceptedClaims } from '../squad/squad-outbound-invite';
import { requireBackupVerified } from '../../stores/backup-verification';
import { currentUser } from '../../stores/auth';
import { markMlsHistoryWelcome } from '../../stores/mls-history-welcome';
import { resolveOneCatchUpEntry } from '../../stores/catch-up';
import {
  clearPendingSquadAdmissionByGroupId,
  getPendingSquadAdmissionByGroupId,
  pendingSquadAdmissions,
  upsertPendingSquadAdmission,
} from '../../stores/pending-squad-admission';
import { t } from 'svelte-i18n';

function tt(
  key: string,
  values?: Record<string, string | number | boolean | Date | null | undefined>
): string {
  try {
    const translate = get(t);
    return values ? translate(key, { values }) : translate(key);
  } catch {
    return key;
  }
}

/** Group IDs whose welcome we accepted ourselves, so the accept handler can skip them. */
const acceptedSquadInviteGroupIds = new Set<string>();

/** Maps channel group id → parent squad while welcome accept is in flight. */
const channelInvitePendingAccept = new Map<string, { parentId: string; channelName: string }>();

/** In-flight consent-first Accept waiters keyed by announcements group id (lowercase). */
const pendingWelcomeWaiters = new Map<string, Set<() => void>>();

export const ACCEPT_WELCOME_POLL_MS = 400;
/** Short opportunistic wait after claims; never a hard failure gate. */
export const ACCEPT_WELCOME_FAST_PATH_MS = 5_000;
/** @deprecated Prefer ACCEPT_WELCOME_FAST_PATH_MS; kept for tests that still import the name. */
export const ACCEPT_WELCOME_DEADLINE_MS = ACCEPT_WELCOME_FAST_PATH_MS;

export const acceptingSquadInviteId = writable<string | null>(null);
export const acceptingChannelInSquadId = writable<string | null>(null);

export function resetInviteAcceptState(): void {
  acceptedSquadInviteGroupIds.clear();
  channelInvitePendingAccept.clear();
  pendingWelcomeWaiters.clear();
  acceptingSquadInviteId.set(null);
  acceptingChannelInSquadId.set(null);
}

export function squadInviteResolvedByMembership(groupId: string): boolean {
  const target = groupId.trim().toLowerCase();
  return get(squads).some((s) => s.id.trim().toLowerCase() === target);
}

export function sameMlsGroupId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function findPendingWelcomeForGroup(
  welcomes: PendingMlsWelcome[],
  groupId: string
): PendingMlsWelcome | undefined {
  return welcomes.find((w) => sameMlsGroupId(w.nostr_group_id, groupId));
}

/** Light probe: list pending welcomes only (no all-groups sync). */
export async function listPendingWelcomeForGroup(
  groupId: string
): Promise<PendingMlsWelcome | undefined> {
  const welcomes = await listPendingMlsWelcomes();
  return findPendingWelcomeForGroup(welcomes, groupId);
}

/**
 * First Accept attempt only: optional one-group sync, then list.
 * Poll / event wake use {@link listPendingWelcomeForGroup} instead.
 */
async function resolvePendingWelcomeForGroupInitial(
  groupId: string
): Promise<PendingMlsWelcome | undefined> {
  try {
    await syncMlsGroupsNow(groupId);
  } catch (e) {
    dmError('syncMlsGroupsNow before accept invite', e);
  }
  return listPendingWelcomeForGroup(groupId);
}

function registerWelcomeWaiter(groupId: string, wake: () => void): () => void {
  const key = groupId.trim().toLowerCase();
  let set = pendingWelcomeWaiters.get(key);
  if (!set) {
    set = new Set();
    pendingWelcomeWaiters.set(key, set);
  }
  set.add(wake);
  return () => {
    set!.delete(wake);
    if (set!.size === 0) pendingWelcomeWaiters.delete(key);
  };
}

/** Called when MLS emits a new invite/welcome — nudge in-flight Accept polls + pending admissions. */
export function notifyPendingInviteWelcome(groupId?: string | null): void {
  if (groupId?.trim()) {
    const set = pendingWelcomeWaiters.get(groupId.trim().toLowerCase());
    if (set) {
      for (const wake of [...set]) wake();
    }
    void tryCompletePendingSquadAdmission(groupId).catch((e) =>
      dmError('tryCompletePendingSquadAdmission', e)
    );
    return;
  }
  for (const set of pendingWelcomeWaiters.values()) {
    for (const wake of [...set]) wake();
  }
  void tryCompleteAllPendingSquadAdmissions();
}

/** Complete a durable pending admission when a Welcome is available. */
export async function tryCompletePendingSquadAdmission(groupId: string): Promise<boolean> {
  const pending = getPendingSquadAdmissionByGroupId(groupId);
  if (!pending) return false;
  if (squadInviteResolvedByMembership(groupId)) {
    clearPendingSquadAdmissionByGroupId(groupId);
    acceptedSquadInviteIds.update((ids: string[]) =>
      ids.includes(pending.messageId) ? ids : [...ids, pending.messageId]
    );
    return true;
  }
  const welcome = await listPendingWelcomeForGroup(groupId);
  if (!welcome) return false;
  acceptedSquadInviteGroupIds.add(groupId);
  await acceptMlsWelcome(welcome.id);
  await finalizeSquadAfterAnnouncementsWelcome(
    { groupId, name: pending.squadName, iconUrl: pending.iconUrl },
    pending.messageId
  );
  clearPendingSquadAdmissionByGroupId(groupId);
  resolveOneCatchUpEntry(pending.messageId).catch(() => {});
  return true;
}

export async function tryCompleteAllPendingSquadAdmissions(): Promise<void> {
  for (const row of get(pendingSquadAdmissions)) {
    try {
      await tryCompletePendingSquadAdmission(row.groupId);
    } catch (e) {
      dmError('tryCompletePendingSquadAdmission', e);
    }
  }
}

/**
 * Check membership / pending welcome first, then sleep (event-wake or backoff).
 * Shared by consent-first Accept after claim DMs are sent.
 */
export async function waitForAnnouncementsWelcome(
  groupId: string,
  deadlineMs: number = ACCEPT_WELCOME_DEADLINE_MS
): Promise<PendingMlsWelcome | 'already_member' | null> {
  const deadline = Date.now() + deadlineMs;

  while (Date.now() < deadline) {
    if (squadInviteResolvedByMembership(groupId)) return 'already_member';
    const welcome = await listPendingWelcomeForGroup(groupId);
    if (welcome) return welcome;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const waitMs = Math.min(ACCEPT_WELCOME_POLL_MS, remaining);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unregister();
        resolve();
      };
      const unregister = registerWelcomeWaiter(groupId, finish);
      const timer = setTimeout(finish, waitMs);
    });
  }

  if (squadInviteResolvedByMembership(groupId)) return 'already_member';
  return (await listPendingWelcomeForGroup(groupId)) ?? null;
}

export function channelInSquadInviteResolvedByMembership(
  announcementsGroupId: string,
  channelGroupId: string
): boolean {
  const squad = get(squads).find((s) => s.id === announcementsGroupId);
  return squad?.channels.some((ch) => ch.groupId === channelGroupId) ?? false;
}

/** Persist accepted state for DM invites whose squad/channel is already local. */
export function reconcileStaleInviteDecisions(): void {
  const squadMessageIds: string[] = [];
  for (const messages of Object.values(get(backendDmMessages))) {
    for (const msg of messages) {
      const payload = parseSquadInviteMessage(msg.content ?? '');
      if (payload && squadInviteResolvedByMembership(payload.groupId)) {
        squadMessageIds.push(msg.id);
      }
    }
  }
  if (squadMessageIds.length === 0) return;
  acceptedSquadInviteIds.update((ids) => {
    const next = new Set(ids);
    for (const id of squadMessageIds) next.add(id);
    return [...next];
  });
}

function addChannelToParent(
  parentId: string,
  channelGroupId: string,
  channelName: string,
  access?: 'open' | 'closed'
): void {
  markMlsHistoryWelcome(channelGroupId);
  void persistSquadPatch(parentId, (squad) => {
    if (squad.channels.some((ch) => ch.groupId === channelGroupId)) return squad;
    return {
      ...squad,
      channels: [
        ...squad.channels,
        {
          name: channelName,
          groupId: channelGroupId,
          order: squad.channels.length,
          ...(access ? { access } : {}),
        },
      ],
    };
  });
}

export interface AnnouncementsInvitePayload {
  groupId: string;
  name: string;
  memberSquads?: { id: string; name: string }[];
  iconUrl?: string;
}

export async function acceptAnnouncementsInvite(
  payload: AnnouncementsInvitePayload,
  messageId: string,
  inviteMeta?: { inviteId?: string; admitterNpubs?: string[]; invitedByNpub?: string }
): Promise<void> {
  if (squadInviteResolvedByMembership(payload.groupId)) {
    acceptedSquadInviteIds.update((ids: string[]) =>
      ids.includes(messageId) ? ids : [...ids, messageId]
    );
    return;
  }
  if (!requireBackupVerified()) return;

  const welcome = await resolvePendingWelcomeForGroupInitial(payload.groupId);
  if (welcome) {
    acceptedSquadInviteGroupIds.add(payload.groupId);
    await acceptMlsWelcome(welcome.id);
    await finalizeSquadAfterAnnouncementsWelcome(payload, messageId);
    return;
  }

  // Consent-first: no welcome yet — claim to admitters and durably pend admission.
  const me = get(currentUser)?.npub?.trim();
  if (!me) throw new Error('Not signed in');

  const admitters = [
    ...new Set(
      [
        ...(inviteMeta?.admitterNpubs ?? []),
        inviteMeta?.invitedByNpub,
      ].filter((n): n is string => typeof n === 'string' && n.startsWith('npub1'))
    ),
  ];
  const inviteId = inviteMeta?.inviteId?.trim();
  if (!inviteId) {
    throw new Error(tt('messaging.inviteCard.invalidInvite'));
  }

  if (admitters.length === 0) {
    throw new Error(tt('messaging.inviteCard.noAdmitters'));
  }

  upsertPendingSquadAdmission({
    messageId,
    groupId: payload.groupId,
    squadName: payload.name,
    inviteId,
    acceptedAt: Date.now(),
    iconUrl: payload.iconUrl,
  });

  showToast(tt('messaging.inviteCard.acceptanceSentToast'));
  await publishInviteAcceptedClaims({
    parentId: payload.groupId,
    inviteId,
    inviteeNpub: me,
    squadName: payload.name,
    admitterNpubs: admitters,
  });

  const waited = await waitForAnnouncementsWelcome(payload.groupId, ACCEPT_WELCOME_FAST_PATH_MS);
  if (waited === 'already_member') {
    clearPendingSquadAdmissionByGroupId(payload.groupId);
    acceptedSquadInviteIds.update((ids: string[]) =>
      ids.includes(messageId) ? ids : [...ids, messageId]
    );
    void maybeAutoRequestSquadStateSyncAfterJoin(payload.groupId);
    return;
  }
  if (waited) {
    clearPendingSquadAdmissionByGroupId(payload.groupId);
    acceptedSquadInviteGroupIds.add(payload.groupId);
    await acceptMlsWelcome(waited.id);
    await finalizeSquadAfterAnnouncementsWelcome(payload, messageId);
  }
  // No welcome yet — card stays in joining state until an admitter completes MLS Add.
}

export async function finalizeSquadAfterAnnouncementsWelcome(
  payload: AnnouncementsInvitePayload,
  /** DM invite message id, or null when a bare MLS welcome drove the join. */
  messageId: string | null
): Promise<void> {
  clearPendingSquadAdmissionByGroupId(payload.groupId);
  const now = Date.now();
  const defaultChannels = defaultChannelRowsForGroupId(payload.groupId);
  const isSquadPair = (payload.memberSquads?.length ?? 0) > 0;
  const newSquad: Squad = isSquadPair
    ? (normalizeStoredSquad({
        id: payload.groupId,
        name: payload.name,
        iconUrl: payload.iconUrl,
        channels: defaultChannels,
        kind: 'squad-pair',
        pairedSquads: payload.memberSquads,
        createdAt: now,
        updatedAt: now,
      }) as Squad)
    : {
        id: payload.groupId,
        name: payload.name,
        iconUrl: payload.iconUrl,
        channels: defaultChannels,
        kind: 'squad',
        createdAt: now,
        updatedAt: now,
      };
  squads.update((list: Squad[]) =>
    isSquadPair
      ? [...list.filter((s) => s.id !== newSquad.id), newSquad]
      : [...list, newSquad]
  );
  try {
    await persistSquad(newSquad);
    squadNavOrder.update((order) => appendSquadNavId(order, newSquad.id));
  } catch (e) {
    dmError('persistSquad after accept invite', e);
    squads.update((list: Squad[]) => list.filter((s) => s.id !== newSquad.id));
    throw e;
  }
  activeSquadId.set(newSquad.id);
  activeChannelId.set(payload.groupId);
  activeHubChannelName.set(ANNOUNCEMENTS_CHANNEL_NAME);
  activeTopNavTab.set('squads');
  activeView.set('hub');
  if (messageId !== null) {
    acceptedSquadInviteIds.update((ids: string[]) =>
      ids.includes(messageId) ? ids : [...ids, messageId]
    );
  }
  markMlsHistoryWelcome(payload.groupId);
  void syncMlsGroupsNow(payload.groupId).catch((e) =>
    dmError('syncMlsGroupsNow after accept invite', e)
  );
  bumpMembershipVersion(payload.groupId);
  void maybeAutoRequestSquadStateSyncAfterJoin(payload.groupId);
  pendingReadyToast.set({
    text: tt('messaging.inviteCard.squadReadyToast', { name: payload.name }),
    goTo: {
      type: 'squad',
      name: payload.name,
      id: payload.groupId,
      channelId: payload.groupId,
    },
  });
}

export async function acceptSquadOrPairInvite(msg: DmMessage): Promise<void> {
  const payload = parseSquadInviteMessage(msg.content);
  if (!payload) return;
  if (get(acceptingSquadInviteId)) return;
  if (!requireBackupVerified()) return;
  acceptingSquadInviteId.set(msg.id);
  try {
    await acceptAnnouncementsInvite(
      {
        groupId: payload.groupId,
        name: payload.squadName,
        memberSquads:
          payload.kind === 'squad-pair' && payload.pairedSquads
            ? [...payload.pairedSquads]
            : undefined,
        iconUrl: payload.iconUrl,
      },
      msg.id,
      {
        inviteId: payload.inviteId,
        admitterNpubs: payload.admitterNpubs,
        invitedByNpub: payload.invitedByNpub,
      }
    );
    resolveOneCatchUpEntry(msg.id).catch(() => {});
  } catch (e) {
    const payload = parseSquadInviteMessage(msg.content);
    if (
      payload &&
      squadInviteResolvedByMembership(payload.groupId) &&
      (e as Error & { noWelcome?: boolean }).noWelcome
    ) {
      acceptedSquadInviteIds.update((ids: string[]) =>
        ids.includes(msg.id) ? ids : [...ids, msg.id]
      );
      resolveOneCatchUpEntry(msg.id).catch(() => {});
      return;
    }
    dmError('Accept squad invite failed', e);
    showToast(getInvokeErrorMessage(e, tt('messaging.inviteCard.acceptFailed')));
  } finally {
    acceptingSquadInviteId.set(null);
  }
}

export interface ChannelInSquadInvitePayload {
  channelGroupId: string;
  announcementsGroupId: string;
  channelName: string;
}

export async function acceptChannelInSquadInvite(
  msg: DmMessage,
  payload: ChannelInSquadInvitePayload
): Promise<void> {
  if (get(acceptingChannelInSquadId)) return;
  if (
    channelInSquadInviteResolvedByMembership(
      payload.announcementsGroupId,
      payload.channelGroupId
    )
  ) {
    acceptedChannelInviteMessageIds.update((ids: string[]) =>
      ids.includes(msg.id) ? ids : [...ids, msg.id]
    );
    resolveOneCatchUpEntry(msg.id).catch(() => {});
    return;
  }
  if (!requireBackupVerified()) return;
  acceptingChannelInSquadId.set(msg.id);
  try {
    const welcomes = await listPendingMlsWelcomes();
    const welcome = welcomes.find((w) => w.nostr_group_id === payload.channelGroupId);
    if (!welcome) {
      dmError('Accept channel in squad: no pending welcome for channel', payload.channelGroupId);
      return;
    }
    channelInvitePendingAccept.set(payload.channelGroupId, {
      parentId: payload.announcementsGroupId,
      channelName: payload.channelName,
    });
    acceptedSquadInviteGroupIds.add(payload.channelGroupId);
    await acceptMlsWelcome(welcome.id);
    markMlsHistoryWelcome(payload.channelGroupId);
    acceptedChannelInviteMessageIds.update((ids: string[]) =>
      ids.includes(msg.id) ? ids : [...ids, msg.id]
    );
    resolveOneCatchUpEntry(msg.id).catch(() => {});
  } catch (e) {
    dmError('Accept channel invite failed', e);
    channelInvitePendingAccept.delete(payload.channelGroupId);
    acceptedSquadInviteGroupIds.delete(payload.channelGroupId);
  } finally {
    acceptingChannelInSquadId.set(null);
  }
}

/** After backend confirms MLS welcome accept — attach channel or ignore unattributed welcomes. */
export function handleMlsWelcomeAccepted(group_id: string): void {
  const channelInviteInfo = channelInvitePendingAccept.get(group_id);
  if (channelInviteInfo) {
    channelInvitePendingAccept.delete(group_id);
    acceptedSquadInviteGroupIds.delete(group_id);
    addChannelToParent(channelInviteInfo.parentId, group_id, channelInviteInfo.channelName);
    return;
  }
  if (acceptedSquadInviteGroupIds.has(group_id)) {
    acceptedSquadInviteGroupIds.delete(group_id);
    return;
  }
}

export function handleChannelAddedToSquad(
  announcements_group_id: string,
  channel_group_id: string,
  channel_name: string
): void {
  addChannelToParent(announcements_group_id, channel_group_id, channel_name);
}
