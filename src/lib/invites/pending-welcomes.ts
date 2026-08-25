/**
 * Pending MLS welcomes that no DM invite card is going to render.
 *
 * A group creator can add you over MLS alone (KeyPackage -> Welcome) with no
 * `squad_invite` DM. The engine accepts that welcome, `list_pending_mls_welcomes`
 * reports it, and Catch up even notifies about it — but squads are materialized
 * from a DM invite payload, so nothing offers the join and the group stays
 * invisible. These helpers turn the authoritative pending-welcome list into
 * refusable entries.
 *
 * Attribution is deliberately not attempted. `findWelcomeInviteSource` scans the
 * DM cache, which holds one message per chat until a thread is opened, so it
 * reports "no invite DM" for plenty of genuinely invited groups; message content
 * is encrypted at rest, so the backend cannot cheaply answer either. Rather than
 * guess, every unresolved pending welcome is offered. Pacto's own squad flow is
 * consent-first — the admitter adds you only after you accept, which is what
 * `pendingSquadAdmissions` records — so a welcome normally exists only once the
 * DM invite is already spoken for. An invite-first sender is exactly the case
 * this surface is for.
 */

import { get } from 'svelte/store';
import { acceptMlsWelcome, type PendingMlsWelcome } from '../api/nostr';
import { declinedWelcomeGroupIds } from '../../stores/invite-decisions';
import { currentNpubForPersistence } from '../../stores/persistence-context';
import {
  clearPendingWelcomeFinalizationByGroupId,
  getPendingWelcomeFinalizationByGroupId,
  pendingWelcomeFinalizations,
  stashPendingWelcomeFinalizationForNpub,
  upsertPendingWelcomeFinalization,
  type PendingWelcomeFinalization,
} from '../../stores/pending-welcome-finalization';
import { dmError } from '../utils/dm-debug';
import { requireBackupVerified } from '../../stores/backup-verification';
import {
  finalizeSquadAfterAnnouncementsWelcome,
  sameMlsGroupId,
  squadInviteResolvedByMembership,
} from './accept-invite';

/** A pending welcome with the fields the request card needs. */
export interface OfferedWelcome {
  /** Welcome (wrapper) event id — the handle `accept_mls_welcome` takes. */
  id: string;
  groupId: string;
  /** Group name from the MLS metadata extension; falls back to the group id. */
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** bech32 npub of whoever sent the welcome. */
  inviterNpub: string;
  memberCount: number;
}

/**
 * Every input is passed in rather than read from a store, so callers stay
 * reactive and the filter stays testable.
 */
export interface OfferedWelcomeInputs {
  welcomes: PendingMlsWelcome[];
  /** Ids of squads already local — those groups are joined, not pending. */
  squadIds: string[];
  declinedGroupIds: string[];
  /** Groups whose DM invite was already accepted; the consent-first path owns those. */
  pendingAdmissionGroupIds: string[];
  blockedNpubs: ReadonlySet<string>;
  /**
   * Engine-accepted welcomes whose local squad row never materialized. Shown
   * even when `list_pending_mls_welcomes` no longer reports them.
   */
  unmaterialized: OfferedWelcome[];
}

/** Max pending-welcome cards shown at once (newest first). Recovery rows are not capped. */
export const MAX_OFFERED_WELCOMES = 20;

/** Map an engine pending welcome into the card/Catch-up Accept payload. */
export function offeredWelcomeFromPendingMls(welcome: PendingMlsWelcome): OfferedWelcome {
  const groupId = welcome.nostr_group_id?.trim() || welcome.nostr_group_id;
  return {
    id: welcome.id,
    groupId,
    name: welcome.group_name?.trim() || groupId,
    description: welcome.group_description?.trim() || null,
    imageUrl: welcome.group_image_url?.trim() || null,
    inviterNpub: welcome.welcomer,
    memberCount: welcome.member_count,
  };
}

