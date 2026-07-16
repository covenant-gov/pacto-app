import { createLazyComponent } from '../ui/lazy-svelte-component';

export const loadDeploySafeModal = createLazyComponent(
  () => import('../../components/parent/DeploySafeModal.svelte'),
);
export const loadDeployPactoGovModal = createLazyComponent(
  () => import('../../components/parent/governance/DeployPactoGovModal.svelte'),
);
export const loadDeployPactoGovAndSponsorModal = createLazyComponent(
  () => import('../../components/parent/governance/DeployPactoGovAndSponsorModal.svelte'),
);
export const loadDeploySquadAdminModal = createLazyComponent(
  () => import('../../components/parent/governance/DeploySquadAdminModal.svelte'),
);
