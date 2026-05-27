import { invoke } from '@tauri-apps/api/core';
import { get, writable } from 'svelte/store';
import { currentUser } from '../../stores/auth';
import { listSquadMemberEvmInvokeArgs } from './squad-member-evm-share';

const DEFER_PREFIX = 'pacto_squad_roster_key_deferred';

function deferStorageKey(): string | null {
  const npub = get(currentUser)?.npub;
  if (!npub) return null;
  return `${DEFER_PREFIX}_${npub}`;
}

function readDeferredParentIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  const key = deferStorageKey();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeDeferredParentIds(ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  const key = deferStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

/** Parent ids where the user chose Defer on the Inbox roster key card. */
export const deferredSquadRosterKeyParentIds = writable<string[]>([]);

export function loadDeferredSquadRosterKeyParentIds(): void {
  deferredSquadRosterKeyParentIds.set(readDeferredParentIds());
}

export function deferSquadRosterKeyChoice(parentId: string): void {
  const pid = parentId.trim();
  if (!pid) return;
  deferredSquadRosterKeyParentIds.update((ids) => {
    const next = ids.includes(pid) ? ids : [...ids, pid];
    writeDeferredParentIds(next);
    return next;
  });
}

export function clearDeferredSquadRosterKeyChoice(parentId: string): void {
  const pid = parentId.trim();
  if (!pid) return;
  deferredSquadRosterKeyParentIds.update((ids) => {
    const next = ids.filter((id) => id !== pid);
    writeDeferredParentIds(next);
    return next;
  });
}

type EvmRow = { memberNpub: string; evmAddress: string; updatedAtMs: number };

/** True when the current user still needs to pick a roster key for this parent. */
export async function needsSquadRosterKeyChoice(
  parentId: string,
  announcementsGroupId: string | null | undefined
): Promise<boolean> {
  const me = get(currentUser)?.npub;
  if (!me) return false;
  const rosterArgs = listSquadMemberEvmInvokeArgs(parentId, announcementsGroupId);
  if (!rosterArgs.parentId) return false;
  if (get(deferredSquadRosterKeyParentIds).includes(rosterArgs.parentId)) return false;
  try {
    const rows = await invoke<EvmRow[]>('list_squad_member_evm', rosterArgs);
    return !rows.some((r) => r.memberNpub === me && r.evmAddress?.trim());
  } catch {
    return false;
  }
}
