<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
  import SquadSponsorWithdrawModal from './SquadSponsorWithdrawModal.svelte';
  import SquadSponsoredFeeUsagePanel from './SquadSponsoredFeeUsagePanel.svelte';
  import type { SquadInfraDto } from '../../../lib/governance/api';
  import {
    SPONSOR_LOW_BALANCE_WEI,
    depositSquadSponsor,
    getSquadSponsorSummary,
    type SquadSponsorDeploySignerWallet,
    type SquadSponsorSummaryDto,
  } from '../../../lib/governance/api';
  import {
    SPONSOR_SUMMARY_TTL_MS,
    fetchSponsorSummaryCached,
    getCachedSponsorSummary,
    isSponsorSummaryCacheStale,
    sponsorSummaryCacheKey,
  } from '../../../lib/governance/squad-sponsor-summary-cache';
  import { explorerAddressUrl, parseSupportedChainId } from '../../../lib/wallet/chains';
  import { openExternalUrl } from '../../../lib/utils/open-external';
  import { friendlyMessage, getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { getActiveSquadEvmSignerAddress } from '../../../lib/wallet/evm-accounts';
  import {
    amountExceedsBalance,
    canonicalAddress,
    emptyBalance,
    fetchEvmBalance,
    reconcileSignerWallet,
    shortAddress,
    type SignerBalance,
  } from '../../../lib/wallet/signer-balance';
  import { resolveSquadRosterEvmAddress } from '../../../lib/squad/squad-roster-binding';
  import { parseWalletOpError } from '../../../lib/wallet/backend-wallet';
  import { formatEther, parseEther } from 'viem';
  import { showToast } from '../../../stores/toast';
  import { requireBackupVerified } from '../../../stores/backup-verification';
  import { get } from 'svelte/store';
  import { t } from 'svelte-i18n';

  interface Props {
    parentId: string;
    sponsorRow?: SquadInfraDto | null;
    onOpenDeploy?: () => void;
  }

  let { parentId, sponsorRow = null, onOpenDeploy = undefined }: Props = $props();

  const tFn = get(t);

  let summary = $state<SquadSponsorSummaryDto | null>(null);
  let loading = $state(false);
  let loadError = $state('');
  let depositEth = $state('0.01');
  let depositing = $state(false);
  let depositError = $state('');
  let showDepositForm = $state(false);
  let showWithdrawModal = $state(false);
  let periodicRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let hydratedSponsorKey = $state('');
  let signerWallet = $state<SquadSponsorDeploySignerWallet>('default');
  let addressesLoading = $state(false);
  let refreshSeq = 0;
  let defaultSignerAddress = $state<string | null>(null);
  let squadSignerAddress = $state<string | null>(null);

  let defaultBalance = $state<SignerBalance>(emptyBalance());
  let squadBalance = $state<SignerBalance>(emptyBalance());
  let feeUsageRefreshToken = $state(0);

  const network = $derived(parseSupportedChainId(sponsorRow?.chain));
  const poolBalanceWei = $derived(summary ? BigInt(summary.poolBalanceWei) : null);
  const lowBalance = $derived(poolBalanceWei != null && poolBalanceWei < SPONSOR_LOW_BALANCE_WEI);
  const explorerUrl = $derived(
    summary?.sponsorAddress &&
      explorerAddressUrl(parseSupportedChainId(summary.chain), summary.sponsorAddress),
  );
  const sponsorKey = $derived(sponsorRow?.id ?? '');

  function currentCacheKey(): string | null {
    if (!parentId?.trim() || !sponsorRow) return null;
    return sponsorSummaryCacheKey(parentId.trim(), sponsorRow.canonicalRef, network);
  }

  async function refreshSummary(force = false) {
    const key = currentCacheKey();
    if (!key) {
      summary = null;
      return;
    }

    if (!force) {
      const cached = getCachedSponsorSummary(key);
      if (cached) {
        summary = cached;
        return;
      }
    }

    loading = true;
    loadError = '';
    try {
      summary = await fetchSponsorSummaryCached(
        key,
        () =>
          getSquadSponsorSummary({
            network,
            parentId: parentId.trim(),
            sponsorAddress: sponsorRow!.canonicalRef,
          }),
        { force }
      );
    } catch (e) {
      loadError = getInvokeErrorMessage(e, tFn('governance.error.couldNotLoadSponsorBalance'));
      if (force) summary = null;
    } finally {
      loading = false;
      if (force) feeUsageRefreshToken += 1;
    }
  }

  function hydrateFromSessionCache() {
    const key = currentCacheKey();
    if (!key) {
      summary = null;
      return;
    }
    const cached = getCachedSponsorSummary(key);
    if (cached) {
      summary = cached;
      return;
    }
    void refreshSummary(false);
  }

  $effect(() => {
    if (sponsorKey && parentId?.trim()) {
      const nextKey = `${parentId}:${sponsorKey}:${network}`;
      if (nextKey !== hydratedSponsorKey) {
        hydratedSponsorKey = nextKey;
        hydrateFromSessionCache();
      }
    }
  });

  onMount(() => {
    periodicRefreshTimer = setInterval(() => {
      const key = currentCacheKey();
      if (!key || !sponsorRow) return;
      if (isSponsorSummaryCacheStale(key)) {
        void refreshSummary(false);
      }
    }, SPONSOR_SUMMARY_TTL_MS);
  });

  onDestroy(() => {
    if (periodicRefreshTimer) clearInterval(periodicRefreshTimer);
  });

  async function refreshSignerBalances() {
    if (!parentId?.trim() || !sponsorRow) return;
    const seq = ++refreshSeq;
    addressesLoading = true;
    try {
      const [defaultAddr, squadAddr] = await Promise.all([
        getActiveSquadEvmSignerAddress(),
        resolveSquadRosterEvmAddress(parentId.trim()),
      ]);
      if (seq !== refreshSeq) return;
      defaultSignerAddress = defaultAddr?.trim() || null;
      squadSignerAddress = squadAddr?.trim() || null;
      signerWallet = reconcileSignerWallet(signerWallet, defaultSignerAddress, squadSignerAddress);
    } finally {
      if (seq === refreshSeq) addressesLoading = false;
    }
    if (seq !== refreshSeq) return;
    const [defaultBal, squadBal] = await Promise.all([
      fetchEvmBalance(network, defaultSignerAddress),
      fetchEvmBalance(network, squadSignerAddress),
    ]);
    if (seq !== refreshSeq) return;
    defaultBalance = defaultBal;
    squadBalance = squadBal;
  }

  const defaultCanonical = $derived(canonicalAddress(defaultSignerAddress));
  const squadCanonical = $derived(canonicalAddress(squadSignerAddress));
  const signersAreSame = $derived(
    defaultCanonical != null && squadCanonical != null && defaultCanonical === squadCanonical,
  );

  const selectedAddress = $derived(
    signersAreSame
      ? squadCanonical
      : signerWallet === 'default'
        ? defaultSignerAddress
        : squadSignerAddress,
  );
  const selectedBalance = $derived(
    signersAreSame
      ? squadBalance
      : signerWallet === 'default'
        ? defaultBalance
        : squadBalance,
  );
  const selectedSymbol = $derived(selectedBalance.symbol || 'ETH');

  const signerUnavailable = $derived(
    signersAreSame
      ? !squadCanonical
      : signerWallet === 'default'
        ? !defaultCanonical
        : !squadCanonical,
  );

  const depositTrimmed = $derived(depositEth.trim());
  const depositWeiPreview = $derived.by(() => {
    try {
      const wei = parseEther(depositTrimmed.replace(/,/g, ''));
      return wei > 0n ? wei : null;
    } catch {
      return null;
    }
  });

  const depositExceedsBalance = $derived(
    depositWeiPreview != null &&
      selectedAddress != null &&
      !addressesLoading &&
      !selectedBalance.loading &&
      !selectedBalance.error &&
      amountExceedsBalance(depositTrimmed, selectedBalance.balanceRaw),
  );

  const canConfirmDeposit = $derived(
    !depositing &&
      !addressesLoading &&
      !signerUnavailable &&
      depositWeiPreview != null &&
      !depositExceedsBalance &&
      !selectedBalance.loading,
  );

  async function openDepositForm() {
    showDepositForm = true;
    depositError = '';
    await refreshSignerBalances();
  }

  async function submitDeposit() {
    if (!requireBackupVerified()) return;
    depositError = '';
    if (!parentId?.trim() || !sponsorRow) return;
    let amountWei: string;
    try {
      amountWei = parseEther(depositEth.trim()).toString();
      if (BigInt(amountWei) <= 0n) {
        depositError = tFn('governance.error.amountMustBeGreater');
        return;
      }
    } catch {
      depositError = tFn('governance.error.validEthAmount');
      return;
    }
    if (signerUnavailable) {
      depositError =
        signerWallet === 'default'
          ? tFn('governance.error.defaultSignerNotSet')
          : tFn('governance.error.noSquadAssignedSigner');
      return;
    }
    if (depositExceedsBalance) {
      depositError = tFn('governance.error.depositExceedsBalance', {
        values: {
          symbol: selectedSymbol,
          balance: selectedBalance.balanceDecimal,
          network,
        },
      });
      return;
    }
    const payFrom: SquadSponsorDeploySignerWallet = signersAreSame ? 'squad' : signerWallet;
    depositing = true;
    try {
      await depositSquadSponsor({
        network,
        parentId: parentId.trim(),
        amountWei,
        sponsorAddress: sponsorRow.canonicalRef,
        signerWallet: payFrom,
      });
      showToast(tFn('governance.toast.sponsorDepositConfirmed'));
      showDepositForm = false;
      await refreshSummary(true);
    } catch (e) {
      let raw = getInvokeErrorMessage(e, tFn('governance.error.depositFailed'));
      const parsed = parseWalletOpError(raw);
      if (parsed?.message) raw = parsed.message;
      if (/insufficient funds/i.test(raw)) {
        depositError = tFn('governance.error.insufficientFundsForDeposit', {
          values: {
            symbol: selectedSymbol,
            address: shortAddress(selectedAddress),
            network,
          },
        });
      } else {
        depositError = raw;
      }
    } finally {
      depositing = false;
    }
  }
</script>

<section class="dashboard-section sponsor-treasury-section" aria-labelledby="sponsor-heading">
  <div class="treasury-section-head">
    <h3 id="sponsor-heading" class="section-heading">{$t('governance.title.squadSponsor')}</h3>
    {#if sponsorRow}
      <RefreshIconButton
        className="sponsor-refresh-btn"
        disabled={loading}
        spinning={loading}
        ariaLabel={loading ? $t('governance.aria.refreshingSponsorBalance') : $t('governance.aria.refreshSponsorBalance')}
        onclick={() => refreshSummary(true)}
      />
    {:else if onOpenDeploy}
      <button type="button" class="btn-primary sponsor-deploy-btn" onclick={onOpenDeploy}>{tFn('governance.action.deploySponsor')}</button>
    {/if}
  </div>

  {#if !sponsorRow}
    <p class="sponsor-empty-lead">{$t('governance.empty.noSponsorDeployed')}</p>
  {:else if loading && !summary}
    <p class="muted">{$t('governance.status.loadingSponsorBalance')}</p>
  {:else if loadError}
    <p class="sponsor-error" role="alert">{$t(friendlyMessage(loadError, 'generic'))}</p>
    <button type="button" class="btn-secondary" onclick={() => refreshSummary(true)}>{tFn('governance.action.retry')}</button>
  {:else if summary}
    <p class="sponsor-lead muted">{$t('governance.info.sponsorLead', { values: { chain: summary.chain } })}</p>
    <dl class="sponsor-dl">
      <dt>{$t('governance.info.sponsorPoolBalance')}</dt>
      <dd>
        <strong>{$t('governance.treasury.balanceEth', { values: { balance: formatEther(BigInt(summary.poolBalanceWei)) } })}</strong>
        {#if lowBalance}
          <span class="sponsor-low-badge" role="status">{$t('governance.info.sponsorLowBalance')}</span>
        {/if}
      </dd>
      <dt>{$t('governance.info.sponsorClone')}</dt>
      <dd>
        <code class="sponsor-mono">{summary.sponsorAddress}</code>
        {#if explorerUrl}
          <button type="button" class="btn-link sponsor-explorer-link" onclick={() => openExternalUrl(explorerUrl)}>
            {tFn('governance.action.viewOnExplorer')}
          </button>
        {/if}
      </dd>
    </dl>

    {#if showDepositForm}
      <div class="sponsor-deposit-form">
        {#if signersAreSame}
          <div class="signer-single" aria-live="polite">
            <span class="sponsor-deposit-label">{$t('governance.info.payDepositFrom')}</span>
            <p class="signer-single-addr">
              <code>{shortAddress(squadCanonical)}</code>
              <span class="muted note">{$t('governance.info.squadSigner')}</span>
            </p>
            <p class="signer-balance muted">
              {#if addressesLoading || squadBalance.loading}
                {tFn('governance.info.balanceLoading')}
              {:else if squadBalance.error}
                {tFn('governance.info.balanceUnavailable')}
              {:else}
                {tFn('governance.info.balance')} {squadBalance.balanceDecimal} {squadBalance.symbol}
              {/if}
            </p>
          </div>
        {:else}
          <fieldset class="signer-fieldset" disabled={addressesLoading}>
            <legend class="sponsor-deposit-label">{$t('governance.info.payDepositFrom')}</legend>
            <div class="signer-options">
              <label class="signer-option" class:selected={signerWallet === 'default'}>
                <input
                  type="radio"
                  name="sponsor-deposit-signer"
                  value="default"
                  bind:group={signerWallet}
                  disabled={!defaultSignerAddress}
                />
                <span class="signer-option-body">
                  <span class="signer-option-title">{$t('governance.info.defaultSigner')}</span>
                  <span class="signer-option-sub">{$t('governance.info.sameAsDmWallet')}</span>
                  <code class="signer-addr">{shortAddress(defaultSignerAddress)}</code>
                  <span class="signer-balance">
                    {#if addressesLoading || defaultBalance.loading}
                      {tFn('governance.info.balanceLoading')}
                    {:else if defaultBalance.error}
                      {tFn('governance.info.balanceUnavailable')}
                    {:else if defaultSignerAddress}
                      {tFn('governance.info.balance')} {defaultBalance.balanceDecimal} {defaultBalance.symbol}
                    {:else}
                      {tFn('governance.info.notConfigured')}
                    {/if}
                  </span>
                </span>
              </label>

              <label class="signer-option" class:selected={signerWallet === 'squad'}>
                <input
                  type="radio"
                  name="sponsor-deposit-signer"
                  value="squad"
                  bind:group={signerWallet}
                  disabled={!squadSignerAddress}
                />
                <span class="signer-option-body">
                  <span class="signer-option-title">{$t('governance.info.squadAssignedSigner')}</span>
                  <span class="signer-option-sub">{$t('governance.info.boundToRoster')}</span>
                  <code class="signer-addr">{shortAddress(squadSignerAddress)}</code>
                  <span class="signer-balance">
                    {#if addressesLoading || squadBalance.loading}
                      {tFn('governance.info.balanceLoading')}
                    {:else if squadBalance.error}
                      {tFn('governance.info.balanceUnavailable')}
                    {:else if squadSignerAddress}
                      {tFn('governance.info.balance')} {squadBalance.balanceDecimal} {squadBalance.symbol}
                    {:else}
                      {tFn('governance.info.notAssigned')}
                    {/if}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        {/if}

        <label class="sponsor-deposit-label" for="sponsor-deposit-eth">{$t('governance.field.depositAmount')}</label>
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
        {:else if depositExceedsBalance}
          <p class="input-error" role="alert">
            {$t('governance.info.depositBelowMax', { values: { balance: selectedBalance.balanceDecimal, symbol: selectedSymbol, network } })}
          </p>
        {/if}
        <div class="sponsor-deposit-actions">
          <button type="button" class="btn-secondary" onclick={() => (showDepositForm = false)} disabled={depositing}>
            {tFn('governance.action.cancel')}
          </button>
          <button type="button" class="btn-primary" onclick={submitDeposit} disabled={!canConfirmDeposit}>
            {depositing ? tFn('governance.info.sending') : tFn('governance.action.confirmDeposit')}
          </button>
        </div>
      </div>
    {:else}
      <div class="sponsor-pool-actions">
        <button type="button" class="btn-primary sponsor-deposit-btn" onclick={openDepositForm}>
          {tFn('governance.action.deposit')}
        </button>
        <button
          type="button"
          class="btn-secondary sponsor-withdraw-btn"
          onclick={() => {
            if (!requireBackupVerified()) return;
            showWithdrawModal = true;
          }}
        >
          {tFn('governance.action.withdraw')}
        </button>
      </div>
    {/if}
  {/if}

  {#if sponsorRow}
    <SquadSponsoredFeeUsagePanel
      parentId={parentId}
      chain={sponsorRow.chain || summary?.chain || network}
      refreshToken={feeUsageRefreshToken}
    />
  {/if}
</section>

<SquadSponsorWithdrawModal
  open={showWithdrawModal}
  network={network}
  parentId={parentId}
  sponsorAddress={sponsorRow?.canonicalRef ?? summary?.sponsorAddress ?? ''}
  onClose={() => (showWithdrawModal = false)}
  onSubmitted={() => {
    void refreshSummary(true);
  }}
/>

<style>
  .dashboard-section {
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 16px;
  }

  .sponsor-treasury-section {
    margin-bottom: 16px;
  }

  .section-heading {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0;
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

  .sponsor-deploy-btn,
  :global(.sponsor-refresh-btn) {
    flex-shrink: 0;
  }

  .btn-primary,
  .btn-secondary {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 0.875rem;
    cursor: pointer;
    font-family: inherit;
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

  .btn-secondary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .sponsor-empty-lead {
    margin: 0;
    max-width: 52ch;
    color: var(--text-muted);
    font-size: 0.875rem;
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

  .muted {
    color: var(--text-muted);
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

  .sponsor-explorer-link {
    display: inline-block;
    margin-left: 8px;
    padding: 0;
    font-size: inherit;
  }

  .sponsor-deposit-form {
    margin-top: 8px;
    max-width: 420px;
  }

  .signer-fieldset {
    margin: 0 0 14px;
    padding: 0;
    border: none;
    min-width: 0;
  }

  .signer-single {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }

  .signer-single-addr {
    margin: 4px 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    font-size: 0.9375rem;
  }

  .note {
    font-size: 0.8125rem;
  }

  .signer-options {
    display: grid;
    gap: 8px;
  }

  .signer-option {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    cursor: pointer;
  }

  .signer-option.selected {
    border-color: var(--brand, #6ea8fe);
    background: color-mix(in srgb, var(--brand, #6ea8fe) 8%, var(--bg-panel));
  }

  .signer-option:has(input:disabled) {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .signer-option input {
    margin-top: 3px;
    flex-shrink: 0;
  }

  .signer-option-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .signer-option-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .signer-option-sub {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .signer-addr {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .signer-balance {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-top: 2px;
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

  .sponsor-pool-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }

  .sponsor-deposit-btn,
  .sponsor-withdraw-btn {
    margin-top: 0;
  }

  .input-error {
    color: var(--danger, #e53e3e);
    font-size: 0.8125rem;
    margin: 0 0 8px;
  }
</style>
