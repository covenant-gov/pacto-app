/**
 * Late-joiner catch-up: sync request on #announcements; peers silently republish
 * roster EVM, known governance announces, squad network/RPC selection, and open channels.
 */

import { get, writable } from 'svelte/store';
import {
  getMlsGroupMembers,
  inviteMemberToGroup,
  sendDmMessage,
  syncMlsGroupsNow,
  formatChannelInSquadMessage,
} from '../api/nostr';
import {
  ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
  buildAnnounceContent,
  isAnnouncementsGovernanceProvider,
} from '../announcements';
import {
  listSquadInfra,
  squadInfraLegacyProvider,
} from '../governance/api';
import { currentUser } from '../../stores/auth';
import { publishSquadMemberEvmShare, getBoundSquadEvmAddressForParent } from './squad-member-evm-share';
import { publishSquadNetworkUpdated } from './squad-network-share';
import { publishSquadRpcUpdated } from './squad-rpc-share';
import { publishSquadChannelsCatalog } from './squad-channels-catalog';
import { publishSquadIdentityUpdated } from './squad-identity-announce';
import { openCustomChannelTargets } from '../parent/channel-access';
import { getAnnouncementsChannel } from '../parent-navbar';
import { dmWarn } from '../utils/dm-debug';
import { squads } from '../../stores/squads';

export const SQUAD_STATE_SYNC_REQUEST_TYPE = 'squad_state_sync_request';
export const SQUAD_STATE_SYNC_REQUEST_VERSION = 1;

/** Announcements group ids with a sync request currently publishing. */
export const squadStateSyncRequestInFlight = writable<Set<string>>(new Set());
export const squadStateSyncRequestInFlightRevision = writable(0);

export function resetSquadStateSyncRequestInFlight(): void {
  squadStateSyncRequestInFlight.set(new Set());
  squadStateSyncRequestInFlightRevision.set(0);
}

export function isSquadStateSyncInFlight(announcementsGroupId: string): boolean {
  const id = announcementsGroupId.trim();
  return id.length > 0 && get(squadStateSyncRequestInFlight).has(id);
}

function markSquadStateSyncInFlight(announcementsGroupId: string): void {
  const id = announcementsGroupId.trim();
  if (!id) return;
  squadStateSyncRequestInFlight.update((s) => {
    if (s.has(id)) return s;
    const next = new Set(s);
    next.add(id);
    return next;
  });
  squadStateSyncRequestInFlightRevision.update((n) => n + 1);
}

function clearSquadStateSyncInFlight(announcementsGroupId: string): void {
  const id = announcementsGroupId.trim();
  if (!id) return;
  let removed = false;
  squadStateSyncRequestInFlight.update((s) => {
    if (!s.has(id)) return s;
    removed = true;
    const next = new Set(s);
    next.delete(id);
    return next;
  });
  if (removed) squadStateSyncRequestInFlightRevision.update((n) => n + 1);
}

const RESPOND_COOLDOWN_MS = 15_000;
const RESPONDED_KEYS_CAP = 200;
/** Insertion-ordered keys for prune (Set iteration is insertion order). */
const respondedRequestKeys = new Set<string>();
const lastRespondAtByParent = new Map<string, number>();
/** Single-responder admit dedupe: request_id + channel + requester */
const channelAdmitKeys = new Set<string>();
const CHANNEL_ADMIT_CAP = 400;

export type SquadStateSyncRequestPayload = {
  parent_id: string;
  request_id: string;
  requester_npub: string;
  requested?: string[];
};

export function formatSquadStateSyncRequest(params: {
  parentId: string;
  requestId: string;
  requesterNpub: string;
}): string {
  return JSON.stringify({
    version: SQUAD_STATE_SYNC_REQUEST_VERSION,
    type: SQUAD_STATE_SYNC_REQUEST_TYPE,
    payload: {
      parent_id: params.parentId.trim(),
      request_id: params.requestId.trim(),
      requester_npub: params.requesterNpub.trim(),
      requested: ['evm', 'infra', 'network', 'rpc', 'channels', 'identity'],
    } satisfies SquadStateSyncRequestPayload,
    pacto_virtual_bucket: 'announcements',
  });
}

