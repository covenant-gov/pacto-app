<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import RefreshIconButton from '../../ui/RefreshIconButton.svelte';
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
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { getEvmNativeBalance } from '../../../lib/wallet/backend-wallet';
  import { getActiveSquadEvmSignerAddress } from '../../../lib/wallet/evm-accounts';
  import { resolveSquadRosterEvmAddress } from '../../../lib/squad/squad-roster-binding';
  import { parseWalletOpError } from '../../../lib/wallet/backend-wallet';
  import { formatEther, getAddress, isAddress, parseEther } from 'viem';
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
  let periodicRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let hydratedSponsorKey = '';
  let signerWallet: SquadSponsorDeploySignerWallet = 'default';
  let addressesLoading = false;
  let refreshSeq = 0;
  let defaultSignerAddress: string | null = null;
  let squadSignerAddress: string | null = null;

  type SignerBalance = {
    balanceRaw: string;
    balanceDecimal: string;
    symbol: string;
    loading: boolean;
    error: string;
  };

  let defaultBalance: SignerBalance = emptyBalance();
  let squadBalance: SignerBalance = emptyBalance();

  function emptyBalance(): SignerBalance {
    return { balanceRaw: '0', balanceDecimal: '0', symbol: 'ETH', loading: false, error: '' };
  }

  function canonicalAddress(addr: string | null): string | null {
    if (!addr?.trim() || !isAddress(addr.trim() as `0x${string}`)) return null;
    try {
      return getAddress(addr.trim() as `0x${string}`);
    } catch {
      return null;
    }
  }

  function amountExceedsBalance(amountTrimmed: string, balanceRaw: string): boolean {
    try {
      if (!/^\d+$/.test(balanceRaw.trim())) return false;
      const amt = parseEther(amountTrimmed.replace(/,/g, ''));
      return amt >= BigInt(balanceRaw.trim());
    } catch {
      return false;
    }
  }

  $: network = parseSupportedChainId(sponsorRow?.chain);
  $: poolBalanceWei = summary ? BigInt(summary.poolBalanceWei) : null;
  $: lowBalance =
    poolBalanceWei != null && poolBalanceWei < SPONSOR_LOW_BALANCE_WEI;
  $: explorerUrl =
    summary?.sponsorAddress &&
    explorerAddressUrl(parseSupportedChainId(summary.chain), summary.sponsorAddress);
  $: sponsorKey = sponsorRow?.id ?? '';

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
      loadError = getInvokeErrorMessage(e, 'Could not load sponsor balance.');
      if (force) summary = null;
    } finally {
      loading = false;
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

  $: if (sponsorKey && parentId?.trim()) {
    const nextKey = `${parentId}:${sponsorKey}:${network}`;
    if (nextKey !== hydratedSponsorKey) {
      hydratedSponsorKey = nextKey;
      hydrateFromSessionCache();
    }
  }

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

  function shortAddress(addr: string | null): string {
    if (!addr) return 'Not set';
    const t = addr.trim();
    if (t.length < 18) return t;
    return `${t.slice(0, 10)}…${t.slice(-8)}`;
  }

  async function fetchBalance(address: string | null): Promise<SignerBalance> {
    if (!address || !sponsorRow) return emptyBalance();
    const result = await getEvmNativeBalance(network, address);
    if (result.ok) {
      return {
        balanceRaw: result.balance.balanceRaw,
        balanceDecimal: result.balance.balanceDecimal,
        symbol: result.balance.symbol,
        loading: false,
        error: '',
      };
    }
    return { ...emptyBalance(), loading: false, error: result.message };
  }

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
      const defaultCanon = canonicalAddress(defaultSignerAddress);
      const squadCanon = canonicalAddress(squadSignerAddress);
      if (defaultCanon && squadCanon && defaultCanon === squadCanon) {
        signerWallet = 'squad';
      } else if (signerWallet === 'default' && !defaultSignerAddress && squadSignerAddress) {
        signerWallet = 'squad';
      } else if (signerWallet === 'squad' && !squadSignerAddress && defaultSignerAddress) {
        signerWallet = 'default';
      }
    } finally {
      if (seq === refreshSeq) addressesLoading = false;
    }
    if (seq !== refreshSeq) return;
    const [defaultBal, squadBal] = await Promise.all([
      fetchBalance(defaultSignerAddress),
      fetchBalance(squadSignerAddress),
    ]);
    if (seq !== refreshSeq) return;
    defaultBalance = defaultBal;
    squadBalance = squadBal;
  }

  $: defaultCanonical = canonicalAddress(defaultSignerAddress);
  $: squadCanonical = canonicalAddress(squadSignerAddress);
  $: signersAreSame =
    defaultCanonical != null && squadCanonical != null && defaultCanonical === squadCanonical;

  $: selectedAddress = signersAreSame
    ? squadCanonical
    : signerWallet === 'default'
      ? defaultSignerAddress
      : squadSignerAddress;
  $: selectedBalance = signersAreSame
    ? squadBalance
    : signerWallet === 'default'
      ? defaultBalance
      : squadBalance;
  $: selectedSymbol = selectedBalance.symbol || 'ETH';

  $: signerUnavailable = signersAreSame
    ? !squadCanonical
    : signerWallet === 'default'
      ? !defaultCanonical
      : !squadCanonical;

  $: depositTrimmed = depositEth.trim();
  $: depositWeiPreview = (() => {
    try {
      const wei = parseEther(depositTrimmed.replace(/,/g, ''));
      return wei > 0n ? wei : null;
    } catch {
      return null;
    }
  })();

  $: depositExceedsBalance =
    depositWeiPreview != null &&
    selectedAddress != null &&
    !addressesLoading &&
    !selectedBalance.loading &&
    !selectedBalance.error &&
    amountExceedsBalance(depositTrimmed, selectedBalance.balanceRaw);

  $: canConfirmDeposit =
    !depositing &&
    !addressesLoading &&
    !signerUnavailable &&
    depositWeiPreview != null &&
    !depositExceedsBalance &&
    !selectedBalance.loading;

  async function openDepositForm() {
    showDepositForm = true;
    depositError = '';
    await refreshSignerBalances();
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
    if (signerUnavailable) {
      depositError =
        signerWallet === 'default'
          ? 'Set a default signer under Settings → Default wallet config.'
          : 'No squad-assigned signer for this squad. Bind one from Settings or Inbox.';
      return;
    }
    if (depositExceedsBalance) {
      depositError = `Deposit plus gas needs less than your ${selectedSymbol} balance (${selectedBalance.balanceDecimal}). Fund the selected wallet on ${network}.`;
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
      showToast('Sponsor pool deposit confirmed.');
      showDepositForm = false;
      await refreshSummary(true);
    } catch (e) {
      let raw = getInvokeErrorMessage(e, 'Deposit failed.');
      const parsed = parseWalletOpError(raw);
      if (parsed?.message) raw = parsed.message;
      if (/insufficient funds/i.test(raw)) {
        depositError = `Selected wallet has insufficient ${selectedSymbol} for this deposit and gas. Fund ${shortAddress(selectedAddress)} on ${network}.`;
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
    <h3 id="sponsor-heading" class="section-heading">Squad sponsor</h3>
    {#if sponsorRow}
      <RefreshIconButton
        className="sponsor-refresh-btn"
        disabled={loading}
        spinning={loading}
        ariaLabel={loading ? 'Refreshing sponsor balance' : 'Refresh sponsor balance'}
        on:click={() => refreshSummary(true)}
      />
    {:else if onOpenDeploy}
      <button type="button" class="btn-primary sponsor-deploy-btn" on:click={onOpenDeploy}>Deploy Sponsor</button>
    {/if}
  </div>

  {#if !sponsorRow}
    <p class="sponsor-empty-lead">No squad sponsor deployed yet. Gas sponsorship requires a sponsor clone first.</p>
  {:else if loading && !summary}
    <p class="muted">Loading sponsor balance…</p>
  {:else if loadError}
    <p class="sponsor-error" role="alert">{loadError}</p>
    <button type="button" class="btn-secondary" on:click={() => refreshSummary(true)}>Retry</button>
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
        {#if signersAreSame}
          <div class="signer-single" aria-live="polite">
            <span class="sponsor-deposit-label">Pay deposit from</span>
            <p class="signer-single-addr">
              <code>{shortAddress(squadCanonical)}</code>
              <span class="muted note">Squad signer</span>
            </p>
            <p class="signer-balance muted">
              {#if addressesLoading || squadBalance.loading}
                Balance: …
              {:else if squadBalance.error}
                Balance unavailable
              {:else}
                Balance: {squadBalance.balanceDecimal} {squadBalance.symbol}
              {/if}
            </p>
          </div>
        {:else}
          <fieldset class="signer-fieldset" disabled={addressesLoading}>
            <legend class="sponsor-deposit-label">Pay deposit from</legend>
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
                  <span class="signer-option-title">Default signer</span>
                  <span class="signer-option-sub">Same as DM wallet</span>
                  <code class="signer-addr">{shortAddress(defaultSignerAddress)}</code>
                  <span class="signer-balance">
                    {#if addressesLoading || defaultBalance.loading}
                      Balance: …
                    {:else if defaultBalance.error}
                      Balance unavailable
                    {:else if defaultSignerAddress}
                      Balance: {defaultBalance.balanceDecimal} {defaultBalance.symbol}
                    {:else}
                      Not configured
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
                  <span class="signer-option-title">Squad-assigned signer</span>
                  <span class="signer-option-sub">Bound to this squad roster</span>
                  <code class="signer-addr">{shortAddress(squadSignerAddress)}</code>
                  <span class="signer-balance">
                    {#if addressesLoading || squadBalance.loading}
                      Balance: …
                    {:else if squadBalance.error}
                      Balance unavailable
                    {:else if squadSignerAddress}
                      Balance: {squadBalance.balanceDecimal} {squadBalance.symbol}
                    {:else}
                      Not assigned
                    {/if}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        {/if}

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
        {:else if depositExceedsBalance}
          <p class="input-error" role="alert">
            Deposit must stay below {selectedBalance.balanceDecimal}
            {selectedSymbol} on {network} so this wallet can pay gas.
          </p>
        {/if}
        <div class="sponsor-deposit-actions">
          <button type="button" class="btn-secondary" on:click={() => (showDepositForm = false)} disabled={depositing}>
            Cancel
          </button>
          <button type="button" class="btn-primary" on:click={submitDeposit} disabled={!canConfirmDeposit}>
            {depositing ? 'Sending…' : 'Confirm deposit'}
          </button>
        </div>
      </div>
    {:else}
      <button type="button" class="btn-primary sponsor-deposit-btn" on:click={openDepositForm}>
        Deposit
      </button>
    {/if}
  {/if}
</section>

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
    background: var(--accent);
    color: var(--accent-contrast, #fff);
    border: none;
  }

  .btn-secondary {
    background: var(--bg-secondary);
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
    color: var(--accent);
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
    border-color: var(--accent, #6ea8fe);
    background: color-mix(in srgb, var(--accent, #6ea8fe) 8%, var(--bg-panel));
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

  .sponsor-deposit-btn {
    margin-top: 4px;
  }
</style>
