/**
 * Wanted open-channel joins from catalog: join list, not sidebar membership.
 */

import { get, writable } from 'svelte/store';
import { persistenceKey } from '../../stores/persistence-context';
import type { ChannelAccess } from '../parent/channel-access';
import { sameMlsGroupId } from '../invites/declined-welcomes';

export const PENDING_OPEN_CHANNEL_JOINS_PREFIX = 'pacto_pending_open_channel_joins';
const MAX_ROWS = 50;
export const PENDING_OPEN_CHANNEL_JOIN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type PendingOpenChannelJoin = {
  parentId: string;
  groupId: string;
  name: string;
  access: ChannelAccess;
  at: number;
};

export const pendingOpenChannelJoins = writable<PendingOpenChannelJoin[]>([]);

function writeDisk(rows: PendingOpenChannelJoin[]): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PENDING_OPEN_CHANNEL_JOINS_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(rows.slice(0, MAX_ROWS)));
  } catch {
    // ignore quota
  }
}

function setRows(rows: PendingOpenChannelJoin[]): void {
  pendingOpenChannelJoins.set(rows);
  writeDisk(rows);
}

function isJoinRow(row: unknown): row is PendingOpenChannelJoin {
  if (!row || typeof row !== 'object') return false;
  const candidate = row as PendingOpenChannelJoin;
  return (
    typeof candidate.parentId === 'string' &&
    typeof candidate.groupId === 'string' &&
    typeof candidate.name === 'string' &&
    (candidate.access === 'open' || candidate.access === 'closed') &&
    typeof candidate.at === 'number'
  );
}

export function loadPendingOpenChannelJoins(): void {
  if (typeof localStorage === 'undefined') {
    pendingOpenChannelJoins.set([]);
    return;
  }
  const key = persistenceKey(PENDING_OPEN_CHANNEL_JOINS_PREFIX);
  if (!key) {
    pendingOpenChannelJoins.set([]);
    return;
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    const rows = Array.isArray(parsed) ? parsed.filter(isJoinRow) : [];
    const cutoff = Date.now() - PENDING_OPEN_CHANNEL_JOIN_TTL_MS;
    pendingOpenChannelJoins.set(rows.filter((row) => row.at >= cutoff).slice(0, MAX_ROWS));
  } catch {
    pendingOpenChannelJoins.set([]);
  }
}

export function upsertPendingOpenChannelJoin(row: {
  parentId: string;
  groupId: string;
  name: string;
  access: ChannelAccess;
}): void {
  const groupId = row.groupId.trim();
  const parentId = row.parentId.trim();
  const name = row.name.trim();
  if (!groupId || !parentId || !name) return;
  const access: ChannelAccess = row.access === 'closed' ? 'closed' : 'open';
  const next: PendingOpenChannelJoin = {
    parentId,
    groupId,
    name,
    access,
    at: Date.now(),
  };
  const rows = get(pendingOpenChannelJoins).filter(
    (existing) => !sameMlsGroupId(existing.groupId, groupId),
  );
  setRows([next, ...rows].slice(0, MAX_ROWS));
}

export function forgetPendingOpenChannelJoin(groupId: string): void {
  const id = groupId.trim();
  if (!id) return;
  setRows(get(pendingOpenChannelJoins).filter((row) => !sameMlsGroupId(row.groupId, id)));
}

/** Drop wanted rows older than the TTL. */
export function pruneExpiredPendingOpenChannelJoins(now = Date.now()): void {
  const rows = get(pendingOpenChannelJoins);
  const kept = rows.filter((row) => row.at >= now - PENDING_OPEN_CHANNEL_JOIN_TTL_MS);
  if (kept.length !== rows.length) setRows(kept);
}

/** Drop a parent's wanted rows whose group id is not in `listedGroupIds`. */
export function forgetPendingOpenChannelJoinsNotListed(
  parentId: string,
  listedGroupIds: string[],
): void {
  const rows = get(pendingOpenChannelJoins);
  const kept = rows.filter(
    (row) =>
      !sameMlsGroupId(row.parentId, parentId) ||
      listedGroupIds.some((id) => sameMlsGroupId(id, row.groupId)),
  );
  if (kept.length !== rows.length) setRows(kept);
}

export function resetPendingOpenChannelJoins(): void {
  pendingOpenChannelJoins.set([]);
}
