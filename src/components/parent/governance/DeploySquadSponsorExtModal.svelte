<script lang="ts">
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
      deployError = 'Select a network for this squad.';
      return;
    }
    if (ownerUnavailable) {
      deployError =
        'No squad-assigned EVM for this squad. Bind one from Settings or Inbox — that address becomes Ext allowlist owner.';
      return;
    }
    if (payerUnavailable) {
      deployError = 'Selected payer wallet is unavailable.';
      return;
    }
    const initialDepositWei = depositWei?.toString();
    if (!initialDepositWei) {
      deployError = 'Enter an initial deposit greater than zero (e.g. 0.01).';
      return;
    }
    if (depositExceedsBalance) {
      deployError = `Deposit must stay below your ${selectedBalance.symbol} balance (${selectedBalance.balanceDecimal}) so this wallet can pay gas.`;
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
      startedToast: 'Squad sponsor Ext deploy submitted. Confirmation continues in the background.',
      subject: 'Squad sponsor Ext deploy',
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
  <h2 id={titleId}>Deploy squad sponsor (Ext)</h2>
  <p id={descId} class="sponsor-deploy-desc">
    You deploy and fund; your squad-assigned EVM owns the allowlist. Gas and the initial deposit may come from
    Default (DM) or the roster key — ownership stays on the roster address.
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
    <span class="sponsor-deploy-label">Allowlist owner (addressOwner)</span>
    <p class="sponsor-signer-single-addr">
      <code>{shortAddress(squadCanonical)}</code>
      <span class="sponsor-signer-single-sub">Squad-assigned roster EVM</span>
    </p>
  </div>

  {#if signersAreSame}
    <div class="sponsor-signer-single" aria-live="polite">
      <span class="sponsor-deploy-label">Pay gas and deposit from</span>
      <p class="sponsor-signer-single-addr">
        <code>{shortAddress(squadCanonical)}</code>
        <span class="sponsor-signer-single-sub">Squad signer (same as Default)</span>
      </p>
      <p class="sponsor-signer-balance">
        {#if addressesLoading || squadBalance.loading}
          Balance: …
        {:else if squadBalance.error}
          Balance unavailable
        {:else if squadCanonical}
          Balance: {squadBalance.balanceDecimal} {squadBalance.symbol}
        {:else}
          Not assigned — bind a squad EVM address first
        {/if}
      </p>
    </div>
  {:else}
    <fieldset class="sponsor-payer-fieldset" disabled={addressesLoading || deploying}>
      <legend class="sponsor-deploy-label">Pay gas and deposit from</legend>
      <label class="sponsor-payer-option">
        <input type="radio" bind:group={signerWallet} value="default" />
        <span>
          Default signer
          <code class="sponsor-payer-code">{shortAddress(defaultCanonical)}</code>
          <span class="sponsor-signer-balance">
            {#if addressesLoading || defaultBalance.loading}
              Balance: …
            {:else if defaultBalance.error}
              Balance unavailable
            {:else if defaultCanonical}
              Balance: {defaultBalance.balanceDecimal} {defaultBalance.symbol}
            {:else}
              Not set
            {/if}
          </span>
        </span>
      </label>
      <label class="sponsor-payer-option">
        <input type="radio" bind:group={signerWallet} value="squad" />
        <span>
          Squad-assigned
          <code class="sponsor-payer-code">{shortAddress(squadCanonical)}</code>
          <span class="sponsor-signer-balance">
            {#if addressesLoading || squadBalance.loading}
              Balance: …
            {:else if squadBalance.error}
              Balance unavailable
            {:else if squadCanonical}
              Balance: {squadBalance.balanceDecimal} {squadBalance.symbol}
            {:else}
              Not assigned
            {/if}
          </span>
        </span>
      </label>
    </fieldset>
  {/if}

  <div class="sponsor-deploy-field">
    <label class="sponsor-deploy-label" for="sponsor-ext-initial-deposit">Initial deposit (ETH)</label>
    <input
      id="sponsor-ext-initial-deposit"
      type="text"
      class="sponsor-deploy-input"
      class:input-invalid={depositInvalidFormat || depositExceedsBalance}
      placeholder="e.g. 0.01"
      value={initialDepositEth}
      on:input={onDepositInput}
      disabled={ownerUnavailable || payerUnavailable || deploying}
      autocomplete="off"
      required
      aria-invalid={depositInvalidFormat || depositExceedsBalance ? 'true' : undefined}
    />
    {#if depositInvalidFormat}
      <p class="input-error" role="alert">Enter a valid ETH amount greater than zero (e.g. 0.01).</p>
    {:else if depositExceedsBalance}
      <p class="input-error" role="alert">
        Deposit must stay below {selectedBalance.balanceDecimal}
        {selectedBalance.symbol} on {deployNetwork} so this wallet can pay gas.
      </p>
    {:else if depositWei !== null}
      <p class="sponsor-deploy-hint">
        Depositing from {shortAddress(payFromEffective === 'default' ? defaultCanonical : squadCanonical)};
        owner remains {shortAddress(squadCanonical)}.
      </p>
    {/if}
  </div>

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose} disabled={deploying}>Cancel</button>
    <button type="button" class="btn-primary" on:click={confirmDeploy} disabled={!canDeploy}>
      {deploying ? 'Deploying…' : 'Deploy on-chain'}
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
