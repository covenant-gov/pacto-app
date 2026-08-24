<script lang="ts">
  import { t } from 'svelte-i18n';
  import HatsTreeDiagram from '../governance/HatsTreeDiagram.svelte';
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import type { HatTreeNodeDto } from '../../../lib/governance/api';
  import type { DashboardStructureSummary } from '../../../lib/dashboard/structure-summary';
  import {
    HATS_TREE_DEFAULT_MAX_DEPTH,
    HATS_TREE_DEFAULT_MAX_NODES,
    isHatsTreeLikelyTruncated,
  } from '../../../lib/governance/hats-tree-read';
  import RpcReadErrorCard from './RpcReadErrorCard.svelte';
  import { rpcReadErrorKind } from '../../../lib/squad/rpc-read-error';
  import type { HatsTreeCommandContext } from '../../../lib/governance/hats-tree-role-actions';

  interface Props {
    squadInfraRows?: unknown[];
    structureSummary?: DashboardStructureSummary | null;
    hatsTree?: HatTreeNodeDto | null;
    hatsTreeLoading?: boolean;
    hatsTreeRefreshing?: boolean;
    hatsTreeError?: string;
    roleLabelByHatId?: Record<string, string>;
    wearerAddressesByHatId?: Record<string, string[]>;
    executorRolesByAddress?: Record<string, string>;
    squadMemberEvmByNpub?: Record<string, string>;
    rolesTreeAnnotationsLoading?: boolean;
    rolesTreeAnnotationsRefreshing?: boolean;
    rolesTreeAnnotationsError?: string;
    onRefreshRolesTree?: () => void;
    onOpenLaunchpad?: () => void;
    /** Lowercase address → protocol module label for wearer chips. */
    knownWearerLabels?: Record<string, string>;
    viewerAddress?: string;
    commandContext?: HatsTreeCommandContext | null;
  }

  let {
    squadInfraRows = undefined,
    structureSummary = undefined,
    hatsTree = null,
    hatsTreeLoading = false,
    hatsTreeRefreshing = false,
    hatsTreeError = '',
    roleLabelByHatId = {},
    wearerAddressesByHatId = {},
    executorRolesByAddress = {},
    squadMemberEvmByNpub = {},
    rolesTreeAnnotationsLoading = false,
    rolesTreeAnnotationsRefreshing = false,
    rolesTreeAnnotationsError = '',
    onRefreshRolesTree = () => {},
    onOpenLaunchpad = () => {},
    knownWearerLabels = {},
    viewerAddress = '',
    commandContext = null,
  }: Props = $props();

  const rolesTreeRefreshing = $derived(hatsTreeRefreshing || rolesTreeAnnotationsRefreshing);
  const rolesTreeLoading = $derived(hatsTreeLoading || rolesTreeAnnotationsLoading);
  const chainKey = $derived(structureSummary?.chainKey ?? null);
  const hatsTreeRpcKind = $derived(rpcReadErrorKind(hatsTreeError));
  const rolesAnnotationsRpcKind = $derived(rpcReadErrorKind(rolesTreeAnnotationsError));
</script>

{#if squadInfraRows !== undefined && !structureSummary}
  <div class="sponsor-empty-banner" role="status">
    <p class="sponsor-empty-banner-text">{$t('governance.roles.empty')}</p>
    <button type="button" class="btn-primary" onclick={onOpenLaunchpad}>{$t('governance.governance.deploy')}</button>
  </div>
{/if}

<section class="roles-tree-panel" aria-label={$t('governance.roles.title')}>
  {#if structureSummary === undefined}
    <p class="dashboard-placeholder-text muted">{$t('governance.roles.loadingContext')}</p>
  {:else if structureSummary}
    <div class="structure-actions">
      {#if structureSummary.hatsExplorerUrl}
        {@const hatsUrl = structureSummary.hatsExplorerUrl}
        <button type="button" class="btn-link treasury-explorer-link" onclick={() => openExternalUrl(hatsUrl)}>
          {$t('governance.roles.openExplorer')}
        </button>
      {:else}
        <p class="dashboard-placeholder-text muted">{$t('governance.roles.explorerError')}</p>
      {/if}
      <RefreshIconButton
        className="roles-tree-refresh-btn"
        disabled={rolesTreeLoading || rolesTreeRefreshing}
        spinning={rolesTreeRefreshing}
        ariaLabel={rolesTreeRefreshing ? $t('governance.roles.refreshing') : $t('governance.roles.refresh')}
        onclick={onRefreshRolesTree}
      />
    </div>
    {#if hatsTreeError && hatsTree}
      {#if hatsTreeRpcKind}
        <RpcReadErrorCard kind={hatsTreeRpcKind} />
      {:else}
        <p class="chain-read-error" role="alert">{hatsTreeError}</p>
      {/if}
    {/if}
    {#if rolesTreeAnnotationsError}
      {#if rolesAnnotationsRpcKind}
        <RpcReadErrorCard kind={rolesAnnotationsRpcKind} />
      {:else}
        <p class="chain-read-error" role="alert">{rolesTreeAnnotationsError}</p>
      {/if}
    {/if}
    {#if hatsTreeLoading && !hatsTree}
      <p class="dashboard-placeholder-text muted">{$t('governance.roles.loadingTree')}</p>
    {:else if rolesTreeAnnotationsLoading && !hatsTree}
      <p class="dashboard-placeholder-text muted">{$t('governance.roles.loadingLabels')}</p>
    {:else if !hatsTree && hatsTreeError}
      {#if hatsTreeRpcKind}
        <RpcReadErrorCard kind={hatsTreeRpcKind} />
      {:else}
        <p class="chain-read-error" role="alert">{hatsTreeError}</p>
      {/if}
    {:else if hatsTree}
      {#if isHatsTreeLikelyTruncated(hatsTree)}
        <p class="hats-tree-truncation-note muted" role="status">
          {$t('governance.roles.truncation', { values: { maxNodes: HATS_TREE_DEFAULT_MAX_NODES, maxDepth: HATS_TREE_DEFAULT_MAX_DEPTH } })}
        </p>
      {/if}
      <HatsTreeDiagram
        root={hatsTree}
        {roleLabelByHatId}
        {wearerAddressesByHatId}
        {executorRolesByAddress}
        {squadMemberEvmByNpub}
        {knownWearerLabels}
        {chainKey}
        {viewerAddress}
        {commandContext}
      />
    {/if}
  {/if}
</section>

<style>
  .sponsor-empty-banner {
    margin: 0 0 16px;
    padding: 14px 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    background: var(--bg-elevated);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
  }

  .sponsor-empty-banner-text {
    margin: 0;
    flex: 1;
    min-width: 200px;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .roles-tree-panel {
    min-width: 0;
    width: 100%;
  }

  :global(.roles-tree-refresh-btn) {
    flex-shrink: 0;
  }

  .hats-tree-truncation-note {
    font-size: 0.8125rem;
    line-height: 1.45;
    margin: 0 0 10px;
  }

  .dashboard-placeholder-text {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }

  .dashboard-placeholder-text.muted,
  .muted {
    color: var(--text-muted);
  }

  .structure-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    margin: 0 0 12px;
  }

  .structure-actions .dashboard-placeholder-text {
    margin: 0;
  }

  .btn-primary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
    background: var(--brand);
    color: var(--on-brand);
    border: none;
  }

  .btn-link {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--brand);
    cursor: pointer;
    text-decoration: underline;
  }

  .treasury-explorer-link {
    margin: 0;
  }
</style>
