<script lang="ts">
  import type { HatTreeNodeDto } from '$lib/governance/api';
  import type { SupportedChainId } from '$lib/wallet/chains';
  import HatsTreeNode from './HatsTreeNode.svelte';
  import { t } from 'svelte-i18n';

  export let root: HatTreeNodeDto;
  export let roleLabelByHatId: Record<string, string> = {};
  export let wearerAddressesByHatId: Record<string, string[]> = {};
  export let executorRolesByAddress: Record<string, string> = {};
  export let squadMemberEvmByNpub: Record<string, string> = {};
  export let knownWearerLabels: Record<string, string> = {};
  export let chainKey: SupportedChainId | null = null;
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
  />
</div>

<style>
  .hats-tree-scroll {
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    overflow-y: visible;
    padding: 8px 0 16px;
    /* Keep horizontal scroll within the mode body, not a nested card. */
    box-sizing: border-box;
  }
</style>
