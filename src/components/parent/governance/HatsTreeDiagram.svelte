<script lang="ts">
  import { setContext } from 'svelte';
  import type { HatTreeNodeDto } from '$lib/governance/api';
  import type { SupportedChainId } from '$lib/wallet/chains';
  import {
    HATS_TREE_ACTIONS_KEY,
    type HatsTreeActionsApi,
    type HatsTreeCommandAction,
    type HatsTreeCommandContext,
  } from '$lib/governance/hats-tree-role-actions';
  import HatsTreeNode from './HatsTreeNode.svelte';
  import GovHatsTreeCommandModals from './GovHatsTreeCommandModals.svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    root: HatTreeNodeDto;
    roleLabelByHatId?: Record<string, string>;
    wearerAddressesByHatId?: Record<string, string[]>;
    executorRolesByAddress?: Record<string, string>;
    squadMemberEvmByNpub?: Record<string, string>;
    knownWearerLabels?: Record<string, string>;
    chainKey?: SupportedChainId | null;
    viewerAddress?: string;
    commandContext?: HatsTreeCommandContext | null;
  }

  let {
    root,
    roleLabelByHatId = {},
    wearerAddressesByHatId = {},
    executorRolesByAddress = {},
    squadMemberEvmByNpub = {},
    knownWearerLabels = {},
    chainKey = null,
    viewerAddress = '',
    commandContext = null,
  }: Props = $props();

  let openAction = $state<HatsTreeCommandAction | null>(null);

  const actionsApi: HatsTreeActionsApi = {
    get command() {
      return commandContext;
    },
    open(action) {
      openAction = action;
    },
  };
  setContext(HATS_TREE_ACTIONS_KEY, actionsApi);
</script>

<div class="hats-tree-scroll" role="tree" aria-label={$t('governance.title.hatsTree')}>
  <HatsTreeNode
    node={root}
    {roleLabelByHatId}
    {wearerAddressesByHatId}
    {executorRolesByAddress}
    {squadMemberEvmByNpub}
    {knownWearerLabels}
    {chainKey}
    {viewerAddress}
  />
</div>
{#if commandContext}
  <GovHatsTreeCommandModals
    command={commandContext}
    {openAction}
    onClose={() => (openAction = null)}
  />
{/if}

<style>
  .hats-tree-scroll {
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: visible;
    padding: 8px 6px 16px;
    /* Keep horizontal scroll within the mode body, not a nested card. */
    box-sizing: border-box;
  }
</style>
