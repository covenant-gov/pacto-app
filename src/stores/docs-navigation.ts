import { writable, type Writable } from 'svelte/store';
import { openSquadTools } from '../lib/navigation/open-squad-dashboard';

/** `channelId` pre-selects the shelf filter; `docId` highlights one row (and clears the filter). */
export type DocsFocus = { parentId: string; docId: string | null; channelId: string | null };

/** Deep-link request consumed by the `#tools` docs mode of `parentId`. */
export const docsFocus: Writable<DocsFocus | null> = writable(null);

/** Opens `#tools` → Docs, optionally filtered to one channel or scrolled to one row. */
export function openSquadDocs(parentId: string, focus: { docId?: string | null; channelId?: string | null } = {}): void {
  const pid = parentId.trim();
  if (!pid) return;
  docsFocus.set({ parentId: pid, docId: focus.docId ?? null, channelId: focus.channelId ?? null });
  openSquadTools(pid, 'docs');
}
