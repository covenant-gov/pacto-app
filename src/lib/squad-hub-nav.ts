/**
 * Squad / squad-pair hub navigation (Squads top tab).
 * See ai-docs/networks/RNF_PLAN.md.
 */
import { get } from 'svelte/store';
import {
  activeSquadId,
  activeChannelId,
  activeHubChannelName,
  activeView,
  activeTopNavTab,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  lastOpenedSquadId,
} from '../stores/navigation';
import { squads, DASHBOARD_CHANNEL_ID, type Squad } from '../stores/squads';
import { resolveHubChannelNameForGroupSelection } from './mls/virtual-channel-bucket';

export function resolveHubParentSquad(allSquads: Squad[], squadId: string | null): Squad | undefined {
  if (!squadId) return undefined;
  return allSquads.find((s) => s.id === squadId);
}

/** Parent open in the hub (dashboard / channels) from `activeSquadId`. */
export function resolveOpenHubParent(allSquads: Squad[], squadId: string | null): Squad | null {
  if (!squadId) return null;
  return allSquads.find((s) => s.id === squadId) ?? null;
}

export function resolveHubChannelForSquad(
  squad: Squad,
  lastChannelBySquad: Record<string, string>,
  lastHubChannelNameBySquad: Record<string, string>
): { channelId: string | null; hubChannelName: string | null } {
  const sorted = [...squad.channels].sort((a, b) => a.order - b.order);
  const firstCh = sorted[0];
  const lastForSquad = lastChannelBySquad[squad.id];
  const lastValid =
    !!lastForSquad &&
    (sorted.some((c) => c.groupId === lastForSquad) || lastForSquad === DASHBOARD_CHANNEL_ID);

  let channelId: string | null;
  if (lastValid && lastForSquad === DASHBOARD_CHANNEL_ID) {
    channelId = DASHBOARD_CHANNEL_ID;
  } else if (lastValid) {
    channelId =
      sorted.find((c) => c.groupId === lastForSquad)?.groupId ?? firstCh?.groupId ?? null;
  } else if (sorted.length > 0) {
    channelId = DASHBOARD_CHANNEL_ID;
  } else {
    channelId = null;
  }

  const hubChannelName =
    channelId && channelId !== DASHBOARD_CHANNEL_ID
      ? resolveHubChannelNameForGroupSelection(
          sorted,
          channelId,
          lastHubChannelNameBySquad[squad.id] ?? null
        )
      : null;

  return { channelId, hubChannelName };
}

function applyHubChannelSelection(squad: Squad): void {
  const { channelId, hubChannelName } = resolveHubChannelForSquad(
    squad,
    get(lastChannelBySquadId),
    get(lastHubChannelNameBySquadId)
  );
  activeChannelId.set(channelId);
  activeHubChannelName.set(hubChannelName);
}

/** Pick last-opened squad (or first) when Squads tab has rows but no active parent. */
export function restoreSquadsHubSelection(): void {
  if (get(activeTopNavTab) !== 'squads') return;
  if (get(activeSquadId)) return;

  const list = get(squads);
  if (list.length === 0) return;

  const lastSquadId = get(lastOpenedSquadId);
  const squad = (lastSquadId ? list.find((s) => s.id === lastSquadId) : null) ?? list[0];

  activeSquadId.set(squad.id);
  lastOpenedSquadId.set(squad.id);
  activeView.set('hub');
  applyHubChannelSelection(squad);
}

/** Open any squad or squad-pair in the standard Squads hub. */
export function activateSquadHub(squadId: string): void {
  activeTopNavTab.set('squads');
  const squad = get(squads).find((s) => s.id === squadId);
  if (!squad) return;

  activeSquadId.set(squadId);
  lastOpenedSquadId.set(squadId);
  activeView.set('hub');
  applyHubChannelSelection(squad);
}
