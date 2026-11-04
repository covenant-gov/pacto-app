import { get, writable, type Writable } from 'svelte/store';
import { navigateToTarget } from '../lib/navigation/open-squad-dashboard';
import { getAnnouncementsChannel } from '../lib/parent-navbar';
import { DOCS_CHANNEL_NAME } from '../lib/squad/hub-channel-names';
import { squads } from './squads';

/** `channelId` pre-selects the shelf filter; `docId` highlights one row (and clears the filter). */
export type DocsFocus = { parentId: string; docId: string | null; channelId: string | null };

/** Deep-link request consumed by the `#docs` panel of `parentId`. */
export const docsFocus: Writable<DocsFocus | null> = writable(null);

/** Opens `#docs`, optionally filtered to one channel or scrolled to one row. */
export function openSquadDocs(parentId: string, focus: { docId?: string | null; channelId?: string | null } = {}): void {
  const pid = parentId.trim();
  if (!pid) return;
  const squad = get(squads).find((s) => s.id === pid);
  const announcementsGroupId = squad?.channels.length ? getAnnouncementsChannel(squad)?.groupId?.trim() : '';
  if (!announcementsGroupId) return;
  docsFocus.set({ parentId: pid, docId: focus.docId ?? null, channelId: focus.channelId ?? null });
  navigateToTarget({
    kind: 'squad-channel',
    squadId: pid,
    channelId: announcementsGroupId,
    hubChannelName: DOCS_CHANNEL_NAME,
  });
}
