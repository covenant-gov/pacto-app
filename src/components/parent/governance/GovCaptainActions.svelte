<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import GovCtaButton from './GovCtaButton.svelte';
  import GovHatRequiredBanner from './GovHatRequiredBanner.svelte';
  import GovBootstrapCrewModal from './GovBootstrapCrewModal.svelte';
  import GovCaptainRosterModal from './GovCaptainRosterModal.svelte';
  import GovCaptainResignModal from './GovCaptainResignModal.svelte';
  import { mutinyCaptainResign, type MutinyStatusDto, type QuartermasterStatusDto } from '../../../lib/governance/api';
  import { isMutinyActive } from '../../../lib/governance/gov-proposal-lists';
  import { isCrewOffboardActive } from '../../../lib/governance/crew-offboard';
  import {
    gateBlockedByMutinyMode,
    gatePermissionlessSigner,
    gateRequiresCaptain,
    isHatRequiredReason,
    type CtaGate,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import {
    fundedByFromWriteResult,
    govWriteSubmittedToast,
  } from '../../../lib/governance/gov-write-funding';
  import { showGovWriteErrorToast } from '../../../lib/governance/gov-write-errors';
  import {
    pickRandomRosterCaptain,
    randomizeCaptainCandidates,
    labeledWearerOptions,
  } from '../../../lib/governance/war-game-captain';
  import { showToast } from '../../../stores/toast';

  interface Props {
    network: string;
    parentId: string;
    quartermaster: string;
    mutinyModule: string;
    privilege: GovernancePrivilege;
    mutinyStatus?: MutinyStatusDto | null;
    qmStatus?: QuartermasterStatusDto | null;
    memberEvmOptions?: { address: string; label: string }[];
    captainWearers?: string[];
    crewWearers?: string[];
    warGameStack?: boolean;
    onRefreshMutiny?: () => void;
    onRefreshQm?: () => void;
    capabilitiesPending?: boolean;
  }

  let {
    network,
    parentId,
    quartermaster,
    mutinyModule,
    privilege,
    mutinyStatus = null,
    qmStatus = null,
    memberEvmOptions = [],
    captainWearers = [],
    crewWearers = [],
    warGameStack = false,
    onRefreshMutiny = () => {},
    onRefreshQm = () => {},
    capabilitiesPending = false,
  }: Props = $props();

  const tFn = get(t);
  const PENDING_GATE: CtaGate = { enabled: false, reason: 'governance.status.loading' };

  let acting = $state(false);
  let showAddCrew = $state(false);
  let showRemoveCrew = $state(false);
  let showBootstrapModal = $state(false);
  let showResign = $state(false);

  let captainGate = $derived(capabilitiesPending ? PENDING_GATE : gateRequiresCaptain(privilege));
  let offboardActive = $derived(isCrewOffboardActive(qmStatus));
  let rosterFrozen = $derived(!!qmStatus?.mutinyActive || offboardActive);
  let rosterFreezeReason = $derived(
    qmStatus?.mutinyActive ? 'governance.gate.quartermasterLocked' : 'governance.gate.rosterFrozenOffboard',
  );
  let qmGate = $derived(
    capabilitiesPending ? PENDING_GATE : gateBlockedByMutinyMode(privilege, rosterFrozen, rosterFreezeReason),
  );
  let execGate = $derived(capabilitiesPending ? PENDING_GATE : gatePermissionlessSigner(privilege));
  let mutinyActive = $derived(isMutinyActive(mutinyStatus));
  let randomizeExclude = $derived([privilege.myAddress, ...captainWearers]);
  let randomizePool = $derived(labeledWearerOptions(crewWearers, memberEvmOptions));
  let randomizeCandidates = $derived(randomizeCaptainCandidates(randomizePool, randomizeExclude));
  let resignGate = $derived(
    mutinyActive
      ? ({ enabled: false, reason: 'governance.gate.cannotResignWhileMutiny' } as const)
      : captainGate,
  );
  let randomizeGate = $derived.by((): CtaGate => {
    if (mutinyActive) {
      return { enabled: false, reason: 'governance.gate.cannotResignWhileMutiny' };
    }
    if (!captainGate.enabled) return captainGate;
    if (randomizeCandidates.length === 0) {
      return { enabled: false, reason: 'governance.gate.noOtherRosterForCaptain' };
    }
    return captainGate;
  });
  let bootstrapAvailable = $derived(qmStatus?.bootstrapAvailable === true);
  let bootstrapGate = $derived(capabilitiesPending ? PENDING_GATE : captainGate);

  function randomizeCaptain() {
    const picked = pickRandomRosterCaptain(randomizePool, randomizeExclude);
    if (!picked) return;
    acting = true;
    void mutinyCaptainResign({ network, parentId, mutinyModule, newCaptain: picked })
      .then((result) => {
        showToast(
          govWriteSubmittedToast(tFn('governance.action.randomizeCaptain'), fundedByFromWriteResult(result)),
        );
        onRefreshMutiny();
        showResign = false;
      })
      .catch((e) => {
        showGovWriteErrorToast(e, tFn('governance.action.randomizeCaptain'));
      })
      .finally(() => {
        acting = false;
      });
  }
</script>

<div class="captain-actions">
  {#if !captainGate.enabled && isHatRequiredReason(captainGate.reason)}
    <GovHatRequiredBanner reason={captainGate.reason} />
  {/if}
  <div class="row">
    {#if quartermaster}
      <GovCtaButton
        label={tFn('governance.shell.addCrew')}
        gate={qmGate}
        onClick={() => (showAddCrew = true)}
      />
      <GovCtaButton
        label={tFn('governance.shell.removeCrew')}
        gate={qmGate}
        onClick={() => (showRemoveCrew = true)}
      />
      {#if bootstrapAvailable}
        <GovCtaButton
          label={tFn('governance.action.bootstrapCrew')}
          variant="primary"
          gate={bootstrapGate}
          {acting}
          onClick={() => (showBootstrapModal = true)}
        />
      {/if}
    {/if}
    {#if mutinyModule}
      <GovCtaButton
        label={tFn('governance.action.resignCaptain')}
        gate={resignGate}
        onClick={() => (showResign = true)}
      />
    {/if}
  </div>
</div>

<GovCaptainRosterModal
  open={showAddCrew}
  onClose={() => (showAddCrew = false)}
  mode="add"
  {network}
  {parentId}
  {quartermaster}
  {qmStatus}
  {memberEvmOptions}
  {qmGate}
  {execGate}
  onSubmitted={onRefreshQm}
/>

<GovCaptainRosterModal
  open={showRemoveCrew}
  onClose={() => (showRemoveCrew = false)}
  mode="remove"
  {network}
  {parentId}
  {quartermaster}
  {qmStatus}
  {memberEvmOptions}
  {qmGate}
  {execGate}
  onSubmitted={onRefreshQm}
/>

<GovBootstrapCrewModal
  open={showBootstrapModal}
  onClose={() => (showBootstrapModal = false)}
  {network}
  {parentId}
  {quartermaster}
  {privilege}
  memberOptions={memberEvmOptions}
  captainAddresses={captainWearers}
  onSubmitted={onRefreshQm}
/>

<GovCaptainResignModal
  open={showResign}
  onClose={() => (showResign = false)}
  {network}
  {parentId}
  {mutinyModule}
  {resignGate}
  {randomizeGate}
  {warGameStack}
  captainGateEnabled={captainGate.enabled}
  {mutinyActive}
  onRandomize={randomizeCaptain}
  onSubmitted={onRefreshMutiny}
  parentActing={acting}
/>

<style>
  .captain-actions {
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
