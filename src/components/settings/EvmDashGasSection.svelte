<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import RefreshIconButton from '../ui/RefreshIconButton.svelte';
  import SettingsCollapsibleSection from './SettingsCollapsibleSection.svelte';
  import { usernameGlobalSpendablePoolWei } from '../../lib/api/username';
  import {
    feeUsageActionLabel,
    feeUsageAmountEth,
    globalFeeUsageLaneLabelKey,
    loadGlobalSponsoredFeeUsage,
    type GlobalSponsoredFeeUsageDto,
  } from '../../lib/wallet/global-sponsored-fee-usage';
  import { getExplorerTxUrl, getWalletNetworkDisplayName } from '../../lib/wallet/assets';
  import { parseSupportedChainId } from '../../lib/wallet/chains';
  import { shortAddress } from '../../lib/wallet/signer-balance';
  import { openExternalUrl } from '../../lib/utils/open-external';
  import { getInvokeErrorMessage } from '../../lib/utils/tauri-errors';
  import { USERNAME_NETWORK } from '../../stores/username';
  import { settingsSectionCollapsed } from '../../lib/settings/settings-section-collapse';

  let rows = $state<GlobalSponsoredFeeUsageDto[]>([]);
  let loading = $state(false);
  let loadError = $state('');
  let poolWei = $state<string | null>(null);
  let poolError = $state('');
  let loadSeq = 0;

  const expanded = $derived(!($settingsSectionCollapsed['settings-evm-dash-gas'] ?? true));
  const poolNetworkName = $derived(
    getWalletNetworkDisplayName(parseSupportedChainId(USERNAME_NETWORK)),
  );

  async function loadRows() {
    const seq = ++loadSeq;
    loading = true;
    loadError = '';
    poolError = '';
    poolWei = null;
    try {
      const [next, pool] = await Promise.all([
        loadGlobalSponsoredFeeUsage({ limit: 50 }),
        usernameGlobalSpendablePoolWei(USERNAME_NETWORK).catch((e) => {
          if (seq === loadSeq) {
            poolError = getInvokeErrorMessage(e, get(t)('settings.evmDashGas.poolError'));
          }
          return null;
        }),
      ]);
      if (seq !== loadSeq) return;
      rows = next;
      if (pool != null) {
        poolWei = pool;
        poolError = '';
      }
    } catch (e) {
      if (seq !== loadSeq) return;
      loadError = getInvokeErrorMessage(e, get(t)('settings.evmDashGas.error'));
      rows = [];
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => {
    if (!expanded) return;
    void loadRows();
  });

  function laneLabel(lane: string): string {
    const key = globalFeeUsageLaneLabelKey(lane);
    return key ? get(t)(key) : lane.trim() || '—';
  }

  function openTx(chain: string, txHash: string) {
    const url = getExplorerTxUrl(parseSupportedChainId(chain), txHash);
    if (url) openExternalUrl(url);
  }

  function rowExplorerUrl(row: GlobalSponsoredFeeUsageDto): string | null {
    if (!row.txHash?.trim()) return null;
    return getExplorerTxUrl(parseSupportedChainId(row.chain), row.txHash);
  }
</script>

<SettingsCollapsibleSection
  sectionId="settings-evm-dash-gas"
  title={$t('settings.evmDashGas.title')}
  sectionClass="settings-section--evm-dash-gas"
>
  <p class="dash-disclaimer muted">{$t('settings.evmDashGas.disclaimer')}</p>

  <div class="dash-toolbar">
    <div class="dash-pool">
      <span class="dash-pool-label">
        {$t('settings.evmDashGas.poolLabel', { values: { network: poolNetworkName } })}
      </span>
      {#if poolError}
        <span class="dash-pool-error" role="status">{poolError}</span>
      {:else if poolWei != null}
        {@const eth = feeUsageAmountEth(poolWei)}
        <span class="dash-pool-value">
          {#if eth != null}
            {$t('settings.evmDashGas.poolBalance', { values: { balance: eth } })}
          {:else}
            <span class="muted">—</span>
          {/if}
        </span>
      {:else if loading}
        <span class="muted">{$t('settings.evmDashGas.loading')}</span>
      {:else}
        <span class="muted">—</span>
      {/if}
    </div>
    <RefreshIconButton
      spinning={loading}
      ariaLabel={loading ? $t('settings.evmDashGas.refreshing') : $t('settings.evmDashGas.refresh')}
      title={loading ? $t('settings.evmDashGas.refreshing') : $t('settings.evmDashGas.refresh')}
      onclick={() => void loadRows()}
    />
  </div>

  {#if loading && rows.length === 0}
    <p class="muted">{$t('settings.evmDashGas.loading')}</p>
  {:else if loadError}
    <p class="dash-error" role="alert">{loadError}</p>
  {:else if rows.length === 0}
    <p class="muted">{$t('settings.evmDashGas.empty')}</p>
  {:else}
    <div class="dash-scroll">
      <table class="dash-table">
        <thead>
          <tr>
            <th scope="col">{$t('settings.evmDashGas.colLane')}</th>
            <th scope="col">{$t('settings.evmDashGas.colAction')}</th>
            <th scope="col">{$t('settings.evmDashGas.colAmount')}</th>
            <th scope="col">{$t('settings.evmDashGas.colParent')}</th>
            <th scope="col">{$t('settings.evmDashGas.colTarget')}</th>
            <th scope="col">{$t('settings.evmDashGas.colTx')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            {@const amountEth = feeUsageAmountEth(row.amountWei)}
            {@const explorer = rowExplorerUrl(row)}
            <tr>
              <td>
                <span class="dash-lane">{laneLabel(row.lane)}</span>
              </td>
              <td><code class="dash-mono">{feeUsageActionLabel(row)}</code></td>
              <td>
                {#if amountEth != null}
                  {$t('settings.evmDashGas.amountEth', { values: { balance: amountEth } })}
                {:else}
                  <span class="muted">—</span>
                {/if}
              </td>
              <td title={row.parentId ?? ''}>
                {#if row.parentId?.trim()}
                  <code class="dash-mono">{row.parentId.trim()}</code>
                {:else}
                  <span class="muted">—</span>
                {/if}
              </td>
              <td title={row.target}>
                <code class="dash-mono">{shortAddress(row.target)}</code>
              </td>
              <td>
                {#if explorer}
                  <button
                    type="button"
                    class="btn-link"
                    onclick={() => openTx(row.chain, row.txHash)}
                  >
                    {$t('settings.evmDashGas.viewTx')}
                  </button>
                {:else if row.txHash?.trim()}
                  <code class="dash-mono" title={row.txHash}>{shortAddress(row.txHash)}</code>
                {:else}
                  <span class="muted">—</span>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</SettingsCollapsibleSection>

<style>
  .dash-disclaimer {
    margin: 0 0 12px;
  }
  .dash-toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .dash-pool {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .dash-pool-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .dash-pool-value {
    font-size: 0.875rem;
    color: var(--text-primary);
  }
  .dash-pool-error {
    font-size: 0.8125rem;
    color: var(--danger, #b91c1c);
  }
  .dash-scroll {
    overflow-x: auto;
  }
  .dash-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  .dash-table th,
  .dash-table td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: top;
  }
  .dash-table th {
    color: var(--text-muted);
    font-weight: 500;
  }
  .dash-lane {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    font-size: 0.75rem;
  }
  .dash-mono {
    font-size: 0.75rem;
  }
  .muted {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .dash-error {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    color: var(--danger, #b91c1c);
  }
  .btn-link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
  }
</style>
