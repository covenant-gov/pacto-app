<script lang="ts">
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';
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
    watchedRowsToWire,
    watchedWireFingerprint,
    type WalletSummary,
  } from '../../lib/wallet';
  import { getAddress, isAddress, parseUnits } from 'viem';
  import { showToast } from '../../stores/toast';
  import { waitForOnChainConfirmationInBackground } from '../../lib/evm/on-chain-background';
  import { requireBackupVerified } from '../../stores/backup-verification';
  import { normalizeLeadingDotDecimalInput } from '../../lib/wallet/amount-input';

  const tFn = get(t);

  interface Props {
    open: boolean;
    onClose: () => void;
    watchedAssetRows?: WatchedErc20Row[];
    /** Chains enabled in Wallet settings (catalog order subset). */
    enabledChainIds?: SupportedChainId[];
  }

  let {
    open,
    onClose,
    watchedAssetRows = [],
    enabledChainIds = [...WALLET_ASSETS_CHAIN_IDS],
  }: Props = $props();

  const titleId = 'wallet-home-send-title';
  const descId = 'wallet-home-send-desc';

  let toAddress = $state('');
  let chainId: SupportedChainId = $state(DEFAULT_CHAIN_ID);
  let assetCode = $state('ETH');
  let amountStr = $state('');

  const chainsForUi = $derived(
    enabledChainIds.length > 0 ? enabledChainIds : [...WALLET_ASSETS_CHAIN_IDS]
  );

  $effect(() => {
    if (chainsForUi.includes(chainId)) return;
    chainId = chainsForUi[0] ?? DEFAULT_CHAIN_ID;
  });

  const recipientValid = $derived.by(() => {
    const trimmed = toAddress.trim();
    if (!trimmed) return false;
    try {
      return isAddress(getAddress(trimmed as `0x${string}`));
    } catch {
      return false;
    }
  });

  let pricesResult = $state<
    { ok: true; prices: WalletUsdSpotPrices } | { ok: false; message: string } | null
  >(null);
  let pricesFetchKey = $state('');
  let pricesFetchGen = $state(0);

  /** Refetches USD prices once per chain while the modal is open; clears on close so a
   * stale quote never carries into the next open. */
  $effect(() => {
    if (!open) {
      pricesFetchKey = '';
      pricesResult = null;
      return;
    }
    const key = chainId;
    if (key === pricesFetchKey) return;
    pricesFetchKey = key;
    pricesFetchGen += 1;
    const gen = pricesFetchGen;
    pricesResult = null;
    getWalletUsdSpotPrices(chainId).then((r) => {
      if (gen !== pricesFetchGen) return;
      pricesResult = r;
    });
  });

  const assetOptions = $derived(
    listWalletAssetOptionsForChainWithWatched(chainId, watchedAssetRows) as WalletAssetOptionRow[]
  );

  $effect(() => {
    const codes = assetOptions.map((o) => o.code);
    if (codes.length > 0 && !codes.includes(assetCode)) {
      assetCode = codes[0] ?? 'ETH';
    }
  });

  const selectedOpt = $derived(assetOptions.find((o) => o.code === assetCode));

  let sendBalanceSummary: WalletSummary | null = $state(null);
  let sendBalanceError: string | null = $state(null);
  let sendBalanceLoading = $state(false);
  let sendBalanceFetchKey = $state('');
  let sendBalanceFetchGen = $state(0);

  const watchedWireForBalances = $derived(watchedRowsToWire(watchedAssetRows));

  $effect(() => {
    if (!open) {
      sendBalanceFetchKey = '';
      sendBalanceSummary = null;
      sendBalanceError = null;
      sendBalanceLoading = false;
      return;
    }
    const key = `${chainId}|${watchedWireFingerprint(watchedWireForBalances)}`;
    if (key === sendBalanceFetchKey) return;
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
  });

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

  const selectedBalanceRow = $derived(findBalanceForAsset(sendBalanceSummary, chainId, assetCode));

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

  const amountValid = $derived(parsePositiveAmount(amountStr) !== null);
  let sending = $state(false);
  let sendError = $state<{ message: string; txHash?: string; code?: string } | null>(null);

  const insufficientFunds = $derived(
    amountValid &&
      selectedOpt != null &&
      selectedBalanceRow != null &&
      amountExceedsBalance(amountStr.trim(), selectedBalanceRow.balanceRaw, selectedOpt.decimals)
  );

  const canConfirm = $derived(
    recipientValid && amountValid && !sending && selectedOpt != null && !insufficientFunds
  );

  const explorerLinkForError = $derived(
    sendError?.txHash != null && sendError.txHash.length > 0
      ? getExplorerTxUrl(chainId, sendError.txHash)
      : null
  );
  const explorerLinkLabel = $derived(explorerTxLinkLabel(chainId));

  async function copyErrorTxHash() {
    const h = sendError?.txHash;
    if (!h) return;
    const ok = await copyTextToClipboard(h);
    showToast(ok ? tFn('wallet.txHashCopied') : tFn('wallet.couldNotCopyHash'));
  }

  const canRetryAfterError = $derived(
    sendError != null && !sending && sendError.code !== 'RECEIPT_TIMEOUT'
  );

  const approxUsd = $derived(
    pricesResult?.ok === true && amountValid
      ? amountToApproxUsd(amountStr, assetCode, pricesResult.prices)
      : null
  );

  const usdLine = $derived(
    pricesResult === null
      ? tFn('wallet.loadingUsdRates')
      : !pricesResult.ok
        ? pricesResult.message
        : approxUsd != null
          ? `≈ ${formatApproxUsd(approxUsd)}`
          : amountValid && (assetCode === 'ETH' || assetCode === 'USDC' || assetCode === 'USDT')
            ? tFn('wallet.enterAmountForUsd')
            : amountValid
              ? tFn('wallet.usdUnavailable')
              : tFn('wallet.enterAmountForUsd')
  );

  function onAmountInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    amountStr = normalizeLeadingDotDecimalInput(el.value);
  }

  async function retryFailedSend() {
    if (!sendError || sending || !canRetryAfterError) return;
    sendError = null;
    await handleConfirm();
  }

  async function handleConfirm() {
    if (!canConfirm || !selectedOpt) return;
    if (!requireBackupVerified()) return;
    const amountHuman = normalizeLeadingDotDecimalInput(amountStr.trim());
    let normalizedTo: string;
    try {
      normalizedTo = getAddress(toAddress.trim() as `0x${string}`);
    } catch {
      showToast(tFn('wallet.invalidEthereumAddress'));
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
        onClose();
        waitForOnChainConfirmationInBackground(chainId, out.result.txHash, {
          subject: tFn('wallet.sendTitle'),
          actionKey: `wallet-send:${out.result.txHash}`,
          confirmedToast: false,
          onConfirmed: () => {
            const h = out.result.txHash;
            const short = h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h;
            showToast(tFn('wallet.txConfirmed', { values: { network: chainId, txHash: short } }));
          },
        });
      } else {
        sendError = {
          message: out.message,
          txHash: out.parsed?.txHash,
          code: out.parsed?.code,
        };
        showToast(out.parsed?.code === 'RECEIPT_TIMEOUT' ? tFn('wallet.confirmationTimedOut') : out.message);
      }
    } finally {
      sending = false;
    }
  }

  /** Clears the form once the modal is closed, so the next open starts blank instead of
   * carrying over a stale address/amount/error; never fires while the user is still editing. */
  $effect(() => {
    if (open) return;
    toAddress = '';
    amountStr = '';
    sendError = null;
  });
