import { createLazyComponent } from '../ui/lazy-svelte-component';

export const loadDeploySafeModal = createLazyComponent(
  () => import('../../components/parent/DeploySafeModal.svelte'),
);
export const loadDeployNavePirataWizard = createLazyComponent(
  () => import('../../components/parent/governance/DeployNavePirataWizard.svelte'),
);
export const loadDeploySquadSponsorModal = createLazyComponent(
  () => import('../../components/parent/governance/DeploySquadSponsorModal.svelte'),
);
export const loadDeploySquadAdminModal = createLazyComponent(
  () => import('../../components/parent/governance/DeploySquadAdminModal.svelte'),
);
