<script lang="ts">
  import type { HatTreeNodeDto } from '../../../lib/governance/api';
  import {
    formatWearerDisplayLabel,
    npubByEvmAddressFromSquadRoster,
  } from '../../../lib/governance/hats-tree-annotations';
  import { getProfileDisplayName } from '../../../lib/utils/profile';
  import { profiles } from '../../../stores/profiles';

  export let node: HatTreeNodeDto;
  export let roleLabelByHatId: Record<string, string> = {};
  export let wearerAddressesByHatId: Record<string, string[]> = {};
  export let executorRolesByAddress: Record<string, string> = {};
  export let squadMemberEvmByNpub: Record<string, string> = {};

  $: roleLabel = roleLabelByHatId[node.hatId] ?? '';
  $: wearerAddresses = wearerAddressesByHatId[node.hatId] ?? [];
  $: npubByAddress = npubByEvmAddressFromSquadRoster(squadMemberEvmByNpub);

  function wearerLabel(address: string): string {
    return formatWearerDisplayLabel(address, npubByAddress, (npub) =>
      getProfileDisplayName($profiles[npub]),
    );
  }

  function executorRolesLabel(address: string): string {
    return executorRolesByAddress[address.trim().toLowerCase()] ?? '';
  }
</script>

<li class="hats-tree-node" role="treeitem" aria-expanded="true">
  <div class="hats-tree-node-card">
    <span class="hats-tree-node-title">{node.details?.trim() || 'Untitled hat'}</span>
    {#if roleLabel}
      <span class="hats-tree-role-badge">{roleLabel}</span>
    {/if}
    <code class="hats-tree-node-id">{node.hatId}</code>
    <span class="hats-tree-node-meta muted"
      >{node.supply}/{node.maxSupply} · {node.active ? 'active' : 'inactive'}</span
    >
    {#if wearerAddresses.length > 0}
      <span class="hats-tree-wearers muted">
        Worn by
        {#each wearerAddresses as address, i (address)}
          {#if i > 0}, {/if}
          <span class="hats-tree-wearer">
            {wearerLabel(address)}{#if executorRolesLabel(address)}<span
                class="hats-tree-executor-roles"
                > · Squad roles: {executorRolesLabel(address)}</span
              >{/if}
          </span>
        {/each}
      </span>
    {/if}
  </div>
  {#if (node.children?.length ?? 0) > 0}
    <ul class="hats-tree-children" role="group">
      {#each node.children ?? [] as child (child.hatId)}
        <svelte:self
          node={child}
          {roleLabelByHatId}
          {wearerAddressesByHatId}
          {executorRolesByAddress}
          {squadMemberEvmByNpub}
        />
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

  .hats-tree-role-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }

  .hats-tree-wearers {
    font-size: 0.75rem;
    width: 100%;
  }

  .hats-tree-executor-roles {
    color: var(--text-secondary);
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
