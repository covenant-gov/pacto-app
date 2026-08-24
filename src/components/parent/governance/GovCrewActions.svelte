<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import GovCtaButton from './GovCtaButton.svelte';
  import GovHatRequiredBanner from './GovHatRequiredBanner.svelte';
  import GovStartMutinyModal from './GovStartMutinyModal.svelte';
  import GovProposeOffboardModal from './GovProposeOffboardModal.svelte';
  import type { MutinyStatusDto, QuartermasterStatusDto } from '../../../lib/governance/api';
  import { isHatRequiredReason, type GovernancePrivilege } from '../../../lib/governance/governance-privilege';
  import { buildGovCommandGates } from '../../../lib/governance/gov-command-gates';

  interface Props {
    network: string;
    parentId: string;
    mutinyModule: string;
    quartermaster?: string;
    privilege: GovernancePrivilege;
    mutinyStatus?: MutinyStatusDto | null;
    qmStatus?: QuartermasterStatusDto | null;
    memberEvmOptions?: { address: string; label: string }[];
    squadMemberOptions?: { address: string; label: string }[];
    memberOptionsLoading?: boolean;
    onRefreshMutiny?: () => void;
    onRefreshQm?: () => void;
    capabilitiesPending?: boolean;
  }

  let {
    network,
    parentId,
    mutinyModule,
    quartermaster = '',
    privilege,
    mutinyStatus = null,
    qmStatus = null,
    memberEvmOptions = [],
    squadMemberOptions = [],
    memberOptionsLoading = false,
    onRefreshMutiny = () => {},
    onRefreshQm = () => {},
    capabilitiesPending = false,
  }: Props = $props();

  const tFn = get(t);

  let showMutiny = $state(false);
  let showOffboard = $state(false);

  let gates = $derived(
    buildGovCommandGates({ privilege, capabilitiesPending, mutinyStatus, qmStatus }),
  );
  let crewGate = $derived(gates.crew);
  let mutinyActive = $derived(gates.mutinyActive);
  let startMutinyGate = $derived(gates.startMutiny);
  let proposeOffboardGate = $derived(gates.proposeOffboard);
</script>

<div class="crew-actions">
  {#if !crewGate.enabled && isHatRequiredReason(crewGate.reason)}
    <GovHatRequiredBanner reason={crewGate.reason} />
  {/if}
  <div class="row">
    {#if mutinyModule}
      <GovCtaButton
        label={tFn('governance.action.startMutiny')}
        variant="primary"
        gate={startMutinyGate}
        onClick={() => (showMutiny = true)}
      />
    {/if}
    {#if quartermaster}
      <GovCtaButton
        label={tFn('governance.action.proposeOffboard')}
        variant="primary"
        gate={proposeOffboardGate}
        onClick={() => (showOffboard = true)}
      />
    {/if}
  </div>
</div>

<GovStartMutinyModal
  open={showMutiny}
  onClose={() => (showMutiny = false)}
  {network}
  {parentId}
  {mutinyModule}
  startGate={startMutinyGate}
  kindGate={startMutinyGate}
  {memberEvmOptions}
  {squadMemberOptions}
  {memberOptionsLoading}
  onSubmitted={onRefreshMutiny}
/>

<GovProposeOffboardModal
  open={showOffboard}
  onClose={() => (showOffboard = false)}
  {network}
  {parentId}
  {quartermaster}
  {privilege}
  {mutinyActive}
  {qmStatus}
  {memberEvmOptions}
  {memberOptionsLoading}
  onSubmitted={onRefreshQm}
/>

<style>
  .crew-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
