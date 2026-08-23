import { get, writable } from 'svelte/store';
import { currentUser } from '../../stores/auth';
import { listEvmAccountSquadBindings } from './evm-account-squad-bindings';
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

export function resetDeferredSquadRosterKeyParentIds(): void {
  deferredSquadRosterKeyParentIds.set([]);
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

/**
 * Crew/Status display map: omit self while personal-alerts still requires a bind,
 * so an orphan auto-share does not look like an intentional assignment.
 */
export function squadMemberEvmForDisplay(
  map: Record<string, string>,
  myNpub: string | null | undefined,
  needsKeyChoice: boolean,
): Record<string, string> {
  const me = myNpub?.trim();
  if (!needsKeyChoice || !me) return map;
  if (!map[me]?.trim()) return map;
  const next = { ...map };
  delete next[me];
  return next;
}

/** Address used for Crew HATS lookup: raw roster, then the viewer's local bind. */
export function crewHatLookupAddress(params: {
  npub: string;
  rawRosterEvmByNpub: Record<string, string>;
  viewerNpub?: string | null;
  viewerBindAddress?: string | null;
}): string {
  const fromRoster = params.rawRosterEvmByNpub[params.npub]?.trim() ?? '';
  if (fromRoster) return fromRoster;
  const me = params.viewerNpub?.trim();
  if (me && params.npub === me) return params.viewerBindAddress?.trim() ?? '';
  return '';
}

/** True when the current user still needs to pick a roster key for this parent. */
export async function needsSquadRosterKeyChoice(
  parentId: string,
  announcementsGroupId: string | null | undefined
): Promise<boolean> {
  const me = get(currentUser)?.npub;
  if (!me) return false;
  const rosterArgs = listSquadMemberEvmInvokeArgs(parentId, announcementsGroupId);
  if (!rosterArgs.parentId) return false;
  const rosterIds = new Set(
    [rosterArgs.parentId, rosterArgs.altParentId, parentId.trim()]
      .map((id) => id?.trim())
      .filter((id): id is string => !!id)
  );
  if ([...rosterIds].some((id) => get(deferredSquadRosterKeyParentIds).includes(id))) return false;
  try {
    const bindings = await listEvmAccountSquadBindings();
    return !bindings.some((b) => rosterIds.has(b.parentId.trim()));
  } catch {
    return false;
  }
}
