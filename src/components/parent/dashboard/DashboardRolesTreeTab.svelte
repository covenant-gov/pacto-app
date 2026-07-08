<script lang="ts">
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

  export let squadInfraRows: unknown[] | undefined = undefined;
  export let hasSponsor = false;
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

  $: rolesTreeRefreshing = hatsTreeRefreshing || rolesTreeAnnotationsRefreshing;
  $: rolesTreeLoading = hatsTreeLoading || rolesTreeAnnotationsLoading;
</script>

{#if squadInfraRows !== undefined && !hasSponsor}
  <div class="sponsor-empty-banner" role="status">
    <p class="sponsor-empty-banner-text">Deploy squad sponsor first using the Deploy button below.</p>
    <button type="button" class="btn-primary" on:click={onOpenLaunchpad}>Open Deploy</button>
  </div>
{/if}
<section class="dashboard-section dashboard-placeholder-section" aria-labelledby="roles-tree-heading">
  <div class="roles-tree-section-head">
    <h3 id="roles-tree-heading" class="section-heading">Roles Tree</h3>
    {#if structureSummary}
      <RefreshIconButton
        className="roles-tree-refresh-btn"
        disabled={rolesTreeLoading || rolesTreeRefreshing}
        spinning={rolesTreeRefreshing}
        ariaLabel={rolesTreeRefreshing ? 'Refreshing roles tree' : 'Refresh roles tree'}
        on:click={onRefreshRolesTree}
      />
    {/if}
  </div>
  {#if structureSummary === undefined}
    <p class="dashboard-placeholder-text muted">Loading roles tree context…</p>
  {:else if structureSummary === null}
    <p class="dashboard-placeholder-text dashboard-placeholder-lead">
      Hat tree and role structure show here once this squad has a <strong>Pacto Gov</strong> deployment
      (Deploy). Safe-only setups do not publish a Hats tree id yet.
    </p>
  {:else}
    <p class="structure-summary-lead dashboard-placeholder-text">
      Top hat for this squad on <strong>{structureSummary.chainDisplayName}</strong> (chain id 
      <code class="structure-mono">{structureSummary.chainIdNumeric}</code>).
    </p>
    <dl class="structure-dl">
      <dt>Tree / top hat id</dt>
      <dd><code class="structure-mono">{structureSummary.treeIdRaw}</code></dd>
    </dl>
    {#if structureSummary.hatsExplorerUrl}
      {@const hatsUrl = structureSummary.hatsExplorerUrl}
      <p class="structure-actions">
        <button type="button" class="btn-link treasury-explorer-link" on:click={() => openExternalUrl(hatsUrl)}>
          Open in Hats tree explorer
        </button>
      </p>
    {:else}
      <p class="dashboard-placeholder-text muted">Explorer link could not be built for this hat id format.</p>
    {/if}
    {#if hatsTreeError && hatsTree}
      <p class="chain-read-error" role="alert">{hatsTreeError}</p>
    {/if}
    {#if rolesTreeAnnotationsError}
      <p class="chain-read-error" role="alert">{rolesTreeAnnotationsError}</p>
    {/if}
    {#if hatsTreeLoading && !hatsTree}
      <p class="dashboard-placeholder-text muted">Loading Hats tree from chain…</p>
    {:else if rolesTreeAnnotationsLoading && !hatsTree}
      <p class="dashboard-placeholder-text muted">Loading role labels and wearers…</p>
    {:else if !hatsTree && hatsTreeError}
      <p class="chain-read-error" role="alert">{hatsTreeError}</p>
    {:else if hatsTree}
      {#if isHatsTreeLikelyTruncated(hatsTree)}
        <p class="hats-tree-truncation-note muted" role="status">
          Showing up to {HATS_TREE_DEFAULT_MAX_NODES} hats (depth {HATS_TREE_DEFAULT_MAX_DEPTH}). Open the Hats
          tree explorer for the full tree.
        </p>
      {/if}
      <p class="roles-table-caption">On-chain tree</p>
      <HatsTreeDiagram
        root={hatsTree}
        {roleLabelByHatId}
        {wearerAddressesByHatId}
        {executorRolesByAddress}
        {squadMemberEvmByNpub}
      />
    {/if}
  {/if}
</section>

<style>
  .sponsor-empty-banner {
    margin: 0 16px 16px;
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

  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
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

  .structure-dl {
    margin: 0 0 14px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 14px;
    font-size: 0.875rem;
  }

  .structure-dl dt {
    margin: 0;
    color: var(--text-muted);
    font-weight: 500;
  }

  .structure-dl dd {
    margin: 0;
    word-break: break-all;
  }

  .structure-mono {
    font-size: 0.8125rem;
    color: var(--text-primary);
    font-family: ui-monospace, monospace;
  }

  .structure-actions {
    margin: 0 0 12px;
  }

  .roles-table-caption {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
    margin: 0 0 8px 0;
  }

  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .btn-primary {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }

  .btn-secondary {
    background: var(--bg-secondary);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }

  .btn-link {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }

  .treasury-explorer-link {
    margin: 0;
  }
</style>
