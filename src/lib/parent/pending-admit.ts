/**
 * Durable admit retry queue for consent-first invites and approved Commons joins.
 */

import { get, writable } from 'svelte/store';
import { persistenceKey } from '../../stores/persistence-context';
import { squads } from '../../stores/squads';
import { admitMemberToSquad } from './admit-member';

export const PENDING_ADMIT_PREFIX = 'pacto_pending_admit';

export type PendingAdmitKind = 'invite' | 'join';

export type PendingAdmitEntry = {
  kind: PendingAdmitKind;
  parentId: string;
  memberNpub: string;
  inviteId?: string;
  requestId?: string;
  createdAt: number;
  lastError?: string;
  lastAttemptAt?: number;
};

/** Reactive snapshot of the durable queue (admitter-side). */
export const pendingAdmitQueue = writable<PendingAdmitEntry[]>([]);

const RETRY_COOLDOWN_MS = 15_000;
const DRAIN_INTERVAL_MS = 45_000;
const QUEUE_CAP = 100;

let drainTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

function entryKey(entry: Pick<PendingAdmitEntry, 'kind' | 'parentId' | 'memberNpub' | 'inviteId' | 'requestId'>): string {
  const id = entry.inviteId?.trim() || entry.requestId?.trim() || '';
  return `${entry.kind}:${entry.parentId.trim().toLowerCase()}:${entry.memberNpub.trim().toLowerCase()}:${id}`;
}

function readDisk(): PendingAdmitEntry[] {
  if (typeof localStorage === 'undefined') return [];
  const key = persistenceKey(PENDING_ADMIT_PREFIX);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is PendingAdmitEntry => {
        if (!row || typeof row !== 'object') return false;
        const r = row as PendingAdmitEntry;
        return (
          (r.kind === 'invite' || r.kind === 'join') &&
          typeof r.parentId === 'string' &&
          typeof r.memberNpub === 'string' &&
          typeof r.createdAt === 'number'
        );
      })
      .slice(0, QUEUE_CAP);
  } catch {
    return [];
  }
}

function writeDisk(entries: PendingAdmitEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PENDING_ADMIT_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, QUEUE_CAP)));
  } catch {
    // ignore
  }
}

function setQueue(entries: PendingAdmitEntry[]): void {
  pendingAdmitQueue.set(entries);
  writeDisk(entries);
}

/** Hydrate queue after login when persistence npub is set. */
export function loadPendingAdmitQueue(): void {
  setQueue(readDisk());
}

export function resetPendingAdmitState(): void {
  pendingAdmitQueue.set([]);
  stopPendingAdmitDrain();
}

export function enqueuePendingAdmit(entry: Omit<PendingAdmitEntry, 'createdAt'> & { createdAt?: number }): void {
  const next: PendingAdmitEntry = {
    ...entry,
    parentId: entry.parentId.trim(),
    memberNpub: entry.memberNpub.trim(),
    inviteId: entry.inviteId?.trim() || undefined,
    requestId: entry.requestId?.trim() || undefined,
    createdAt: entry.createdAt ?? Date.now(),
  };
  if (!next.parentId || !next.memberNpub) return;
  const key = entryKey(next);
  const cur = get(pendingAdmitQueue);
  if (cur.some((e) => entryKey(e) === key)) {
    setQueue(
      cur.map((e) =>
        entryKey(e) === key
          ? { ...e, lastError: next.lastError ?? e.lastError, lastAttemptAt: next.lastAttemptAt ?? e.lastAttemptAt }
          : e
      )
    );
    return;
  }
  setQueue([next, ...cur].slice(0, QUEUE_CAP));
}

export function clearPendingAdmitForMember(parentId: string, memberNpub: string): void {
  const p = parentId.trim().toLowerCase();
  const m = memberNpub.trim().toLowerCase();
  setQueue(
    get(pendingAdmitQueue).filter(
      (e) => e.parentId.trim().toLowerCase() !== p || e.memberNpub.trim().toLowerCase() !== m
    )
  );
}

export function listPendingAdmitForParent(parentId: string): PendingAdmitEntry[] {
  const id = parentId.trim().toLowerCase();
  return get(pendingAdmitQueue).filter((e) => e.parentId.trim().toLowerCase() === id);
}

/** Attempt all due queue entries once. */
export async function drainPendingAdmitQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const now = Date.now();
    const entries = [...get(pendingAdmitQueue)];
    for (const entry of entries) {
      if (entry.lastAttemptAt && now - entry.lastAttemptAt < RETRY_COOLDOWN_MS) continue;
      const parent = get(squads).find((s) => s.id === entry.parentId);
      if (!parent) continue;

      const touched: PendingAdmitEntry = { ...entry, lastAttemptAt: now };
      setQueue(get(pendingAdmitQueue).map((e) => (entryKey(e) === entryKey(entry) ? touched : e)));

      const result = await admitMemberToSquad({ parent, memberNpub: entry.memberNpub });
      if (result.ok) {
        clearPendingAdmitForMember(entry.parentId, entry.memberNpub);
      } else {
        enqueuePendingAdmit({
          ...entry,
          lastError: result.error,
          lastAttemptAt: now,
        });
      }
    }
  } finally {
    draining = false;
  }
}

export function startPendingAdmitDrain(): void {
  if (drainTimer != null) return;
  void drainPendingAdmitQueue();
  drainTimer = setInterval(() => {
    void drainPendingAdmitQueue();
  }, DRAIN_INTERVAL_MS);
}

export function stopPendingAdmitDrain(): void {
  if (drainTimer != null) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
}
