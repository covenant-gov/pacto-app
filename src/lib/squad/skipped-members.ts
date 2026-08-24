import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import type { SkippedMember, UndeliveredInvite } from '../api/nostr';
import { profiles } from '../../stores/profiles';
import { shortNpub } from './join-inbox-announce';

/**
 * Name for a member the notice has to blame. Reads the profile cache directly rather than
 * `getProfileDisplayName`, whose 'Unknown' sentinel would hide the one fact worth showing.
 */
function skippedMemberName(npub: string): string {
  const profile = get(profiles)[npub];
  const name =
    profile?.nickname?.trim() || profile?.name?.trim() || profile?.display_name?.trim();
  return name || shortNpub(npub);
}

/**
 * Warn about members left out of a squad/channel create because their key package couldn't be
 * resolved. Callers must exclude these npubs from invite DMs.
 */
export function warnSkippedMembers(skipped: SkippedMember[]): void {
  for (const { npub, reason } of skipped) {
    console.warn('[squad-create] member skipped', shortNpub(npub), reason);
  }
}

/** Localized notice text for skipped members, or '' when none were skipped. */
export function skippedMembersNotice(skipped: SkippedMember[]): string {
  if (!skipped.length) return '';
  const names = skipped.map((s) => skippedMemberName(s.npub)).join(', ');
  return get(t)('nav.navbar.organizeSquad.membersSkipped', { values: { names } });
}

/**
 * Warn about members the engine already added to the group but whose welcome delivery failed.
 * They keep an engine leaf; a resend (Restore path) is the recovery action, not a fresh invite.
 */
export function warnPendingInvites(pending: UndeliveredInvite[]): void {
  for (const { npub, reason } of pending) {
    console.warn('[squad-create] member pending invite', shortNpub(npub), reason);
  }
}

/** Localized notice text for pending-invite members, or '' when none are pending. */
export function pendingInvitesNotice(pending: UndeliveredInvite[]): string {
  if (!pending.length) return '';
  const names = pending.map((p) => skippedMemberName(p.npub)).join(', ');
  return get(t)('nav.navbar.organizeSquad.membersPendingInvite', { values: { names } });
}
