/**
 * Requester-side auto-finalize after Commons join is approved (no second Accept card).
 */

import { get, writable } from 'svelte/store';
import { acceptMlsWelcome, listPendingMlsWelcomes, syncMlsGroupsNow } from '../api/nostr';
import {
  finalizeSquadAfterAnnouncementsWelcome,
  listPendingWelcomeForGroup,
  sameMlsGroupId,
  squadInviteResolvedByMembership,
} from '../invites/accept-invite';
import { parseJoinInboxResponseDm } from './squad-join-mls';
import { dmError } from '../utils/dm-debug';
import { showToast } from '../../stores/toast';
import { t } from 'svelte-i18n';
import { getJoinRequestRecord } from '../commons/commons-join-request';
import { persistenceKey } from '../../stores/persistence-context';

const completingGroupIds = new Set<string>();
export const PENDING_APPROVED_JOINS_PREFIX = 'pacto_pending_approved_joins';

type PendingApprovedJoin = {
  groupId: string;
  squadName: string;
  requestId: string;
  at: number;
};

/** Approved joins waiting for MLS Welcome. */
export const pendingApprovedJoins = writable<PendingApprovedJoin[]>([]);

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

function writeDisk(rows: PendingApprovedJoin[]): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PENDING_APPROVED_JOINS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(rows.slice(0, 50)));
  } catch {
    // ignore quota
  }
}

function setRows(rows: PendingApprovedJoin[]): void {
  pendingApprovedJoins.set(rows);
  writeDisk(rows);
}

export function loadPendingApprovedJoins(): void {
  if (typeof localStorage === 'undefined') {
    pendingApprovedJoins.set([]);
    return;
  }
  const key = persistenceKey(PENDING_APPROVED_JOINS_PREFIX);
  if (!key) {
    pendingApprovedJoins.set([]);
    return;
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    const rows = Array.isArray(parsed)
      ? parsed.filter((row): row is PendingApprovedJoin => {
          if (!row || typeof row !== 'object') return false;
          const candidate = row as PendingApprovedJoin;
          return (
            typeof candidate.groupId === 'string' &&
            typeof candidate.squadName === 'string' &&
            typeof candidate.requestId === 'string' &&
            typeof candidate.at === 'number'
          );
        })
      : [];
    pendingApprovedJoins.set(rows.slice(0, 50));
  } catch {
    pendingApprovedJoins.set([]);
  }
}

function rememberApprovedJoin(groupId: string, squadName: string, requestId: string): void {
  const id = groupId.trim().toLowerCase();
  const rows = get(pendingApprovedJoins);
  if (rows.some((r) => r.groupId.trim().toLowerCase() === id)) return;
  setRows([{ groupId, squadName, requestId, at: Date.now() }, ...rows].slice(0, 50));
}

function forgetApprovedJoin(groupId: string): void {
  const id = groupId.trim().toLowerCase();
  setRows(get(pendingApprovedJoins).filter((r) => r.groupId.trim().toLowerCase() !== id));
}

/** Handle inbound Join inbox response DM for the requester. */
export async function handleJoinInboxResponseDm(
  content: string | null | undefined,
  senderNpub: string
): Promise<void> {
  const parsed = parseJoinInboxResponseDm(content);
  if (!parsed || parsed.status !== 'accepted') return;
  const request = getJoinRequestRecord(parsed.squadId);
  if (
    !request ||
    request.requestId !== parsed.requestId ||
    request.inboxNpub.trim() !== senderNpub.trim()
  ) {
    return;
  }
  rememberApprovedJoin(parsed.squadId, parsed.squadName, parsed.requestId);
  await completeApprovedJoin(parsed.squadId, parsed.squadName, parsed.requestId);
}

/** Called when any MLS welcome arrives — finish approved Commons joins. */
export async function tryCompletePendingApprovedJoins(groupId?: string | null): Promise<void> {
  const rows = get(pendingApprovedJoins);
  const targets = groupId?.trim()
    ? rows.filter((r) => sameMlsGroupId(r.groupId, groupId))
    : rows;
  for (const row of targets) {
    await completeApprovedJoin(row.groupId, row.squadName, row.requestId);
  }
}

export async function completeApprovedJoin(
  squadId: string,
  squadName: string,
  requestId: string
): Promise<void> {
  const groupId = squadId.trim();
  if (!groupId) return;
  if (squadInviteResolvedByMembership(groupId)) {
    forgetApprovedJoin(groupId);
    return;
  }
  if (completingGroupIds.has(groupId.toLowerCase())) return;
  completingGroupIds.add(groupId.toLowerCase());
  try {
    try {
      await syncMlsGroupsNow(groupId);
    } catch (e) {
      dmError('syncMlsGroupsNow after join approved', e);
    }

    let welcome = await listPendingWelcomeForGroup(groupId);
    if (!welcome) {
      const all = await listPendingMlsWelcomes();
      welcome = all.find((w) => sameMlsGroupId(w.nostr_group_id, groupId));
    }
    if (!welcome) {
      showToast(tt('messaging.inviteCard.joinApprovedPendingToast'));
      return;
    }

    await acceptMlsWelcome(welcome.id);
    await finalizeSquadAfterAnnouncementsWelcome(
      { groupId, name: squadName || groupId },
      `join-${requestId}`
    );
    forgetApprovedJoin(groupId);
  } catch (e) {
    dmError('completeApprovedJoin', e);
  } finally {
    completingGroupIds.delete(groupId.toLowerCase());
  }
}

export function resetPendingApprovedJoins(): void {
  pendingApprovedJoins.set([]);
  completingGroupIds.clear();
}
