<script lang="ts">
  import SquadSponsorTreasuryPanel from '../governance/SquadSponsorTreasuryPanel.svelte';
  import type { TreasurySafeEntry } from '../../../lib/treasury/treasury-safes';
  import { TREASURY_SAFE_UI_CAP } from '../../../lib/treasury/treasury-safes';
  import type { SquadInfraDto } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import { explorerAddressUrl, parseSupportedChainId, safeAppHomeUrl } from '../../../lib/wallet/chains';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { treasuryVaultHeading } from '../../../lib/treasury/treasury-vault-labels';
  import { safeStateByTreasuryId } from '../../../stores/safe';
  import { treasurySafesFetchMetaByParentId } from '../../../lib/dashboard/dashboard-fetch-meta';
  import { refreshAllSafeStates } from '../../../lib/dashboard/batch-safe-state-refresh';

  export let parentId = '';
  export let sponsorRow: SquadInfraDto | null = null;
  export let treasurySafes: TreasurySafeEntry[] = [];
  export let displayedTreasurySafes: TreasurySafeEntry[] = [];
  export let pactoPayload: PactoGovProviderPayloadV1 | null = null;
  export let onOpenSponsorDeploy: () => void = () => {};
  export let onOpenDeploySafe: () => void = () => {};
  export let onOpenImportSafe: () => void = () => {};

  function shortAddress(addr: string): string {
    if (!addr || addr.length < 12) return addr;
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  function openTreasuryExplorer(entry: TreasurySafeEntry) {
    const url = explorerAddressUrl(parseSupportedChainId(entry.chain), entry.safeAddress);
    if (url) openExternalUrl(url);
  }

  function openTreasurySafeApp(entry: TreasurySafeEntry) {
    const url = safeAppHomeUrl(parseSupportedChainId(entry.chain), entry.safeAddress);
    if (url) openExternalUrl(url);
  }

  $: treasuryFetchMeta = parentId ? ($treasurySafesFetchMetaByParentId[parentId] ?? null) : null;
  $: treasurySafeRefreshKey = displayedTreasurySafes.map((e) => e.id).join('|');
  $: if (treasurySafeRefreshKey) {
    void refreshAllSafeStates(displayedTreasurySafes);
  }
</script>

<SquadSponsorTreasuryPanel {parentId} {sponsorRow} onOpenDeploy={onOpenSponsorDeploy} />
<section class="dashboard-section" aria-labelledby="safe-heading">
  <div class="treasury-section-head">
    <h3 id="safe-heading" class="section-heading">Vaults</h3>
    {#if treasuryFetchMeta?.loading && (treasurySafes?.length ?? 0) > 0}
      <span class="treasury-refresh-note muted" role="status">Refreshing…</span>
    {/if}
    {#if (treasurySafes?.length ?? 0) < TREASURY_SAFE_UI_CAP}
      <div class="treasury-action-btns">
        <button type="button" class="btn-primary treasury-deploy-btn" on:click={onOpenDeploySafe}>Deploy Safe</button>
        <button type="button" class="btn-secondary treasury-import-btn" on:click={onOpenImportSafe}>Import Safe</button>
      </div>
    {/if}
  </div>
  {#if treasuryFetchMeta?.error && (treasurySafes?.length ?? 0) > 0}
    <p class="chain-read-error treasury-cache-error" role="alert">{treasuryFetchMeta.error}</p>
  {/if}
  {#if (treasurySafes?.length ?? 0) > TREASURY_SAFE_UI_CAP}
    <p class="treasury-cap-note muted">
      Showing {TREASURY_SAFE_UI_CAP} of {treasurySafes.length} linked Safes.
    </p>
  {/if}
  {#if displayedTreasurySafes.length === 0}
    <p class="no-safe">No Safe linked yet.</p>
  {:else}
    <ul class="treasury-safe-card-list" role="list">
      {#each displayedTreasurySafes as entry (entry.id)}
        {@const st = $safeStateByTreasuryId[entry.id]}
        {@const exUrl = explorerAddressUrl(parseSupportedChainId(entry.chain), entry.safeAddress)}
        {@const safeAppUrl = safeAppHomeUrl(parseSupportedChainId(entry.chain), entry.safeAddress)}
        <li class="treasury-safe-card">
          <h4 class="treasury-vault-title">{treasuryVaultHeading(entry, pactoPayload)}</h4>
          <div class="treasury-card-top">
            <span class="treasury-pill treasury-pill-chain">{entry.chain}</span>
            {#if entry.label}
              <span class="treasury-pill treasury-pill-label">{entry.label}</span>
            {/if}
          </div>
          <code class="treasury-card-address">{entry.safeAddress}</code>
          {#if exUrl || safeAppUrl}
            <div class="treasury-card-links">
              {#if exUrl}
                <button
                  type="button"
                  class="btn-link treasury-explorer-link"
                  on:click={() => openTreasuryExplorer(entry)}
                >
                  View on explorer
                </button>
              {/if}
              {#if safeAppUrl}
                <button
                  type="button"
                  class="btn-link treasury-explorer-link"
                  on:click={() => openTreasurySafeApp(entry)}
                >
                  Open in Safe
                </button>
              {/if}
            </div>
          {/if}
          {#if st?.state}
            <dl class="safe-state-dl treasury-card-dl">
              <dt>Balance</dt>
              <dd>{st.state.balanceFormatted} ETH</dd>
              <dt>Signatures</dt>
              <dd>{st.state.threshold} of {st.state.owners.length}</dd>
              <dt>Nonce</dt>
              <dd>{String(st.state.nonce)}</dd>
              <dt>Owners</dt>
              <dd>
                <ul class="safe-owners-list">
                  {#each st.state.owners as owner}
                    <li><code class="safe-owner-address">{shortAddress(owner as string)}</code></li>
                  {/each}
                </ul>
              </dd>
            </dl>
            {#if st.loading}
              <p class="safe-state-meta">Refreshing…</p>
            {:else if st.error}
              <p class="safe-state-error" role="alert">Last refresh failed: {st.error}</p>
            {/if}
          {:else if st?.loading}
            <p class="safe-state-meta">Loading Safe state…</p>
          {:else if st?.error}
            <p class="safe-state-error" role="alert">{st.error}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }

  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 12px 0;
  }

  .treasury-section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .treasury-section-head .section-heading {
    margin: 0;
  }

  .treasury-vault-title {
    margin: 0 0 8px 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .treasury-action-btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .treasury-deploy-btn,
  .treasury-import-btn {
    flex-shrink: 0;
  }

  .treasury-cap-note {
    font-size: 0.8125rem;
    margin: 0 0 12px 0;
  }

  .muted {
    color: var(--text-muted);
  }

  .treasury-safe-card-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .treasury-safe-card {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 12px;
    background: var(--bg-elevated);
  }

  .treasury-card-top {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }

  .treasury-pill {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .treasury-card-address {
    display: block;
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
    word-break: break-all;
    margin-bottom: 8px;
    color: var(--text-primary);
  }

  .treasury-card-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }

  .treasury-explorer-link {
    margin: 0;
  }

  .treasury-card-dl {
    margin-top: 8px;
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

  .no-safe {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin: 0;
  }

  .safe-state-meta {
    font-size: 0.875rem;
    color: var(--text-muted);
    margin: 12px 0 0 0;
  }

  .safe-state-error {
    font-size: 0.875rem;
    color: var(--danger, #e53e3e);
    margin: 12px 0 0 0;
  }

  .safe-state-dl {
    margin: 12px 0 0 0;
    font-size: 0.875rem;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 16px;
    align-items: baseline;
  }

  .safe-state-dl dt {
    color: var(--text-muted);
    font-weight: 500;
  }

  .safe-state-dl dd {
    margin: 0;
    color: var(--text-primary);
  }

  .safe-owners-list {
    margin: 0;
    padding-left: 1.25rem;
    list-style: disc;
  }

  .safe-owner-address {
    font-family: ui-monospace, monospace;
    font-size: 0.8125rem;
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
</style>
