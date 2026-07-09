import { persistenceKey } from '../../stores/persistence-context';

export const PACTO_SQUAD_JOIN_MUTED_PREFIX = 'pacto_squad_join_muted';

type MutedBySquad = Record<string, string[]>;

function readMutedMap(): MutedBySquad {
  if (typeof localStorage === 'undefined') return {};
  const key = persistenceKey(PACTO_SQUAD_JOIN_MUTED_PREFIX);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as MutedBySquad)
      : {};
  } catch {
    return {};
  }
}

function writeMutedMap(map: MutedBySquad): void {
  if (typeof localStorage === 'undefined') return;
  const key = persistenceKey(PACTO_SQUAD_JOIN_MUTED_PREFIX);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

export function isJoinRequesterMuted(squadId: string, requesterNpub: string): boolean {
  const squad = squadId.trim();
  const npub = requesterNpub.trim();
  if (!squad || !npub) return false;
  return (readMutedMap()[squad] ?? []).includes(npub);
}

export function muteJoinRequester(squadId: string, requesterNpub: string): void {
  const squad = squadId.trim();
  const npub = requesterNpub.trim();
  if (!squad || !npub) return;
  const map = readMutedMap();
  const list = map[squad] ?? [];
  if (list.includes(npub)) return;
  map[squad] = [...list, npub];
  writeMutedMap(map);
}
