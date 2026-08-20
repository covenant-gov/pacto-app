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
  import { parseUnits } from 'viem';
  import { showToast } from '../../stores/toast';
  import { requireBackupVerified } from '../../stores/backup-verification';
  import type { WalletSendPrefillPayload } from '../../stores/app';
  import { currentUser } from '../../stores/auth';
  import { formatWalletTxRequest } from '../../lib/wallet/dm-messages';
  import {
    finalizeWalletDmTransferAfterBroadcast,
    toastWalletBroadcastSubmitted,
  } from '../../lib/wallet/wallet-dm-transfer';
  import { normalizeLeadingDotDecimalInput } from '../../lib/wallet/amount-input';
  import { getActiveEvmSignerAddress } from '../../lib/wallet/evm-accounts';

  const tFn = get(t);

  export let mode: 'send' | 'request';
  export let npub: string;
  export let peerDisplayName: string;
  export let onClose: () => void;
  /** Request mode: post JSON DM (`wallet_tx_request`). Same path as normal DM send. */
  export let postDmPlaintext: ((content: string) => Promise<boolean>) | undefined = undefined;
  /** Send mode: from Accept on a `wallet_tx_request` (applied once per open). */
  export let formPrefill: WalletSendPrefillPayload | null = null;
  /** Send mode: refresh balances after confirmation (chat note is handled in background). */
  export let onBalanceRefresh: (() => void | Promise<void>) | undefined = undefined;

  /** ERC-20 rows the user watches (from Import tokens); native ETH is always offered. */
  export let watchedAssetRows: WatchedErc20Row[] = [];

  function truncateNpub(n: string): string {
    if (n.length <= 20) return n;
    return n.slice(0, 10) + '…' + n.slice(-6);
  }

  const titleId = `wallet-${mode}-title`;
  const descId = `wallet-${mode}-desc`;

  let chainId: SupportedChainId = DEFAULT_CHAIN_ID;
  let assetCode = 'ETH';
  let amountStr = '';

  let appliedPrefillKey = '';
  let linkedRequestId = '';

  $: prefillKey =
    mode === 'send' && formPrefill
      ? `${formPrefill.requestMessageId}:${formPrefill.requestId}`
      : '';

  $: if (mode === 'send' && formPrefill && prefillKey !== appliedPrefillKey) {
    appliedPrefillKey = prefillKey;
    chainId = formPrefill.network;
    assetCode = formPrefill.asset;
    amountStr = normalizeLeadingDotDecimalInput(formPrefill.amount.trim());
    linkedRequestId = formPrefill.requestId;
  }

  $: if (mode === 'send' && !formPrefill) {
    appliedPrefillKey = '';
    linkedRequestId = '';
  }

  let pricesResult:
    | { ok: true; prices: WalletUsdSpotPrices }
    | { ok: false; message: string }
    | null = null;
  let pricesFetchKey = '';
  let pricesFetchGen = 0;

  $: {
    const key = `${mode}|${chainId}`;
    if (mode !== 'send') {
      pricesFetchKey = '';
      pricesResult = null;
    } else if (key !== pricesFetchKey) {
      pricesFetchKey = key;
      pricesFetchGen += 1;
      const gen = pricesFetchGen;
      pricesResult = null;
      getWalletUsdSpotPrices(chainId).then((r) => {
        if (gen !== pricesFetchGen) return;
        pricesResult = r;
      });
    }
  }

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

  $: if (mode !== 'send') {
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

  $: selectedBalanceRow =
    mode === 'send' ? findBalanceForAsset(sendBalanceSummary, chainId, assetCode) : null;

  /** Compare human amount to `balance_raw` (integer string) using asset decimals. */
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
  /** Request mode: brief resolve of signer address before optimistic post. */
  let requestPosting = false;
  let sendError: { message: string; txHash?: string; code?: string } | null = null;

  $: insufficientFunds =
    mode === 'send' &&
    amountValid &&
    selectedOpt != null &&
    selectedBalanceRow != null &&
    amountExceedsBalance(amountStr.trim(), selectedBalanceRow.balanceRaw, selectedOpt.decimals);

  $: canConfirm =
    amountValid &&
    !sending &&
    !requestPosting &&
    selectedOpt != null &&
    (mode === 'request' || !insufficientFunds);
  $: explorerLinkForError =
    sendError?.txHash != null && sendError.txHash.length > 0
      ? getExplorerTxUrl(chainId, sendError.txHash)
      : null;
  $: explorerLinkLabel = explorerTxLinkLabel(chainId);

  async function copyErrorTxHash() {
    const h = sendError?.txHash;
    if (!h) return;
    const ok = await copyTextToClipboard(h);
    showToast(ok ? tFn('wallet.txHashCopied') : tFn('wallet.couldNotCopyHash'));
  }

  /** Receipt timeout: tx was already broadcast; another Confirm would risk a duplicate send. */
  $: canRetryAfterError =
    sendError != null &&
    !sending &&
    !requestPosting &&
    (mode === 'request' || sendError.code !== 'RECEIPT_TIMEOUT');

  async function retryFailedSend() {
    if (!sendError || sending || !canRetryAfterError) return;
    sendError = null;
    await handleConfirm();
  }

  $: approxUsd =
    pricesResult?.ok === true && amountValid
      ? amountToApproxUsd(amountStr, assetCode, pricesResult.prices)
      : null;

  $: usdLine =
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
              : tFn('wallet.enterAmountForUsd');

  function onAmountInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    amountStr = normalizeLeadingDotDecimalInput(el.value);
  }

  async function handleConfirm() {
    if (!amountValid || sending || !selectedOpt) return;
    if (mode === 'send' && insufficientFunds) return;
    const amountHuman = normalizeLeadingDotDecimalInput(amountStr.trim());
    const erc20Transfer =
      selectedOpt.kind === 'erc20' && selectedOpt.address
        ? { address: selectedOpt.address as string, decimals: selectedOpt.decimals }
        : undefined;
    if (mode === 'request') {
      const postDm = postDmPlaintext;
      if (!postDm) {
        showToast(tFn('wallet.paymentRequestDesktopOnly'));
        return;
      }
      sendError = null;
      requestPosting = true;
      try {
        const fromEvm = await getActiveEvmSignerAddress();
        if (!fromEvm) {
          const msg = tFn('wallet.noActiveEvmAccount');
          sendError = { message: msg };
          showToast(msg);
          return;
        }
        const content = formatWalletTxRequest({
          request_id: crypto.randomUUID(),
          network: chainId,
          asset: assetCode,
          amount: amountHuman,
          created_at_ms: Date.now(),
          from_evm_address: fromEvm,
        });
        const ok = await postDm(content);
        if (ok) {
          onClose();
        } else {
          const msg = tFn('wallet.couldNotDeliverRequest');
          sendError = { message: msg };
          showToast(msg);
        }
      } catch {
        const msg = tFn('wallet.couldNotSendPaymentRequest');
        sendError = { message: msg };
        showToast(msg);
      } finally {
        requestPosting = false;
      }
      return;
    }
    if (!requireBackupVerified()) return;
    sendError = null;
    sending = true;
    try {
      const out = await walletBuildAndSendTransaction(
        npub,
        chainId,
        assetCode,
        amountHuman,
        erc20Transfer,
        null,
        false,
      );
      if (out.ok) {
        toastWalletBroadcastSubmitted(out.result);
        onClose();
        const me = get(currentUser)?.npub;
        const sendPlain = postDmPlaintext;
        if (me && sendPlain) {
          void finalizeWalletDmTransferAfterBroadcast({
            peerNpub: npub,
            network: chainId,
            asset: assetCode,
            amount: amountHuman,
            txHash: out.result.txHash,
            fromNpub: me,
            requestId: linkedRequestId !== '' ? linkedRequestId : undefined,
            sendDm: sendPlain,
            onBalanceRefresh,
          });
        }
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
</script>

<Modal
  {titleId}
  descriptionId={descId}
  {onClose}
  dismissible={mode === 'request' ? !requestPosting : !sending}
>
  <h2 id={titleId}>{mode === 'send' ? $t('wallet.sendTitle') : $t('wallet.requestPaymentTitle')}</h2>
  <p id={descId} class="wallet-stub-desc">
    {mode === 'send'
      ? $t('wallet.sendStubDesc', { values: { peerName: peerDisplayName } })
      : $t('wallet.requestStubDesc', { values: { peerName: peerDisplayName } })}
    <span class="wallet-stub-npub-ref">{truncateNpub(npub)}</span>
  </p>

  <div class="wallet-stub-fields">
    <label class="wallet-stub-label">
      <span class="wallet-stub-label-text">{$t('wallet.networkLabel')}</span>
      <select
        class="wallet-stub-select"
        bind:value={chainId}
        aria-label={$t('wallet.networkLabel')}
        disabled={sending || requestPosting}
      >
        {#each WALLET_ASSETS_CHAIN_IDS as cid (cid)}
          <option value={cid as SupportedChainId}>{getWalletNetworkDisplayName(cid as SupportedChainId)}</option>
        {/each}
      </select>
    </label>

    <label class="wallet-stub-label">
      <span class="wallet-stub-label-text">{$t('wallet.assetLabel')}</span>
      <select class="wallet-stub-select" bind:value={assetCode} aria-label={$t('wallet.assetLabel')} disabled={sending || requestPosting}>
        {#each assetOptions as o (o.code)}
          <option value={o.code}>{o.code}</option>
        {/each}
      </select>
    </label>

    <label class="wallet-stub-label">
      <span class="wallet-stub-label-text">{$t('wallet.amountLabel')}</span>
      <input
        class="wallet-stub-input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        placeholder={$t('wallet.amountPlaceholder')}
        value={amountStr}
        oninput={onAmountInput}
        disabled={sending || requestPosting}
        aria-invalid={amountStr.trim() !== '' && (!amountValid || insufficientFunds)}
        aria-label={$t('wallet.amountLabel')}
      />
    </label>

    {#if mode === 'send' && sendBalanceLoading}
      <p class="wallet-stub-balance-loading" role="status">{$t('wallet.loadingBalance')}</p>
    {/if}
    {#if mode === 'send' && insufficientFunds && selectedBalanceRow}
      <p class="wallet-stub-insufficient" role="alert">
        {$t('wallet.insufficientFunds', { values: { assetCode, balanceDecimal: selectedBalanceRow.balanceDecimal } })}
      </p>
    {:else if mode === 'send' && sendBalanceError && !sendBalanceLoading}
      <p class="wallet-stub-balance-warn" role="status">
        {$t('wallet.couldNotLoadBalanceStillTry', { values: { error: sendBalanceError } })}
      </p>
    {/if}

    <p class="wallet-stub-usd" role="status">{usdLine}</p>

    {#if sendError}
      <div class="wallet-stub-error" role="alert">
        <p class="wallet-stub-error-msg">{sendError.message}</p>
        {#if sendError.txHash}
          <div class="wallet-stub-tx-hash-row">
            <code class="wallet-stub-tx-hash-code" title={sendError.txHash}>{sendError.txHash}</code>
            <button
              type="button"
              class="wallet-stub-copy-hash"
              aria-label={$t('wallet.copyFullTransactionHash')}
              onclick={copyErrorTxHash}
            >
              {$t('wallet.copyHash')}
            </button>
          </div>
        {/if}
        {#if explorerLinkForError}
          <a
            class="wallet-stub-error-link"
            href={explorerLinkForError}
            target="_blank"
            rel="external noopener noreferrer"
            title={explorerLinkForError}
          >
            {explorerLinkLabel}
          </a>
        {/if}
        {#if sendError?.code === 'RECEIPT_TIMEOUT'}
          <p class="wallet-stub-error-retry-hint" role="note">
            {$t('wallet.retryHint')}
          </p>
        {:else if canRetryAfterError}
          <button type="button" class="wallet-stub-retry" onclick={retryFailedSend}>
            {$t('wallet.tryAgain')}
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="wallet-stub-actions">
    <button
      type="button"
      class="wallet-stub-btn wallet-stub-btn-secondary"
      disabled={mode === 'send' ? sending : requestPosting}
      onclick={onClose}>{$t('wallet.cancel')}</button>
    <button type="button" class="wallet-stub-btn wallet-stub-btn-primary" disabled={!canConfirm} onclick={handleConfirm}>
      {requestPosting
        ? $t('wallet.sending')
        : sending
          ? $t('wallet.submitting')
          : $t('wallet.confirm')}
    </button>
  </div>
</Modal>

<style>
  .wallet-stub-desc {
    margin: 0 0 20px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .wallet-stub-npub-ref {
    display: block;
    margin-top: 8px;
    font-size: 0.75rem;
    font-family: ui-monospace, monospace;
    color: var(--text-muted);
    word-break: break-all;
  }

  .wallet-stub-fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 24px;
  }

  .wallet-stub-label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
  }

  .wallet-stub-label-text {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .wallet-stub-select,
  .wallet-stub-input {
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

  .wallet-stub-input:focus,
  .wallet-stub-select:focus {
    outline: 2px solid var(--brand);
    outline-offset: 1px;
  }

  .wallet-stub-balance-loading,
  .wallet-stub-balance-warn {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-muted);
  }

  .wallet-stub-insufficient {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-primary);
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: rgba(220, 53, 69, 0.08);
  }

  .wallet-stub-usd {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
    line-height: 1.4;
    min-height: 1.2em;
  }

  .wallet-stub-error {
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: rgba(220, 53, 69, 0.08);
  }

  .wallet-stub-error-msg {
    margin: 0 0 8px;
    font-size: 0.875rem;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .wallet-stub-error-msg:last-child {
    margin-bottom: 0;
  }

  .wallet-stub-error-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-top: 12px;
    padding: 8px 14px;
    font-size: 0.8125rem;
    font-weight: 600;
    font-family: inherit;
    color: var(--on-brand);
    background: var(--brand);
    border: none;
    border-radius: 8px;
    text-decoration: none;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  .wallet-stub-error-link:hover {
    background: var(--brand-hover);
    filter: brightness(1.02);
  }

  .wallet-stub-error-link:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .wallet-stub-error-retry-hint {
    margin: 12px 0 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .wallet-stub-retry {
    margin-top: 12px;
    padding: 8px 14px;
    font-size: 0.875rem;
    font-weight: 600;
    font-family: inherit;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    cursor: pointer;
  }

  .wallet-stub-retry:hover {
    background: var(--bg-hover);
    border-color: var(--border);
  }

  .wallet-stub-retry:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 2px;
  }

  .wallet-stub-tx-hash-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 10px;
    margin-top: 4px;
  }

  .wallet-stub-tx-hash-code {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 6px 8px;
    font-size: 0.75rem;
    font-family: ui-monospace, monospace;
    color: var(--text-secondary);
    word-break: break-all;
    background: var(--bg-elevated);
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
  }

  .wallet-stub-copy-hash {
    flex-shrink: 0;
    padding: 6px 12px;
    font-size: 0.75rem;
    font-weight: 500;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
  }

  .wallet-stub-copy-hash:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .wallet-stub-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: flex-end;
  }

  .wallet-stub-btn {
    padding: 10px 18px;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    font-family: inherit;
  }

  .wallet-stub-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .wallet-stub-btn-secondary {
    background: var(--border);
    color: var(--text-primary);
  }

  .wallet-stub-btn-primary {
    background: var(--brand);
    color: var(--on-brand);
  }
</style>
