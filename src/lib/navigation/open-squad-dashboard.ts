import {
  activeChannelId,
  activeSquadId,
  activeTopNavTab,
  activeView,
  DASHBOARD_CHANNEL_ID,
} from '../../stores/app';

/** Open a squad's dashboard from Settings or other non-hub views. */
export function openSquadDashboard(parentId: string): void {
  const id = parentId.trim();
  if (!id) return;
  activeTopNavTab.set('squads');
  activeSquadId.set(id);
  activeChannelId.set(DASHBOARD_CHANNEL_ID);
  activeView.set('hub');
}
