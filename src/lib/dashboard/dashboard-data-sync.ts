import { get } from 'svelte/store';
import { currentUser } from '../../stores/auth';
import { squadMemberEvmByParentId, treasurySafesByParentId, squadInfraByParentId } from '../../stores/squads';
import { listParentTreasurySafes } from '../api/nostr';
import { listSquadInfra } from '../governance/api';
import { fetchSquadMemberEvmByNpub } from './parent-dashboard-loaders';
import { persistTreasurySafesForParent, treasurySafesFetchedAtMs } from './treasury-safes-cache';
import { persistSquadInfraForParent, squadInfraFetchedAtMs } from './squad-infra-cache';
import { persistSquadMemberEvmForParent } from './squad-member-evm-cache';
import { setSquadInfraFetchMeta, setTreasurySafesFetchMeta } from './dashboard-fetch-meta';

const treasuryInflight = new Map<string, Promise<void>>();
const infraInflight = new Map<string, Promise<void>>();
const memberEvmInflight = new Map<string, Promise<void>>();

function activeNpub(): string | null {
  return get(currentUser)?.npub ?? null;
}

export async function syncTreasurySafesForParent(parentId: string): Promise<void> {
  if (!parentId) return;
  const existing = treasuryInflight.get(parentId);
  if (existing) return existing;

  const npub = activeNpub();
  setTreasurySafesFetchMeta(parentId, {
    loading: true,
    error: null,
    fetchedAtMs: npub ? treasurySafesFetchedAtMs(npub, parentId) : null,
  });

  const p = (async () => {
    try {
      const rows = await listParentTreasurySafes(parentId);
      treasurySafesByParentId.update((m) => ({ ...m, [parentId]: rows }));
      const curNpub = activeNpub();
      if (curNpub) persistTreasurySafesForParent(curNpub, parentId, rows);
      else setTreasurySafesFetchMeta(parentId, { loading: false, error: null, fetchedAtMs: Date.now() });
    } catch (e) {
      const curNpub = activeNpub();
      setTreasurySafesFetchMeta(parentId, {
        loading: false,
        error: (e as Error)?.message ?? 'Could not refresh treasury safes.',
        fetchedAtMs: curNpub ? treasurySafesFetchedAtMs(curNpub, parentId) : null,
      });
    } finally {
      treasuryInflight.delete(parentId);
    }
  })();

  treasuryInflight.set(parentId, p);
  return p;
}

export async function syncSquadInfraForParent(parentId: string): Promise<void> {
  if (!parentId) return;
  const existing = infraInflight.get(parentId);
  if (existing) return existing;

  const npub = activeNpub();
  setSquadInfraFetchMeta(parentId, {
    loading: true,
    error: null,
    fetchedAtMs: npub ? squadInfraFetchedAtMs(npub, parentId) : null,
  });

  const p = (async () => {
    try {
      const rows = await listSquadInfra(parentId);
      squadInfraByParentId.update((m) => ({ ...m, [parentId]: rows }));
      const curNpub = activeNpub();
      if (curNpub) persistSquadInfraForParent(curNpub, parentId, rows);
      else setSquadInfraFetchMeta(parentId, { loading: false, error: null, fetchedAtMs: Date.now() });
    } catch (e) {
      const curNpub = activeNpub();
      setSquadInfraFetchMeta(parentId, {
        loading: false,
        error: (e as Error)?.message ?? 'Could not refresh squad infra.',
        fetchedAtMs: curNpub ? squadInfraFetchedAtMs(curNpub, parentId) : null,
      });
    } finally {
      infraInflight.delete(parentId);
    }
  })();

  infraInflight.set(parentId, p);
  return p;
}

export async function syncSquadMemberEvmForParent(
  parentId: string,
  announcementsGroupId: string | null,
): Promise<void> {
  if (!parentId) return;
  const existing = memberEvmInflight.get(parentId);
  if (existing) return existing;

  const p = (async () => {
    try {
      const rows = await fetchSquadMemberEvmByNpub(parentId, announcementsGroupId);
      squadMemberEvmByParentId.update((m) => ({ ...m, [parentId]: rows }));
      const curNpub = activeNpub();
      if (curNpub) persistSquadMemberEvmForParent(curNpub, parentId, rows);
    } finally {
      memberEvmInflight.delete(parentId);
    }
  })();

  memberEvmInflight.set(parentId, p);
  return p;
}

/** Clears in-flight dedupe maps (e.g. on logout). */
export function resetDashboardDataSyncInflight(): void {
  treasuryInflight.clear();
  infraInflight.clear();
  memberEvmInflight.clear();
}
