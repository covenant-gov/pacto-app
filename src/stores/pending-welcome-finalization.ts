/**
 * Durable "engine accepted, squad not yet materialized" records for bare MLS
 * welcomes. MLS consumes the welcome at accept time, so a later persistSquad
 * failure cannot retry via `pendingMlsWelcomes` — this store is the retry key.
 */

import { get, writable } from 'svelte/store';
import { currentNpubForPersistence } from './persistence-context';

export const PENDING_WELCOME_FINALIZATION_PREFIX = 'pacto_pending_welcome_finalization';

export type PendingWelcomeFinalization = {
  /** Welcome event id — not reused for accept; retry only finalizes. */
  welcomeId: string;
  groupId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  inviterNpub: string;
  memberCount: number;
  acceptedAt: number;
};

export const pendingWelcomeFinalizations = writable<PendingWelcomeFinalization[]>([]);

function diskKey(npub: string): string {
  return `${PENDING_WELCOME_FINALIZATION_PREFIX}_${npub}`;
}

function isFinalization(row: unknown): row is PendingWelcomeFinalization {
  if (!row || typeof row !== 'object') return false;
  const r = row as PendingWelcomeFinalization;
  return (
    typeof r.welcomeId === 'string' &&
    typeof r.groupId === 'string' &&
    typeof r.name === 'string' &&
    (r.description === null || typeof r.description === 'string') &&
    (r.imageUrl === null || typeof r.imageUrl === 'string') &&
    typeof r.inviterNpub === 'string' &&
    typeof r.memberCount === 'number' &&
    typeof r.acceptedAt === 'number'
  );
}

function readDisk(npub: string): PendingWelcomeFinalization[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(diskKey(npub));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFinalization);
  } catch {
    return [];
  }
}

function writeDiskForNpub(npub: string, entries: PendingWelcomeFinalization[]): void {
  if (typeof localStorage === 'undefined' || !npub) return;
  try {
    localStorage.setItem(diskKey(npub), JSON.stringify(entries));
  } catch {
    // ignore
  }
}

function writeDisk(entries: PendingWelcomeFinalization[]): void {
  const npub = get(currentNpubForPersistence);
  if (!npub) return;
  writeDiskForNpub(npub, entries);
}

function setEntries(entries: PendingWelcomeFinalization[]): void {
  pendingWelcomeFinalizations.set(entries);
  writeDisk(entries);
}

export function loadPendingWelcomeFinalizations(npub: string): void {
  pendingWelcomeFinalizations.set(readDisk(npub));
}

export function resetPendingWelcomeFinalizations(): void {
  pendingWelcomeFinalizations.set([]);
}

export function upsertPendingWelcomeFinalization(entry: PendingWelcomeFinalization): void {
  const target = entry.groupId.trim().toLowerCase();
  const without = get(pendingWelcomeFinalizations).filter(
    (e) => e.groupId.trim().toLowerCase() !== target
  );
  setEntries([entry, ...without]);
}

/** Persist a recovery row for a specific npub without touching the live store. */
export function stashPendingWelcomeFinalizationForNpub(
  npub: string,
  entry: PendingWelcomeFinalization
): void {
  if (!npub) return;
  const target = entry.groupId.trim().toLowerCase();
  const without = readDisk(npub).filter((e) => e.groupId.trim().toLowerCase() !== target);
  writeDiskForNpub(npub, [entry, ...without]);
}

export function clearPendingWelcomeFinalizationByGroupId(groupId: string): void {
  const target = groupId.trim().toLowerCase();
  setEntries(get(pendingWelcomeFinalizations).filter((e) => e.groupId.trim().toLowerCase() !== target));
}

export function getPendingWelcomeFinalizationByGroupId(
  groupId: string
): PendingWelcomeFinalization | undefined {
  const target = groupId.trim().toLowerCase();
  return get(pendingWelcomeFinalizations).find((e) => e.groupId.trim().toLowerCase() === target);
}
