<script lang="ts">
  import type { HatTreeNodeDto } from '../../../lib/governance/api';
  import {
    formatWearerDisplayLabel,
    npubByEvmAddressFromSquadRoster,
  } from '../../../lib/governance/hats-tree-annotations';
  import { prettyHatId } from '../../../lib/governance/pretty-hat-id';
  import { getProfileDisplayName } from '../../../lib/utils/profile';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { explorerAddressUrl, type SupportedChainId } from '../../../lib/wallet/chains';
  import { profiles } from '../../../stores/profiles';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { localizeRoleLabel } from '../../../lib/governance/governance-privilege';

  export let node: HatTreeNodeDto;
  export let roleLabelByHatId: Record<string, string> = {};
  export let wearerAddressesByHatId: Record<string, string[]> = {};
  export let executorRolesByAddress: Record<string, string> = {};
  export let squadMemberEvmByNpub: Record<string, string> = {};
  /** Known protocol module labels keyed by lowercase address. */
  export let knownWearerLabels: Record<string, string> = {};
  export let chainKey: SupportedChainId | null = null;

  const tFn = get(t);

  $: roleLabel = roleLabelByHatId[node.hatId] ?? '';
  $: wearerAddresses = wearerAddressesByHatId[node.hatId] ?? [];
  $: npubByAddress = npubByEvmAddressFromSquadRoster(squadMemberEvmByNpub);
  $: prettyId = prettyHatId(node.hatId) ?? node.hatId;
  $: humanDetails = humanHatDetails(node.details);
  /** Extra line only when role label and a distinct human details string both exist. */
  $: detailsSubtitle =
    roleLabel && humanDetails && humanDetails !== roleLabel ? humanDetails : '';
  $: hasWearers = wearerAddresses.length > 0 || node.supply > 0;
  $: children = node.children ?? [];
  $: childCount = children.length;
  $: primaryWearer = wearerAddresses[0] ?? '';
  $: primaryWearerRoles = primaryWearer ? executorRolesLabel(primaryWearer) : '';

  function wearerLabel(address: string): string {
    return formatWearerDisplayLabel(
      address,
      npubByAddress,
      (npub) => getProfileDisplayName($profiles[npub]),
      knownWearerLabels,
    );
  }

  function executorRolesLabel(address: string): string {
    return executorRolesByAddress[address.trim().toLowerCase()] ?? '';
  }

  function footerSupply(): string {
    if (node.maxSupply >= 0xffffffff) return hasWearers ? `${node.supply}` : '';
    if (hasWearers) return tFn('governance.hats.supply', { values: { count: node.supply, max: node.maxSupply } });
    return tFn('governance.hats.supplyOf', { values: { max: node.maxSupply } });
  }

  function openWearerExplorer(address: string) {
    if (!chainKey) return;
    const url = explorerAddressUrl(chainKey, address);
    if (url) void openExternalUrl(url);
  }

  function wearerExplorerTitle(address: string): string {
    return tFn('governance.hats.wearerExplorerTitle', { values: { address: address.trim() } });
  }

  function humanHatDetails(raw: string | null | undefined): string {
    const t = raw?.trim() ?? '';
    if (!t || t.includes('://')) return '';
    return t;
  }

  function wearerCountLabel(count: number): string {
    if (count === 0) return tFn('governance.hats.noWearers');
    return tFn('governance.hats.wearerCount', { values: { count } });
  }
</script>

<div class="hats-tree-node" role="treeitem" aria-expanded={childCount > 0 ? 'true' : undefined} aria-selected="false">
  <div class="hats-tree-node-card" class:has-wearers={hasWearers} class:inactive={!node.active}>
    <div class="hats-tree-node-body">
      <code class="hats-tree-node-id" title={node.hatId}>{prettyId}</code>
      <span class="hats-tree-node-title">{$t(localizeRoleLabel(roleLabel)) || humanDetails || $t('governance.hats.untitled')}</span>
      {#if detailsSubtitle}
        <span class="hats-tree-node-details muted">{detailsSubtitle}</span>
      {/if}
    </div>
    <div class="hats-tree-node-footer">
      <span class="hats-tree-footer-primary">
        {#if primaryWearer}
          <button
            type="button"
            class="wearer-link"
            title={wearerExplorerTitle(primaryWearer)}
            on:click={() => openWearerExplorer(primaryWearer)}
          >
            {wearerLabel(primaryWearer)}
          </button>
          {#if primaryWearerRoles}
            <span class="wearer-roles"> · {primaryWearerRoles}</span>
          {/if}
        {:else}
          {wearerCountLabel(node.supply)}
        {/if}
      </span>
      {#if footerSupply()}
        <span class="hats-tree-footer-supply">{footerSupply()}</span>
      {/if}
    </div>
    {#if wearerAddresses.length > 1}
      <div class="hats-tree-extra-wearers muted">
        {$t('governance.hats.moreWearers', { values: { count: wearerAddresses.length - 1 } })}
        {#each wearerAddresses.slice(1) as address, i (address)}
          {#if i > 0}, {/if}
          <button
            type="button"
            class="wearer-link"
            title={wearerExplorerTitle(address)}
            on:click={() => openWearerExplorer(address)}
          >
            {wearerLabel(address)}
          </button>
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
            {knownWearerLabels}
            {chainKey}
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

  .wearer-link {
    display: inline;
    max-width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .wearer-link:hover {
    color: var(--accent);
  }

  .wearer-roles {
    color: inherit;
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
  }
</style>
