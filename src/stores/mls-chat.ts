import { writable, derived } from 'svelte/store';
import type { PendingMlsWelcome } from '../lib/api/nostr';
import { buildBackendGroupTimelineMessages } from '../lib/mls/virtual-channel-bucket';
import type { DmMessage } from './dm';

export const backendGroupMessages = writable<Record<string, DmMessage[]>>({});

export const backendGroupTimelineMessages = derived(backendGroupMessages, buildBackendGroupTimelineMessages);

export const groupSendError = writable<string | null>(null);

export const pendingMlsWelcomes = writable<PendingMlsWelcome[]>([]);

export const membershipVersionByGroupId = writable<Record<string, number>>({});

export function bumpMembershipVersion(groupId: string): void {
  membershipVersionByGroupId.update((map) => ({
    ...map,
    [groupId]: (map[groupId] ?? 0) + 1,
  }));
}
