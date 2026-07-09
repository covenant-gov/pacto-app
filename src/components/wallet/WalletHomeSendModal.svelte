<script lang="ts">
  import { onMount } from 'svelte';
  import { getAddress, isAddress, parseUnits } from 'viem';
  import Modal from '../ui/Modal.svelte';
  import type { SupportedChainId } from '../../lib/wallet/chains';
  import { DEFAULT_CHAIN_ID } from '../../lib/wallet/chains';
  import {
    WALLET_ASSETS_CHAIN_IDS,
    getWalletNetworkDisplayName,
    getExplorerTxUrl,
    explorerTxLinkLabel,
  } from '../../lib/wallet/assets';
  import { copyTextToClipboard } from '../../lib/wallet/clipboard-copy';
  import {
    listWalletAssetOptionsForChainWithWatched,
    type WatchedErc20Row,
    type WalletAssetOptionRow,
  } from '../../lib/wallet/watched-tokens';
  import {
    getWalletUsdSpotPrices,
    amountToApproxUsd,
    formatApproxUsd,
    type WalletUsdSpotPrices,
  } from '../../lib/wallet/pricing';
  import {
    getWalletSummary,
    walletBuildAndSendTransaction,
    walletWaitForTransaction,
    watchedRowsToWire,
    watchedWireFingerprint,
    type WalletSummary,
  } from '../../lib/wallet';
  import { toastWalletBroadcastSubmitted } from '../../lib/wallet/wallet-dm-transfer';
  import { showToast } from '../../stores/toast';
  import { normalizeLeadingDotDecimalInput } from '../../lib/wallet/amount-input';

  export let open: boolean;
  export let onClose: () => void;
  export let watchedAssetRows: WatchedErc20Row[] = [];
  /** Chains enabled in Wallet settings (catalog order subset). */
  export let enabledChainIds: SupportedChainId[] = [...WALLET_ASSETS_CHAIN_IDS];

  const titleId = 'wallet-home-send-title';
  const descId = 'wallet-home-send-desc';

  let toAddress = '';
  let chainId: SupportedChainId = DEFAULT_CHAIN_ID;
  let assetCode = 'ETH';
  let amountStr = '';

  $: chainsForUi =
    enabledChainIds.length > 0 ? enabledChainIds : [...WALLET_ASSETS_CHAIN_IDS];

  $: if (!chainsForUi.includes(chainId)) {
    chainId = chainsForUi[0] ?? DEFAULT_CHAIN_ID;
  }

  $: recipientValid = (() => {
    const t = toAddress.trim();
    if (!t) return false;
    try {
      return isAddress(getAddress(t as `0x${string}`));
    } catch {
      return false;
    }
  })();

  let pricesResult:
    | { ok: true; prices: WalletUsdSpotPrices }
    | { ok: false; message: string }
    | null = null;

  onMount(() => {
    let cancelled = false;
    getWalletUsdSpotPrices().then((r) => {
      if (!cancelled) pricesResult = r;
    });
    return () => {
      cancelled = true;
    };
  });

  $: assetOptions = listWalletAssetOptionsForChainWithWatched(
    chainId,
    watchedAssetRows
  ) as WalletAssetOptionRow[];

  $: {
    const codes = assetOptions.map((o) => o.code);
    if (codes.length > 0 && !codes.includes(assetCode)) {
      assetCode = codes[0] ?? 'ETH';
    }
  }

  $: selectedOpt = assetOptions.find((o) => o.code === assetCode);

  let sendBalanceSummary: WalletSummary | null = null;
  let sendBalanceError: string | null = null;
  let sendBalanceLoading = false;
  let sendBalanceFetchKey = '';
  let sendBalanceFetchGen = 0;

  $: watchedWireForBalances = watchedRowsToWire(watchedAssetRows);

  $: if (!open) {
    sendBalanceFetchKey = '';
    sendBalanceSummary = null;
    sendBalanceError = null;
    sendBalanceLoading = false;
  } else {
    const key = `${chainId}|${watchedWireFingerprint(watchedWireForBalances)}`;
    if (key !== sendBalanceFetchKey) {
      sendBalanceFetchKey = key;
      sendBalanceFetchGen += 1;
      const gen = sendBalanceFetchGen;
      sendBalanceLoading = true;
      sendBalanceError = null;
      getWalletSummary(watchedWireForBalances, [chainId]).then((r) => {
        if (gen !== sendBalanceFetchGen) return;
        sendBalanceLoading = false;
        if (r.ok) {
          sendBalanceSummary = r.summary;
        } else {
          sendBalanceSummary = null;
          sendBalanceError = r.message;
        }
      });
    }
  }

  function findBalanceForAsset(
    summary: WalletSummary | null,
    netKey: SupportedChainId,
    symbol: string
  ): { balanceRaw: string; balanceDecimal: string } | null {
    if (!summary) return null;
    const net = summary.networks.find((n) => n.network === netKey);
    if (!net) return null;
    const asset = net.assets.find((a) => a.symbol === symbol);
    if (!asset) return null;
    return { balanceRaw: asset.balanceRaw, balanceDecimal: asset.balanceDecimal };
  }

  $: selectedBalanceRow = findBalanceForAsset(sendBalanceSummary, chainId, assetCode);

  function amountExceedsBalance(amountTrimmed: string, balanceRaw: string, decimals: number): boolean {
    try {
      if (!/^\d+$/.test(balanceRaw.trim())) return false;
      const amt = parseUnits(amountTrimmed.replace(/,/g, ''), decimals);
      return amt > BigInt(balanceRaw.trim());
    } catch {
      return false;
    }
  }

  function parsePositiveAmount(s: string): number | null {
    const t = s.trim();
    if (!t) return null;
    const n = Number.parseFloat(t.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  $: amountValid = parsePositiveAmount(amountStr) !== null;
  let sending = false;
  let sendError: { message: string; txHash?: string; code?: string } | null = null;

  $: insufficientFunds =
    amountValid &&
    selectedOpt != null &&
    selectedBalanceRow != null &&
    amountExceedsBalance(amountStr.trim(), selectedBalanceRow.balanceRaw, selectedOpt.decimals);

  $: canConfirm =
    recipientValid && amountValid && !sending && selectedOpt != null && !insufficientFunds;

  $: approxUsd =
    pricesResult?.ok === true && amountValid
      ? amountToApproxUsd(amountStr, assetCode, pricesResult.prices)
      : null;

  $: usdLine =
    pricesResult === null
      ? 'Loading USD rates…'
      : !pricesResult.ok
        ? pricesResult.message
        : approxUsd != null
          ? `≈ ${formatApproxUsd(approxUsd)}`
          : amountValid && (assetCode === 'ETH' || assetCode === 'USDC' || assetCode === 'USDT')
            ? 'Enter an amount to see USD estimate.'
            : amountValid
              ? 'USD estimate unavailable for this asset.'
              : 'Enter an amount to see USD estimate.';

  $: explorerLinkForError =
    sendError?.txHash != null && sendError.txHash.length > 0
      ? getExplorerTxUrl(chainId, sendError.txHash)
      : null;
  $: explorerLinkLabel = explorerTxLinkLabel(chainId);

  $: canRetryAfterError =
    sendError != null && !sending && sendError.code !== 'RECEIPT_TIMEOUT';

  function onAmountInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    amountStr = normalizeLeadingDotDecimalInput(el.value);
  }

  async function copyErrorTxHash() {
    const h = sendError?.txHash;
    if (!h) return;
    const ok = await copyTextToClipboard(h);
    showToast(ok ? 'Transaction hash copied' : 'Could not copy hash');
  }

  async function handleConfirm() {
    if (!canConfirm || !selectedOpt) return;
    const amountHuman = normalizeLeadingDotDecimalInput(amountStr.trim());
    let normalizedTo: string;
    try {
      normalizedTo = getAddress(toAddress.trim() as `0x${string}`);
    } catch {
      showToast('Enter a valid recipient address.');
      return;
    }
    const erc20Transfer =
      selectedOpt.kind === 'erc20' && selectedOpt.address
        ? { address: selectedOpt.address as string, decimals: selectedOpt.decimals }
        : undefined;
    sendError = null;
    sending = true;
    try {
      const out = await walletBuildAndSendTransaction(
        '',
        chainId,
        assetCode,
        amountHuman,
        erc20Transfer,
        normalizedTo,
        false,
      );
      if (out.ok) {
        toastWalletBroadcastSubmitted(out.result);
        onClose();
        void walletWaitForTransaction(chainId, out.result.txHash).then((wait) => {
          if (wait.ok) {
            const h = wait.result.txHash;
            const short = h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h;
            showToast(`Confirmed on ${wait.result.network}. Tx ${short}`);
          } else if (wait.parsed?.code !== 'RECEIPT_TIMEOUT') {
            showToast(wait.message);
          }
        });
      } else {
        sendError = {
          message: out.message,
          txHash: out.parsed?.txHash,
          code: out.parsed?.code,
        };
        showToast(out.parsed?.code === 'RECEIPT_TIMEOUT' ? 'Confirmation timed out' : out.message);
      }
    } finally {
      sending = false;
    }
  }

  async function retryFailedSend() {
    if (!sendError || sending || !canRetryAfterError) return;
    sendError = null;
    await handleConfirm();
  }

  $: if (!open) {
    toAddress = '';
    amountStr = '';
    sendError = null;
  }
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={() => !sending && onClose()} dismissible={!sending}>
    <h2 id={titleId}>Send</h2>
    <p id={descId} class="home-send-desc">
      Send from your embedded wallet to any <strong>0x</strong> address on the selected network. Confirm signs and
      broadcasts in the desktop app; confirmation continues in the background after the modal closes.
    </p>

    <div class="home-send-fields">
      <label class="home-send-label">
        <span class="home-send-label-text">Recipient address</span>
        <input
          class="home-send-input"
          type="text"
          bind:value={toAddress}
          placeholder="0x…"
          autocomplete="off"
          spellcheck="false"
          disabled={sending}
          aria-invalid={toAddress.trim() !== '' && !recipientValid}
          aria-label="Recipient EVM address"
        />
      </label>
      {#if toAddress.trim() && !recipientValid}
        <p class="home-send-invalid" role="alert">Enter a valid Ethereum address.</p>
      {/if}

      <label class="home-send-label">
        <span class="home-send-label-text">Network</span>
        <select class="home-send-select" bind:value={chainId} aria-label="Network" disabled={sending}>
          {#each chainsForUi as cid (cid)}
            <option value={cid}>{getWalletNetworkDisplayName(cid)}</option>
          {/each}
        </select>
      </label>

      <label class="home-send-label">
        <span class="home-send-label-text">Asset</span>
        <select class="home-send-select" bind:value={assetCode} aria-label="Asset" disabled={sending}>
          {#each assetOptions as o (o.code)}
            <option value={o.code}>{o.code}</option>
          {/each}
        </select>
      </label>

      <label class="home-send-label">
        <span class="home-send-label-text">Amount</span>
        <input
          class="home-send-input"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0.0"
          value={amountStr}
          on:input={onAmountInput}
          disabled={sending}
          aria-invalid={amountStr.trim() !== '' && (!amountValid || insufficientFunds)}
          aria-label="Amount"
        />
      </label>

      {#if sendBalanceLoading}
        <p class="home-send-balance-loading" role="status">Loading balance…</p>
      {/if}
      {#if insufficientFunds && selectedBalanceRow}
        <p class="home-send-insufficient" role="alert">
          This amount is more than your {assetCode} balance on this network. Available: {selectedBalanceRow.balanceDecimal}
          {assetCode}.
        </p>
      {:else if sendBalanceError && !sendBalanceLoading}
        <p class="home-send-balance-warn" role="status">
          Could not load your balance ({sendBalanceError}). You can still try to send.
        </p>
      {/if}

      <p class="home-send-usd" role="status">{usdLine}</p>

      {#if sendError}
        <div class="home-send-error" role="alert">
          <p class="home-send-error-msg">{sendError.message}</p>
          {#if sendError.txHash}
            <div class="home-send-tx-row">
              <code class="home-send-tx-code" title={sendError.txHash}>{sendError.txHash}</code>
              <button type="button" class="home-send-copy-hash" on:click={copyErrorTxHash}>Copy hash</button>
            </div>
          {/if}
          {#if explorerLinkForError}
            <a class="home-send-error-link" href={explorerLinkForError} target="_blank" rel="external noopener noreferrer">
              {explorerLinkLabel}
            </a>
          {/if}
          {#if sendError?.code === 'RECEIPT_TIMEOUT'}
            <p class="home-send-retry-hint" role="note">
              The transaction may still confirm. Check the explorer before sending again.
            </p>
          {:else if canRetryAfterError}
            <button type="button" class="home-send-retry" on:click={retryFailedSend}>Try again</button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="home-send-actions">
      <button type="button" class="home-send-btn home-send-btn-secondary" disabled={sending} on:click={onClose}>
        Cancel
      </button>
      <button type="button" class="home-send-btn home-send-btn-primary" disabled={!canConfirm} on:click={handleConfirm}>
        {sending ? 'Submitting…' : 'Confirm'}
      </button>
    </div>
  </Modal>
{/if}

<style>
  .home-send-desc {
    margin: 0 0 20px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .home-send-fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 24px;
  }

  .home-send-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
  }

  .home-send-label-text {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .home-send-select,
  .home-send-input {
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-primary);
    font-size: 0.9375rem;
    font-family: inherit;
    box-sizing: border-box;
    width: 100%;
  }

  .home-send-input:focus,
  .home-send-select:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .home-send-invalid {
    margin: -6px 0 0;
    font-size: 0.8125rem;
    color: var(--danger, #c44);
  }

  .home-send-balance-loading,
  .home-send-balance-warn {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .home-send-insufficient {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger, #c44);
  }

  .home-send-usd {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .home-send-wait {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .home-send-error {
    padding: 12px;
    border-radius: 8px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .home-send-error-msg {
    margin: 0 0 8px;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .home-send-tx-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .home-send-tx-code {
    font-size: 0.75rem;
    word-break: break-all;
    color: var(--text-secondary);
  }

  .home-send-copy-hash {
    font-size: 0.75rem;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-primary);
    cursor: pointer;
  }

  .home-send-error-link {
    font-size: 0.8125rem;
    color: var(--accent);
  }

  .home-send-retry-hint {
    margin: 8px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .home-send-retry {
    margin-top: 8px;
    padding: 8px 12px;
    font-size: 0.875rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    cursor: pointer;
  }

  .home-send-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .home-send-btn {
    padding: 10px 18px;
    font-size: 0.9375rem;
    font-weight: 500;
    border-radius: 8px;
    cursor: pointer;
    border: none;
    font-family: inherit;
  }

  .home-send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .home-send-btn-secondary {
    background: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .home-send-btn-primary {
    background: var(--accent);
    color: #fff;
  }
</style>
