import type { PendingMlsWelcome } from '../../lib/api/nostr';
import { sameMlsGroupId } from '../../lib/invites/accept-invite';
import type { WelcomeInviteSource } from '../../lib/invites/find-invite-source';

/** Where a `welcome` Catch up entry sends the member on open. */
export type WelcomeEntryTarget = { kind: 'dm'; npub: string } | { kind: 'dm-requests' } | null;

export interface ResolvedWelcomeEntry {
  target: WelcomeEntryTarget;
  locationLabel: string;
}

/**
 * Resolves a `welcome` entry's destination and label. A local DM invite
 * (when cached) wins — it can name the inviter's thread. Otherwise falls
 * back to the group's own pending-welcome record, landing on DMs -> Requests
 * where the refusable join card lives. Neither found means the welcome is
 * gone (already accepted, declined elsewhere, or the entry is stale).
 */
export function resolveWelcomeEntry(
  groupId: string,
  welcomeSource: WelcomeInviteSource | null,
  pendingWelcomes: PendingMlsWelcome[],
  unavailableLabel: string
): ResolvedWelcomeEntry {
  if (welcomeSource) {
    const locationLabel = welcomeSource.channelName
      ? `${welcomeSource.squadName} · #${welcomeSource.channelName}`
      : welcomeSource.squadName;
    return { target: { kind: 'dm', npub: welcomeSource.npub }, locationLabel };
  }
  const pending = pendingWelcomes.find((w) => sameMlsGroupId(w.nostr_group_id, groupId));
  if (pending) {
    return { target: { kind: 'dm-requests' }, locationLabel: pending.group_name.trim() || groupId };
  }
  return { target: null, locationLabel: unavailableLabel };
}
