import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import type { SkippedMember } from '../api/nostr';
import { showToast } from '../../stores/toast';
import { shortNpub } from './squad-bot-announce';

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
export function skippedMembersNotice(
  skipped: SkippedMember[],
  resolveName: (npub: string) => string = shortNpub
): string {
  if (!skipped.length) return '';
  const names = skipped
    .map((s) => resolveName(s.npub).trim() || shortNpub(s.npub))
    .join(', ');
  return get(t)('nav.navbar.organizeSquad.membersSkipped', { values: { names } });
}

/** Warn + toast convenience for callers with no competing toast in flight. */
export function reportSkippedMembers(
  skipped: SkippedMember[],
  resolveName: (npub: string) => string = shortNpub
): void {
  if (!skipped.length) return;
  warnSkippedMembers(skipped);
  showToast(skippedMembersNotice(skipped, resolveName));
}