export function parseSquadStateSyncRequest(
  content: string | null | undefined,
): SquadStateSyncRequestPayload | null {
  if (!content || typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  if (root.type !== SQUAD_STATE_SYNC_REQUEST_TYPE) return null;
  const payload = root.payload;
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const parent_id = typeof p.parent_id === 'string' ? p.parent_id.trim() : '';
  const request_id = typeof p.request_id === 'string' ? p.request_id.trim() : '';
  const requester_npub = typeof p.requester_npub === 'string' ? p.requester_npub.trim() : '';
  if (!parent_id || !request_id || !requester_npub) return null;
  const requested = Array.isArray(p.requested)
    ? p.requested.filter((x): x is string => typeof x === 'string')
    : undefined;
  return { parent_id, request_id, requester_npub, requested };
}

/** Test helper: clear in-memory debounce state. */
export function resetSquadStateSyncRespondStateForTests(): void {
  respondedRequestKeys.clear();
  lastRespondAtByParent.clear();
  channelAdmitKeys.clear();
}

function pruneChannelAdmitKeys(): void {
  while (channelAdmitKeys.size > CHANNEL_ADMIT_CAP) {
    const oldest = channelAdmitKeys.values().next().value;
    if (oldest === undefined) break;
    channelAdmitKeys.delete(oldest);
  }
}

function autoRequestStorageKey(npub: string, announcementsGroupId: string): string {
  return `pacto_squad_state_sync_auto_v1_${npub.trim()}_${announcementsGroupId.trim()}`;
}

function pruneRespondedRequestKeys(): void {
  while (respondedRequestKeys.size > RESPONDED_KEYS_CAP) {
    const oldest = respondedRequestKeys.values().next().value;
    if (oldest === undefined) break;
    respondedRequestKeys.delete(oldest);
  }
}

function markResponded(respondKey: string, parentId: string): void {
  respondedRequestKeys.add(respondKey);
  pruneRespondedRequestKeys();
  lastRespondAtByParent.set(parentId, Date.now());
}

/**
 * Broadcast a sync request on #announcements so online peers republish roster EVM, infra, and network.
 */
export async function requestSquadStateSync(announcementsGroupId: string): Promise<boolean> {
  const gid = announcementsGroupId.trim();
  if (!gid) return false;
  if (isSquadStateSyncInFlight(gid)) return false;
  const me = get(currentUser)?.npub?.trim();
  if (!me) return false;
  markSquadStateSyncInFlight(gid);
  try {
    try {
      await syncMlsGroupsNow(gid);
    } catch {
      /* still attempt publish */
    }
    const requestId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const json = formatSquadStateSyncRequest({
      parentId: gid,
      requestId,
      requesterNpub: me,
    });
    try {
      await sendDmMessage(gid, json, '', { virtualBucket: 'announcements' });
      return true;
    } catch (e) {
      console.warn('[squad-state-sync] request publish failed', e);
      return false;
    }
  } finally {
    clearSquadStateSyncInFlight(gid);
  }
}

/** Once per browser session after joining announcements — joiner stays passive. */
export async function maybeAutoRequestSquadStateSyncAfterJoin(
  announcementsGroupId: string,
): Promise<void> {
  const gid = announcementsGroupId.trim();
  if (!gid) return;
  const me = get(currentUser)?.npub?.trim();
  if (!me) return;
  const storageKey = autoRequestStorageKey(me, gid);
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(storageKey)) {
      return;
    }
  } catch {
    /* private mode */
  }
  const ok = await requestSquadStateSync(gid);
  if (!ok) return;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(storageKey, '1');
    }
  } catch {
    /* ignore */
  }
}

/**
 * Peer response: republish this device's roster EVM, announcements-scoped infra, and network.
 * Fire-and-forget from MLS structured refresh; debounced per request / parent.
 */
