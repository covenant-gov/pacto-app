import { createLazyComponent } from '../ui/lazy-svelte-component';

export const loadDashboardStatusTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardStatusTab.svelte'),
);
export const loadDashboardGovernanceTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardGovernanceTab.svelte'),
);
export const loadDashboardTreasuryTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardTreasuryTab.svelte'),
);
export const loadDashboardCrewTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardCrewTab.svelte'),
);
export const loadDashboardSettingsUsTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardSettingsUsTab.svelte'),
);
export const loadDashboardSettingsAccessTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardSettingsAccessTab.svelte'),
);
export const loadDashboardSettingsNetworkTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardSettingsNetworkTab.svelte'),
);
export const loadMyDashboardStatusTab = createLazyComponent(
  () => import('../../components/parent/dashboard/MyDashboardStatusTab.svelte'),
);
export const loadMyDashboardAlertsTab = createLazyComponent(
  () => import('../../components/parent/dashboard/MyDashboardAlertsTab.svelte'),
);
export const loadDashboardPollsPanel = createLazyComponent(
  () => import('../../components/parent/DashboardPollsPanel.svelte'),
);
export const loadSquadEventsPanel = createLazyComponent(
  () => import('../../components/parent/SquadEventsPanel.svelte'),
);
export const loadSquadDocsPanel = createLazyComponent(
  () => import('../../components/parent/SquadDocsPanel.svelte'),
);
