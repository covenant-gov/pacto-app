<script lang="ts">
  import type { HatTreeNodeDto } from '../../../lib/governance/api';
  import {
    formatWearerDisplayLabel,
    npubByEvmAddressFromSquadRoster,
  } from '../../../lib/governance/hats-tree-annotations';
  import { prettyHatId } from '../../../lib/governance/pretty-hat-id';
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
  $: prettyId = prettyHatId(node.hatId) ?? node.hatId;
  $: title = roleLabel || node.details?.trim() || 'Untitled hat';
  $: hasWearers = wearerAddresses.length > 0 || node.supply > 0;
  $: children = node.children ?? [];
  $: childCount = children.length;

  function wearerLabel(address: string): string {
    return formatWearerDisplayLabel(address, npubByAddress, (npub) =>
      getProfileDisplayName($profiles[npub]),
    );
  }

  function executorRolesLabel(address: string): string {
    return executorRolesByAddress[address.trim().toLowerCase()] ?? '';
  }

  function footerPrimary(): string {
    if (wearerAddresses.length > 0) {
      const first = wearerLabel(wearerAddresses[0]);
      const roles = executorRolesLabel(wearerAddresses[0]);
      return roles ? `${first} · ${roles}` : first;
    }
    if (node.supply > 0) return `${node.supply} wearer${node.supply === 1 ? '' : 's'}`;
    return '0 Wearers';
  }

  function footerSupply(): string {
    if (node.maxSupply >= 0xffffffff) return hasWearers ? `${node.supply}` : '';
    if (hasWearers) return `${node.supply} of ${node.maxSupply}`;
    return `of ${node.maxSupply}`;
  }
</script>

<div class="hats-tree-node" role="treeitem" aria-expanded={childCount > 0 ? 'true' : undefined}>
  <div class="hats-tree-node-card" class:has-wearers={hasWearers} class:inactive={!node.active}>
    <div class="hats-tree-node-body">
      <code class="hats-tree-node-id" title={node.hatId}>{prettyId}</code>
      <span class="hats-tree-node-title">{title}</span>
      {#if roleLabel && node.details?.trim() && node.details.trim() !== roleLabel}
        <span class="hats-tree-node-details muted">{node.details.trim()}</span>
      {/if}
    </div>
    <div class="hats-tree-node-footer">
      <span class="hats-tree-footer-primary">{footerPrimary()}</span>
      {#if footerSupply()}
        <span class="hats-tree-footer-supply">{footerSupply()}</span>
      {/if}
    </div>
    {#if wearerAddresses.length > 1}
      <div class="hats-tree-extra-wearers muted">
        +{wearerAddresses.length - 1} more:
        {#each wearerAddresses.slice(1) as address, i (address)}
          {#if i > 0}, {/if}{wearerLabel(address)}
        {/each}
      </div>
    {/if}
  </div>

  {#if childCount > 0}
    <div class="hats-tree-branch" aria-hidden="true">
      <span class="hats-tree-stem"></span>
    </div>
    <div class="hats-tree-children" class:single={childCount === 1} role="group">
      {#each children as child (child.hatId)}
        <div class="hats-tree-child">
          <span class="hats-tree-child-stem" aria-hidden="true"></span>
          <svelte:self
            node={child}
            {roleLabelByHatId}
            {wearerAddressesByHatId}
            {executorRolesByAddress}
            {squadMemberEvmByNpub}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .hats-tree-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: max-content;
    min-width: 160px;
  }

  .hats-tree-node-card {
    display: flex;
    flex-direction: column;
    width: 168px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg-elevated);
    overflow: hidden;
  }

  .hats-tree-node-card.inactive {
    opacity: 0.72;
  }

  .hats-tree-node-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px 8px;
    min-height: 56px;
  }

  .hats-tree-node-id {
    font-family: ui-monospace, monospace;
    font-size: 0.6875rem;
    color: var(--text-muted);
    line-height: 1.2;
  }

  .hats-tree-node-title {
    font-weight: 600;
    font-size: 0.8125rem;
    color: var(--text-primary);
    line-height: 1.25;
    word-break: break-word;
  }

  .hats-tree-node-details {
    font-size: 0.6875rem;
    line-height: 1.3;
    word-break: break-word;
  }

  .hats-tree-node-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    font-size: 0.6875rem;
    line-height: 1.2;
    background: color-mix(in srgb, var(--border-subtle) 55%, transparent);
    color: var(--text-secondary);
  }

  .hats-tree-node-card.has-wearers .hats-tree-node-footer {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--text-primary);
  }

  .hats-tree-footer-primary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hats-tree-footer-supply {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .hats-tree-extra-wearers {
    padding: 4px 10px 6px;
    font-size: 0.625rem;
    line-height: 1.3;
    border-top: 1px solid var(--border-subtle);
  }

  .hats-tree-branch {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 16px;
  }

  .hats-tree-stem {
    width: 2px;
    height: 100%;
    background: var(--border-subtle);
  }

  .hats-tree-children {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: center;
    gap: 16px;
    position: relative;
  }

  /* Horizontal rail between first and last child centers (card width 168px). */
  .hats-tree-children:not(.single)::before {
    content: '';
    position: absolute;
    top: 0;
    left: 84px;
    right: 84px;
    height: 2px;
    background: var(--border-subtle);
  }

  .hats-tree-child {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
  }

  .hats-tree-child-stem {
    width: 2px;
    height: 12px;
    background: var(--border-subtle);
    margin-bottom: 0;
  }

  .muted {
    color: var(--text-muted);
  }
</style>
