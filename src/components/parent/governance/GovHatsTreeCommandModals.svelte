<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import GovSubmitProposalModal from './GovSubmitProposalModal.svelte';
  import GovVoteModeModal from './GovVoteModeModal.svelte';
  import GovStartMutinyModal from './GovStartMutinyModal.svelte';
  import GovProposeOffboardModal from './GovProposeOffboardModal.svelte';
  import GovCaptainRosterModal from './GovCaptainRosterModal.svelte';
  import GovBootstrapCrewModal from './GovBootstrapCrewModal.svelte';
  import GovCaptainResignModal from './GovCaptainResignModal.svelte';
  import { mutinyCaptainResign } from '../../../lib/governance/api';
  import { buildGovCommandGates } from '../../../lib/governance/gov-command-gates';
  import { runGovWriteInBackground } from '../../../lib/governance/gov-write-background';
  import { labeledWearerOptions, pickRandomRosterCaptain } from '../../../lib/governance/war-game-captain';
  import { govMemberOptions } from '../../../lib/governance/gov-member-options';
  import type { HatsTreeCommandAction, HatsTreeCommandContext } from '../../../lib/governance/hats-tree-role-actions';

  interface Props {
    command: HatsTreeCommandContext;
    openAction?: HatsTreeCommandAction | null;
    onClose?: () => void;
  }

  let { command, openAction = null, onClose = () => {} }: Props = $props();

  const tFn = get(t);

  const gates = $derived(
    buildGovCommandGates({
      privilege: command.privilege,
      capabilitiesPending: command.capabilitiesPending,
      mutinyStatus: command.mutinyStatus,
      qmStatus: command.qmStatus,
      captainWearers: command.captainWearers,
      crewWearers: command.crewWearers,
      memberEvmOptions: command.memberEvmOptions,
    }),
  );
  const randomizeExclude = $derived([command.privilege.myAddress, ...command.captainWearers]);
  const randomizePool = $derived(labeledWearerOptions(command.crewWearers, command.memberEvmOptions));
  const addCrewOptions = $derived(
    govMemberOptions({
      roster: command.memberEvmOptions,
      crewWearers: command.crewWearers,
      preset: 'squadNotCrew',
    }),
  );
  const removeCrewOptions = $derived(
    govMemberOptions({
      roster: command.memberEvmOptions,
      crewWearers: command.crewWearers,
      preset: 'crewWearers',
    }),
  );

  function randomizeCaptain() {
    const picked = pickRandomRosterCaptain(randomizePool, randomizeExclude);
    if (!picked) return;
    onClose();
    runGovWriteInBackground({
      label: tFn('governance.action.randomizeCaptain'),
      parentId: command.parentId,
      actionKey: 'randomize-captain',
      job: () =>
        mutinyCaptainResign({
          network: command.network,
          parentId: command.parentId,
          mutinyModule: command.mutinyModule,
          newCaptain: picked,
        }),
      onSettled: () => command.refreshMutiny(),
    });
  }
</script>

<GovSubmitProposalModal
  open={openAction === 'submitProposal'}
  {onClose}
  network={command.network}
  parentId={command.parentId}
  treasuryAuthority={command.treasuryAuthority}
  privilege={command.privilege}
  capabilitiesPending={command.capabilitiesPending}
  onSubmitted={command.refreshProposals}
/>

<GovVoteModeModal
  open={openAction === 'voteMode'}
  {onClose}
  network={command.network}
  parentId={command.parentId}
  treasuryAuthority={command.treasuryAuthority}
  privilege={command.privilege}
  onSubmitted={command.refreshProposals}
/>

<GovStartMutinyModal
  open={openAction === 'startMutiny'}
  {onClose}
  network={command.network}
  parentId={command.parentId}
  mutinyModule={command.mutinyModule}
  startGate={gates.startMutiny}
  kindGate={gates.startMutiny}
  memberEvmOptions={command.crewMemberOptions}
  squadMemberOptions={command.memberEvmOptions}
  memberOptionsLoading={command.memberOptionsLoading}
  onSubmitted={command.refreshMutiny}
/>

<GovProposeOffboardModal
  open={openAction === 'proposeOffboard'}
  {onClose}
  network={command.network}
  parentId={command.parentId}
  quartermaster={command.quartermaster}
  privilege={command.privilege}
  mutinyActive={gates.mutinyActive}
  qmStatus={command.qmStatus}
  memberEvmOptions={command.crewMemberOptions}
  memberOptionsLoading={command.memberOptionsLoading}
  onSubmitted={command.refreshQm}
/>

<GovCaptainRosterModal
  open={openAction === 'addCrew'}
  {onClose}
  mode="add"
  network={command.network}
  parentId={command.parentId}
  quartermaster={command.quartermaster}
  qmStatus={command.qmStatus}
  memberEvmOptions={addCrewOptions}
  memberOptionsLoading={command.memberOptionsLoading}
  emptyKey="governance.gate.noSquadMemberToAdd"
  qmGate={gates.qmRoster}
  execGate={gates.exec}
  onSubmitted={command.refreshQm}
/>

<GovCaptainRosterModal
  open={openAction === 'removeCrew'}
  {onClose}
  mode="remove"
  network={command.network}
  parentId={command.parentId}
  quartermaster={command.quartermaster}
  qmStatus={command.qmStatus}
  memberEvmOptions={removeCrewOptions}
  memberOptionsLoading={command.memberOptionsLoading}
  emptyKey="governance.gate.noCrewHatToRemove"
  qmGate={gates.qmRoster}
  execGate={gates.exec}
  onSubmitted={command.refreshQm}
/>

<GovBootstrapCrewModal
  open={openAction === 'bootstrapCrew'}
  {onClose}
  network={command.network}
  parentId={command.parentId}
  quartermaster={command.quartermaster}
  privilege={command.privilege}
  memberOptions={command.memberEvmOptions}
  captainAddresses={command.captainWearers}
  onSubmitted={command.refreshQm}
/>

<GovCaptainResignModal
  open={openAction === 'resign'}
  {onClose}
  network={command.network}
  parentId={command.parentId}
  mutinyModule={command.mutinyModule}
  resignGate={gates.resign}
  randomizeGate={gates.randomize}
  warGameStack={command.warGameStack}
  captainGateEnabled={gates.captain.enabled}
  mutinyActive={gates.mutinyActive}
  onRandomize={randomizeCaptain}
  onSubmitted={command.refreshMutiny}
/>
