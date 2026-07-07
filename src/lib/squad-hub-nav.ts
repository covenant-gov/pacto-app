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

/** Parent squad id for an MLS channel group (announcements row or child channel). */
export function parentIdForChannelGroup(allSquads: Squad[], groupId: string): string | null {
  const gid = groupId.trim();
  if (!gid) return null;
  for (const s of allSquads) {
    if (s.id === gid) return s.id;
    if (s.channels.some((ch) => ch.groupId === gid)) return s.id;
  }
  return null;
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
    channelId = DASHBOARD_CHANNEL_ID;
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

function isActiveChannelValidForSquad(squad: Squad, channelId: string | null): boolean {
  if (!channelId || channelId.startsWith('creating-')) return false;
  if (channelId === DASHBOARD_CHANNEL_ID) return true;
  return squad.channels.some((c) => c.groupId === channelId);
}

/** Resolved channel for the open squad — used for hub routing before store sync catches up. */
export function resolveEffectiveHubChannel(
  squad: Squad | null | undefined,
  activeChannelId: string | null,
  lastChannelBySquad: Record<string, string>,
  lastHubChannelNameBySquad: Record<string, string>,
): { channelId: string | null; hubChannelName: string | null } {
  if (!squad) return { channelId: activeChannelId, hubChannelName: null };
  if (isActiveChannelValidForSquad(squad, activeChannelId)) {
    const hub =
      activeChannelId && activeChannelId !== DASHBOARD_CHANNEL_ID
        ? resolveHubChannelNameForGroupSelection(
            squad.channels,
            activeChannelId,
            lastHubChannelNameBySquad[squad.id] ?? null,
          )
        : null;
    return { channelId: activeChannelId, hubChannelName: hub };
  }
  const resolved = resolveHubChannelForSquad(squad, lastChannelBySquad, lastHubChannelNameBySquad);
  if (!resolved.channelId) {
    return { channelId: DASHBOARD_CHANNEL_ID, hubChannelName: null };
  }
  return resolved;
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

/**
 * Ensure Squads hub has a valid `(activeSquadId, activeChannelId)` pair after hydrate or tab restore.
 * Re-applies channel selection when the squad is set but the channel is missing or stale.
 */
export function syncSquadsHubSelection(): void {
  if (get(activeTopNavTab) !== 'squads') return;
  const list = get(squads);
  if (list.length === 0) return;

  const existingId = get(activeSquadId);
  if (existingId) {
    const squad = list.find((s) => s.id === existingId);
    if (squad) {
      if (isActiveChannelValidForSquad(squad, get(activeChannelId))) return;
      applyHubChannelSelection(squad);
      return;
    }
  }

  const lastSquadId = get(lastOpenedSquadId);
  const squad = (lastSquadId ? list.find((s) => s.id === lastSquadId) : null) ?? list[0];
  if (!squad) return;

  activeSquadId.set(squad.id);
  lastOpenedSquadId.set(squad.id);
  activeView.set('hub');
  applyHubChannelSelection(squad);
}

/** Pick last-opened squad (or first) when Squads tab has rows but no active parent. */
export function restoreSquadsHubSelection(): void {
  syncSquadsHubSelection();
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
