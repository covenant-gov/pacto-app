<script lang="ts">
  import { t } from 'svelte-i18n';
  import SquadSponsorTreasuryPanel from '../governance/SquadSponsorTreasuryPanel.svelte';
  import TreasurySafeModulePanel from '../governance/TreasurySafeModulePanel.svelte';
  import type { TreasurySafeEntry } from '../../../lib/treasury/treasury-safes';
  import { TREASURY_SAFE_UI_CAP } from '../../../lib/treasury/treasury-safes';
  import type { SquadInfraDto } from '../../../lib/governance/api';
  import { getSquadCapabilities } from '../../../lib/governance/api';
  import { aclSnapshotLoadKey } from '../../../lib/governance/acl-snapshot-key';
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
  import DashboardAssetCard from './DashboardAssetCard.svelte';
  import RpcReadErrorCard from './RpcReadErrorCard.svelte';
  import { rpcReadErrorKind } from '../../../lib/squad/rpc-read-error';
  import { governanceProcessNonceByParentId } from '../../../stores/navigation';
  import { shortEvmAddress as shortAddress } from '../../../lib/governance/hats-tree-annotations';

  interface Props {
    parentId?: string;
    network?: string;
    sponsorRow?: SquadInfraDto | null;
    treasurySafes?: TreasurySafeEntry[];
    displayedTreasurySafes?: TreasurySafeEntry[];
    governanceTreasurySafe?: TreasurySafeEntry | null;
    pactoPayload?: PactoGovProviderPayloadV1 | null;
    announcementsGroupId?: string;
    myAddress?: string;
    captainWearers?: string[];
    crewWearers?: string[];
    onOpenSponsorDeploy?: () => void;
    onOpenDeploySafe?: () => void;
    onOpenImportSafe?: () => void;
    topHatId?: string;
    warGameStack?: boolean;
  }

  let {
    parentId = '',
    network = 'sepolia',
    sponsorRow = null,
    treasurySafes = [],
    displayedTreasurySafes = [],
    governanceTreasurySafe = null,
    pactoPayload = null,
    announcementsGroupId = '',
    myAddress = '',
    captainWearers = [],
    crewWearers = [],
    onOpenSponsorDeploy = () => {},
    onOpenDeploySafe = () => {},
    onOpenImportSafe = () => {},
    topHatId = '',
    warGameStack = false,
  }: Props = $props();

  let capabilitiesLoadKey = $state('');
  let capabilities = $state<Awaited<ReturnType<typeof getSquadCapabilities>> | null>(null);
  let processNonce = $derived($governanceProcessNonceByParentId[parentId.trim()] ?? 0);

  const privilege = $derived(
    resolveGovernancePrivilege({
      myAddress,
      safeAddress: pactoPayload?.safe ?? '',
      captainWearers,
      crewWearers,
      capabilities,
    }) as GovernancePrivilege,
  );

  $effect(() => {
    const pid = parentId.trim();
    const key = aclSnapshotLoadKey({
      parentId: pid,
      network,
      warGameStack,
      processNonce,
      myAddress,
      captainWearers,
      crewWearers,
    });
    if (!pid || key === capabilitiesLoadKey) return;
    capabilitiesLoadKey = key;
    capabilities = null;
    void loadCapabilities(pid, key);
  });

  async function loadCapabilities(pid: string, key: string) {
    try {
      const snap = await getSquadCapabilities(pid, network, { wargame: warGameStack });
      if (key !== capabilitiesLoadKey) return;
      capabilities = snap;
    } catch {
      if (key !== capabilitiesLoadKey) return;
      capabilities = null;
    }
  }

  function openTreasuryExplorer(entry: TreasurySafeEntry) {
    const url = explorerAddressUrl(parseSupportedChainId(entry.chain), entry.safeAddress);
    if (url) openExternalUrl(url);
  }

  function openTreasurySafeApp(entry: TreasurySafeEntry) {
    const url = safeAppHomeUrl(parseSupportedChainId(entry.chain), entry.safeAddress);
    if (url) openExternalUrl(url);
  }

  const treasuryFetchMeta = $derived(parentId ? ($treasurySafesFetchMetaByParentId[parentId] ?? null) : null);
  const treasurySafeRefreshKey = $derived(displayedTreasurySafes.map((e) => e.id).join('|'));
  $effect(() => {
    if (treasurySafeRefreshKey) {
      void refreshAllSafeStates(displayedTreasurySafes);
    }
  });
  const govSafeAddress = $derived(governanceTreasurySafe?.safeAddress ?? pactoPayload?.safe ?? '');
  const showGovTreasury = $derived(!!govSafeAddress.trim());
