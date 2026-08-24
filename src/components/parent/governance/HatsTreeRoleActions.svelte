<script lang="ts">
  import { getContext } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import GovCtaButton from './GovCtaButton.svelte';
  import { buildGovCommandGates } from '../../../lib/governance/gov-command-gates';
  import {
    HATS_TREE_ACTIONS_KEY,
    type HatsTreeActionsApi,
    type HatsTreeCommandAction,
    type HatsTreeCommandContext,
    type HatsTreeRoleActionKind,
  } from '../../../lib/governance/hats-tree-role-actions';

  interface Props {
    kind: HatsTreeRoleActionKind;
    command?: HatsTreeCommandContext | null;
    onOpen?: (action: HatsTreeCommandAction) => void;
  }

  let { kind, command = null, onOpen }: Props = $props();

  const tFn = get(t);
  const api = getContext<HatsTreeActionsApi | undefined>(HATS_TREE_ACTIONS_KEY);
  const resolved = $derived(command ?? api?.command ?? null);
  const gates = $derived(
    resolved
      ? buildGovCommandGates({
          privilege: resolved.privilege,
          capabilitiesPending: resolved.capabilitiesPending,
          mutinyStatus: resolved.mutinyStatus,
          qmStatus: resolved.qmStatus,
          captainWearers: resolved.captainWearers,
          crewWearers: resolved.crewWearers,
          memberEvmOptions: resolved.memberEvmOptions,
        })
      : null,
  );

  function open(action: HatsTreeCommandAction) {
    if (onOpen) {
      onOpen(action);
      return;
    }
    api?.open(action);
  }
</script>

{#if resolved && gates && kind === 'treasury' && resolved.treasuryAuthority}
  <div class="hats-tree-node-actions">
    <GovCtaButton
      compact
      label={tFn('governance.action.submitProposal')}
      variant="primary"
      gate={gates.treasury}
      onClick={() => open('submitProposal')}
    />
    <GovCtaButton
      compact
      label={tFn('governance.shell.openVoteMode')}
      variant="primary"
      gate={gates.treasury}
      onClick={() => open('voteMode')}
    />
  </div>
{:else if resolved && gates && kind === 'mutiny' && resolved.mutinyModule}
  <div class="hats-tree-node-actions">
    <GovCtaButton
      compact
      label={tFn('governance.action.startMutiny')}
      variant="primary"
      gate={gates.startMutiny}
      onClick={() => open('startMutiny')}
    />
    <GovCtaButton
      compact
      label={tFn('governance.action.resignCaptain')}
      variant="primary"
      gate={gates.resign}
      onClick={() => open('resign')}
    />
  </div>
{:else if resolved && gates && kind === 'quartermaster' && resolved.quartermaster}
  <div class="hats-tree-node-actions">
    <GovCtaButton
      compact
      label={tFn('governance.shell.addCrew')}
      variant="primary"
      gate={gates.qmRoster}
      onClick={() => open('addCrew')}
    />
    <GovCtaButton
      compact
      label={tFn('governance.shell.removeCrew')}
      variant="primary"
      gate={gates.qmRoster}
      onClick={() => open('removeCrew')}
    />
    <GovCtaButton
      compact
      label={tFn('governance.action.proposeOffboard')}
      variant="primary"
      gate={gates.proposeOffboard}
      onClick={() => open('proposeOffboard')}
    />
    {#if gates.bootstrapAvailable}
      <GovCtaButton
        compact
        label={tFn('governance.action.bootstrapCrew')}
        variant="primary"
        gate={gates.bootstrap}
        onClick={() => open('bootstrapCrew')}
      />
    {/if}
  </div>
{/if}

<style>
  .hats-tree-node-actions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px 8px;
    border-top: 1px solid var(--border-subtle);
  }
</style>
