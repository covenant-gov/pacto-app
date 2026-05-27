<script lang="ts">
  import type { HatTreeNodeDto } from '$lib/governance/api';

  export let node: HatTreeNodeDto;
</script>

<li class="hats-tree-node" role="treeitem" aria-expanded="true">
  <div class="hats-tree-node-card">
    <span class="hats-tree-node-title">{node.details?.trim() || 'Untitled hat'}</span>
    <code class="hats-tree-node-id">{node.hatId}</code>
    <span class="hats-tree-node-meta muted"
      >{node.supply}/{node.maxSupply} · {node.active ? 'active' : 'inactive'}</span
    >
  </div>
  {#if (node.children?.length ?? 0) > 0}
    <ul class="hats-tree-children" role="group">
      {#each node.children ?? [] as child (child.hatId)}
        <svelte:self node={child} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  .hats-tree-node {
    position: relative;
  }

  .hats-tree-children {
    list-style: none;
    margin: 0;
    margin-left: 20px;
    padding: 0 0 0 16px;
    border-left: 2px solid var(--border-subtle);
  }

  .hats-tree-children > :global(.hats-tree-node)::before {
    content: '';
    position: absolute;
    left: -16px;
    top: 22px;
    width: 14px;
    height: 2px;
    background: var(--border-subtle);
  }

  .hats-tree-node-card {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    padding: 10px 12px;
    margin: 6px 0;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
  }

  .hats-tree-node-title {
    font-weight: 600;
    font-size: 0.9375rem;
    color: var(--text-primary);
  }

  .hats-tree-node-id {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .hats-tree-node-meta {
    font-size: 0.75rem;
    width: 100%;
  }

  .muted {
    color: var(--text-muted);
  }
</style>
