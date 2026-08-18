import { createLazyComponent } from '../ui/lazy-svelte-component';

export const loadDashboardStatusTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardStatusTab.svelte'),
);
export const loadDashboardGovernanceTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardGovernanceTab.svelte'),
);
export const loadDashboardRolesTreeTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardRolesTreeTab.svelte'),
);
export const loadDashboardTreasuryTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardTreasuryTab.svelte'),
);
export const loadDashboardCrewTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardCrewTab.svelte'),
);
export const loadDashboardSettingsTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardSettingsTab.svelte'),
);
export const loadMyDashboardStatusTab = createLazyComponent(
  () => import('../../components/parent/dashboard/MyDashboardStatusTab.svelte'),
);
export const loadMyDashboardAlertsTab = createLazyComponent(
  () => import('../../components/parent/dashboard/MyDashboardAlertsTab.svelte'),
);
