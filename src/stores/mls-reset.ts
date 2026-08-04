import { writable } from 'svelte/store';
import {
  getMlsStoreResetState,
  type MlsStoreResetGroupState,
} from '../lib/api/nostr';

export const mlsResetByGroupId = writable<Record<string, MlsStoreResetGroupState>>({});
let refreshGeneration = 0;

export function applyMlsStoreResetState(groups: MlsStoreResetGroupState[]): void {
  const byGroup: Record<string, MlsStoreResetGroupState> = {};
  for (const group of groups) {
    if (!group?.group_id || !group.state_lost) continue;
    byGroup[group.group_id] = {
      ...group,
      admin_npubs: [...(group.admin_npubs ?? [])],
      single_admin: (group.admin_npubs ?? []).length === 1,
    };
  }
  mlsResetByGroupId.set(byGroup);
}

export async function refreshMlsStoreResetState(): Promise<void> {
  const generation = ++refreshGeneration;
  const groups = await getMlsStoreResetState();
  if (generation === refreshGeneration) {
    applyMlsStoreResetState(groups);
  }
}

export function resetMlsStoreResetState(): void {
  refreshGeneration += 1;
  mlsResetByGroupId.set({});
}
