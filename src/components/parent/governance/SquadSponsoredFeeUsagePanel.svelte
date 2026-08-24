<script lang="ts">
  import { t } from 'svelte-i18n';
  import {
    listSquadSponsoredFeeUsage,
    type SquadSponsoredFeeUsageDto,
  } from '../../../lib/governance/api';
  import {
    feeUsageActionLabel,
    feeUsageAmountEth,
    truncateNpub,
  } from '../../../lib/governance/sponsored-fee-usage-display';
  import { getExplorerTxUrl } from '../../../lib/wallet/assets';
  import { parseSupportedChainId } from '../../../lib/wallet/chains';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { shortAddress } from '../../../lib/wallet/signer-balance';

  let {
    parentId,
    chain,
    refreshToken = 0,
  }: {
    parentId: string;
    chain: string;
    refreshToken?: number;
  } = $props();

  let rows = $state<SquadSponsoredFeeUsageDto[]>([]);
  let loading = $state(false);
  let loadError = $state('');
  let loadSeq = 0;

  const chainId = $derived(parseSupportedChainId(chain));

  async function loadRows() {
    const id = parentId.trim();
    if (!id) {
      rows = [];
      loadError = '';
      return;
    }
    const seq = ++loadSeq;
    loading = true;
    loadError = '';
    try {
      const next = await listSquadSponsoredFeeUsage({ parentId: id });
      if (seq !== loadSeq) return;
      rows = next;
    } catch (e) {
      if (seq !== loadSeq) return;
      loadError = getInvokeErrorMessage(e, 'governance.treasury.feeUsage.error');
      rows = [];
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => {
    void parentId;
    void refreshToken;
    void loadRows();
  });

  function openTx(txHash: string) {
    const url = getExplorerTxUrl(chainId, txHash);
    if (url) openExternalUrl(url);
  }

  function actorTitle(row: SquadSponsoredFeeUsageDto): string {
    const parts = [row.actorEvm?.trim(), row.actorNpub?.trim()].filter(Boolean);
    return parts.join(' · ');
  }
</script>

<details class="fee-usage">
  <summary class="fee-usage-summary">{$t('governance.treasury.feeUsage.summary')}</summary>

  {#if loading && rows.length === 0}
    <p class="muted">{$t('governance.treasury.feeUsage.loading')}</p>
  {:else if loadError}
    <p class="fee-usage-error" role="alert">
      {loadError.startsWith('governance.') ? $t(loadError) : loadError}
    </p>
    <button type="button" class="btn-secondary fee-usage-retry" onclick={() => void loadRows()}>
      {$t('governance.action.retry')}
    </button>
  {:else if rows.length === 0}
    <p class="muted">{$t('governance.treasury.feeUsage.empty')}</p>
  {:else}
    <div class="fee-usage-scroll">
      <table class="fee-usage-table">
        <thead>
          <tr>
            <th scope="col">{$t('governance.treasury.feeUsage.colActor')}</th>
            <th scope="col">{$t('governance.treasury.feeUsage.colAmount')}</th>
            <th scope="col">{$t('governance.treasury.feeUsage.colAction')}</th>
            <th scope="col">{$t('governance.treasury.feeUsage.colTarget')}</th>
            <th scope="col">{$t('governance.treasury.feeUsage.colTx')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.id)}
            {@const amountEth = feeUsageAmountEth(row.amountWei)}
            <tr>
              <td title={actorTitle(row)}>
                <code class="fee-mono">{shortAddress(row.actorEvm)}</code>
                {#if row.actorNpub?.trim()}
                  <span class="muted fee-npub">{truncateNpub(row.actorNpub)}</span>
                {/if}
              </td>
              <td>
                {#if amountEth != null}
                  {$t('governance.treasury.balanceEth', { values: { balance: amountEth } })}
                {:else}
                  <span class="muted">—</span>
                {/if}
              </td>
              <td><code class="fee-mono">{feeUsageActionLabel(row)}</code></td>
              <td title={row.target}>
                <code class="fee-mono">{shortAddress(row.target)}</code>
              </td>
              <td>
                {#if row.txHash?.trim() && getExplorerTxUrl(chainId, row.txHash)}
                  <button
                    type="button"
                    class="btn-link"
                    onclick={() => openTx(row.txHash)}
                  >
                    {$t('governance.treasury.feeUsage.viewTx')}
                  </button>
                {:else if row.txHash?.trim()}
                  <code class="fee-mono" title={row.txHash}>{shortAddress(row.txHash)}</code>
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
</details>

<style>
  .fee-usage {
    margin: 0;
  }
  .fee-usage-summary {
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .fee-usage-scroll {
    margin-top: 10px;
    overflow-x: auto;
  }
  .fee-usage-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  .fee-usage-table th,
  .fee-usage-table td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: top;
  }
  .fee-usage-table th {
    color: var(--text-muted);
    font-weight: 500;
  }
  .fee-mono {
    font-size: 0.75rem;
  }
  .fee-npub {
    display: block;
    font-size: 0.6875rem;
    margin-top: 2px;
  }
  .muted {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
  .fee-usage-error {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    color: var(--danger, #b91c1c);
  }
  .fee-usage-retry {
    margin-top: 8px;
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