</script>

<SquadSponsorTreasuryPanel
  {parentId}
  {sponsorRow}
  {topHatId}
  onOpenDeploy={warGameStack ? undefined : onOpenSponsorDeploy}
/>

{#if showGovTreasury}
  <TreasurySafeModulePanel
    {network}
    {parentId}
    safeAddress={govSafeAddress}
    {announcementsGroupId}
    {privilege}
  />
{/if}

<section class="dashboard-section" aria-labelledby="safe-heading">
  <div class="treasury-section-head">
    <h3 id="safe-heading" class="section-heading">{$t('governance.treasury.otherVaults')}</h3>
    {#if treasuryFetchMeta?.loading && (treasurySafes?.length ?? 0) > 0}
      <span class="treasury-refresh-note muted" role="status">{$t('governance.treasury.refreshing')}</span>
    {/if}
    {#if (treasurySafes?.length ?? 0) < TREASURY_SAFE_UI_CAP}
      <div class="treasury-action-btns">
        <button type="button" class="btn-primary treasury-deploy-btn" onclick={onOpenDeploySafe}>{$t('governance.treasury.deploySafe')}</button>
        <button type="button" class="btn-secondary treasury-import-btn" onclick={onOpenImportSafe}>{$t('governance.treasury.importSafe')}</button>
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
        <li>
          <DashboardAssetCard
            headingId={`vault-heading-${entry.id}`}
            heading={entry.label ? $t('governance.treasury.vaultLabel', { values: { label: entry.label } }) : $t('governance.treasury.vaultMultisig')}
            headingLevel={4}
          >
            <dl class="asset-dl">
              {#if st?.state}
                <dt>{$t('governance.info.sponsorEth')}</dt>
                <dd><strong>{st.state.balanceFormatted}</strong></dd>
              {/if}
              <dt>{$t('governance.field.chain')}</dt>
              <dd>{entry.chain}</dd>
              <dt>{$t('governance.treasury.safe')}</dt>
              <dd class="asset-dd-inline">
                {#if exUrl}
                  <button
                    type="button"
                    class="btn-link treasury-addr-link"
                    title={entry.safeAddress}
                    aria-label={$t('governance.hats.wearerExplorerTitle', { values: { address: entry.safeAddress } })}
                    onclick={() => openTreasuryExplorer(entry)}
                  >
                    {shortAddress(entry.safeAddress)}
                  </button>
                {:else}
                  <code class="safe-owner-address" title={entry.safeAddress}>{shortAddress(entry.safeAddress)}</code>
                {/if}
                {#if safeAppUrl}
                  <button
                    type="button"
                    class="btn-link"
                    onclick={() => openTreasurySafeApp(entry)}
                  >
                    {$t('governance.treasury.openSafe')}
                  </button>
                {/if}
              </dd>
              {#if st?.state}
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
              {/if}
            </dl>
            {#if st?.state && st.loading}
              <p class="safe-state-meta">{$t('governance.treasury.refreshing')}</p>
            {:else if st?.state && st.error}
              <p class="safe-state-error" role="alert">{$t('governance.treasury.lastRefreshFailed', { values: { error: st.error } })}</p>
            {:else if !st?.state && st?.loading}
              <p class="safe-state-meta">{$t('governance.treasury.loadingSafe')}</p>
            {:else if !st?.state && st?.error}
              <p class="safe-state-error" role="alert">{st.error}</p>
            {/if}
          </DashboardAssetCard>
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

  .treasury-addr-link {
    font-family: ui-monospace, monospace;
    margin: 0;
    padding: 0;
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
