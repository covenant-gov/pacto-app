<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    headingId,
    heading,
    headingLevel = 3,
    class: className = '',
    headerAction,
    children,
    footer,
    showFooter = true,
  }: {
    headingId: string;
    heading: string;
    headingLevel?: 3 | 4;
    class?: string;
    headerAction?: Snippet;
    children: Snippet;
    footer?: Snippet;
    showFooter?: boolean;
  } = $props();
</script>

<section class="dashboard-asset-card {className}" aria-labelledby={headingId}>
  <div class="asset-card-head">
    <svelte:element this={`h${headingLevel}`} id={headingId} class="asset-card-heading">
      {heading}
    </svelte:element>
    {#if headerAction}
      {@render headerAction()}
    {/if}
  </div>
  {@render children()}
  {#if footer && showFooter}
    <div class="asset-card-footer">
      {@render footer()}
    </div>
  {/if}
</section>

<style>
  .dashboard-asset-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }

  .asset-card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .asset-card-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
  }

  .asset-card-footer {
    margin-top: 14px;
    border-top: 1px solid var(--border-subtle);
    padding-top: 10px;
  }

  .dashboard-asset-card :global(.asset-dl) {
    margin: 0 0 14px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 14px;
    font-size: 0.875rem;
  }

  .dashboard-asset-card :global(.asset-dl:last-child) {
    margin-bottom: 0;
  }

  .dashboard-asset-card :global(.asset-dl dt) {
    margin: 0;
    color: var(--text-muted);
    font-weight: 500;
  }

  .dashboard-asset-card :global(.asset-dl dd) {
    margin: 0;
    word-break: break-all;
    color: var(--text-primary);
  }

  .dashboard-asset-card :global(.asset-dd-inline) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    word-break: normal;
  }
</style>
