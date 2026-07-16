<script lang="ts">
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { deploySquadSponsorForParent } from '../../../lib/governance/api';
  import { getEvmNativeBalance } from '../../../lib/wallet/backend-wallet';
  import { runOnChainInBackground } from '../../../lib/evm/on-chain-background';
  import { resolveSquadRosterEvmAddress } from '../../../lib/squad/squad-roster-binding';
  import { parseEther, getAddress, isAddress } from 'viem';
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

  type SignerBalance = {
    balanceRaw: string;
    balanceDecimal: string;
    symbol: string;
    loading: boolean;
    error: string;
  };

  let deployNetwork: SupportedChainId | '' = squadNetwork ?? '';
  let initialDepositEth = '';
  let deployError = '';

  let squadSignerAddress: string | null = null;
  let addressesLoading = true;
  let refreshSeq = 0;
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

  function canonicalAddress(addr: string | null): string | null {
    if (!addr?.trim() || !isAddress(addr.trim() as `0x${string}`)) return null;
    try {
      return getAddress(addr.trim() as `0x${string}`);
    } catch {
      return null;
    }
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
      const squadAddr = await resolveSquadRosterEvmAddress(parentId.trim());
      if (seq !== refreshSeq) return;
      squadSignerAddress = squadAddr?.trim() || null;
    } finally {
      if (seq === refreshSeq) addressesLoading = false;
    }
    if (seq !== refreshSeq) return;
    squadBalance = await fetchBalance(squadSignerAddress);
  }

  async function fetchBalance(address: string | null): Promise<SignerBalance> {
    if (!address || !deployNetwork) return emptyBalance();
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

  $: squadCanonical = canonicalAddress(squadSignerAddress);
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
    squadCanonical != null &&
    !squadBalance.loading &&
    !squadBalance.error &&
    amountExceedsBalance(depositTrimmed, squadBalance.balanceRaw);

  $: signerUnavailable = !squadCanonical;

  $: canDeploy =
    deployNetwork !== '' &&
    !addressesLoading &&
    !signerUnavailable &&
    depositWei !== null &&
    !depositInvalidFormat &&
    !depositExceedsBalance &&
    !squadBalance.loading;

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
        'No squad-assigned signer for this squad. Bind one from Settings or Inbox, then fund it for gas.';
      return;
    }
    const initialDepositWei = depositWei?.toString();
    if (!initialDepositWei) {
      deployError = 'Enter an initial deposit greater than zero (e.g. 0.01).';
      return;
    }
    if (depositExceedsBalance) {
      deployError = `Deposit must stay below your ${squadBalance.symbol} balance (${squadBalance.balanceDecimal}) so this wallet can pay gas.`;
      return;
    }
    const jobParams = {
      network: deployNetwork,
      parentId: parentId.trim(),
      initialDepositWei,
      signerWallet: 'squad' as const,
    };
    onClose();
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
      },
    });
  }
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible contentClass="deploy-sponsor-modal-panel">
  <h2 id={titleId}>Deploy squad sponsor (Ext)</h2>
  <p id={descId} class="sponsor-deploy-desc">
    Standalone Ext sponsor: you become owner and manage the allowlist. Gas and the initial deposit are
    paid from your squad-assigned EVM address (generated or default-bound on this roster).
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

  <div class="sponsor-signer-single" aria-live="polite">
    <span class="sponsor-deploy-label">Pay gas and deposit from</span>
    <p class="sponsor-signer-single-addr">
      <code>{shortAddress(squadCanonical)}</code>
      <span class="sponsor-signer-single-sub">Squad-assigned signer</span>
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
      disabled={signerUnavailable}
      autocomplete="off"
      required
      aria-invalid={depositInvalidFormat || depositExceedsBalance ? 'true' : undefined}
    />
    {#if depositInvalidFormat}
      <p class="input-error" role="alert">Enter a valid ETH amount greater than zero (e.g. 0.01).</p>
    {:else if depositExceedsBalance}
      <p class="input-error" role="alert">
        Deposit must stay below {squadBalance.balanceDecimal}
        {squadBalance.symbol} on {deployNetwork} so this wallet can pay gas.
      </p>
    {:else if squadCanonical && depositWei !== null}
      <p class="sponsor-deploy-hint">
        Depositing from {shortAddress(squadCanonical)}.
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

  .sponsor-signer-single {
    margin: 0 0 14px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel);
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
