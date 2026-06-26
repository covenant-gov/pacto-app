import { get, writable } from 'svelte/store';
import type { SupportedChainId } from '../wallet/chains';

export const SETTINGS_CHAIN_CACHE_VERSION = 1 as const;
export const SETTINGS_CHAIN_CACHE_PREFIX = 'pacto_settings_chain_cache_v1';

export interface SettingsChainSnapshot {
  cacheKey: string;
  memberHatByAddress: Record<string, string>;
  memberRolesByAddress: Record<string, string>;
  fetchedAtMs: number;
}

interface SettingsChainDiskBlob {
  version: number;
  byParentId: Record<string, SettingsChainSnapshot>;
}

export interface SettingsChainHydrated {
  npub: string;
  byParentId: Record<string, SettingsChainSnapshot>;
}

export const settingsChainHydrated = writable<SettingsChainHydrated | null>(null);

export function settingsChainMemberFingerprint(squadMemberEvmByNpub: Record<string, string>): string {
  return Object.values(squadMemberEvmByNpub)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
}

export function settingsChainCacheKey(params: {
  network: SupportedChainId;
  topHatId: string | null;
  squadAdminProxy: string | null;
  squadMemberEvmByNpub: Record<string, string>;
}): string {
  return `${params.network}:${params.topHatId ?? ''}:${params.squadAdminProxy ?? ''}:${settingsChainMemberFingerprint(params.squadMemberEvmByNpub)}`;
}

function storageKey(npub: string): string {
  return `${SETTINGS_CHAIN_CACHE_PREFIX}_${npub}`;
}

function isStringRecord(x: unknown): x is Record<string, string> {
  if (!x || typeof x !== 'object') return false;
  return Object.entries(x).every(([k, v]) => typeof k === 'string' && typeof v === 'string');
}

function readBlob(npub: string): SettingsChainDiskBlob | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(storageKey(npub));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<SettingsChainDiskBlob>;
    if (o.version !== SETTINGS_CHAIN_CACHE_VERSION || typeof o.byParentId !== 'object' || !o.byParentId) {
      return null;
    }
    const byParentId: Record<string, SettingsChainSnapshot> = {};
    for (const [parentId, snap] of Object.entries(o.byParentId)) {
      if (
        snap &&
        typeof snap === 'object' &&
        typeof (snap as SettingsChainSnapshot).cacheKey === 'string' &&
        isStringRecord((snap as SettingsChainSnapshot).memberHatByAddress) &&
        isStringRecord((snap as SettingsChainSnapshot).memberRolesByAddress) &&
        typeof (snap as SettingsChainSnapshot).fetchedAtMs === 'number'
      ) {
        byParentId[parentId] = snap as SettingsChainSnapshot;
      }
    }
    return { version: SETTINGS_CHAIN_CACHE_VERSION, byParentId };
  } catch {
    return null;
  }
}

function writeBlob(npub: string, blob: SettingsChainDiskBlob): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(npub), JSON.stringify(blob));
  } catch {
    // ignore quota
  }
  settingsChainHydrated.set({ npub, byParentId: blob.byParentId });
}

export function hydrateSettingsChainCacheFromDisk(npub: string): void {
  const blob = readBlob(npub);
  if (!blob) {
    settingsChainHydrated.set(null);
    return;
  }
  settingsChainHydrated.set({ npub, byParentId: blob.byParentId });
}

export function getCachedSettingsChainSnapshot(
  npub: string | null | undefined,
  parentId: string,
  cacheKey: string,
): SettingsChainSnapshot | null {
  if (!npub || !parentId) return null;
  const h = get(settingsChainHydrated);
  const snap = h?.npub === npub ? h.byParentId[parentId] : readBlob(npub)?.byParentId[parentId];
  if (!snap || snap.cacheKey !== cacheKey) return null;
  return snap;
}

export function persistSettingsChainSnapshot(
  npub: string,
  parentId: string,
  cacheKey: string,
  data: {
    memberHatByAddress: Record<string, string>;
    memberRolesByAddress: Record<string, string>;
  },
): void {
  if (!npub || !parentId || !cacheKey) return;
  const blob = readBlob(npub) ?? { version: SETTINGS_CHAIN_CACHE_VERSION, byParentId: {} };
  blob.byParentId[parentId] = {
    cacheKey,
    memberHatByAddress: data.memberHatByAddress,
    memberRolesByAddress: data.memberRolesByAddress,
    fetchedAtMs: Date.now(),
  };
  writeBlob(npub, blob);
}

export function clearSettingsChainCacheStore(): void {
  settingsChainHydrated.set(null);
}

export function removeSettingsChainCacheForParent(npub: string, parentId: string): void {
  if (!npub || !parentId) return;
  const blob = readBlob(npub);
  if (!blob?.byParentId[parentId]) return;
  delete blob.byParentId[parentId];
  writeBlob(npub, blob);
}
