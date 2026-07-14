<script lang="ts">
  import type { HatTreeNodeDto } from '$lib/governance/api';
  import HatsTreeNode from './HatsTreeNode.svelte';

  export let root: HatTreeNodeDto;
  export let roleLabelByHatId: Record<string, string> = {};
  export let wearerAddressesByHatId: Record<string, string[]> = {};
  export let executorRolesByAddress: Record<string, string> = {};
  export let squadMemberEvmByNpub: Record<string, string> = {};
</script>

<div class="hats-tree-scroll" role="tree" aria-label="Hats tree">
  <HatsTreeNode
    node={root}
    {roleLabelByHatId}
    {wearerAddressesByHatId}
    {executorRolesByAddress}
    {squadMemberEvmByNpub}
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
