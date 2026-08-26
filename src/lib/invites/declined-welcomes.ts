import { declinedWelcomeGroupIds } from '../../stores/invite-decisions';

export function sameMlsGroupId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function recordDeclinedWelcomeGroupId(groupId: string): void {
  const id = groupId.trim();
  if (!id) return;
  declinedWelcomeGroupIds.update((ids) =>
    ids.some((existing) => sameMlsGroupId(existing, id)) ? ids : [...ids, id]
  );
}

/** Clear a prior Decline so a new Accept / Welcome for the same group is not suppressed. */
export function clearDeclinedWelcomeGroupId(groupId: string): void {
  const id = groupId.trim();
  if (!id) return;
  declinedWelcomeGroupIds.update((ids) => ids.filter((existing) => !sameMlsGroupId(existing, id)));
}
