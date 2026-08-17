<script lang="ts">
  import { t } from 'svelte-i18n';
  import { onMount } from 'svelte';
  import SquadSponsorTreasuryPanel from '../governance/SquadSponsorTreasuryPanel.svelte';
  import TreasurySafeModulePanel from '../governance/TreasurySafeModulePanel.svelte';
  import type { TreasurySafeEntry } from '../../../lib/treasury/treasury-safes';
  import { TREASURY_SAFE_UI_CAP } from '../../../lib/treasury/treasury-safes';
  import type { SquadInfraDto } from '../../../lib/governance/api';
  import { getSquadCapabilities } from '../../../lib/governance/api';
  import type { PactoGovProviderPayloadV1 } from '../../../lib/governance/pacto-gov-payload';
  import {
    resolveGovernancePrivilege,
    type GovernancePrivilege,
  } from '../../../lib/governance/governance-privilege';
  import { explorerAddressUrl, parseSupportedChainId, safeAppHomeUrl } from '../../../lib/wallet/chains';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { safeStateByTreasuryId } from '../../../stores/safe';
  import { treasurySafesFetchMetaByParentId } from '../../../lib/dashboard/dashboard-fetch-meta';
  import { refreshAllSafeStates } from '../../../lib/dashboard/batch-safe-state-refresh';
  import RpcReadErrorCard from './RpcReadErrorCard.svelte';
  import { rpcReadErrorKind } from '../../../lib/squad/rpc-read-error';

  export let parentId = '';
  export let network = 'sepolia';
  export let sponsorRow: SquadInfraDto | null = null;
  export let treasurySafes: TreasurySafeEntry[] = [];
  export let displayedTreasurySafes: TreasurySafeEntry[] = [];
  export let governanceTreasurySafe: TreasurySafeEntry | null = null;
  export let pactoPayload: PactoGovProviderPayloadV1 | null = null;
  export let announcementsGroupId = '';
  export let myAddress = '';
  export let captainWearers: string[] = [];
  export let crewWearers: string[] = [];
  export let onOpenSponsorDeploy: () => void = () => {};
  export let onOpenDeploySafe: () => void = () => {};
  export let onOpenImportSafe: () => void = () => {};

  let capabilitiesLoadKey = '';
  let capabilities: Awaited<ReturnType<typeof getSquadCapabilities>> | null = null;

  $: privilege = resolveGovernancePrivilege({
    myAddress,
    safeAddress: pactoPayload?.safe ?? '',
    captainWearers,
    crewWearers,
    capabilities,
  }) as GovernancePrivilege;

  $: {
    const pid = parentId.trim();
    const key = `${pid}|${network}`;
    if (pid && key !== capabilitiesLoadKey) {
      capabilitiesLoadKey = key;
      void loadCapabilities(pid);
    }
  }

  async function loadCapabilities(pid: string) {
    const key = `${pid}|${network}`;
    try {
      const snap = await getSquadCapabilities(pid, network);
      if (key !== capabilitiesLoadKey) return;
      capabilities = snap;
    } catch {
      if (key !== capabilitiesLoadKey) return;
      capabilities = null;
    }
  }

  onMount(() => {
    const pid = parentId.trim();
    if (pid) {
      capabilitiesLoadKey = `${pid}|${network}`;
      void loadCapabilities(pid);
    }
  });

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
  $: govSafeAddress = governanceTreasurySafe?.safeAddress ?? pactoPayload?.safe ?? '';
  $: showGovTreasury = !!govSafeAddress.trim();
  $: govExUrl = showGovTreasury ? explorerAddressUrl(parseSupportedChainId(network), govSafeAddress) : null;
  $: govSafeAppUrl = showGovTreasury ? safeAppHomeUrl(parseSupportedChainId(network), govSafeAddress) : null;
</script>

<SquadSponsorTreasuryPanel {parentId} {sponsorRow} onOpenDeploy={onOpenSponsorDeploy} />

