<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import GovCtaButton from './GovCtaButton.svelte';
  import GovHatRequiredBanner from './GovHatRequiredBanner.svelte';
  import GovBootstrapCrewModal from './GovBootstrapCrewModal.svelte';
  import GovCaptainRosterModal from './GovCaptainRosterModal.svelte';
  import GovCaptainResignModal from './GovCaptainResignModal.svelte';
  import { mutinyCaptainResign, type MutinyStatusDto, type QuartermasterStatusDto } from '../../../lib/governance/api';
  import { isHatRequiredReason, type GovernancePrivilege } from '../../../lib/governance/governance-privilege';
  import { buildGovCommandGates } from '../../../lib/governance/gov-command-gates';
  import { runGovWriteInBackground } from '../../../lib/governance/gov-write-background';
  import { pickRandomRosterCaptain, labeledWearerOptions } from '../../../lib/governance/war-game-captain';

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

  let showAddCrew = $state(false);
  let showRemoveCrew = $state(false);
  let showBootstrapModal = $state(false);
  let showResign = $state(false);

  let gates = $derived(
    buildGovCommandGates({
      privilege,
      capabilitiesPending,
      mutinyStatus,
      qmStatus,
      captainWearers,
      crewWearers,
      memberEvmOptions,
    }),
  );
  let captainGate = $derived(gates.captain);
  let qmGate = $derived(gates.qmRoster);
  let execGate = $derived(gates.exec);
  let mutinyActive = $derived(gates.mutinyActive);
  let resignGate = $derived(gates.resign);
  let randomizeGate = $derived(gates.randomize);
  let bootstrapAvailable = $derived(gates.bootstrapAvailable);
  let bootstrapGate = $derived(gates.bootstrap);
  let randomizeExclude = $derived([privilege.myAddress, ...captainWearers]);
  let randomizePool = $derived(labeledWearerOptions(crewWearers, memberEvmOptions));

  function randomizeCaptain() {
    const picked = pickRandomRosterCaptain(randomizePool, randomizeExclude);
    if (!picked) return;
    showResign = false;
    runGovWriteInBackground({
      label: tFn('governance.action.randomizeCaptain'),
      parentId,
      actionKey: 'randomize-captain',
      job: () => mutinyCaptainResign({ network, parentId, mutinyModule, newCaptain: picked }),
      onSettled: () => onRefreshMutiny(),
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
        variant="primary"
        gate={qmGate}
        onClick={() => (showAddCrew = true)}
      />
      <GovCtaButton
        label={tFn('governance.shell.removeCrew')}
        variant="primary"
        gate={qmGate}
        onClick={() => (showRemoveCrew = true)}
      />
      {#if bootstrapAvailable}
        <GovCtaButton
          label={tFn('governance.action.bootstrapCrew')}
          variant="primary"
          gate={bootstrapGate}
          onClick={() => (showBootstrapModal = true)}
        />
      {/if}
    {/if}
    {#if mutinyModule}
      <GovCtaButton
        label={tFn('governance.action.resignCaptain')}
        variant="primary"
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
