import {
  activeChannelId,
  activeDmId,
  activeHubChannelName,
  activeSquadId,
  activeTopNavTab,
  activeView,
  lastChannelBySquadId,
  lastHubChannelNameBySquadId,
  lastOpenedChannelId,
  lastOpenedSquadId,
  settingsChannelMode,
  squads,
  SQUAD_DASHBOARD_CHANNEL_ID,
  SQUAD_WARGAME_CHANNEL_ID,
  isVirtualHubChannelId,
  type Squad,
} from '../../stores/app';
import { resolveHubChannelNameForGroupSelection } from '../mls/virtual-channel-bucket';
import { ANNOUNCEMENTS_CHANNEL_NAME, SETTINGS_CHANNEL_ID } from '../squad/hub-channel-names';
import { get } from 'svelte/store';

/**
 * A complete deep-link target. Generalizes the navigation state Toast's
 * `goToSpace` set for a squad channel (the only pre-existing complete
 * example — see the Planning Contract) to also cover a squad's dashboard
 * tab and a DM peer, so `sourceEventId`-referencing surfaces like Catch up
 * can land a member in the exact canonical home an item resolves in.
 */
export type NavigationTarget =
  | { kind: 'squad-channel'; squadId: string; channelId: string; hubChannelName?: string | null }
  | { kind: 'squad-dashboard'; squadId: string }
  | { kind: 'dm'; npub: string };

/** Sets every store a squad-channel navigation touches (nav + memory), matching Toast's `goToSpace`. */
function navigateToSquadChannel(squadId: string, channelId: string, preferredHubChannelName?: string | null): void {
  activeTopNavTab.set('squads');
  activeSquadId.set(squadId);
  activeChannelId.set(channelId);
  activeView.set('hub');
  lastOpenedSquadId.set(squadId);
  lastOpenedChannelId.set(channelId);
  lastChannelBySquadId.update((m) => ({ ...m, [squadId]: channelId }));

  const squad = get(squads).find((s) => s.id === squadId);
  const isVirtual = isVirtualHubChannelId(channelId);
  const hub = isVirtual
    ? null
    : resolveHubChannelNameForGroupSelection(squad?.channels ?? [], channelId, preferredHubChannelName ?? null);
  activeHubChannelName.set(hub);
  if (hub) lastHubChannelNameBySquadId.update((m) => ({ ...m, [squadId]: hub }));
}

/** Open a squad's squad-dashboard from Settings, Catch up, or other non-hub views. */
export function openSquadDashboard(parentId: string): void {
  const id = parentId.trim();
  if (!id) return;
  navigateToSquadChannel(id, SQUAD_DASHBOARD_CHANNEL_ID);
}

/** Open a squad's squad-wargame hub from Status or other non-hub views. */
export function openSquadWargame(parentId: string): void {
  const id = parentId.trim();
  if (!id) return;
  navigateToSquadChannel(id, SQUAD_WARGAME_CHANNEL_ID);
}

/** Full navigation state change for landing on a DM peer's thread. */
function navigateToDm(npub: string): void {
  activeDmId.set(npub);
  activeTopNavTab.set('dms');
  activeView.set('hub');
}

/** Applies a resolved deep-link target — the shared resolver Toast's handler and Catch up both route through. */
export function navigateToTarget(target: NavigationTarget): void {
  if (target.kind === 'dm') {
    navigateToDm(target.npub);
    return;
  }
  if (target.kind === 'squad-dashboard') {
    navigateToSquadChannel(target.squadId, SQUAD_DASHBOARD_CHANNEL_ID);
    return;
  }
  if (target.channelId === SETTINGS_CHANNEL_ID) {
    settingsChannelMode.set('squad');
  }
  navigateToSquadChannel(target.squadId, target.channelId, target.hubChannelName);
}

/**
 * Classifies a Catch up entry's `chatId` into its canonical-home target
 * (R22): a real squad channel group id, a DM npub, or — for `action_prompt`
 * entries recorded against a squad's announcements channel (the governance
 * roster-key prompt and pending join requests both use that fallback id,
 * since neither is tied to one specific channel) — `#settings` for
 * `join-request:*` items and the squad dashboard for other prompts.
 * Returns `null` for a reference that resolves to nothing (a bug in the
 * Catch up backend's orphan cleanup, not an expected case here).
 */
export function resolveCatchUpTarget(
  entry: { chatId: string; kind: string; sourceEventId?: string },
  allSquads: Squad[]
): NavigationTarget | null {
  for (const squad of allSquads) {
    const channel = squad.channels.find((c) => c.groupId === entry.chatId);
    if (!channel) continue;
    if (entry.kind === 'action_prompt' && channel.name === ANNOUNCEMENTS_CHANNEL_NAME) {
      if (entry.sourceEventId?.startsWith('join-request:')) {
        return { kind: 'squad-channel', squadId: squad.id, channelId: SETTINGS_CHANNEL_ID };
      }
      return { kind: 'squad-dashboard', squadId: squad.id };
    }
    return { kind: 'squad-channel', squadId: squad.id, channelId: entry.chatId };
  }
  if (entry.chatId.startsWith('npub1')) {
    return { kind: 'dm', npub: entry.chatId };
  }
  return null;
}
