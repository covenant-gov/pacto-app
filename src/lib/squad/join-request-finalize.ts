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
import { parseBotJoinResponseDm } from './squad-join-mls';
import { dmError } from '../utils/dm-debug';
import { showToast } from '../../stores/toast';
import { get as getI18n, t } from 'svelte-i18n';

const completingGroupIds = new Set<string>();

/** Approved joins waiting for MLS Welcome. */
export const pendingApprovedJoins = writable<
  Array<{ groupId: string; squadName: string; requestId: string; at: number }>
>([]);

function msg(key: string, values?: Record<string, unknown>): string {
  try {
    const translate = getI18n(t);
    return values ? translate(key, { values }) : translate(key);
  } catch {
    return key;
  }
}

function rememberApprovedJoin(groupId: string, squadName: string, requestId: string): void {
  const id = groupId.trim().toLowerCase();
  pendingApprovedJoins.update((rows) => {
    if (rows.some((r) => r.groupId.trim().toLowerCase() === id)) return rows;
    return [{ groupId, squadName, requestId, at: Date.now() }, ...rows].slice(0, 50);
  });
}

function forgetApprovedJoin(groupId: string): void {
  const id = groupId.trim().toLowerCase();
  pendingApprovedJoins.update((rows) => rows.filter((r) => r.groupId.trim().toLowerCase() !== id));
}

/** Handle inbound bot_join_response DM for the requester. */
export async function handleBotJoinResponseDm(content: string | null | undefined): Promise<void> {
  const parsed = parseBotJoinResponseDm(content);
  if (!parsed || parsed.status !== 'accepted') return;
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
      showToast(msg('messaging.inviteCard.joinApprovedPendingToast'));
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
