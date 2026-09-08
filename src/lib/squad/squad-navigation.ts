import { get } from 'svelte/store';
import {
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  lastOpenedChannelId,
  lastOpenedSquadId,
} from '../../stores/navigation';
import type { Squad } from '../../stores/squads';
import { ANNOUNCEMENTS_CHANNEL_NAME } from './hub-channel-names';

export interface SquadNavigationChannelDefaults {
  channelId?: string | null;
  hubChannelName?: string | null;
}

export function channelDefaultsFromSquad(squad: Squad): SquadNavigationChannelDefaults {
  const ann = squad.channels.find((c) => c.name === ANNOUNCEMENTS_CHANNEL_NAME);
  const first = squad.channels[0];
  const channelId = ann?.groupId ?? first?.groupId ?? squad.id;
  const hubChannelName = ann?.name ?? first?.name ?? null;
  return { channelId, hubChannelName };
}

/** Remap nav prefs from a temp create id to the finalized MLS parent id. */
export function remapActiveSquadNavigation(
  tempId: string,
  finalId: string,
  channelDefaults?: SquadNavigationChannelDefaults,
): void {
  const temp = tempId.trim();
  const final = finalId.trim();
  if (!temp || !final || temp === final) return;

  const channelId = channelDefaults?.channelId?.trim() || final;
  const hubChannelName = channelDefaults?.hubChannelName?.trim() || null;

  if (get(activeSquadId) === temp) {
    activeSquadId.set(final);
    activeChannelId.set(channelId);
    activeHubChannelName.set(hubChannelName);
  }

  lastOpenedSquadId.set(final);
  lastOpenedChannelId.set(channelId);

  lastChannelBySquadId.update((m) => {
    const next = { ...m };
    delete next[temp];
    next[final] = channelId;
    return next;
  });

  lastHubChannelNameBySquadId.update((m) => {
    const next = { ...m };
    delete next[temp];
    if (hubChannelName) next[final] = hubChannelName;
    else delete next[final];
    return next;
  });
}
