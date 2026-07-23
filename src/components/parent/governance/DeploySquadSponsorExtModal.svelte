<script lang="ts">
  import { t } from 'svelte-i18n';
  import { get } from 'svelte/store';
  import { onDestroy } from 'svelte';
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { deploySquadSponsorForParent, type SquadSponsorDeploySignerWallet } from '../../../lib/governance/api';
  import { getEvmAddress } from '../../../lib/api/auth';
  import { getActiveSquadEvmSignerAddress } from '../../../lib/wallet/evm-accounts';
  import {
    amountExceedsBalance,
    canonicalAddress,
    emptyBalance,
    fetchEvmBalance,
    loadingBalance,
    reconcileSignerWallet,
    shortAddress,
    shouldPreferFundedDefault,
    type SignerBalance,
  } from '../../../lib/wallet/signer-balance';
  import { runOnChainInBackground } from '../../../lib/evm/on-chain-background';
  import { resolveSquadRosterEvmAddress } from '../../../lib/squad/squad-roster-binding';
  import { parseEther } from 'viem';
  import { normalizeLeadingDotDecimalInput } from '../../../lib/wallet/amount-input';
  import SquadDeployNetworkField from './SquadDeployNetworkField.svelte';

  export let parentId: string;
  /** Established squad network; when set the picker is pinned to it. */
  export let squadNetwork: SupportedChainId | null = null;
  export let onClose: () => void;
  export let onComplete: (result: {
    txHash: string;
    chain: string;
    sponsorAddress: string;
    providerPayload: string;
    infraRowId: string;
  }) => Promise<void>;

  const titleId = 'deploy-sponsor-ext-title';
  const descId = 'deploy-sponsor-ext-desc';

  const tFn = get(t);

  let deployNetwork: SupportedChainId | '' = squadNetwork ?? '';
  let initialDepositEth = '';
  let deployError = '';
  let deploying = false;
  let closed = false;

  let signerWallet: SquadSponsorDeploySignerWallet = 'default';
  let defaultSignerAddress: string | null = null;
  let squadSignerAddress: string | null = null;
  let addressesLoading = true;
  let refreshSeq = 0;
  let preferredPayerOnce = false;
  let defaultBalance: SignerBalance = emptyBalance();
  let squadBalance: SignerBalance = emptyBalance();

  function parsePositiveDepositWei(amountTrimmed: string): bigint | null {
    try {
      const wei = parseEther(amountTrimmed.replace(/,/g, ''));
      return wei > 0n ? wei : null;
    } catch {
      return null;
    }
  }

  async function refreshAll() {
    const seq = ++refreshSeq;
    addressesLoading = true;
    defaultBalance = loadingBalance();
    squadBalance = loadingBalance();
    try {
      const [defaultAddr, squadAddr, profileAddr] = await Promise.all([
        getActiveSquadEvmSignerAddress(),
        resolveSquadRosterEvmAddress(parentId.trim()),
        getEvmAddress(),
      ]);
      if (closed || seq !== refreshSeq) return;
      defaultSignerAddress = defaultAddr?.trim() || profileAddr?.trim() || null;
      squadSignerAddress = squadAddr?.trim() || null;
      signerWallet = reconcileSignerWallet(signerWallet, defaultSignerAddress, squadSignerAddress);

      const [defaultBal, squadBal] = await Promise.all([
        fetchEvmBalance(deployNetwork, defaultSignerAddress),
        fetchEvmBalance(deployNetwork, squadSignerAddress),
      ]);
      if (closed || seq !== refreshSeq) return;
      defaultBalance = defaultBal;
      squadBalance = squadBal;
      if (
        !preferredPayerOnce &&
        shouldPreferFundedDefault({
          defaultSignerAddress,
          squadSignerAddress,
          defaultBalanceRaw: defaultBalance.balanceRaw,
          squadBalanceRaw: squadBalance.balanceRaw,
        })
      ) {
        signerWallet = 'default';
        preferredPayerOnce = true;
      }
    } catch {
      if (!closed && seq === refreshSeq) {
        defaultSignerAddress = null;
        squadSignerAddress = null;
        defaultBalance = emptyBalance();
        squadBalance = emptyBalance();
      }
    } finally {
      if (!closed && seq === refreshSeq) addressesLoading = false;
    }
  }

  onDestroy(() => {
    closed = true;
    refreshSeq += 1;
  });

  $: parentId, deployNetwork, void refreshAll();

  $: defaultCanonical = canonicalAddress(defaultSignerAddress);
  $: squadCanonical = canonicalAddress(squadSignerAddress);
  $: signersAreSame =
    defaultCanonical != null && squadCanonical != null && defaultCanonical === squadCanonical;
  $: payFromEffective = (signersAreSame ? 'squad' : signerWallet) as SquadSponsorDeploySignerWallet;
  $: selectedBalance = signersAreSame
    ? squadBalance
    : payFromEffective === 'default'
      ? defaultBalance
      : squadBalance;

  $: depositTrimmed = initialDepositEth.trim();
  $: depositWei = parsePositiveDepositWei(depositTrimmed);
  $: depositInvalidFormat =
    depositTrimmed.length > 0 &&
    (() => {
      try {
        parseEther(depositTrimmed.replace(/,/g, ''));
        return depositWei === null;
      } catch {
        return true;
      }
    })();

  $: depositExceedsBalance =
    depositWei !== null &&
    !selectedBalance.loading &&
    !selectedBalance.error &&
    amountExceedsBalance(depositTrimmed, selectedBalance.balanceRaw);

  $: ownerUnavailable = !squadCanonical;
  $: payerUnavailable = signersAreSame
    ? !squadCanonical
    : payFromEffective === 'default'
      ? !defaultCanonical
      : !squadCanonical;

  $: canDeploy =
    deployNetwork !== '' &&
    !addressesLoading &&
    !ownerUnavailable &&
    !payerUnavailable &&
    !deploying &&
    depositWei !== null &&
    !depositInvalidFormat &&
    !depositExceedsBalance &&
    !selectedBalance.loading;

  function onDepositInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    initialDepositEth = normalizeLeadingDotDecimalInput(el.value);
  }

  function confirmDeploy() {
    if (deploying) return;
    deployError = '';
    if (!deployNetwork) {
      deployError = tFn('governance.deploySquadSponsorExt.error.noNetwork');
      return;
    }
    if (ownerUnavailable) {
      deployError =
        tFn('governance.deploySquadSponsorExt.error.noOwnerEvm');
      return;
    }
    if (payerUnavailable) {
      deployError = tFn('governance.deploySquadSponsorExt.error.payerUnavailable');
      return;
    }
    const initialDepositWei = depositWei?.toString();
    if (!initialDepositWei) {
      deployError = tFn('governance.deploySquadSponsorExt.error.depositGreaterThanZero');
      return;
    }
    if (depositExceedsBalance) {
      deployError = tFn('governance.deploySquadSponsorExt.deposit.error.exceedsBalance', { values: { balance: selectedBalance.balanceDecimal, symbol: selectedBalance.symbol, network: deployNetwork } });
      return;
    }
    deploying = true;
    const jobParams = {
      network: deployNetwork,
      parentId: parentId.trim(),
      initialDepositWei,
      signerWallet: payFromEffective,
    };
    runOnChainInBackground({
      startedToast: tFn('governance.deploySquadSponsorExt.toast.submitted'),
      subject: tFn('governance.deploySquadSponsorExt.subject'),
      job: () => deploySquadSponsorForParent(jobParams),
      onSuccess: async (result) => {
        await onComplete({
          txHash: result.txHash,
          chain: result.chain,
          sponsorAddress: result.sponsorAddress,
          providerPayload: result.providerPayload,
          infraRowId: result.infraRowId,
        });
        onClose();
      },
      onError: (message) => {
        deploying = false;
        deployError = message;
      },
    });
  }
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible={!deploying} contentClass="deploy-sponsor-modal-panel">
  <h2 id={titleId}>{$t('governance.deploySquadSponsorExt.title')}</h2>
  <p id={descId} class="sponsor-deploy-desc">
    {$t('governance.deploySquadSponsorExt.description')}
  </p>

  <div class="sponsor-deploy-field">
    <SquadDeployNetworkField
      id="sponsor-ext-deploy-network"
      {squadNetwork}
      bind:value={deployNetwork}
      labelClass="sponsor-deploy-label"
      selectClass="sponsor-deploy-input sponsor-deploy-select"
    />
  </div>

  <div class="sponsor-owner-block" aria-live="polite">
    <span class="sponsor-deploy-label">{$t('governance.deploySquadSponsorExt.ownerLabel')}</span>
    <p class="sponsor-signer-single-addr">
      <code>{shortAddress(squadCanonical)}</code>
      <span class="sponsor-signer-single-sub">{$t('governance.deploySquadSponsorExt.ownerSub')}</span>
    </p>
  </div>

  {#if signersAreSame}
    <div class="sponsor-signer-single" aria-live="polite">
      <span class="sponsor-deploy-label">{$t('governance.deploySquadSponsorExt.labels.payFrom')}</span>
      <p class="sponsor-signer-single-addr">
        <code>{shortAddress(squadCanonical)}</code>
        <span class="sponsor-signer-single-sub">{$t('governance.deploySquadSponsorExt.signer.singleSub')}</span>
      </p>
      <p class="sponsor-signer-balance">
        {#if addressesLoading || squadBalance.loading}
          {$t('governance.common.balanceLoading')}
        {:else if squadBalance.error}
          {$t('governance.common.balanceUnavailable')}
        {:else if squadCanonical}
          {$t('governance.common.balance', { values: { balance: squadBalance.balanceDecimal, symbol: squadBalance.symbol } })}
        {:else}
          {$t('governance.deploySquadSponsorExt.notAssignedBindFirst')}
        {/if}
      </p>
    </div>
  {:else}
    <fieldset class="sponsor-payer-fieldset" disabled={addressesLoading || deploying}>
      <legend class="sponsor-deploy-label">{$t('governance.deploySquadSponsorExt.labels.payFrom')}</legend>
      <label class="sponsor-payer-option">
        <input type="radio" bind:group={signerWallet} value="default" />
        <span>
          {$t('governance.deploySquadSponsorExt.signer.default')}
          <code class="sponsor-payer-code">{shortAddress(defaultCanonical)}</code>
          <span class="sponsor-signer-balance">
            {#if addressesLoading || defaultBalance.loading}
              {$t('governance.common.balanceLoading')}
            {:else if defaultBalance.error}
              {$t('governance.common.balanceUnavailable')}
            {:else if defaultCanonical}
              {$t('governance.common.balance', { values: { balance: defaultBalance.balanceDecimal, symbol: defaultBalance.symbol } })}
            {:else}
              {$t('governance.common.notSet')}
            {/if}
          </span>
        </span>
      </label>
      <label class="sponsor-payer-option">
        <input type="radio" bind:group={signerWallet} value="squad" />
        <span>
          {$t('governance.deploySquadSponsorExt.signer.squad')}
          <code class="sponsor-payer-code">{shortAddress(squadCanonical)}</code>
          <span class="sponsor-signer-balance">
            {#if addressesLoading || squadBalance.loading}
              {$t('governance.common.balanceLoading')}
            {:else if squadBalance.error}
              {$t('governance.common.balanceUnavailable')}
            {:else if squadCanonical}
              {$t('governance.common.balance', { values: { balance: squadBalance.balanceDecimal, symbol: squadBalance.symbol } })}
            {:else}
              {$t('governance.common.notAssigned')}
            {/if}
          </span>
        </span>
      </label>
    </fieldset>
  {/if}

  <div class="sponsor-deploy-field">
    <label class="sponsor-deploy-label" for="sponsor-ext-initial-deposit">{$t('governance.deploySquadSponsorExt.deposit.label')}</label>
    <input
      id="sponsor-ext-initial-deposit"
      type="text"
      class="sponsor-deploy-input"
      class:input-invalid={depositInvalidFormat || depositExceedsBalance}
      placeholder={$t('governance.deploySquadSponsorExt.deposit.placeholder')}
      value={initialDepositEth}
      on:input={onDepositInput}
      disabled={ownerUnavailable || payerUnavailable || deploying}
      autocomplete="off"
      required
      aria-invalid={depositInvalidFormat || depositExceedsBalance ? 'true' : undefined}
    />
    {#if depositInvalidFormat}
      <p class="input-error" role="alert">{$t('governance.deploySquadSponsorExt.deposit.error.invalid')}</p>
    {:else if depositExceedsBalance}
      <p class="input-error" role="alert">
        {$t('governance.deploySquadSponsorExt.deposit.error.exceedsBalance', { values: { balance: selectedBalance.balanceDecimal, symbol: selectedBalance.symbol, network: deployNetwork } })}
      </p>
    {:else if depositWei !== null}
      <p class="sponsor-deploy-hint">
        {$t('governance.deploySquadSponsorExt.deposit.hint', { values: { payer: shortAddress(payFromEffective === 'default' ? defaultCanonical : squadCanonical), owner: shortAddress(squadCanonical) } })}
      </p>
    {/if}
  </div>

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose} disabled={deploying}>{$t('governance.common.cancel')}</button>
    <button type="button" class="btn-primary" on:click={confirmDeploy} disabled={!canDeploy}>
      {deploying ? $t('governance.common.deploying') : $t('governance.common.deployOnChain')}
    </button>
  </div>
</Modal>

<style>
  .sponsor-deploy-desc {
    margin: 0 0 16px;
    font-size: 0.9375rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 52ch;
  }

  .sponsor-deploy-field {
    margin-bottom: 14px;
  }

  .sponsor-owner-block,
  .sponsor-signer-single {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }

  .sponsor-payer-fieldset {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }

  .sponsor-payer-option {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin-top: 8px;
    font-size: 0.9375rem;
    cursor: pointer;
  }

  .sponsor-payer-code {
    display: inline-block;
    margin-left: 6px;
    font-size: 0.8125rem;
  }

  .sponsor-signer-single-addr {
    margin: 4px 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
    font-size: 0.9375rem;
  }

  .sponsor-signer-single-sub {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .sponsor-deploy-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .sponsor-signer-balance {
    display: block;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .sponsor-deploy-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    color: var(--text-primary);
    font-size: 0.9375rem;
  }

  .sponsor-deploy-input.input-invalid {
    border-color: var(--danger, #e55353);
  }

  .sponsor-deploy-select {
    max-width: 240px;
  }

  .sponsor-deploy-hint {
    margin: 6px 0 0;
    font-size: 0.8125rem;
    color: var(--text-muted);
  }
</style>
