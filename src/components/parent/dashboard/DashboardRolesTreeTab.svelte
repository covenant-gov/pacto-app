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

  export let squadInfraRows: unknown[] | undefined = undefined;
  export let structureSummary: DashboardStructureSummary | null | undefined = undefined;
  export let hatsTree: HatTreeNodeDto | null = null;
  export let hatsTreeLoading = false;
  export let hatsTreeRefreshing = false;
  export let hatsTreeError = '';
  export let roleLabelByHatId: Record<string, string> = {};
  export let wearerAddressesByHatId: Record<string, string[]> = {};
  export let executorRolesByAddress: Record<string, string> = {};
  export let squadMemberEvmByNpub: Record<string, string> = {};
  export let rolesTreeAnnotationsLoading = false;
  export let rolesTreeAnnotationsRefreshing = false;
  export let rolesTreeAnnotationsError = '';
  export let onRefreshRolesTree: () => void = () => {};
  export let onOpenLaunchpad: () => void = () => {};
  /** Lowercase address → protocol module label for wearer chips. */
  export let knownWearerLabels: Record<string, string> = {};

  $: rolesTreeRefreshing = hatsTreeRefreshing || rolesTreeAnnotationsRefreshing;
  $: rolesTreeLoading = hatsTreeLoading || rolesTreeAnnotationsLoading;
  $: chainKey = structureSummary?.chainKey ?? null;
  $: hatsTreeRpcKind = rpcReadErrorKind(hatsTreeError);
  $: rolesAnnotationsRpcKind = rpcReadErrorKind(rolesTreeAnnotationsError);
</script>

{#if squadInfraRows !== undefined && !structureSummary}
  <div class="sponsor-empty-banner" role="status">
    <p class="sponsor-empty-banner-text">{$t('governance.roles.empty')}</p>
    <button type="button" class="btn-primary" on:click={onOpenLaunchpad}>{$t('governance.roles.openDeploy')}</button>
  </div>
{/if}

<section class="roles-tree-panel" aria-labelledby="roles-tree-heading">
  <div class="roles-tree-section-head">
    <h3 id="roles-tree-heading" class="section-heading">{$t('governance.roles.title')}</h3>
    {#if structureSummary}
      <RefreshIconButton
        className="roles-tree-refresh-btn"
        disabled={rolesTreeLoading || rolesTreeRefreshing}
        spinning={rolesTreeRefreshing}
        ariaLabel={rolesTreeRefreshing ? $t('governance.roles.refreshing') : $t('governance.roles.refresh')}
        on:click={onRefreshRolesTree}
      />
    {/if}
  </div>
  {#if structureSummary === undefined}
    <p class="dashboard-placeholder-text muted">{$t('governance.roles.loadingContext')}</p>
  {:else if structureSummary === null}
    <p class="dashboard-placeholder-text dashboard-placeholder-lead">
      {$t('governance.roles.leadPrefix')}
      <strong>{$t('governance.roles.leadBrand')}</strong>
      {$t('governance.roles.leadSuffix')}
    </p>
  {:else}
    <p class="structure-summary-lead dashboard-placeholder-text">
      {$t('governance.roles.topHatOn')}
      <strong>{structureSummary.chainDisplayName}</strong>
      {$t('governance.roles.chainIdStart')}
      <code class="structure-mono">{structureSummary.chainIdNumeric}</code>
      {$t('governance.roles.hatTreeIdStart')}
      <code class="structure-mono" title={structureSummary.treeIdRaw}
        >{structureSummary.treeDomain ?? structureSummary.treeIdRaw}</code
      >.
    </p>
    {#if structureSummary.hatsExplorerUrl}
      {@const hatsUrl = structureSummary.hatsExplorerUrl}
      <p class="structure-actions">
        <button type="button" class="btn-link treasury-explorer-link" on:click={() => openExternalUrl(hatsUrl)}>
          {$t('governance.roles.openExplorer')}
        </button>
      </p>
    {:else}
      <p class="dashboard-placeholder-text muted">{$t('governance.roles.explorerError')}</p>
    {/if}
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

  .roles-tree-section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .roles-tree-section-head .section-heading {
    margin: 0;
  }

  :global(.roles-tree-refresh-btn) {
    flex-shrink: 0;
  }

  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
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

  .dashboard-placeholder-lead {
    margin-bottom: 16px;
  }

  .dashboard-placeholder-text.muted,
  .muted {
    color: var(--text-muted);
  }

  .structure-summary-lead {
    margin-top: 0;
  }

  .structure-mono {
    font-size: 0.8125rem;
    color: var(--text-primary);
    font-family: ui-monospace, monospace;
  }

  .structure-actions {
    margin: 0 0 12px;
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
