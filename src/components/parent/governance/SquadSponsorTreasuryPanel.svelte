<script lang="ts">
  import type { SquadInfraDto } from '../../../lib/governance/api';
  import {
    SPONSOR_LOW_BALANCE_WEI,
    depositSquadSponsor,
    getSquadSponsorSummary,
    type SquadSponsorSummaryDto,
  } from '../../../lib/governance/api';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { explorerAddressUrl, parseSupportedChainId } from '../../../lib/wallet/chains';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { parseWalletOpError } from '../../../lib/wallet/backend-wallet';
  import { formatEther, parseEther } from 'viem';
  import { showToast } from '../../../stores/toast';

  export let parentId: string;
  export let sponsorRow: SquadInfraDto | null = null;
  export let onOpenDeploy: (() => void) | undefined = undefined;

  let summary: SquadSponsorSummaryDto | null = null;
  let loading = false;
  let loadError = '';
  let depositEth = '0.01';
  let depositing = false;
  let depositError = '';
  let showDepositForm = false;

  $: network = (sponsorRow?.chain?.trim() || 'sepolia') as SupportedChainId;
  $: poolBalanceWei = summary ? BigInt(summary.poolBalanceWei) : null;
  $: lowBalance =
    poolBalanceWei != null && poolBalanceWei < SPONSOR_LOW_BALANCE_WEI;
  $: explorerUrl =
    summary?.sponsorAddress &&
    explorerAddressUrl(parseSupportedChainId(summary.chain), summary.sponsorAddress);

  async function refreshSummary() {
    if (!parentId?.trim() || !sponsorRow) {
      summary = null;
      return;
    }
    loading = true;
    loadError = '';
    try {
      summary = await getSquadSponsorSummary({
        network,
        parentId: parentId.trim(),
        sponsorAddress: sponsorRow.canonicalRef,
      });
    } catch (e) {
      loadError = getInvokeErrorMessage(e, 'Could not load sponsor balance.');
      summary = null;
    } finally {
      loading = false;
    }
  }

  $: sponsorKey = sponsorRow?.id ?? '';
  $: if (sponsorKey && parentId?.trim()) {
    void refreshSummary();
  }

  async function submitDeposit() {
    depositError = '';
    if (!parentId?.trim() || !sponsorRow) return;
    let amountWei: string;
    try {
      amountWei = parseEther(depositEth.trim()).toString();
      if (BigInt(amountWei) <= 0n) {
        depositError = 'Amount must be greater than zero.';
        return;
      }
    } catch {
      depositError = 'Enter a valid ETH amount (e.g. 0.01).';
      return;
    }
    depositing = true;
    try {
      await depositSquadSponsor({
        network,
        parentId: parentId.trim(),
        amountWei,
        sponsorAddress: sponsorRow.canonicalRef,
      });
      showToast('Sponsor pool deposit confirmed.');
      showDepositForm = false;
      await refreshSummary();
    } catch (e) {
      let raw = getInvokeErrorMessage(e, 'Deposit failed.');
      const parsed = parseWalletOpError(raw);
      if (parsed?.message) raw = parsed.message;
      depositError = raw;
    } finally {
      depositing = false;
    }
  }
</script>

<section class="dashboard-section sponsor-treasury-section" aria-labelledby="sponsor-heading">
  <div class="treasury-section-head">
    <h3 id="sponsor-heading" class="section-heading">Squad sponsor</h3>
    {#if sponsorRow}
      <button type="button" class="btn-secondary sponsor-refresh-btn" on:click={refreshSummary} disabled={loading}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    {/if}
  </div>

  {#if !sponsorRow}
    <p class="sponsor-empty-lead">No squad sponsor deployed yet. Gas sponsorship requires a sponsor clone first.</p>
    {#if onOpenDeploy}
      <button type="button" class="btn-primary" on:click={onOpenDeploy}>Deploy squad sponsor</button>
    {/if}
  {:else if loading && !summary}
    <p class="muted">Loading sponsor balance…</p>
  {:else if loadError}
    <p class="sponsor-error" role="alert">{loadError}</p>
    <button type="button" class="btn-secondary" on:click={refreshSummary}>Retry</button>
  {:else if summary}
    <p class="sponsor-lead muted">Gas sponsorship pool for this squad on <strong>{summary.chain}</strong>.</p>
    <dl class="sponsor-dl">
      <dt>Pool balance</dt>
      <dd>
        <strong>{formatEther(BigInt(summary.poolBalanceWei))} ETH</strong>
        {#if lowBalance}
          <span class="sponsor-low-badge" role="status">Low balance — top up before gas runs out</span>
        {/if}
      </dd>
      <dt>Sponsor clone</dt>
      <dd>
        <code class="sponsor-mono">{summary.sponsorAddress}</code>
        {#if explorerUrl}
          <button type="button" class="btn-link sponsor-explorer-link" on:click={() => openExternalUrl(explorerUrl)}>
            View on explorer
          </button>
        {/if}
      </dd>
    </dl>

    {#if showDepositForm}
      <div class="sponsor-deposit-form">
        <label class="sponsor-deposit-label" for="sponsor-deposit-eth">Deposit amount (ETH)</label>
        <input
          id="sponsor-deposit-eth"
          type="text"
          class="sponsor-deposit-input"
          bind:value={depositEth}
          disabled={depositing}
          autocomplete="off"
        />
        {#if depositError}
          <p class="input-error" role="alert">{depositError}</p>
        {/if}
        <div class="sponsor-deposit-actions">
          <button type="button" class="btn-secondary" on:click={() => (showDepositForm = false)} disabled={depositing}>
            Cancel
          </button>
          <button type="button" class="btn-primary" on:click={submitDeposit} disabled={depositing}>
            {depositing ? 'Sending…' : 'Confirm deposit'}
          </button>
        </div>
      </div>
    {:else}
      <button type="button" class="btn-primary sponsor-deposit-btn" on:click={() => (showDepositForm = true)}>
        Deposit
      </button>
    {/if}
  {/if}
</section>

<style>
  .sponsor-treasury-section {
    margin-bottom: 8px;
  }

  .sponsor-empty-lead {
    margin: 0 0 12px;
    max-width: 52ch;
    color: var(--text-secondary);
  }

  .sponsor-lead {
    margin: 0 0 12px;
    font-size: 0.875rem;
  }

  .sponsor-dl {
    margin: 0 0 14px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 14px;
    font-size: 0.875rem;
  }

  .sponsor-dl dt {
    margin: 0;
    color: var(--text-muted);
    font-weight: 500;
  }

  .sponsor-dl dd {
    margin: 0;
    word-break: break-all;
  }

  .sponsor-mono {
    font-size: 0.8125rem;
  }

  .sponsor-low-badge {
    display: block;
    margin-top: 6px;
    font-size: 0.8125rem;
    color: var(--warning-text, #b45309);
    font-weight: 500;
  }

  .sponsor-error {
    color: var(--error-text, #b91c1c);
    margin: 0 0 8px;
  }

  .sponsor-refresh-btn {
    font-size: 0.8125rem;
  }

  .sponsor-explorer-link {
    display: inline-block;
    margin-left: 8px;
    padding: 0;
    font-size: inherit;
  }

  .sponsor-deposit-form {
    margin-top: 8px;
    max-width: 320px;
  }

  .sponsor-deposit-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .sponsor-deposit-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    margin-bottom: 8px;
  }

  .sponsor-deposit-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sponsor-deposit-btn {
    margin-top: 4px;
  }
</style>
