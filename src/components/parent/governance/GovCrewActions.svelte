<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import GovCtaButton from './GovCtaButton.svelte';
  import GovHatRequiredBanner from './GovHatRequiredBanner.svelte';
  import GovStartMutinyModal from './GovStartMutinyModal.svelte';
  import GovProposeOffboardModal from './GovProposeOffboardModal.svelte';
  import type { MutinyStatusDto, QuartermasterStatusDto } from '../../../lib/governance/api';
  import { isMutinyActive } from '../../../lib/governance/gov-proposal-lists';
  import {
    gateRequiresCrew,
    isHatRequiredReason,
    type CtaGate,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { isCrewOffboardActive } from '../../../lib/governance/crew-offboard';

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
    onRefreshMutiny?: () => void;
    onRefreshQm?: () => void;
    fundingHint?: string;
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
    onRefreshMutiny = () => {},
    onRefreshQm = () => {},
    fundingHint = '',
    capabilitiesPending = false,
  }: Props = $props();

  const tFn = get(t);
  const PENDING_GATE: CtaGate = { enabled: false, reason: 'governance.status.loading' };

  let showMutiny = $state(false);
  let showOffboard = $state(false);

  let crewGate = $derived(capabilitiesPending ? PENDING_GATE : gateRequiresCrew(privilege));
  let mutinyActive = $derived(isMutinyActive(mutinyStatus));
  let offboardActive = $derived(isCrewOffboardActive(qmStatus));
  let startMutinyGate = $derived.by((): CtaGate => {
    if (mutinyActive) return { enabled: false, reason: 'governance.gate.mutinyAlreadyActive' };
    if (offboardActive) return { enabled: false, reason: 'governance.gate.cannotStartMutinyWhileOffboard' };
    return crewGate;
  });
  let proposeOffboardGate = $derived.by((): CtaGate => {
    if (offboardActive) return { enabled: false, reason: 'governance.gate.offboardAlreadyActive' };
    if (mutinyActive) return { enabled: false, reason: 'governance.gate.cannotOffboardWhileMutiny' };
    return crewGate;
  });
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
  {fundingHint}
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
