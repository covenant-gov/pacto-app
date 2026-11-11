import { writable } from 'svelte/store';

/** Bumped per parent after a local role write; privilege-gated controls re-read on change. */
export const squadPrivilegeNonceByParentId = writable<Record<string, number>>({});

export function bumpSquadPrivilegeNonce(parentId: string): void {
  const pid = parentId.trim();
  if (!pid) return;
  squadPrivilegeNonceByParentId.update((m) => ({ ...m, [pid]: (m[pid] ?? 0) + 1 }));
}
