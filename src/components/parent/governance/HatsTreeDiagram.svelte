<script lang="ts">
  import type { HatTreeNodeDto } from '$lib/governance/api';
  import HatsTreeNode from './HatsTreeNode.svelte';

  export let root: HatTreeNodeDto;
</script>

<ul class="hats-tree-diagram" role="tree" aria-label="Hats tree">
  <HatsTreeNode node={root} />
</ul>

<style>
  .hats-tree-diagram {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