export function offeredWelcomes({
  welcomes,
  squadIds,
  declinedGroupIds,
  pendingAdmissionGroupIds,
  blockedNpubs,
  unmaterialized,
}: OfferedWelcomeInputs): OfferedWelcome[] {
  // One normalization path for every id filter: group ids reach us from MLS
  // metadata, squad rows and localStorage, and their case does not always match.
  const resolved = new Set(
    [...squadIds, ...declinedGroupIds, ...pendingAdmissionGroupIds].map((id) =>
      id.trim().toLowerCase()
    )
  );
  const seen = new Set<string>();
  const pending: OfferedWelcome[] = [];

  for (const welcome of welcomes) {
    const groupId = welcome.nostr_group_id?.trim();
    if (!groupId) continue;
    const key = groupId.toLowerCase();
    if (seen.has(key) || resolved.has(key)) continue;
    if (welcome.welcomer && blockedNpubs.has(welcome.welcomer)) continue;
    seen.add(key);
    pending.push(offeredWelcomeFromPendingMls(welcome));
  }

  // Engine-accepted rows stay visible even when the pending list is capped.
  const extras: OfferedWelcome[] = [];
  for (const extra of unmaterialized) {
    const groupId = extra.groupId?.trim();
    if (!groupId) continue;
    const key = groupId.toLowerCase();
    if (seen.has(key) || resolved.has(key)) continue;
    seen.add(key);
    extras.push(extra);
  }
  return [...extras, ...pending.slice(0, MAX_OFFERED_WELCOMES)];
}

function finalizationFromWelcome(welcome: OfferedWelcome): PendingWelcomeFinalization {
  return {
    welcomeId: welcome.id,
    groupId: welcome.groupId,
    name: welcome.name,
    description: welcome.description,
    imageUrl: welcome.imageUrl,
    inviterNpub: welcome.inviterNpub,
    memberCount: welcome.memberCount,
    acceptedAt: Date.now(),
  };
}

export function offeredWelcomeFromFinalization(row: PendingWelcomeFinalization): OfferedWelcome {
  return {
    id: row.welcomeId,
    groupId: row.groupId,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    inviterNpub: row.inviterNpub,
    memberCount: row.memberCount,
  };
}

/**
 * Join the group behind a pending welcome: accept it in the engine, then run the
 * same squad materialization the DM invite path runs. No DM message backs this,
 * so no invite-decision id is recorded.
 *
 * MLS consumes the welcome at accept time. If local materialization then fails,
 * a durable finalization record keeps the card retryable without re-accepting.
 */
export async function acceptOfferedWelcome(welcome: OfferedWelcome): Promise<void> {
  if (!requireBackupVerified()) throw new Error('Backup verification required');
  const startedAs = get(currentNpubForPersistence);
  const alreadyAccepted = getPendingWelcomeFinalizationByGroupId(welcome.groupId);
  if (!alreadyAccepted) {
    await acceptMlsWelcome(welcome.id);
    const row = finalizationFromWelcome(welcome);
    // Persist before finalize so a persistSquad failure (or crash) is retryable
    // without re-calling acceptMlsWelcome — the engine has already consumed it.
    if (get(currentNpubForPersistence) !== startedAs) {
      if (startedAs) stashPendingWelcomeFinalizationForNpub(startedAs, row);
      throw new Error('Account changed during welcome accept');
    }
    upsertPendingWelcomeFinalization(row);
  } else if (get(currentNpubForPersistence) !== startedAs) {
    throw new Error('Account changed during welcome accept');
  }

  await finalizeSquadAfterAnnouncementsWelcome(
    { groupId: welcome.groupId, name: welcome.name },
    null
  );
  clearPendingWelcomeFinalizationByGroupId(welcome.groupId);
}

/** Retry local materialization for engine-accepted welcomes after a later login. */
export async function tryCompletePendingWelcomeFinalization(groupId: string): Promise<boolean> {
  const pending = getPendingWelcomeFinalizationByGroupId(groupId);
  if (!pending) return false;
  if (squadInviteResolvedByMembership(groupId)) {
    clearPendingWelcomeFinalizationByGroupId(groupId);
    return true;
  }
  await finalizeSquadAfterAnnouncementsWelcome({ groupId: pending.groupId, name: pending.name }, null);
  clearPendingWelcomeFinalizationByGroupId(groupId);
  return true;
}

export async function tryCompleteAllPendingWelcomeFinalizations(): Promise<void> {
  for (const row of get(pendingWelcomeFinalizations)) {
    try {
      await tryCompletePendingWelcomeFinalization(row.groupId);
    } catch (e) {
      dmError('tryCompletePendingWelcomeFinalization', e);
    }
  }
}

/**
 * Refuse a pending welcome, or record that a `squad_invite` DM was declined so
 * this surface agrees with that decision.
 *
 * Local only: MLS has no decline primitive, so the welcome stays pending in the
 * engine and we merely stop offering it. Nothing reaches the inviter.
 */
export function recordDeclinedWelcomeGroupId(groupId: string): void {
  const id = groupId.trim();
  if (!id) return;
  declinedWelcomeGroupIds.update((ids) =>
    ids.some((existing) => sameMlsGroupId(existing, id)) ? ids : [...ids, id]
  );
}