</script>

{#if open}
  <Modal {titleId} descriptionId={descId} onClose={() => !sending && onClose()} dismissible={!sending}>
    <h2 id={titleId}>{$t('wallet.sendTitle')}</h2>
    <p id={descId} class="home-send-desc">
      {$t('wallet.sendDesc', { values: { '0x': '0x' } })}
    </p>

    <div class="home-send-fields">
      <label class="home-send-label">
        <span class="home-send-label-text">{$t('wallet.recipientAddressLabel')}</span>
        <input
          class="home-send-input"
          type="text"
          bind:value={toAddress}
          placeholder={$t('wallet.recipientAddressPlaceholder')}
          autocomplete="off"
          spellcheck="false"
          disabled={sending}
          aria-invalid={toAddress.trim() !== '' && !recipientValid}
          aria-label={$t('wallet.recipientEvmAddressAria')}
        />
      </label>
      {#if toAddress.trim() && !recipientValid}
        <p class="home-send-invalid" role="alert">{$t('wallet.invalidEthereumAddress')}</p>
      {/if}

      <label class="home-send-label">
        <span class="home-send-label-text">{$t('wallet.networkLabel')}</span>
        <select class="home-send-select" bind:value={chainId} aria-label={$t('wallet.networkLabel')} disabled={sending}>
          {#each chainsForUi as cid (cid)}
            <option value={cid}>{getWalletNetworkDisplayName(cid)}</option>
          {/each}
        </select>
      </label>

      <label class="home-send-label">
        <span class="home-send-label-text">{$t('wallet.assetLabel')}</span>
        <select class="home-send-select" bind:value={assetCode} aria-label={$t('wallet.assetLabel')} disabled={sending}>
          {#each assetOptions as o (o.code)}
            <option value={o.code}>{o.code}</option>
          {/each}
        </select>
      </label>

      <label class="home-send-label">
        <span class="home-send-label-text">{$t('wallet.amountLabel')}</span>
        <input
          class="home-send-input"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          placeholder={$t('wallet.amountPlaceholder')}
          value={amountStr}
          oninput={onAmountInput}
          disabled={sending}
          aria-invalid={amountStr.trim() !== '' && (!amountValid || insufficientFunds)}
          aria-label={$t('wallet.amountLabel')}
        />
      </label>

      {#if sendBalanceLoading}
        <p class="home-send-balance-loading" role="status">{$t('wallet.loadingBalance')}</p>
      {/if}
      {#if insufficientFunds && selectedBalanceRow}
        <p class="home-send-insufficient" role="alert">
          {$t('wallet.insufficientFunds', { values: { assetCode, balanceDecimal: selectedBalanceRow.balanceDecimal } })}
        </p>
      {:else if sendBalanceError && !sendBalanceLoading}
        <p class="home-send-balance-warn" role="status">
          {$t('wallet.couldNotLoadBalance', { values: { error: sendBalanceError } })}
        </p>
      {/if}

      <p class="home-send-usd" role="status">{usdLine}</p>

      {#if sendError}
        <div class="home-send-error" role="alert">
          <p class="home-send-error-msg">{sendError.message}</p>
          {#if sendError.txHash}
            <div class="home-send-tx-row">
              <code class="home-send-tx-code" title={sendError.txHash}>{sendError.txHash}</code>
              <button type="button" class="home-send-copy-hash" onclick={copyErrorTxHash}>{$t('wallet.copyHash')}</button>
            </div>
          {/if}
          {#if explorerLinkForError}
            <a class="home-send-error-link" href={explorerLinkForError} target="_blank" rel="external noopener noreferrer">
              {explorerLinkLabel}
            </a>
          {/if}
          {#if sendError?.code === 'RECEIPT_TIMEOUT'}
            <p class="home-send-retry-hint" role="note">
              {$t('wallet.retryHint')}
            </p>
          {:else if canRetryAfterError}
            <button type="button" class="home-send-retry" onclick={retryFailedSend}>{$t('wallet.tryAgain')}</button>
          {/if}
        </div>
      {/if}
    </div>

    <div class="home-send-actions">
      <button type="button" class="home-send-btn home-send-btn-secondary" disabled={sending} onclick={onClose}>
        {$t('wallet.cancel')}
      </button>
      <button type="button" class="home-send-btn home-send-btn-primary" disabled={!canConfirm} onclick={handleConfirm}>
        {sending ? $t('wallet.submitting') : $t('wallet.confirm')}
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
    outline: 2px solid var(--brand);
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
    color: var(--brand);
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
    background: var(--brand);
    color: var(--on-brand);
  }
</style>
