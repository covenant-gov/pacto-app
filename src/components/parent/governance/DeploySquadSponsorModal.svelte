<script lang="ts">
  import Modal from '../../ui/Modal.svelte';
  import type { SupportedChainId } from '../../../lib/wallet/chains';
  import { deploySquadSponsorForParent } from '../../../lib/governance/api';
  import { getInvokeErrorMessage } from '../../../lib/utils/tauri-errors';
  import { parseWalletOpError } from '../../../lib/wallet/backend-wallet';
  import { parseEther } from 'viem';

  export let parentId: string;
  export let parentType: 'squad' | 'network' = 'squad';
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

  let deployNetwork: SupportedChainId = 'sepolia';
  let initialDepositEth = '';
  let deployError = '';
  let deploying = false;

  async function confirmDeploy() {
    deployError = '';
    deploying = true;
    try {
      let initialDepositWei: string | null = null;
      const trimmed = initialDepositEth.trim();
      if (trimmed) {
        try {
          initialDepositWei = parseEther(trimmed).toString();
        } catch {
          deployError = 'Initial deposit must be a valid ETH amount (e.g. 0.01).';
          return;
        }
      }
      const result = await deploySquadSponsorForParent({
        network: deployNetwork,
        parentId: parentId.trim(),
        initialDepositWei,
      });
      await onComplete({
        txHash: result.txHash,
        chain: result.chain,
        sponsorAddress: result.sponsorAddress,
        providerPayload: result.providerPayload,
        infraRowId: result.infraRowId,
      });
      onClose();
    } catch (e) {
      let raw = getInvokeErrorMessage(e, 'Sponsor deploy failed.');
      const parsed = parseWalletOpError(raw);
      if (parsed?.message) raw = parsed.message;
      deployError = raw;
    } finally {
      deploying = false;
    }
  }
</script>

<Modal {titleId} descriptionId={descId} {onClose} dismissible={!deploying} contentClass="deploy-sponsor-modal-panel">
  <h2 id={titleId}>Deploy squad sponsor</h2>
  <p id={descId} class="sponsor-deploy-desc">
    Creates a per-{parentType} sponsor clone from the factory. Gas is paid from your embedded wallet. Optional initial
    deposit seeds the sponsorship pool in the same transaction.
  </p>

  <div class="sponsor-deploy-field">
    <label class="sponsor-deploy-label" for="sponsor-deploy-network">Network</label>
    <select
      id="sponsor-deploy-network"
      class="sponsor-deploy-input sponsor-deploy-select"
      bind:value={deployNetwork}
      disabled={deploying}
    >
      <option value="sepolia">Sepolia</option>
      <option value="mainnet">Ethereum</option>
      <option value="optimism">Optimism</option>
    </select>
  </div>

  <div class="sponsor-deploy-field">
    <label class="sponsor-deploy-label" for="sponsor-initial-deposit">Initial deposit (ETH, optional)</label>
    <input
      id="sponsor-initial-deposit"
      type="text"
      class="sponsor-deploy-input"
      placeholder="e.g. 0.01 — leave empty to deploy without funding"
      bind:value={initialDepositEth}
      disabled={deploying}
      autocomplete="off"
    />
  </div>

  {#if deployError}
    <p class="input-error" role="alert">{deployError}</p>
  {/if}

  <div class="modal-actions">
    <button type="button" class="btn-secondary" on:click={onClose} disabled={deploying}>Cancel</button>
    <button type="button" class="btn-primary" on:click={confirmDeploy} disabled={deploying}>
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

  .sponsor-deploy-label {
    display: block;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 6px;
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

  .sponsor-deploy-select {
    max-width: 240px;
  }
</style>
