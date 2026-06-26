import { get } from 'svelte/store';
import { leaveMlsGroup } from '../api/nostr';
import { uniqueChannelsByGroupIdPreservingOrder } from '../parent-navbar';
import { resolveHubChannelNameForGroupSelection } from '../mls/virtual-channel-bucket';
import { getInvokeErrorMessage, friendlyMessage } from '../utils/tauri-errors';
import { deleteSquad, persistSquad } from '../squad/squad-catalog';
import { clearParentDashboardCaches } from './clear-parent-dashboard-caches';
import { currentNpubForPersistence } from '../../stores/persistence-context';
import { squads, type Squad } from '../../stores/squads';
import {
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  lastHubChannelNameBySquadId,
} from '../../stores/navigation';

/** Remove parent locally, delete catalog row, then leave MLS groups; revert on failure. */
export function runExitParent(opts: {
  squad: Squad;
  wasActive: boolean;
  previousChannelId: string | null;
  onFailure: (message: string) => void;
}): void {
  const { squad, wasActive, previousChannelId, onFailure } = opts;

  squads.update((list) => list.filter((s) => s.id !== squad.id));
  if (wasActive) {
    activeSquadId.set(null);
    activeChannelId.set(null);
    activeHubChannelName.set(null);
  }

  void (async () => {
    try {
      await deleteSquad(squad.id);
      clearParentDashboardCaches(get(currentNpubForPersistence), squad.id);
      for (const ch of uniqueChannelsByGroupIdPreservingOrder(squad.channels)) {
        await leaveMlsGroup(ch.groupId);
      }
    } catch (e) {
      const msg = friendlyMessage(getInvokeErrorMessage(e));
      try {
        await persistSquad(squad);
      } catch {
        // store-only revert if catalog write fails
      }
      squads.update((list) => (list.some((s) => s.id === squad.id) ? list : [...list, squad]));
      if (wasActive) {
        activeSquadId.set(squad.id);
        const gid = previousChannelId ?? squad.channels[0]?.groupId ?? null;
        activeChannelId.set(gid);
        activeHubChannelName.set(
          gid
            ? resolveHubChannelNameForGroupSelection(
                squad.channels,
                gid,
                get(lastHubChannelNameBySquadId)[squad.id] || null,
              )
            : null,
        );
      }
      onFailure(msg);
    }
  })();
}
