<script lang="ts">
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import {
    deploySquadSponsorForParent,
    type SquadSponsorDeploySignerWallet,
  } from '../../../lib/governance/api';
  import { getEvmNativeBalance } from '../../../lib/wallet/backend-wallet';
  import { runOnChainInBackground } from '../../../lib/evm/on-chain-background';
  import { getActiveSquadEvmSignerAddress } from '../../../lib/wallet/evm-accounts';
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

  const titleId = 'deploy-sponsor-title';
  const descId = 'deploy-sponsor-desc';

  type SignerBalance = {
    balanceRaw: string;
    balanceDecimal: string;
    symbol: string;
    loading: boolean;
    error: string;
  };

  let deployNetwork: SupportedChainId | '' = squadNetwork ?? '';
  let signerWallet: SquadSponsorDeploySignerWallet = 'squad';
  let initialDepositEth = '';
  let deployError = '';

  let defaultSignerAddress: string | null = null;
  let squadSignerAddress: string | null = null;
  let addressesLoading = true;
  let refreshSeq = 0;

  let defaultBalance: SignerBalance = emptyBalance();
  let squadBalance: SignerBalance = emptyBalance();

  function emptyBalance(): SignerBalance {
    return { balanceRaw: '0', balanceDecimal: '0', symbol: 'ETH', loading: false, error: '' };
  }

  function shortAddress(addr: string | null): string {
    if (!addr) return 'Not set';
    const t = addr.trim();
    if (t.length < 18) return t;
    return `${t.slice(0, 10)}…${t.slice(-8)}`;
  }

  function parsePositiveDepositWei(amountTrimmed: string): bigint | null {
    try {
      const wei = parseEther(amountTrimmed.replace(/,/g, ''));
      return wei > 0n ? wei : null;
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

  async function refreshAll() {
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
      if (signerWallet === 'default' && !defaultSignerAddress && squadSignerAddress) {
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

  async function fetchBalance(address: string | null): Promise<SignerBalance> {
    if (!address || !deployNetwork) return emptyBalance();
    const loading = { ...emptyBalance(), loading: true };
    const result = await getEvmNativeBalance(deployNetwork, address);
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

  $: parentId, deployNetwork, void refreshAll();

  $: selectedAddress =
    signerWallet === 'default' ? defaultSignerAddress : squadSignerAddress;
  $: selectedBalance = signerWallet === 'default' ? defaultBalance : squadBalance;

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
    selectedAddress != null &&
    !selectedBalance.loading &&
    !selectedBalance.error &&
    amountExceedsBalance(depositTrimmed, selectedBalance.balanceRaw);

  $: signerUnavailable =
    signerWallet === 'default' ? !defaultSignerAddress : !squadSignerAddress;

  $: canDeploy =
    deployNetwork !== '' &&
    !addressesLoading &&
    !signerUnavailable &&
    depositWei !== null &&
    !depositInvalidFormat &&
    !depositExceedsBalance &&
    !selectedBalance.loading;

  function onDepositInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    initialDepositEth = normalizeLeadingDotDecimalInput(el.value);
  }

  async function confirmDeploy() {
    deployError = '';
    if (!deployNetwork) {
      deployError = 'Select a network for this squad.';
      return;
    }
    if (signerUnavailable) {
      deployError =
        signerWallet === 'default'
          ? 'Set a default signer under Settings → Default wallet config.'
          : 'No squad-assigned signer for this squad. Bind one from Settings or Inbox.';
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
    const jobParams = {
      network: deployNetwork,
      parentId: parentId.trim(),
      initialDepositWei,
      signerWallet,
    };
    onClose();
    runOnChainInBackground({
      startedToast: 'Squad sponsor deploy submitted. Confirmation continues in the background.',
      subject: 'Squad sponsor deploy',
      job: () => deploySquadSponsorForParent(jobParams),
      onSuccess: async (result) => {
        await onComplete({
          txHash: result.txHash,
          chain: result.chain,
          sponsorAddress: result.sponsorAddress,
          providerPayload: result.providerPayload,
          infraRowId: result.infraRowId,
        });
      },
    });
  }
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible contentClass="deploy-sponsor-modal-panel">
  <h2 id={titleId}>Deploy squad sponsor</h2>
  <p id={descId} class="sponsor-deploy-desc">
    Creates a per-squad sponsor clone from the factory. Gas is paid from the signer you choose below. An
    initial deposit seeds the sponsorship pool in the same transaction.
  </p>

  <div class="sponsor-deploy-field">
    <SquadDeployNetworkField
      id="sponsor-deploy-network"
      {squadNetwork}
      bind:value={deployNetwork}
      labelClass="sponsor-deploy-label"
      selectClass="sponsor-deploy-input sponsor-deploy-select"
    />
  </div>

  <fieldset class="sponsor-signer-fieldset" disabled={addressesLoading}>
    <legend class="sponsor-deploy-label">Pay gas and deposit from</legend>
    <div class="sponsor-signer-options">
      <label class="sponsor-signer-option" class:selected={signerWallet === 'default'}>
        <input
          type="radio"
          name="sponsor-deploy-signer"
          value="default"
          bind:group={signerWallet}
          disabled={!defaultSignerAddress}
        />
        <span class="sponsor-signer-option-body">
          <span class="sponsor-signer-option-title">Default signer</span>
          <span class="sponsor-signer-option-sub">Same as DM wallet</span>
          <code class="sponsor-signer-addr">{shortAddress(defaultSignerAddress)}</code>
          <span class="sponsor-signer-balance">
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

      <label class="sponsor-signer-option" class:selected={signerWallet === 'squad'}>
        <input
          type="radio"
          name="sponsor-deploy-signer"
          value="squad"
          bind:group={signerWallet}
          disabled={!squadSignerAddress}
        />
        <span class="sponsor-signer-option-body">
          <span class="sponsor-signer-option-title">Squad-assigned signer</span>
          <span class="sponsor-signer-option-sub">Bound to this squad roster</span>
          <code class="sponsor-signer-addr">{shortAddress(squadSignerAddress)}</code>
          <span class="sponsor-signer-balance">
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

  <div class="sponsor-deploy-field">
    <label class="sponsor-deploy-label" for="sponsor-initial-deposit">Initial deposit (ETH)</label>
    <input
      id="sponsor-initial-deposit"
      type="text"
      class="sponsor-deploy-input"
      class:input-invalid={depositInvalidFormat || depositExceedsBalance}
      placeholder="e.g. 0.01"
      value={initialDepositEth}
      on:input={onDepositInput}
      disabled={signerUnavailable}
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
    {:else if selectedAddress && depositWei !== null}
      <p class="sponsor-deploy-hint">
        Depositing from {shortAddress(selectedAddress)}.
      </p>
    {/if}
  </div>

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose}>Cancel</button>
    <button type="button" class="btn-primary" on:click={confirmDeploy} disabled={!canDeploy}>
      Deploy on-chain
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

  .sponsor-signer-fieldset {
    margin: 0 0 14px;
    padding: 0;
    border: none;
    min-width: 0;
  }

  .sponsor-deploy-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .sponsor-signer-options {
    display: grid;
    gap: 8px;
  }

  .sponsor-signer-option {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
    cursor: pointer;
  }

  .sponsor-signer-option.selected {
    border-color: var(--accent, #6ea8fe);
    background: color-mix(in srgb, var(--accent, #6ea8fe) 8%, var(--bg-panel));
  }

  .sponsor-signer-option:has(input:disabled) {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .sponsor-signer-option input {
    margin-top: 3px;
    flex-shrink: 0;
  }

  .sponsor-signer-option-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .sponsor-signer-option-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .sponsor-signer-option-sub {
    font-size: 0.8125rem;
    color: var(--text-muted);
  }

  .sponsor-signer-addr {
    font-size: 0.8125rem;
    color: var(--text-secondary);
    margin-top: 2px;
  }

  .sponsor-signer-balance {
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