{#if showGovTreasury}
  <section class="dashboard-section gov-treasury-section" aria-labelledby="gov-treasury-heading">
    <h3 id="gov-treasury-heading" class="section-heading">{$t('governance.treasury.govHeading')}</h3>
    <code class="treasury-card-address">{govSafeAddress}</code>
    {#if govExUrl || govSafeAppUrl}
      <div class="treasury-card-links">
        {#if govExUrl}
          <button type="button" class="btn-link treasury-explorer-link" on:click={() => openExternalUrl(govExUrl)}>
            {$t('governance.treasury.viewExplorer')}
          </button>
        {/if}
        {#if govSafeAppUrl}
          <button type="button" class="btn-link treasury-explorer-link" on:click={() => openExternalUrl(govSafeAppUrl)}>
            {$t('governance.treasury.openSafe')}
          </button>
        {/if}
      </div>
    {/if}
    <TreasurySafeModulePanel
      {network}
      {parentId}
      safeAddress={govSafeAddress}
      {announcementsGroupId}
      {privilege}
    />
  </section>
{/if}

<section class="dashboard-section" aria-labelledby="safe-heading">
  <div class="treasury-section-head">
    <h3 id="safe-heading" class="section-heading">{$t('governance.treasury.otherVaults')}</h3>
    {#if treasuryFetchMeta?.loading && (treasurySafes?.length ?? 0) > 0}
      <span class="treasury-refresh-note muted" role="status">{$t('governance.treasury.refreshing')}</span>
    {/if}
    {#if (treasurySafes?.length ?? 0) < TREASURY_SAFE_UI_CAP}
      <div class="treasury-action-btns">
        <button type="button" class="btn-primary treasury-deploy-btn" on:click={onOpenDeploySafe}>{$t('governance.treasury.deploySafe')}</button>
        <button type="button" class="btn-secondary treasury-import-btn" on:click={onOpenImportSafe}>{$t('governance.treasury.importSafe')}</button>
      </div>
    {/if}
  </div>
  {#if treasuryFetchMeta?.error && (treasurySafes?.length ?? 0) > 0}
    {@const treasuryRpcKind = rpcReadErrorKind(treasuryFetchMeta.error)}
    {#if treasuryRpcKind}
      <RpcReadErrorCard kind={treasuryRpcKind} />
    {:else}
      <p class="chain-read-error treasury-cache-error" role="alert">{treasuryFetchMeta.error}</p>
    {/if}
  {/if}
  {#if (treasurySafes?.length ?? 0) > TREASURY_SAFE_UI_CAP}
    <p class="treasury-cap-note muted">
      {$t('governance.treasury.capNote', { values: { shown: TREASURY_SAFE_UI_CAP, total: treasurySafes.length } })}
    </p>
  {/if}
  {#if displayedTreasurySafes.length === 0}
    <p class="no-safe">{$t('governance.treasury.noVaults')}</p>
  {:else}
    <ul class="treasury-safe-card-list" role="list">
      {#each displayedTreasurySafes as entry (entry.id)}
        {@const st = $safeStateByTreasuryId[entry.id]}
        {@const exUrl = explorerAddressUrl(parseSupportedChainId(entry.chain), entry.safeAddress)}
        {@const safeAppUrl = safeAppHomeUrl(parseSupportedChainId(entry.chain), entry.safeAddress)}
        <li class="treasury-safe-card">
          <h4 class="treasury-vault-title">{entry.label ? $t('governance.treasury.vaultLabel', { values: { label: entry.label } }) : $t('governance.treasury.vaultMultisig')}</h4>
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
                  {$t('governance.treasury.viewExplorer')}
                </button>
              {/if}
              {#if safeAppUrl}
                <button
                  type="button"
                  class="btn-link treasury-explorer-link"
                  on:click={() => openTreasurySafeApp(entry)}
                >
                  {$t('governance.treasury.openSafe')}
                </button>
              {/if}
            </div>
          {/if}
          {#if st?.state}
            <dl class="safe-state-dl treasury-card-dl">
              <dt>{$t('governance.treasury.balance')}</dt>
              <dd>{$t('governance.treasury.balanceEth', { values: { balance: st.state.balanceFormatted } })}</dd>
              <dt>{$t('governance.treasury.signatures')}</dt>
              <dd>{$t('governance.treasury.thresholdOf', { values: { threshold: st.state.threshold, owners: st.state.owners.length } })}</dd>
              <dt>{$t('governance.treasury.nonce')}</dt>
              <dd>{String(st.state.nonce)}</dd>
              <dt>{$t('governance.treasury.owners')}</dt>
              <dd>
                <ul class="safe-owners-list">
                  {#each st.state.owners as owner (owner)}
                    <li><code class="safe-owner-address">{shortAddress(owner as string)}</code></li>
                  {/each}
                </ul>
              </dd>
            </dl>
            {#if st.loading}
              <p class="safe-state-meta">{$t('governance.treasury.refreshing')}</p>
            {:else if st.error}
              <p class="safe-state-error" role="alert">{$t('governance.treasury.lastRefreshFailed', { values: { error: st.error } })}</p>
            {/if}
          {:else if st?.loading}
            <p class="safe-state-meta">{$t('governance.treasury.loadingSafe')}</p>
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
    margin-top: 16px;
  }

  .gov-treasury-section {
    margin-top: 16px;
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
    color: var(--brand);
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
    background: var(--brand);
    color: var(--on-brand);
    border: none;
  }

  .btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
</style>
