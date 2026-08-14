/**
 * Store wiring for pending-welcome join offers. Kept out of `pending-welcomes.ts`
 * so the filter there stays pure and cheap to test.
 */

import { derived, get, writable } from 'svelte/store';
import { pendingMlsWelcomes } from '../../stores/mls-chat';
import { squads } from '../../stores/squads';
import { blockedDmNpubs } from '../../stores/dm';
import { declinedWelcomeGroupIds } from '../../stores/invite-decisions';
import { pendingSquadAdmissions } from '../../stores/pending-squad-admission';
import { resolveOneCatchUpEntry } from '../../stores/catch-up';
import { sameMlsGroupId } from './accept-invite';
import {
  offeredWelcomes,
  recordDeclinedWelcomeGroupId,
  type OfferedWelcome,
} from './pending-welcomes';

/** Group ids with an accept in flight, so a card cannot be double-submitted. */
export const joiningWelcomeGroupIds = writable<string[]>([]);

/**
 * Pending welcomes awaiting a decision. Read by the Requests cards and by the
 * sidebar, which suppresses its "no requests" empty state when this is non-empty.
 */
export const offeredWelcomeList = derived(
  [
    pendingMlsWelcomes,
    squads,
    declinedWelcomeGroupIds,
    pendingSquadAdmissions,
    blockedDmNpubs,
    joiningWelcomeGroupIds,
  ] as const,
  ([$welcomes, $squads, $declined, $admissions, $blocked, $joining]): OfferedWelcome[] =>
    offeredWelcomes({
      welcomes: $welcomes,
      squadIds: $squads.map((s) => s.id),
      declinedGroupIds: $declined,
      pendingAdmissionGroupIds: $admissions.map((p) => p.groupId),
      blockedNpubs: $blocked,
      joiningGroupIds: new Set($joining),
    })
);

/**
 * Refuse a pending welcome and clear the Catch up row that announced it.
 *
 * Accepting needs no equivalent: `do_accept_mls_welcome` resolves the entry
 * backend-side. Refusing leaves the welcome pending in the engine, so without
 * this the row would survive and point at a Requests tab no longer offering it.
 */
export function declineWelcomeForGroup(groupId: string): void {
  recordDeclinedWelcomeGroupId(groupId);
  const pending = get(pendingMlsWelcomes).find((w) => sameMlsGroupId(w.nostr_group_id, groupId));
  if (!pending) return;
  void resolveOneCatchUpEntry(pending.wrapper_event_id).catch(() => {
    // Row stays until the next Catch up refresh; the refusal itself is recorded.
  });
}
