import { writable } from 'svelte/store';
import {
  getMlsStoreResetState,
  type MlsStoreResetGroupState,
} from '../lib/api/nostr';

export const mlsResetByGroupId = writable<Record<string, MlsStoreResetGroupState>>({});

// Spans both call sources: the `mls_store_reset` event listener's direct
// applyMlsStoreResetState calls and refreshMlsStoreResetState's fetch-driven
// calls. Bumped on every apply/reset so a fetch that resolves after a newer
// call has already landed is discarded instead of overwriting fresher state.
let applyGeneration = 0;

export function applyMlsStoreResetState(groups: MlsStoreResetGroupState[]): void {
  applyGeneration += 1;
  const byGroup: Record<string, MlsStoreResetGroupState> = {};
  for (const group of groups) {
    if (!group?.groupId || !group.stateLost) continue;
    byGroup[group.groupId] = {
      ...group,
      adminNpubs: [...(group.adminNpubs ?? [])],
      singleAdmin: (group.adminNpubs ?? []).length === 1,
    };
  }
  mlsResetByGroupId.set(byGroup);
}

export async function refreshMlsStoreResetState(): Promise<void> {
  const generation = applyGeneration;
  const groups = await getMlsStoreResetState();
  if (generation === applyGeneration) {
    applyMlsStoreResetState(groups);
  }
}

export function resetMlsStoreResetState(): void {
  applyGeneration += 1;
  mlsResetByGroupId.set({});
}
