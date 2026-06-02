import { createLazyComponent } from '../ui/lazy-svelte-component';

export const loadDashboardGovernanceTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardGovernanceTab.svelte'),
);
export const loadDashboardRolesTreeTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardRolesTreeTab.svelte'),
);
export const loadDashboardTreasuryTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardTreasuryTab.svelte'),
);
export const loadDashboardSettingsTab = createLazyComponent(
  () => import('../../components/parent/dashboard/DashboardSettingsTab.svelte'),
);
