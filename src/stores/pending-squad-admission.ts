/**
 * Invitee-side durable pending admission after Accept (consent recorded; Welcome not yet).
 */

import { get, writable } from 'svelte/store';
import { persistenceKey } from './persistence-context';

export const PENDING_SQUAD_ADMISSION_PREFIX = 'pacto_pending_squad_admission';

export type PendingSquadAdmission = {
  messageId: string;
  groupId: string;
  squadName: string;
  inviteId?: string;
  acceptedAt: number;
};

export const pendingSquadAdmissions = writable<PendingSquadAdmission[]>([]);

function writeDisk(entries: PendingSquadAdmission[]): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PENDING_SQUAD_ADMISSION_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // ignore
  }
}

function setEntries(entries: PendingSquadAdmission[]): void {
  pendingSquadAdmissions.set(entries);
  writeDisk(entries);
}

export function loadPendingSquadAdmissions(npub: string): void {
  if (typeof localStorage === 'undefined') {
    pendingSquadAdmissions.set([]);
    return;
  }
  try {
    const raw = localStorage.getItem(`${PENDING_SQUAD_ADMISSION_PREFIX}_${npub}`);
    if (!raw) {
      pendingSquadAdmissions.set([]);
      return;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      pendingSquadAdmissions.set([]);
      return;
    }
    const rows = parsed.filter((row): row is PendingSquadAdmission => {
      if (!row || typeof row !== 'object') return false;
      const r = row as PendingSquadAdmission;
      return (
        typeof r.messageId === 'string' &&
        typeof r.groupId === 'string' &&
        typeof r.squadName === 'string' &&
        typeof r.acceptedAt === 'number'
      );
    });
    pendingSquadAdmissions.set(rows);
  } catch {
    pendingSquadAdmissions.set([]);
  }
}

export function resetPendingSquadAdmissions(): void {
  pendingSquadAdmissions.set([]);
}

export function upsertPendingSquadAdmission(entry: PendingSquadAdmission): void {
  const cur = get(pendingSquadAdmissions);
  const without = cur.filter(
    (e) => e.messageId !== entry.messageId && e.groupId.trim().toLowerCase() !== entry.groupId.trim().toLowerCase()
  );
  setEntries([entry, ...without]);
}

export function clearPendingSquadAdmissionByGroupId(groupId: string): void {
  const target = groupId.trim().toLowerCase();
  setEntries(get(pendingSquadAdmissions).filter((e) => e.groupId.trim().toLowerCase() !== target));
}

export function clearPendingSquadAdmissionByMessageId(messageId: string): void {
  setEntries(get(pendingSquadAdmissions).filter((e) => e.messageId !== messageId));
}

export function isPendingSquadAdmissionMessage(messageId: string): boolean {
  return get(pendingSquadAdmissions).some((e) => e.messageId === messageId);
}

export function getPendingSquadAdmissionByGroupId(groupId: string): PendingSquadAdmission | undefined {
  const target = groupId.trim().toLowerCase();
  return get(pendingSquadAdmissions).find((e) => e.groupId.trim().toLowerCase() === target);
}
