<script lang="ts">
  import type { HatTreeNodeDto } from '$lib/governance/api';
  import HatsTreeNode from './HatsTreeNode.svelte';

  export let root: HatTreeNodeDto;
  export let roleLabelByHatId: Record<string, string> = {};
  export let wearerAddressesByHatId: Record<string, string[]> = {};
  export let executorRolesByAddress: Record<string, string> = {};
  export let squadMemberEvmByNpub: Record<string, string> = {};
</script>

<ul class="hats-tree-diagram" role="tree" aria-label="Hats tree">
  <HatsTreeNode
    node={root}
    {roleLabelByHatId}
    {wearerAddressesByHatId}
    {executorRolesByAddress}
    {squadMemberEvmByNpub}
  />
</ul>

<style>
  .hats-tree-diagram {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