export async function respondToSquadStateSyncRequest(
  content: string | null | undefined,
  groupId: string,
): Promise<void> {
  const req = parseSquadStateSyncRequest(content);
  if (!req) return;
  const gid = groupId.trim();
  if (!gid || req.parent_id !== gid) return;
  const me = get(currentUser)?.npub?.trim();
  if (!me) return;
  if (req.requester_npub === me) return;

  const parentId = req.parent_id;
  const respondKey = `${parentId}:${req.request_id}`;
  if (respondedRequestKeys.has(respondKey)) return;
  const last = lastRespondAtByParent.get(parentId) ?? 0;
  if (Date.now() - last < RESPOND_COOLDOWN_MS) return;

  const wantEvm = !req.requested?.length || req.requested.includes('evm');
  const wantInfra = !req.requested?.length || req.requested.includes('infra');
  const wantNetwork = !req.requested?.length || req.requested.includes('network');
  const wantRpc = !req.requested?.length || req.requested.includes('rpc');
  const wantChannels = !req.requested?.length || req.requested.includes('channels');

  const parent =
    get(squads).find((s) => s.id === parentId) ??
    get(squads).find((s) => getAnnouncementsChannel(s).groupId === parentId);

  let anyOk = false;

  if (wantEvm) {
    try {
      const bound = await getBoundSquadEvmAddressForParent(parentId);
      if (bound) {
        const ok = await publishSquadMemberEvmShare(parentId, { evmAddress: bound });
        if (ok) anyOk = true;
      }
      /* unbound: omit EVM; still help with infra/network/channels */
    } catch (e) {
      console.warn('[squad-state-sync] EVM republish failed', e);
    }
  }

  if (wantInfra) {
    try {
      const rows = await listSquadInfra(parentId);
      for (const row of rows) {
        const provider = squadInfraLegacyProvider(row.infraType);
        if (!isAnnouncementsGovernanceProvider(provider)) continue;
        const canonical = row.canonicalRef?.trim();
        if (!canonical) continue;
        const payload = {
          parent_id: parentId,
          provider,
          canonical_ref: canonical,
          chain: row.chain,
          entry_id: row.id,
          ...(row.providerPayload?.trim()
            ? { provider_payload: row.providerPayload }
            : {}),
          ...(row.pactoGovRevision?.trim()
            ? { pacto_gov_revision: row.pactoGovRevision }
            : {}),
        };
        await sendDmMessage(
          gid,
          buildAnnounceContent({
            type: ANNOUNCE_TYPE_GOVERNANCE_UPDATED,
            payload,
          }),
          '',
          { virtualBucket: 'announcements' },
        );
        anyOk = true;
      }
      // Infra requested but nothing to publish still counts as a handled attempt when list succeeded.
      if (!wantEvm && !wantNetwork && !wantRpc && !wantChannels && rows.length === 0) anyOk = true;
    } catch (e) {
      console.warn('[squad-state-sync] infra republish failed', e);
    }
  }

  if (wantNetwork) {
    try {
      const ok = await publishSquadNetworkUpdated(parentId);
      if (ok) anyOk = true;
    } catch (e) {
      console.warn('[squad-state-sync] network republish failed', e);
    }
  }

  if (wantRpc) {
    try {
      const ok = await publishSquadRpcUpdated(parentId);
      if (ok) anyOk = true;
    } catch (e) {
      dmWarn('[squad-state-sync] rpc republish failed', e);
    }
  }

  if (parent) {
    try {
      const ok = await publishSquadIdentityUpdated(parent);
      if (ok) anyOk = true;
    } catch (e) {
      console.warn('[squad-state-sync] identity republish failed', e);
    }
  }

  if (wantChannels) {
    if (parent) {
      try {
        const ok = await publishSquadChannelsCatalog(parent);
        if (ok) anyOk = true;
      } catch (e) {
        console.warn('[squad-state-sync] channels catalog republish failed', e);
      }

      const requester = req.requester_npub;
      for (const ch of openCustomChannelTargets(parent.channels)) {
        const admitKey = `${req.request_id}:${ch.groupId}:${requester}`;
        if (channelAdmitKeys.has(admitKey)) continue;
        try {
          const members = await getMlsGroupMembers(ch.groupId);
          if ((members.members ?? []).includes(requester)) {
            channelAdmitKeys.add(admitKey);
            pruneChannelAdmitKeys();
            anyOk = true;
            continue;
          }
          await inviteMemberToGroup(ch.groupId, requester);
          channelAdmitKeys.add(admitKey);
          pruneChannelAdmitKeys();
          const announcements = getAnnouncementsChannel(parent);
          try {
            await sendDmMessage(
              requester,
              formatChannelInSquadMessage({
                type: 'channel_in_squad',
                squadName: parent.name,
                announcementsGroupId: announcements.groupId,
                channelGroupId: ch.groupId,
                channelName: ch.name,
              }),
            );
          } catch (e) {
            console.warn('[squad-state-sync] channel notify failed', e);
          }
          anyOk = true;
        } catch (e) {
          console.warn('[squad-state-sync] open channel admit failed', ch.groupId.slice(0, 12), e);
        }
      }
    }
  }

  if (anyOk) {
    markResponded(respondKey, parentId);
  }
}
