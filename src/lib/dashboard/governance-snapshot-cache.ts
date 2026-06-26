import { get, writable } from 'svelte/store';
import type { HatTreeNodeDto, TreasuryProposalDto } from '../governance/api';

export const GOVERNANCE_SNAPSHOT_CACHE_VERSION = 1 as const;
export const GOVERNANCE_SNAPSHOT_CACHE_PREFIX = 'pacto_governance_snapshot_cache_v1';

interface TreasuryProposalsSnapshot {
  proposals: TreasuryProposalDto[];
  fetchedAtMs: number;
}

interface HatsTreeSnapshot {
  tree: HatTreeNodeDto | null;
  fetchedAtMs: number;
}

interface GovernanceSnapshotDiskBlob {
  version: number;
  treasuryProposalsByKey: Record<string, TreasuryProposalsSnapshot>;
  hatsTreeByKey: Record<string, HatsTreeSnapshot>;
}

export interface GovernanceSnapshotHydrated {
  npub: string;
  treasuryProposalsByKey: Record<string, TreasuryProposalsSnapshot>;
  hatsTreeByKey: Record<string, HatsTreeSnapshot>;
}

export const governanceSnapshotHydrated = writable<GovernanceSnapshotHydrated | null>(null);

function storageKey(npub: string): string {
  return `${GOVERNANCE_SNAPSHOT_CACHE_PREFIX}_${npub}`;
}

function isTreasuryProposalDto(x: unknown): x is TreasuryProposalDto {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.proposalId === 'string' && typeof o.status === 'string';
}

function isHatTreeNodeDto(x: unknown): x is HatTreeNodeDto {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.hatId === 'string' && Array.isArray(o.children);
}

function readBlob(npub: string): GovernanceSnapshotDiskBlob | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(storageKey(npub));
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<GovernanceSnapshotDiskBlob>;
    if (o.version !== GOVERNANCE_SNAPSHOT_CACHE_VERSION) return null;
    const treasuryProposalsByKey: Record<string, TreasuryProposalsSnapshot> = {};
    if (typeof o.treasuryProposalsByKey === 'object' && o.treasuryProposalsByKey) {
      for (const [key, snap] of Object.entries(o.treasuryProposalsByKey)) {
        if (
          snap &&
          typeof snap === 'object' &&
          Array.isArray((snap as TreasuryProposalsSnapshot).proposals) &&
          (snap as TreasuryProposalsSnapshot).proposals.every(isTreasuryProposalDto) &&
          typeof (snap as TreasuryProposalsSnapshot).fetchedAtMs === 'number'
        ) {
          treasuryProposalsByKey[key] = snap as TreasuryProposalsSnapshot;
        }
      }
    }
    const hatsTreeByKey: Record<string, HatsTreeSnapshot> = {};
    if (typeof o.hatsTreeByKey === 'object' && o.hatsTreeByKey) {
      for (const [key, snap] of Object.entries(o.hatsTreeByKey)) {
        if (
          snap &&
          typeof snap === 'object' &&
          typeof (snap as HatsTreeSnapshot).fetchedAtMs === 'number' &&
          ((snap as HatsTreeSnapshot).tree === null ||
            isHatTreeNodeDto((snap as HatsTreeSnapshot).tree))
        ) {
          hatsTreeByKey[key] = snap as HatsTreeSnapshot;
        }
      }
    }
    return {
      version: GOVERNANCE_SNAPSHOT_CACHE_VERSION,
      treasuryProposalsByKey,
      hatsTreeByKey,
    };
  } catch {
    return null;
  }
}

function writeBlob(npub: string, blob: GovernanceSnapshotDiskBlob): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(npub), JSON.stringify(blob));
  } catch {
    // ignore quota
  }
  governanceSnapshotHydrated.set({
    npub,
    treasuryProposalsByKey: blob.treasuryProposalsByKey,
    hatsTreeByKey: blob.hatsTreeByKey,
  });
}

export function hydrateGovernanceSnapshotCacheFromDisk(npub: string): void {
  const blob = readBlob(npub);
  if (!blob) {
    governanceSnapshotHydrated.set(null);
    return;
  }
  governanceSnapshotHydrated.set({
    npub,
    treasuryProposalsByKey: blob.treasuryProposalsByKey,
    hatsTreeByKey: blob.hatsTreeByKey,
  });
}

export function getCachedTreasuryProposals(
  npub: string | null | undefined,
  key: string,
): TreasuryProposalsSnapshot | null {
  if (!npub) return null;
  const h = get(governanceSnapshotHydrated);
  if (h?.npub === npub && h.treasuryProposalsByKey[key]) return h.treasuryProposalsByKey[key];
  const blob = readBlob(npub);
  return blob?.treasuryProposalsByKey[key] ?? null;
}

export function getCachedHatsTree(
  npub: string | null | undefined,
  key: string,
): HatsTreeSnapshot | null {
  if (!npub) return null;
  const h = get(governanceSnapshotHydrated);
  if (h?.npub === npub && h.hatsTreeByKey[key]) return h.hatsTreeByKey[key];
  const blob = readBlob(npub);
  return blob?.hatsTreeByKey[key] ?? null;
}

export function persistTreasuryProposalsSnapshot(
  npub: string,
  key: string,
  proposals: TreasuryProposalDto[],
): void {
  if (!npub || !key) return;
  const blob = readBlob(npub) ?? {
    version: GOVERNANCE_SNAPSHOT_CACHE_VERSION,
    treasuryProposalsByKey: {},
    hatsTreeByKey: {},
  };
  blob.treasuryProposalsByKey[key] = { proposals, fetchedAtMs: Date.now() };
  writeBlob(npub, blob);
}

export function persistHatsTreeSnapshot(
  npub: string,
  key: string,
  tree: HatTreeNodeDto | null,
): void {
  if (!npub || !key) return;
  const blob = readBlob(npub) ?? {
    version: GOVERNANCE_SNAPSHOT_CACHE_VERSION,
    treasuryProposalsByKey: {},
    hatsTreeByKey: {},
  };
  blob.hatsTreeByKey[key] = { tree, fetchedAtMs: Date.now() };
  writeBlob(npub, blob);
}

export function clearGovernanceSnapshotCacheStore(): void {
  governanceSnapshotHydrated.set(null);
}
