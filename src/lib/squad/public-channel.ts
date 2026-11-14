/**
 * NIP-28 public channels. The squad roster stays local and is never published.
 */

import { get } from 'svelte/store';
import { watchPublicChannels } from '../api/nostr';
import type { Squad } from '../../stores/squads';
import { squads } from '../../stores/squads';

export function publicChannelIds(list: Squad[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const squad of list) {
    for (const channel of squad.channels) {
      if (channel.access !== 'public') continue;
      const id = channel.groupId.trim();
      if (!id || id.startsWith('creating-') || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Tell the backend which kind-40 ids to store. Empty clears the watch set. */
export async function watchKnownPublicChannels(): Promise<void> {
  try {
    await watchPublicChannels(publicChannelIds(get(squads)));
  } catch (e) {
    console.warn('[public-channel] watch failed', e);
  }
}
